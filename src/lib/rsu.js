// RSU vesting schedule — unvested equity tracked as FUTURE INCOME, never as
// an asset. Unvested value shows on the Overview (explicitly outside net
// worth); vests still scheduled for the current year feed the reconciled
// gross-income estimate (facts.js), so taxes and the advisor see true
// expected income instead of only what has already vested.

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/[$,%\s,]/g, ''))
  return Number.isNaN(n) ? 0 : n
}

// A price the user typed always wins over a fetched quote — a lookup is a
// reference, never an authority.
export function effectivePrice(rsu = {}) {
  const typed = num(rsu.price)
  if (typed > 0) return typed
  return num(rsu.quote?.price)
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

function parseDate(token) {
  const t = token.trim()
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/) // YYYY-MM-DD
  if (m) return t
  m = t.match(/^([A-Za-z]{3,9})[-/ ](\d{1,2})[-,/ ]+(\d{4})$/) // Aug-15-2026, Aug 15, 2026
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]
    if (mo) return `${m[3]}-${String(mo).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`
  }
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/) // MM/DD/YYYY
  if (m) return `${m[3]}-${String(Number(m[1])).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`
  return null
}

// Parse a pasted vesting schedule — one vest per line, in the shape equity
// portals export: "Aug-15-2026  $30,469.92 USD  114 units". Tolerant of
// missing amounts ("Aug-15-2026 114 units") and CSV/TSV separators.
export function parseVestSchedule(text) {
  const out = []
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const dateTok = line.match(/\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}[-/ ]\d{1,2}[-,/ ]+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{4}/)
    if (!dateTok) continue
    const date = parseDate(dateTok[0])
    if (!date) continue
    const rest = line.replace(dateTok[0], ' ')
    const amountTok = rest.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/)
    const unitsTok = rest.match(/([\d,]+)\s*units?\b/i)
      || (amountTok ? rest.replace(amountTok[0], ' ').match(/(?:^|\s)(\d{1,6})(?:\s|$)/) : rest.match(/(?:^|\s)(\d{1,6})(?:\s|$)/))
    const units = unitsTok ? num(unitsTok[1]) : 0
    const amount = amountTok ? num(amountTok[1]) : 0
    if (units <= 0 && amount <= 0) continue
    out.push({ date, units, amount })
  }
  return out
}

// How a vest is valued.
//   'portal' (default, and what the app has always done): the dollar amount
//     the equity portal exported wins; the price only fills in rows that have
//     none. Faithful to the document, but frozen at export time.
//   'price': value every row with units at units x price. This is what makes a
//     current share price actually move the headline number.
// Rows with units but no amount behave identically under both.
export function vestValue(vest, pricePerShare = 0, basis = 'portal') {
  const explicit = num(vest.amount)
  const units = num(vest.units)
  const price = num(pricePerShare)
  if (basis === 'price' && units > 0 && price > 0) return units * price
  if (explicit > 0) return explicit
  return units * price
}

// True when switching basis would change this row's value — drives the per-row
// "portal $" vs "at $267.28" badge so the two bases are never silently mixed.
export function vestBasisDiffers(vest, pricePerShare = 0) {
  const a = vestValue(vest, pricePerShare, 'portal')
  const b = vestValue(vest, pricePerShare, 'price')
  return Math.abs(a - b) > 0.005
}

// → { totalUnvestedUnits, totalUnvestedValue, lastVestYear, nextVest,
//     remainingThisYear, byYear: [{year, units, value}] }
export function rsuSummary(state, todayStr) {
  const rsu = state.rsu || {}
  const vests = rsu.vests || []
  const price = effectivePrice(rsu)
  const basis = rsu.basis === 'price' ? 'price' : 'portal'
  const today = todayStr || new Date().toISOString().slice(0, 10)
  const year = today.slice(0, 4)

  let totalUnvestedUnits = 0
  let totalUnvestedValue = 0
  let remainingThisYear = 0
  let nextVest = null
  let lastVestYear = null
  const byYear = new Map()
  for (const v of [...vests].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    if (v.date <= today) continue // already vested — payroll actuals own it
    const value = vestValue(v, price, basis)
    totalUnvestedUnits += num(v.units)
    totalUnvestedValue += value
    if (v.date.slice(0, 4) === year) remainingThisYear += value
    if (!nextVest) nextVest = { date: v.date, units: num(v.units), value }
    lastVestYear = v.date.slice(0, 4)
    const y = v.date.slice(0, 4)
    const cur = byYear.get(y) || { year: y, units: 0, value: 0 }
    cur.units += num(v.units)
    cur.value += value
    byYear.set(y, cur)
  }
  return {
    totalUnvestedUnits,
    totalUnvestedValue,
    remainingThisYear,
    nextVest,
    lastVestYear,
    byYear: [...byYear.values()],
  }
}

// Scheduled vests still ahead of the latest pay statement, within the current
// year — the piece of income payroll actuals can't see yet. Strictly after
// the stub date so a vest already inside the YTD never counts twice.
export function rsuScheduledAfter(state, afterDate, year) {
  const rsu = state.rsu || {}
  const price = effectivePrice(rsu)
  const basis = rsu.basis === 'price' ? 'price' : 'portal'
  return (rsu.vests || [])
    .filter(v => v.date > afterDate && v.date.slice(0, 4) === String(year))
    .reduce((s, v) => s + vestValue(v, price, basis), 0)
}
