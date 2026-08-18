// Foreign social security (CPP, OAS, …) in the retirement engine.
//
// The rules worth locking down: amounts stay in their own currency until a
// user-typed exchange rate converts them (no rate → $0, never loonies counted
// as dollars); each stream starts at its own age, independent of the US SS
// claim age; and the streams flow into projectPath, which is what Retirement,
// Scenarios, and the SS explorer all consume.
import {
  normalizeForeignPensions, foreignAnnualAt, retirementParams,
  deterministicProjection, projectPath,
} from '../../src/lib/retirement.js'
import { buildFinancialContext } from '../../src/lib/aiContext.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + name) } }
const near = (a, b, eps = 1) => Math.abs(a - b) < eps

console.log('Normalization and currency honesty')
{
  const [cpp] = normalizeForeignPensions([{ id: 'a', label: 'CPP', country: 'Canada', currency: 'CAD', monthlyAmount: '1200', fxToUsd: '0.73', startAge: '65' }])
  ok(near(cpp.usdMonthly, 876), `CAD 1,200 × 0.73 = $876/mo (${cpp.usdMonthly})`)
  ok(cpp.usdAnnual === cpp.usdMonthly * 12, 'annual is monthly × 12')
  ok(cpp.missingFx === false, 'a set rate is not flagged')

  const [noFx] = normalizeForeignPensions([{ id: 'b', label: 'OAS', currency: 'CAD', monthlyAmount: '700', fxToUsd: '', startAge: '65' }])
  ok(noFx.usdMonthly === 0 && noFx.missingFx === true,
    'no exchange rate → contributes $0 and says so — never CAD counted as USD')

  const [usd] = normalizeForeignPensions([{ id: 'c', label: 'US pension', currency: 'usd', monthlyAmount: '500', fxToUsd: '', startAge: '60' }])
  ok(usd.usdMonthly === 500 && usd.fxToUsd === 1, 'USD needs no rate, case-insensitively')

  ok(normalizeForeignPensions([{ id: 'd', monthlyAmount: '' }, { id: 'e', monthlyAmount: '0' }]).length === 0,
    'empty rows are dropped')
  ok(normalizeForeignPensions(null).length === 0 && normalizeForeignPensions(undefined).length === 0,
    'missing list is handled')
  const [dflt] = normalizeForeignPensions([{ id: 'f', monthlyAmount: '100', currency: 'USD', startAge: 'x' }])
  ok(dflt.startAge === 65, 'garbage start age falls back to 65')
}

console.log('Each stream starts on its own clock')
{
  const pensions = normalizeForeignPensions([
    { id: 'a', label: 'CPP', currency: 'CAD', monthlyAmount: '1200', fxToUsd: '0.73', startAge: '65' },
    { id: 'b', label: 'OAS', currency: 'CAD', monthlyAmount: '700', fxToUsd: '0.73', startAge: '70' },
  ])
  ok(foreignAnnualAt(pensions, 64) === 0, 'nothing before the first start age')
  ok(near(foreignAnnualAt(pensions, 65), 876 * 12), 'CPP alone at 65')
  ok(near(foreignAnnualAt(pensions, 70), (876 + 511) * 12), 'both at 70')
  ok(near(foreignAnnualAt(pensions, 95), (876 + 511) * 12), 'and they continue for life')
}

const baseState = {
  accounts: [], transactions: [], insurance: [], goals: [], paystubs: [], benefits: [],
  profile: { age: '38', grossIncome: '500000', monthlyExpenses: '9000', filingStatus: 'mfj' },
  retirement: {
    retireAge: '60', ssClaimAge: '67',
    foreignPensions: [
      { id: 'a', label: 'CPP', country: 'Canada', currency: 'CAD', monthlyAmount: '1200', fxToUsd: '0.73', startAge: '65' },
    ],
  },
  home: {}, budgets: {}, budgetMonths: {}, budgetConfig: {}, sinkingFunds: [], rules: [], history: [],
}

console.log('Flows into the plan')
{
  const params = retirementParams(baseState, 3000000)
  ok(params.ready, 'params resolve')
  ok(params.foreignPensions.length === 1 && near(params.foreignAnnualTotal, 876 * 12),
    `params carry the USD total (${Math.round(params.foreignAnnualTotal)}/yr)`)

  // The pension reduces withdrawals from 65 on: with it, the portfolio must
  // end higher (or deplete later) than without it, on the identical path.
  const without = retirementParams({ ...baseState, retirement: { ...baseState.retirement, foreignPensions: [] } }, 3000000)
  const flat = () => 0.02
  const withPath = projectPath(params, flat)
  const withoutPath = projectPath(without, flat)
  ok(withPath.endBalance > withoutPath.endBalance,
    `the stream is real money in the projection (${Math.round(withPath.endBalance)} > ${Math.round(withoutPath.endBalance)})`)

  // Before its start age it must change nothing: compare balances at 64.
  const at = (path, age) => path.series.find(s => s.age === age)?.value ?? -1
  ok(near(at(withPath, 64), at(withoutPath, 64), 0.01), 'identical until the start age — no early credit')
  ok(at(withPath, 66) > at(withoutPath, 66), 'diverges the year after it starts')

  ok(deterministicProjection(params).series.length === withPath.series.length, 'deterministic projection runs with it')
}

console.log('Rate honesty end to end')
{
  const noRate = {
    ...baseState,
    retirement: { ...baseState.retirement, foreignPensions: [{ id: 'a', label: 'CPP', currency: 'CAD', monthlyAmount: '1200', fxToUsd: '', startAge: '65' }] },
  }
  const p = retirementParams(noRate, 500000)
  ok(p.foreignAnnualTotal === 0, 'a stream without a rate moves no projection')
  ok(p.foreignPensions[0].missingFx === true, 'but is surfaced as needing one, not silently dropped')
}

console.log('AI context')
{
  const ctx = buildFinancialContext(baseState)
  const fp = ctx.retirement?.foreignPensions
  ok(Array.isArray(fp) && fp.length === 1, 'foreign pensions ride along')
  ok(fp[0].currency === 'CAD' && near(fp[0].usdMonthly, 876), 'with both currencies visible')
  ok(/repealed in 2025/.test(ctx.retirement.foreignPensionNote), 'and the WEP-repeal note so the model does not apply stale law')
  const ctxNone = buildFinancialContext({ ...baseState, retirement: { retireAge: '60' } })
  ok(ctxNone.retirement.foreignPensions === undefined, 'absent when there are none')
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
