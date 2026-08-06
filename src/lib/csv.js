// CSV parsing + institution format auto-detection.
// Supported exports:
//   Chase credit card:   Transaction Date, Post Date, Description, Category, Type, Amount, Memo
//   Chase checking:      Details, Posting Date, Description, Amount, Type, Balance, Check or Slip #
//   Bank of America:     Date, Description, Amount, Running Bal.  (preceded by a summary block)
//   Fidelity brokerage:  Run Date, Action, Symbol, Description, ..., Amount ($), Settlement Date
//   Fidelity credit card: Date, Transaction, Name, Memo, Amount
//   Generic:             any file with Date / Description / Amount columns

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
  let t = String(s).trim().replace(/[$,]/g, '')
  if (!t) return NaN
  if (t.startsWith('(') && t.endsWith(')')) t = '-' + t.slice(1, -1)
  return parseFloat(t)
}

function normalizeDate(s) {
  if (!s) return null
  const t = String(s).trim()
  // MM/DD/YYYY or MM/DD/YY
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) {
    let [, mo, d, y] = m
    if (y.length === 2) y = '20' + y
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  // YYYY-MM-DD
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return null
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
  if (has('transaction', 'name', 'amount') && has('date')) return 'Fidelity credit card'
  if (has('date', 'description', 'amount')) return 'Generic (Date/Description/Amount)'
  return null
}

export function parseStatement(text) {
  const rows = parseCSV(text)
  if (rows.length === 0) return { error: 'Empty file', transactions: [] }
  const headerIdx = findHeader(rows)
  if (headerIdx === -1) return { error: 'Could not find a header row with Date and Amount columns.', transactions: [] }

  const format = detectFormat(rows, headerIdx)
  if (!format) return { error: 'Unrecognized CSV format.', transactions: [] }

  const header = rows[headerIdx]
  const dateCol = headerIndex(header, 'transaction date', 'posting date', 'run date', 'date')
  const descCol = headerIndex(header, 'description', 'name', 'payee')
  const amountCol = headerIndex(header, 'amount ($)', 'amount')
  const categoryCol = headerIndex(header, 'category')
  const actionCol = headerIndex(header, 'action', 'transaction')

  const transactions = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    if (r.length < 2) continue
    const date = normalizeDate(r[dateCol])
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
  return { format, transactions, error: transactions.length === 0 ? 'No transactions found in file.' : null }
}
