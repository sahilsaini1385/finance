// RSU vesting schedule — unvested equity tracked as FUTURE INCOME, never as
// an asset. Unvested value shows on the Overview (explicitly outside net
// worth); vests still scheduled for the current year feed the reconciled
// gross-income estimate (facts.js), so taxes and the advisor see true
// expected income instead of only what has already vested.

// The household's real Amazon vesting schedule (18 scheduled distributions,
// pasted from the equity portal on 2026-08-13, ≈$267.28/share). Seeded once
// by a data migration when the state looks like this household (an Amazon
// account or paystub exists) and no vests have been entered yet — so the
// schedule is just there, no retyping. Deterministic ids keep family-sync
// merges duplicate-free if both phones seed independently.
export const AMZN_SEED = {
  symbol: 'AMZN',
  price: '267.28',
  vests: [
    { date: '2026-08-15', amount: 30469.92, units: 114 },
    { date: '2026-08-21', amount: 51050.48, units: 191 },
    { date: '2026-11-15', amount: 30469.92, units: 114 },
    { date: '2026-11-21', amount: 51050.48, units: 191 },
    { date: '2027-02-15', amount: 30202.64, units: 113 },
    { date: '2027-02-21', amount: 50783.20, units: 190 },
    { date: '2027-05-15', amount: 40626.56, units: 152 },
    { date: '2027-05-21', amount: 70561.92, units: 264 },
    { date: '2027-08-15', amount: 40626.56, units: 152 },
    { date: '2027-08-21', amount: 70561.92, units: 264 },
    { date: '2027-11-15', amount: 40626.56, units: 152 },
    { date: '2027-11-21', amount: 70561.92, units: 264 },
    { date: '2028-02-15', amount: 40359.28, units: 151 },
    { date: '2028-02-21', amount: 70294.64, units: 263 },
    { date: '2028-05-21', amount: 65750.88, units: 246 },
    { date: '2028-08-21', amount: 65750.88, units: 246 },
    { date: '2028-11-21', amount: 65483.60, units: 245 },
    { date: '2029-02-21', amount: 65483.60, units: 245 },
  ].map(v => ({ ...v, id: `amzn-${v.date}` })),
}

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/[$,%\s,]/g, ''))
  return Number.isNaN(n) ? 0 : n
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

export function vestValue(vest, pricePerShare = 0) {
  const explicit = num(vest.amount)
  if (explicit > 0) return explicit
  return num(vest.units) * num(pricePerShare)
}

// → { totalUnvestedUnits, totalUnvestedValue, lastVestYear, nextVest,
//     remainingThisYear, byYear: [{year, units, value}] }
export function rsuSummary(state, todayStr) {
  const rsu = state.rsu || {}
  const vests = rsu.vests || []
  const price = num(rsu.price)
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
    const value = vestValue(v, price)
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
  const price = num(rsu.price)
  return (rsu.vests || [])
    .filter(v => v.date > afterDate && v.date.slice(0, 4) === String(year))
    .reduce((s, v) => s + vestValue(v, price), 0)
}
