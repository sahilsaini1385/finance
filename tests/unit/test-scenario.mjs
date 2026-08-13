// Scenario sandbox engine: phases, flow-through, seeded determinism.
import { runScenario, scenarioBaseline, seededRng } from '../../src/lib/scenario.js'

let pass = 0, fail = 0
const ok = (c, n) => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)) }

const state = {
  accounts: [
    { id: 'b', type: 'brokerage', name: 'B', institution: 'X', balance: 400000 },
    { id: 'r', type: 'retirement', name: 'R', institution: 'X', balance: 300000 },
    { id: 'c', type: 'checking', name: 'C', institution: 'X', balance: 30000 },
  ],
  transactions: [], goals: [], insurance: [], benefits: [], paystubs: [],
  budgets: {}, budgetMonths: {}, budgetConfig: {}, sinkingFunds: [], customCategories: [],
  billPrefs: [], history: [], documents: [], homeBills: [], rules: [], retirement: {},
  profile: { age: '38', filingStatus: 'mfj', grossIncome: '220000', spouseIncome: '120000', monthlyExpenses: '12000', dependents: '2', k401ContributionPct: '10' },
  home: { mortgageBalance: '348825', mortgageRate: '5.99', monthlyPayment: '2660' },
}
const b = scenarioBaseline(state)
const run = (phases, globals = {}) => runScenario(state, { retireAge: b.retireAge, windfall: 0, ...globals, phases })
const basePhase = { income: b.income, spouseIncome: b.spouseIncome, spendMonthly: b.spendMonthly, extraInvestMonthly: 0, extraPrincipalMonthly: 0 }

console.log('Determinism & neutrality')
{
  const r1 = seededRng(7), r2 = seededRng(7)
  ok(r1() === r2() && r1() === r2(), 'seeded rng reproduces')
  const a = run([{ ...basePhase, years: null }])
  const c = run([{ ...basePhase, years: null }])
  ok(a.ready && a.base.successPct === c.base.successPct, 'identical across runs')
  ok(a.base.successPct === a.scen.successPct && a.base.fiAge === a.scen.fiAge && a.base.annualContrib === a.scen.annualContrib, 'baseline phase → zero delta everywhere')
  ok(a.phases.length === 1 && a.phases[0].flowMonthly === 0, 'single infinite baseline phase, no flow')
  ok(a.base.mortgage && a.base.mortgage.months === 214, 'mortgage baseline rides along')
}

console.log('Time-boxing softens the blow')
{
  const forever = run([{ ...basePhase, spouseIncome: 0, years: null }])
  const twoYears = run([{ ...basePhase, spouseIncome: 0, years: 2 }])
  ok(forever.scen.successPct <= forever.base.successPct, 'losing an income forever never helps')
  ok(twoYears.scen.successPct >= forever.scen.successPct, '2-year break hurts no more than forever')
  ok(twoYears.scen.medianAtRetirement > forever.scen.medianAtRetirement, '2-year break leaves a bigger portfolio than forever')
  ok(twoYears.scen.medianAtRetirement < twoYears.base.medianAtRetirement, '…but still costs something vs today')
  ok(twoYears.phases.length === 2, 'finite phase gets an automatic back-to-today tail')
  ok(twoYears.phases[1].flowMonthly === 0 && twoYears.phases[1].contribAnnual === twoYears.base.annualContrib, 'tail phase = today\'s numbers')
  ok(twoYears.phases[0].flowMonthly < -4000, `break-year cash-flow shown (${twoYears.phases[0].flowMonthly}/mo)`)
}

console.log('Two explicit phases: off 2 years, then back at 60%')
{
  const r = run([
    { ...basePhase, spouseIncome: 0, years: 2 },
    { ...basePhase, spouseIncome: Math.round(b.spouseIncome * 0.6), years: null },
  ])
  ok(r.phases.length === 2, 'no tail appended after an infinite phase 2')
  ok(r.phases[1].contribAnnual < r.base.annualContrib, 'long-run contributions below today (60% income)')
  ok(r.phases[0].contribAnnual <= r.phases[1].contribAnnual, 'break years no richer than the 60% years')
  ok(r.scen.annualContrib === r.phases[1].contribAnnual, 'long-run figure reported for the table')
  const fullBreak = run([{ ...basePhase, spouseIncome: 0, years: null }])
  ok(r.scen.successPct >= fullBreak.scen.successPct, 'partial return beats never returning')
}

console.log('Phase 2 finite → reverts to today after it')
{
  const r = run([
    { ...basePhase, spouseIncome: 0, years: 2 },
    { ...basePhase, spouseIncome: Math.round(b.spouseIncome * 0.6), years: 3 },
  ])
  ok(r.phases.length === 3 && r.phases[2].years === null, 'implicit back-to-today tail appended')
  ok(r.phases[2].contribAnnual === r.base.annualContrib, 'tail contributions match today')
}

console.log('Phased mortgage prepay')
{
  const none = run([{ ...basePhase, years: null }])
  const fiveYr = run([{ ...basePhase, extraPrincipalMonthly: 500, years: 5 }])
  const forever = run([{ ...basePhase, extraPrincipalMonthly: 500, years: null }])
  ok(fiveYr.scen.mortgage.months < none.scen.mortgage.months, '5 years of extra principal shortens payoff')
  ok(forever.scen.mortgage.months < fiveYr.scen.mortgage.months, 'forever shortens it more')
  ok(fiveYr.scen.mortgage.interest > forever.scen.mortgage.interest && fiveYr.scen.mortgage.interest < none.scen.mortgage.interest, 'interest saved sits between')
}

console.log('Other levers still work')
{
  const spendLess = run([{ ...basePhase, spendMonthly: b.spendMonthly - 2000, years: null }])
  ok(spendLess.phases[0].flowMonthly === 2000, 'spending cut becomes +$2,000/mo flow')
  ok(spendLess.scen.fiNumber < spendLess.base.fiNumber, 'FI target falls with long-run spending')
  const invest = run([{ ...basePhase, extraInvestMonthly: 1000, years: null }])
  ok(invest.scen.annualContrib === invest.base.annualContrib + 12000 && invest.phases[0].flowMonthly === 0, 'extra investing adds without a flow change')
  const windfall = run([{ ...basePhase, years: null }], { windfall: 100000 })
  ok(windfall.scen.medianAtRetirement > windfall.base.medianAtRetirement, 'windfall raises median at retirement')
  const early = run([{ ...basePhase, years: null }], { retireAge: b.retireAge - 5 })
  ok(early.scen.retireAge === b.retireAge - 5 && early.scen.successPct <= early.base.successPct, 'earlier retirement carried, never better odds')
  const broke = run([{ ...basePhase, income: 30000, spouseIncome: 0, spendMonthly: 20000, years: null }])
  ok(broke.scen.annualContrib === 0, 'flow-through clamps at zero contributions')
}

console.log('Not ready without basics')
{
  const bare = { ...state, profile: { filingStatus: 'mfj' } }
  const r = runScenario(bare, { retireAge: 65, windfall: 0, phases: [] })
  ok(r.ready === false && r.missing.length > 0, 'missing fields reported')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
