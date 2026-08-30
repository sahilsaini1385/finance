// CSV parsing + institution format auto-detection.
// Supported exports:
//   Chase credit card:   Transaction Date, Post Date, Description, Category, Type, Amount, Memo
//   Chase checking:      Details, Posting Date, Description, Amount, Type, Balance, Check or Slip #
//   Bank of America:     Date, Description, Amount, Running Bal.  (preceded by a summary block)
//   Fidelity brokerage:  Run Date, Action, Symbol, Description, ..., Amount ($), Settlement Date
//   Fidelity credit card: Date, Transaction, Name, Memo, Amount
//   Monzo (UK):          Date, Time, Type, Name, Category, Amount, Currency, …
//   Starling Bank (UK):  Date, Counter Party, Reference, Type, Amount (GBP), Balance (GBP)
//   Revolut:             Type, Product, Started Date, Completed Date, Description, Amount, …
//   Generic:             any file with Date / Description / Amount columns
//
// Dates: US exports write MM/DD/YYYY, UK exports write DD/MM/YYYY, and
// "04/03/2026" alone cannot tell you which. Known UK formats force DD/MM;
// otherwise the whole file is scanned — one row with a first part > 12 proves
// DD/MM, one with a second part > 12 proves MM/DD. A file where every row is
// ambiguous is flagged (dateAmbiguous) so the UI can ask instead of guessing
// silently: an import that swaps March 4th and April 3rd poisons every
// month's budget with no error anywhere.

export function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0].trim() !== '') rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.length > 1 || row[0].trim() !== '') rows.push(row)
  }
  return rows
}

function normalizeAmount(s) {
  if (s === null || s === undefined) return NaN
  // £ and € too — a UK export's "-£42.15" used to fail the whole file.
  let t = String(s).trim().replace(/[$£€,]/g, '')
  if (!t) return NaN
  if (t.startsWith('(') && t.endsWith(')')) t = '-' + t.slice(1, -1)
  return parseFloat(t)
}

// dateStyle: 'mdy' (US) or 'dmy' (UK). Slash and dash accepted either way.
function normalizeDate(s, dateStyle = 'mdy') {
  if (!s) return null
  const t = String(s).trim()
  // MM/DD/YYYY or DD/MM/YYYY (also with dashes), 2- or 4-digit year
  let m = t.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/)
  if (m) {
    let [, a, b, y] = m
    if (y.length === 2) y = '20' + y
    const [mo, d] = dateStyle === 'dmy' ? [b, a] : [a, b]
    if (Number(mo) > 12 || Number(d) > 31) return null // impossible under this style
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  // YYYY-MM-DD
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return null
}

// Scan every slash/dash date in the file: one first-part > 12 proves DD/MM,
// one second-part > 12 proves MM/DD. → {style, ambiguous}
function inferDateStyle(rows, headerIdx, dateCol) {
  let sawDmy = false, sawMdy = false, sawAny = false
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const m = String(rows[i]?.[dateCol] || '').trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-]\d{2,4}/)
    if (!m) continue
    sawAny = true
    if (Number(m[1]) > 12) sawDmy = true
    if (Number(m[2]) > 12) sawMdy = true
  }
  if (sawDmy && !sawMdy) return { style: 'dmy', ambiguous: false }
  if (sawMdy && !sawDmy) return { style: 'mdy', ambiguous: false }
  // Nothing decisive (or contradictory rows): default US, but say so.
  return { style: 'mdy', ambiguous: sawAny }
}

function headerIndex(header, ...names) {
  const lower = header.map(h => h.trim().toLowerCase())
  for (const name of names) {
    const i = lower.indexOf(name.toLowerCase())
    if (i !== -1) return i
  }
  // partial match fallback
  for (const name of names) {
    const i = lower.findIndex(h => h.includes(name.toLowerCase()))
    if (i !== -1) return i
  }
  return -1
}

