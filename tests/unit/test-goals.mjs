// Goal pacing: net-deposit pace vs target-date requirement.
import { goalPace } from '../../src/lib/goals.js'
import { buildFinancialContext } from '../../src/lib/aiContext.js'

let pass = 0, fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}
const TODAY = '2026-08-10'

const mkState = (txs, balance = 24000) => ({
  accounts: [{ id: 's1', type: 'savings', name: 'Sav', institution: 'X', balance },
             { id: 'c1', type: 'checking', name: 'Chk', institution: 'X', balance: 5000 }],
  transactions: txs, goals: [], insurance: [], benefits: [], paystubs: [], budgets: {}, budgetMonths: {},
  budgetConfig: {}, sinkingFunds: [], customCategories: [], billPrefs: [], history: [], profile: {},
  home: {}, homeBills: [], documents: [], rules: [],
})
const dep = (id, date, amount, acct = 's1') => ({ id, accountId: acct, date, amount, category: 'Transfers', description: 'TRANSFER IN' })

console.log('Pace math')
{
  // $1,000/mo into savings for the 3 complete months
  const txs = [dep('a', '2026-05-15', 1000), dep('b', '2026-06-15', 1000), dep('c', '2026-07-15', 1000),
    dep('d', '2026-08-05', 1000), // current month ignored (incomplete)
    dep('e', '2026-07-20', -200), // withdrawal nets against
    { id: 'x', accountId: 'c1', date: '2026-07-01', amount: 5000, category: 'Income', description: 'PAY' }] // other account ignored
  const g = { id: 'g', name: 'House', target: 60000, accountIds: ['s1'], targetDate: '2028-08-01' }
  const p = goalPace(mkState(txs), g, TODAY)
  ok(p.pace === Math.round((1000 + 1000 + 800) / 3), `net pace ~$933/mo (got ${p.pace})`)
  ok(p.saved === 24000 && p.remaining === 36000, 'saved/remaining from linked balance')
  // needs 36000 / 24 months = 1500/mo > 933 → behind
  ok(p.neededMonthly === 1500 && p.status === 'behind', `behind when pace < needed (needed ${p.neededMonthly})`)
  ok(p.etaMonths === Math.ceil(36000 / p.pace) && p.etaLabel, 'ETA projected from pace')
}

console.log('Status variants')
{
  const heavy = [dep('a', '2026-05-15', 2000), dep('b', '2026-06-15', 2000), dep('c', '2026-07-15', 2000)]
  const g = { id: 'g', name: 'House', target: 60000, accountIds: ['s1'], targetDate: '2028-08-01' }
  ok(goalPace(mkState(heavy), g, TODAY).status === 'on-track', 'on-track when pace ≥ needed')

  const noDate = { id: 'g2', name: 'Cushion', target: 60000, accountIds: ['s1'] }
  ok(goalPace(mkState(heavy), noDate, TODAY).status === 'pacing', 'no target date → pacing with ETA')
  ok(goalPace(mkState([]), noDate, TODAY).status === 'no-data', 'no transactions ever → no-data')
  const stalled = [{ id: 'w', accountId: 's1', date: '2026-01-10', amount: 500, category: 'Transfers', description: 'OLD' }]
  ok(goalPace(mkState(stalled), noDate, TODAY).status === 'stalled', 'old activity but nothing recent → stalled')
  ok(goalPace(mkState(heavy, 61000), g, TODAY).status === 'done', 'funded → done')
  // tolerance: within 5% of needed still on-track
  const close = [dep('a', '2026-05-15', 1440), dep('b', '2026-06-15', 1440), dep('c', '2026-07-15', 1440)]
  ok(goalPace(mkState(close), g, TODAY).status === 'on-track', '96% of needed pace counts as on track')
}

