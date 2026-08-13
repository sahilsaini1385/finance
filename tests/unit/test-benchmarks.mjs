// Bill benchmarking: market-range comparison for recurring charges.
import { benchmarkBill, getSavingsInsights, BILL_BENCHMARKS } from '../../src/lib/savings.js'
import { buildFinancialContext } from '../../src/lib/aiContext.js'

let pass = 0, fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}

// Recurring detection needs a steady monthly pattern
const monthly = (id, desc, amount, day = '09') =>
  ['2026-05', '2026-06', '2026-07', '2026-08'].map((m, i) =>
    ({ id: `${id}${i}`, accountId: 'a1', date: `${m}-${day}`, description: desc, amount, category: 'Utilities', source: 'SimpleFIN', hash: `${id}${i}` }))

const mkState = txs => ({
  accounts: [{ id: 'a1', type: 'checking', name: 'Chk', institution: 'X', balance: 10000 }],
  transactions: txs, insurance: [], benefits: [], goals: [], paystubs: [], budgets: {}, budgetMonths: {},
  budgetConfig: {}, sinkingFunds: [], customCategories: [], billPrefs: [], history: [], profile: {},
  home: {}, homeBills: [], documents: [], rules: [],
})

console.log('benchmarkBill')
{
  ok(benchmarkBill({ merchant: 'COMCAST', monthlyCost: 109 })?.over === true, 'Comcast $109 flagged over the $50–85 internet range')
  ok(benchmarkBill({ merchant: 'COMCAST', monthlyCost: 85 })?.over === false, '$85 (at the high end) stays quiet')
  ok(benchmarkBill({ merchant: 'COMCAST', monthlyCost: 88 })?.over === false, '5% grace over the high end stays quiet')
  ok(benchmarkBill({ merchant: 'NETFLIX', monthlyCost: 25 }) === null, 'unbenchmarked merchants return null')
  ok(benchmarkBill({ merchant: 'GEICO AUTO INS', monthlyCost: 182 })?.over === true, 'Geico $182 above typical auto range')
  const b = benchmarkBill({ merchant: 'COMCAST', monthlyCost: 109 })
  ok(b.overBy === Math.round(109 - (50 + 85) / 2), 'overBy measured to the range midpoint')
}

console.log('Savings insights rec')
{
  const txs = [...monthly('cc', 'COMCAST CABLE COMM', -109), ...monthly('nf', 'Netflix.com', -15.49, '05')]
  const { recs } = getSavingsInsights(mkState(txs))
  const rec = recs.find(r => r.title.includes('above typical home internet pricing'))
  ok(!!rec, 'over-market internet bill produces a rec')
  ok(/\$50–\$85\/mo/.test(rec.detail) && /rough national range/.test(rec.detail), 'cites the range and its roughness')
  ok(/~\$\d+\/mo/.test(rec.detail) && /retention/.test(rec.detail), 'quantifies saving and gives the play')
  const cheap = getSavingsInsights(mkState(monthly('cc', 'COMCAST CABLE COMM', -70)))
  ok(!cheap.recs.some(r => r.title.includes('above typical')), 'in-range bill stays quiet')
}

console.log('AI context benchmark flags')
{
  const txs = [...monthly('cc', 'COMCAST CABLE COMM', -109)]
  const ctx = buildFinancialContext(mkState(txs))
  const bill = ctx.recurringBills.find(b => /comcast/.test(b.name))
  ok(bill?.aboveTypical === true && /\$50-\$85/.test(bill.typicalMarketRange), 'flag + range ride along to the AI')
}

console.log('Benchmark hygiene')
{
  for (const b of BILL_BENCHMARKS) ok(b.low < b.high && b.tip.length > 30, `${b.key}: sane range + actionable tip`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
