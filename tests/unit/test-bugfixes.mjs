// Unit checks for the ultracode bug-fix batch. Run: node test-bugfixes.mjs
import { scanForTransfers, SCAN_VERSION } from '../../src/lib/transfers.js'
import { effectiveBudgets, daysInfo, monthActivity } from '../../src/lib/budget.js'
import { monthStats } from '../../src/lib/report.js'
import { upcomingBills } from '../../src/lib/savings.js'
import { amortize } from '../../src/lib/mortgage.js'
import { localToday, localMonth } from '../../src/lib/dates.js'

let pass = 0, fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}

console.log('dates')
ok(/^\d{4}-\d{2}-\d{2}$/.test(localToday()), 'localToday shape')
ok(localMonth() === localToday().slice(0, 7), 'localMonth = today prefix')
const d = new Date(2026, 7, 31, 23, 30) // Aug 31 11:30pm local
ok(localToday(d) === '2026-08-31', 'late evening stays on local date')

console.log('transfers: pair scan never flips a user-set category on old rows')
{
  const txs = [
    { id: 'a', accountId: 'A', date: '2026-08-01', amount: 2000, category: 'Income', pairChecked: SCAN_VERSION },
    { id: 'b', accountId: 'B', date: '2026-08-03', amount: -2000, category: 'Other' }, // fresh
  ]
  const { transferIds } = scanForTransfers(txs)
  ok(transferIds.includes('b'), 'fresh side flipped to Transfers')
  ok(!transferIds.includes('a'), 'old user-categorized counterpart untouched')
}
{
  const txs = [
    { id: 'a', accountId: 'A', date: '2026-08-01', amount: 2000, category: 'Other', pairChecked: SCAN_VERSION },
    { id: 'b', accountId: 'B', date: '2026-08-03', amount: -2000, category: 'Other' },
  ]
  const { transferIds } = scanForTransfers(txs)
  ok(transferIds.includes('a') && transferIds.includes('b'), 'old but still-Other counterpart is flipped')
}

console.log('budget: zero override is visible and daysInfo is local')
{
  const state = { budgets: { Dining: 500 }, budgetMonths: { '2026-08': { Dining: 0 } } }
  const eff = effectiveBudgets(state, '2026-08')
  ok(eff.Dining === 0, 'explicit 0 override kept as 0 (no template snap-back)')
  ok(effectiveBudgets(state, '2026-07').Dining === 500, 'other months keep template')
}
{
  const info = daysInfo(localMonth())
  ok(info.isCurrent === true, 'current month detected via local date')
  ok(info.daysLeft >= 0, 'daysLeft never negative')
  ok(info.dayOfMonth === new Date().getDate(), 'dayOfMonth = local day')
}

console.log('report: monthStats headline agrees with clamped categories & budget page')
{
  const txs = [
    { date: '2026-08-02', amount: -100, category: 'Shopping', description: 'store' },
    { date: '2026-08-05', amount: 500, category: 'Shopping', description: 'refund' }, // nets -400
    { date: '2026-08-06', amount: -600, category: 'Dining', description: 'food' },
  ]
  const s = monthStats(txs, '2026-08')
  ok(s.byCat.Shopping === undefined, 'refund-negative category dropped from bars')
  ok(s.spend === 600, `headline = sum of clamped cats (got ${s.spend})`)
  const { spentByCat } = monthActivity({ transactions: txs }, '2026-08')
  const flexTotal = Object.values(spentByCat).reduce((a, b) => a + b, 0)
  ok(flexTotal === 600, 'budget page agrees with report headline')
}

console.log('savings: renewal due today appears in upcoming bills')
{
  const { bills } = upcomingBills([], [{ renewalDate: localToday(), type: 'auto', provider: 'Geico', premium: '120', premiumFreq: 'month' }], 30)
  ok(bills.length === 1 && bills[0].kind === 'renewal', 'same-day renewal included')
  const past = upcomingBills([], [{ renewalDate: '2020-01-01', type: 'auto', provider: 'X', premium: '1', premiumFreq: 'month' }], 30)
  ok(past.bills.length === 0, 'past renewal excluded')
}

console.log('mortgage: cap hit returns a reason')
{
  const r = amortize(500000, 6.0, 2520) // barely above interest → >600 months
  ok(r.feasible === false && typeof r.reason === 'string' && r.reason.includes('50 years'), `cap-hit reason present (${r.reason})`)
  const okRun = amortize(400000, 5.5, 2600)
  ok(okRun.feasible === true && okRun.months > 0 && /^\d{4}-\d{2}$/.test(okRun.payoffDate), 'normal payoff unaffected')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