// Find the header row (BofA files start with a summary block before the real header).
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const lower = rows[i].map(c => c.trim().toLowerCase())
    const hasDate = lower.some(c => c === 'date' || c.includes('date'))
    const hasAmount = lower.some(c => c.includes('amount'))
    if (hasDate && hasAmount) return i
  }
  return -1
}

export function detectFormat(rows, headerIdx) {
  const header = rows[headerIdx].map(c => c.trim().toLowerCase())
  const has = (...names) => names.every(n => header.some(h => h.includes(n)))
  if (has('transaction date', 'post date')) return 'Chase credit card'
  if (has('details', 'posting date')) return 'Chase checking'
  if (has('running bal')) return 'Bank of America'
  if (has('run date', 'amount')) return 'Fidelity brokerage'
  // UK formats before the US ones that could shadow them — these force DD/MM.
  if (has('amount (gbp)')) return 'Starling Bank (UK)'
  if (has('started date', 'completed date')) return 'Revolut'
  if (has('date', 'amount', 'currency') && (has('local amount') || has('emoji'))) return 'Monzo (UK)'
  if (has('transaction', 'name', 'amount') && has('date')) return 'Fidelity credit card'
  if (has('date', 'description', 'amount')) return 'Generic (Date/Description/Amount)'
  return null
}

// Formats whose exports are documented DD/MM — no inference needed.
const DMY_FORMATS = new Set(['Starling Bank (UK)', 'Monzo (UK)', 'Revolut'])
// Formats whose native amounts are pounds.
export const GBP_FORMATS = new Set(['Starling Bank (UK)', 'Monzo (UK)'])

// opts.dateStyle: 'mdy' | 'dmy' — an explicit user choice overrides both the
// per-format rule and the inference.
export function parseStatement(text, opts = {}) {
  const rows = parseCSV(text)
  if (rows.length === 0) return { error: 'Empty file', transactions: [] }
  const headerIdx = findHeader(rows)
  if (headerIdx === -1) return { error: 'Could not find a header row with Date and Amount columns.', transactions: [] }

  const format = detectFormat(rows, headerIdx)
  if (!format) return { error: 'Unrecognized CSV format.', transactions: [] }

  const header = rows[headerIdx]
  const dateCol = headerIndex(header, 'transaction date', 'posting date', 'completed date', 'run date', 'date')
  const descCol = headerIndex(header, 'description', 'name', 'counter party', 'payee')
  const amountCol = headerIndex(header, 'amount ($)', 'amount (gbp)', 'amount')
  const categoryCol = headerIndex(header, 'category')
  const actionCol = headerIndex(header, 'action', 'transaction')

  let dateStyle = opts.dateStyle || null
  let dateAmbiguous = false
  if (!dateStyle) {
    if (DMY_FORMATS.has(format)) dateStyle = 'dmy'
    else {
      const inf = inferDateStyle(rows, headerIdx, dateCol)
      dateStyle = inf.style
      dateAmbiguous = inf.ambiguous
    }
  }

  const transactions = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    if (r.length < 2) continue
    const date = normalizeDate(r[dateCol], dateStyle)
    const amount = normalizeAmount(r[amountCol])
    if (!date || Number.isNaN(amount)) continue // skip summary/disclaimer rows
    let description = (descCol !== -1 && r[descCol] ? r[descCol] : '').trim()
    if (!description && actionCol !== -1) description = (r[actionCol] || '').trim()
    if (format === 'Fidelity brokerage' && actionCol !== -1 && r[actionCol]) {
      description = `${r[actionCol].trim()}${description ? ' — ' + description : ''}`
    }
    transactions.push({
      date,
      description: description || '(no description)',
      amount,
      bankCategory: categoryCol !== -1 ? (r[categoryCol] || '').trim() : '',
    })
  }
  return {
    format,
    transactions,
    dateStyle,
    dateAmbiguous,
    currency: GBP_FORMATS.has(format) ? 'GBP' : 'USD',
    error: transactions.length === 0 ? 'No transactions found in file.' : null,
  }
}
