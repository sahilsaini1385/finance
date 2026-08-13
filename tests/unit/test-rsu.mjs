// RSU schedule — parse, summary math, and the strictly-after-stub guard that
// keeps a vest from counting in both payroll YTD and the scheduled remainder.
import { parseVestSchedule, vestValue, rsuSummary, rsuScheduledAfter } from '../../src/lib/rsu.js'

let pass = 0, fail = 0
const t = (name, cond) => { if (cond) { pass++ } else { fail++; console.log('FAIL:', name) } }
const close = (a, b, eps = 0.01) => Math.abs(a - b) < eps

// --- parseVestSchedule: his exact portal format ---
const SCHEDULE = `
Aug-15-2026  $30,469.92 USD  114 units
Nov-21-2026  $32,608.16 USD  122 units
Feb-21-2027  $33,410.00 USD  125 units
May-15-2027  $32,073.60 USD  120 units
Feb-21-2029  $65,483.60 USD  245 units
`
const vests = parseVestSchedule(SCHEDULE)
t('parses 5 lines', vests.length === 5)
t('first date normalized', vests[0].date === '2026-08-15')
t('first amount', close(vests[0].amount, 30469.92))
t('first units', vests[0].units === 114)
t('last date', vests[4].date === '2029-02-21')
t('last amount', close(vests[4].amount, 65483.60))

// alternate formats
const alt = parseVestSchedule('2027-03-01 50 units\n03/15/2027 $1,000.00 10 units\nAug 15, 2027 25 units')
t('ISO date line', alt[0]?.date === '2027-03-01' && alt[0].units === 50 && alt[0].amount === 0)
t('MM/DD/YYYY line', alt[1]?.date === '2027-03-15' && close(alt[1].amount, 1000))
t('Mon DD, YYYY line', alt[2]?.date === '2027-08-15' && alt[2].units === 25)

// junk tolerated
const junk = parseVestSchedule('header row\n\nAug-15-2026 114 units\nnothing here')
t('junk lines skipped', junk.length === 1 && junk[0].units === 114)
t('empty input', parseVestSchedule('').length === 0 && parseVestSchedule(null).length === 0)

// units-only line needs price; bare number without "units" after amount strip
const bare = parseVestSchedule('Aug-15-2026 $500.00')
t('amount-only line kept', bare.length === 1 && close(bare[0].amount, 500) && bare[0].units === 0)

// --- vestValue ---
t('explicit amount wins over units×price', close(vestValue({ units: 100, amount: 999 }, 267.28), 999))
t('falls back to units×price', close(vestValue({ units: 100, amount: 0 }, 267.28), 26728))
t('no price, no amount → 0', vestValue({ units: 100 }, 0) === 0)

// --- rsuSummary ---
const state = { rsu: { price: '267.28', vests: parseVestSchedule(SCHEDULE).map((v, i) => ({ ...v, id: String(i) })) } }
const today = '2026-08-13'
const s = rsuSummary(state, today)
t('all 5 unvested as of 2026-08-13', s.totalUnvestedUnits === 114 + 122 + 125 + 120 + 245)
t('total value sums explicit amounts', close(s.totalUnvestedValue, 30469.92 + 32608.16 + 33410 + 32073.6 + 65483.6))
t('remainingThisYear = the two 2026 vests', close(s.remainingThisYear, 30469.92 + 32608.16))
t('nextVest is Aug-15-2026', s.nextVest.date === '2026-08-15' && close(s.nextVest.value, 30469.92))
t('lastVestYear 2029', s.lastVestYear === '2029')
t('byYear has 2026/2027/2029', s.byYear.map(y => y.year).join(',') === '2026,2027,2029')
t('byYear 2027 value', close(s.byYear.find(y => y.year === '2027').value, 33410 + 32073.6))

// vest dated exactly today does NOT count as unvested (payroll owns it)
const sToday = rsuSummary(state, '2026-08-15')
t('vest on today excluded', close(sToday.remainingThisYear, 32608.16))

// after all vests
const sLate = rsuSummary(state, '2029-03-01')
t('all vested → zeros', sLate.totalUnvestedValue === 0 && sLate.nextVest === null && sLate.lastVestYear === null)

// empty state safe
const sEmpty = rsuSummary({}, today)
t('no rsu slice → empty summary', sEmpty.totalUnvestedValue === 0 && sEmpty.byYear.length === 0)

// units-only vests priced by assumed price
const sUnits = rsuSummary({ rsu: { price: '100', vests: [{ id: 'a', date: '2027-01-01', units: 10, amount: 0 }] } }, today)
t('units×price fallback in summary', close(sUnits.totalUnvestedValue, 1000))

// --- rsuScheduledAfter: the double-count guard ---
// Stub paid 2026-08-15 (the same day a vest lands): that vest is inside the
// YTD gross already — scheduledAfter must NOT include it.
t('strictly after stub date', close(rsuScheduledAfter(state, '2026-08-15', '2026'), 32608.16))
t('before both 2026 vests', close(rsuScheduledAfter(state, '2026-06-30', '2026'), 30469.92 + 32608.16))
t('year filter', close(rsuScheduledAfter(state, '2026-06-30', '2027'), 33410 + 32073.6))
t('year as number works', close(rsuScheduledAfter(state, '2026-06-30', 2026), 30469.92 + 32608.16))
t('no rsu slice → 0', rsuScheduledAfter({}, '2026-01-01', '2026') === 0)

console.log(`\ntest-rsu: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