console.log('Expected return (growth) math')
{
  const txs = [dep('a', '2026-05-15', 1000), dep('b', '2026-06-15', 1000), dep('c', '2026-07-15', 1000)]
  const flat = { id: 'g', name: 'College', target: 60000, accountIds: ['s1'], targetDate: '2028-08-01' }
  const grow = { ...flat, returnPct: 6 }
  const p0 = goalPace(mkState(txs), flat, TODAY)
  const p6 = goalPace(mkState(txs), grow, TODAY)
  ok(p0.returnPct === 0 && p6.returnPct === 6, 'returnPct reported (default 0)')
  ok(p6.neededMonthly < p0.neededMonthly, `growth lowers required deposit (${Math.round(p6.neededMonthly)} < ${p0.neededMonthly})`)
  // closed-form check: verify the annuity equation actually lands on target
  const i = Math.pow(1.06, 1 / 12) - 1
  const x = Math.pow(1 + i, 24)
  const fv = 24000 * x + p6.neededMonthly * (x - 1) / i
  ok(Math.abs(fv - 60000) < 1, `needed/mo satisfies FV equation (fv ${fv.toFixed(2)})`)
  ok(p6.etaMonths < p0.etaMonths, `growth shortens ETA (${p6.etaMonths} < ${p0.etaMonths})`)

  // growth alone covers the goal → needed clamps to 0 and status is on-track
  // even with zero deposits: 24000 @ 6% for 24mo ≈ 27050 vs target 25000
  const easy = { id: 'g2', name: 'Easy', target: 25000, accountIds: ['s1'], targetDate: '2028-08-01', returnPct: 6 }
  const pe = goalPace(mkState([dep('z', '2026-07-15', 0.01)]), easy, TODAY)
  ok(pe.neededMonthly === 0 && pe.status === 'on-track', `growth alone reaches target → $0 needed, on-track (got ${pe.status})`)
  // ...and the ETA comes from compounding alone when pace is ~0
  ok(pe.etaMonths !== null && pe.etaMonths <= 24, `growth-only ETA computed (${pe.etaMonths} months)`)

  // the user's real shape: 249k of 1M over 143 months — linear says 5,250;
  // 6% growth says ~2,433
  const acct = { accounts: [{ id: 's1', type: 'investment', name: 'I', institution: 'X', balance: 249197 }], }
  const big = { ...mkState(txs), accounts: [{ id: 's1', type: 'investment', name: '529', institution: 'V', balance: 249197 }] }
  const gBig = { id: 'g3', name: 'College', target: 1000000, accountIds: ['s1'], targetDate: '2038-07-01', returnPct: 6 }
  const pb = goalPace(big, gBig, '2026-08-01')
  ok(Math.abs(pb.neededMonthly - 2433) < 25, `college-fund case: ~$2,433/mo at 6% vs $5,250 linear (got ${Math.round(pb.neededMonthly)})`)
}

console.log('AI context exposure')
{
  const txs = [dep('a', '2026-05-15', 1000), dep('b', '2026-06-15', 1000), dep('c', '2026-07-15', 1000)]
  const state = { ...mkState(txs), goals: [{ id: 'g', name: 'House', target: 60000, accountIds: ['s1'], targetDate: '2028-08-01' }] }
  const ctx = buildFinancialContext(state)
  const goal = ctx.goals[0]
  ok(goal.depositPaceMonthly > 0 && goal.status && goal.neededMonthly > 0, 'pace/status/needed ride along for the AI')
}

