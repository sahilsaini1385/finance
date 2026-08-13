// Mortgage schedule + prepay-vs-invest math.
import { amortizationSchedule, amortize, yearlyRollup, horizonOutlook, scenarioDelta, extraPaymentScenarios } from '../../src/lib/mortgage.js'
import { deductibleFraction, afterTaxPrepayRatePct, fvAnnuity, investFvAfterTax, breakevenTaxablePct, prepayVsInvestSummary } from '../../src/lib/prepay.js'
import { buildFinancialContext } from '../../src/lib/aiContext.js'

let pass = 0, fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

console.log('amortizationSchedule — real-loan check values (348825 @ 5.99, $2660 P&I)')
{
  const s = amortizationSchedule(348825, 5.99, 2660)
  ok(s.feasible && s.months === 214, `214 months (got ${s.months})`)
  ok(near(s.totalInterest, 219073, 60), `total interest ≈ 219,073 (got ${Math.round(s.totalInterest)})`)
  ok(near(s.rows[0].interest, 1741, 1) && near(s.rows[0].principal, 919, 1), 'first split 1741/919')
  ok(s.rows.length === s.months, 'one row per month, no thinning')
  ok(s.rows[s.months - 1].balance === 0, 'ends at zero')
  ok(s.rows[s.months - 1].payment <= 2660, 'final month partial — never overpays')
  ok(s.crossoverMonth !== null && s.rows[s.crossoverMonth - 1].principal >= s.rows[s.crossoverMonth - 1].interest
     && (s.crossoverMonth === 1 || s.rows[s.crossoverMonth - 2].principal < s.rows[s.crossoverMonth - 2].interest),
     `crossover at first principal≥interest month (${s.crossoverMonth}, ${s.crossoverDate})`)
  ok(near(s.totalPrincipal, 348825, 1), 'principal totals the balance')
}

console.log('amortize() delegation keeps the legacy shape')
{
  const legacy = amortize(348825, 5.99, 2660)
  const s = amortizationSchedule(348825, 5.99, 2660)
  ok(legacy.months === s.months && near(legacy.totalInterest, s.totalInterest, 0.01), 'same totals from one loop')
  ok(legacy.series[0].month === 0 && legacy.series.at(-1).balance === 0, 'thinned series starts at 0, ends at payoff')
  ok(legacy.series.every((p, i) => i === 0 || p.month % 3 === 0 || p.balance === 0), 'every-3rd-month thinning')
  ok(amortize(1000, 12, 5).feasible === false, 'infeasible passthrough (payment below interest)')
}

console.log('yearlyRollup')
{
  const s = amortizationSchedule(348825, 5.99, 2660)
  const ys = yearlyRollup(s.rows)
  ok(ys[0].monthsCount < 12 && ys.at(-1).monthsCount < 12, 'partial first/last years')
  ok(ys.reduce((t, y) => t + y.monthsCount, 0) === s.months, 'months conserved')
  ok(near(ys.reduce((t, y) => t + y.interest, 0), s.totalInterest, 0.01), 'interest conserved')
  ok(ys.at(-1).endBalance === 0, 'final year ends at zero')
}

console.log('horizonOutlook & scenarioDelta')
{
  const s = amortizationSchedule(348825, 5.99, 2660)
  const o5 = horizonOutlook(s.rows, 60)
  ok(near(o5.interestPaid + o5.principalPaid, 2660 * 60, 5), '5y outlook conserves cash out')
  ok(near(o5.endingBalance, 348825 - o5.principalPaid, 1), '5y balance = start − principal paid')
  const scen = amortizationSchedule(348825, 5.99, 2660, 500)
  const d = scenarioDelta(s, scen)
  ok(d.monthsSaved === s.months - scen.months && d.monthsSaved > 40, `+$500 saves ${d.monthsSaved} months`)
  ok(d.ghostYears.reduce((t, y) => t + y.monthsCount, 0) === d.monthsSaved, 'ghost years cover exactly the saved months')
  const short = horizonOutlook(amortizationSchedule(20000, 5, 1000).rows, 120)
  ok(short.paidOff === true && short.endingBalance === 0, 'paidOff flag when horizon passes payoff')
}