// After-tax 401(k) dollars fund a Roth without ever appearing as a deposit.
// Before this, a goal linked to that Roth read as stalled while it was in fact
// the fastest-funding thing the household had.
console.log('Payroll inflow: money in the plan, not yet in the account')
{
  const YEAR = 2026
  const withPayroll = (over = {}) => ({
    ...mkState([], 100000),
    accounts: [{ id: 'r1', type: 'roth ira', name: 'Roth', institution: 'F', balance: 100000 }],
    profile: { filingStatus: 'mfj', state: 'WA', age: '38' },
    paystubs: [{
      id: 'p1', employer: 'ACME', payDate: `${YEAR}-07-31`, periodStart: `${YEAR}-07-16`, periodEnd: `${YEAR}-07-31`,
      gross: 9000, grossYtd: 241246.95, net: 5000,
      taxes: [{ label: 'Federal Income Tax', amount: 2000, ytd: 38123 }],
      deductions: [
        { label: '401K Pretax', amount: 900, ytd: 16643, pretax: true },
        { label: '401K After Tax', amount: 1500, ytd: 22824, pretax: false },
      ],
      earnings: [{ label: 'Regular', amount: 9000, ytd: 241246.95 }],
      totalTaxes: 2000, totalDeductions: 2400, balanced: false,
    }],
    ...over,
  })
  const linked = { id: 'gr', name: 'Roth', target: 250000, accountIds: ['r1'], targetDate: '2029-08-01', payrollInflow: 'k401AfterTax' }
  const unlinked = { ...linked, payrollInflow: '' }
  const s = withPayroll()

  const off = goalPace(s, unlinked, TODAY)
  ok(off.status === 'no-data' && off.pending === 0,
    'without the link, an account with no transactions is unpaceable — the bug this fixes')

  const on = goalPace(s, linked, TODAY)
  ok(on.pending === 22824, `the after-tax contributed this year counts as secured (${on.pending})`)
  ok(on.saved === 100000, 'the account balance itself is untouched — pending is reported separately')
  ok(on.committed === 122824, 'committed = balance + what is in the plan')
  ok(on.remaining === 250000 - 122824, 'remaining measures against committed, not the stale balance')
  ok(on.status !== 'no-data', 'a payroll-funded goal is never "no pace known"')
  ok(on.inflowMonthly > 3000 && on.txPace === 0, `pace comes entirely from payroll (${on.inflowMonthly}/mo)`)
  ok(on.pace === on.inflowMonthly + on.txPace, 'total pace is deposits plus payroll')
  ok(on.inflow.projected > on.inflow.ytd && on.inflow.short === 'after-tax 401(k)',
    `the stream is described, not just totalled (${on.inflow.projected} by year end)`)
  ok(on.etaMonths !== null && on.etaMonths < 40, `and it produces a real ETA (${on.etaMonths} months)`)

  // Deposits and payroll add up rather than replacing one another.
  const both = goalPace(
    { ...withPayroll(), transactions: [dep('a', '2026-05-15', 500, 'r1'), dep('b', '2026-06-15', 500, 'r1'), dep('c', '2026-07-15', 500, 'r1')] },
    linked, TODAY,
  )
  ok(both.txPace === 500 && both.pace === 500 + both.inflowMonthly, 'deposits and payroll both count')

  // The projection can't exceed what 415(c) still allows.
  ok(on.inflow.projected <= 72000 - 24500, 'the year-end projection respects the 415(c) ceiling')

  // No after-tax dollars on the statements → no stream to claim. This is also
  // what stops January (last year's contributions already converted into the
  // balance) from counting the same money twice.
  const noAfterTax = withPayroll()
  noAfterTax.paystubs[0].deductions = [{ label: '401K Pretax', amount: 900, ytd: 16643, pretax: true }]
  const none = goalPace(noAfterTax, linked, TODAY)
  ok(none.inflow === null && none.pending === 0 && none.committed === none.saved,
    'a goal linked to a stream payroll does not show falls back to the balance alone')

  const noPayroll = goalPace({ ...mkState([]), goals: [] }, linked, TODAY)
  ok(noPayroll.pending === 0, 'no paystubs at all is handled')

  // Everything above must leave ordinary goals exactly as they were.
  const plain = goalPace(mkState([dep('a', '2026-05-15', 1000), dep('b', '2026-06-15', 1000), dep('c', '2026-07-15', 1000)]),
    { id: 'g', name: 'House', target: 60000, accountIds: ['s1'], targetDate: '2028-08-01' }, TODAY)
  ok(plain.committed === plain.saved && plain.pending === 0 && plain.pace === plain.txPace,
    'a goal with no payroll link behaves exactly as before')

  // The advisor has to see it too, or it will call a funded goal stalled.
  const ctx = buildFinancialContext({ ...s, goals: [linked] })
  ok(ctx.goals[0].pendingPayrollConversion === 22824 && ctx.goals[0].securedTotal === 122824,
    'the AI context carries the in-flight money')
  const ctxPlain = buildFinancialContext({ ...mkState([]), goals: [{ id: 'g', name: 'H', target: 1000, accountIds: ['s1'] }] })
  ok(!('pendingPayrollConversion' in ctxPlain.goals[0]), 'and stays out of the payload when there is none')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