console.log('prepay math')
{
  ok(near(fvAnnuity(100, 5.99, 120), 16380, 5), `FV of $100/mo @5.99 for 10y ≈ 16,380 (${Math.round(fvAnnuity(100, 5.99, 120))})`)
  ok(fvAnnuity(100, 0, 120) === 12000, 'zero-rate FV is plain sum')
  const inv = investFvAfterTax(100, 5, 120, 0.15)
  ok(near(inv.fvAt, 15000, 40), `taxable invest FV ≈ 15,000 (${Math.round(inv.fvAt)})`)
  ok(near(breakevenTaxablePct(5.99, 120, 0.15), 6.8, 0.15), `10y breakeven ≈ 6.8% (${breakevenTaxablePct(5.99, 120).toFixed(2)})`)
  ok(deductibleFraction(35000, 32200, 20000) === (35000 - 32200) / 20000, 'partial-itemizer fraction')
  ok(deductibleFraction(60000, 32200, 20000) === 1 && deductibleFraction(10000, 32200, 20000) === 0, 'fraction clamps 0..1')
  ok(near(afterTaxPrepayRatePct(5.99, 35, 1), 5.99 * 0.65, 0.001), 'full itemizer keeps rate × (1−marginal)')
  const sum = prepayVsInvestSummary({ ratePct: 5.99, marginalFedPct: 35, itemizeLikely: false })
  ok(sum.guaranteedPreTaxReturnPct === 5.99 && sum.afterTaxReturnPct === 5.99, 'standard deduction keeps the full rate')
  ok(sum.per100PerMonthExtra.yr10.prepayEdge > 1000, `prepay edge at 10y (${sum.per100PerMonthExtra.yr10.prepayEdge})`)
  const it = prepayVsInvestSummary({ ratePct: 5.99, marginalFedPct: 35, itemizeLikely: true, itemizableEst: 42200, standardDeduction: 32200, annualMortgageInterest: 20000 })
  ok(it.afterTaxReturnPct < 5.99 && it.afterTaxBasis.startsWith('itemizing'), `itemizer after-tax rate drops (${it.afterTaxReturnPct}%)`)
  ok(prepayVsInvestSummary({ ratePct: 0 }) === null, 'no rate → null')
}

console.log('aiContext home block')
{
  const state = { accounts: [], transactions: [], goals: [], insurance: [], benefits: [], paystubs: [], budgets: {}, budgetMonths: {}, budgetConfig: {}, sinkingFunds: [], customCategories: [], billPrefs: [], history: [], documents: [], homeBills: [], rules: [],
    profile: { filingStatus: 'mfj', grossIncome: '340000', spouseIncome: '0', dependents: '2', monthlyExpenses: '12000' },
    home: { mortgageBalance: '348825', mortgageRate: '5.99', monthlyPayment: '2660' } }
  const ctx = buildFinancialContext(state)
  ok(ctx.home !== null, 'mortgage-only home (no value estimate) still gets a home block')
  ok(ctx.home.payoff.monthsRemaining === 214 && ctx.home.payoff.interestRemaining > 200000, 'payoff block rides along')
  ok(ctx.home.payoff.outlook5y.interestPaid > 0 && ctx.home.payoff.outlook10y.endingBalance > 0, 'horizon outlooks present')
  ok(ctx.home.prepayVsInvest.breakevenTaxablePreTaxPct.yr10 > 6, 'prepayVsInvest attached with breakeven')
  ok(ctx.home.prepayVsInvest.afterTaxBasis.includes('standard deduction'), 'mfj standard-deduction basis (no itemizing data)')
  const noHome = buildFinancialContext({ ...state, home: {} })
  ok(noHome.home === null, 'no home data → null')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
