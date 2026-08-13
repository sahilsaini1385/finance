// Unit checks for the Boldin-style retirement engine.
import {
  estimateSSMonthly, claimFactor, retirementParams,
  deterministicProjection, monteCarloRetirement, ssExplorer,
} from '../../src/lib/retirement.js'

let pass = 0, fail = 0
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.error(`  ✗ ${name}`) }
}

// Deterministic RNG (mulberry32) so Monte Carlo assertions are stable
const mulberry32 = seed => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

console.log('Social Security estimate')
{
  const ss165 = estimateSSMonthly(165000)
  ok(ss165 > 2500 && ss165 < 4200, `$165k income → plausible PIA (${ss165}/mo)`)
  ok(estimateSSMonthly(500000) === estimateSSMonthly(250000), 'wage cap applies above the taxable max')
  ok(estimateSSMonthly(0) === 0, 'no income → no benefit')
  ok(claimFactor(62) === 0.70 && claimFactor(67) === 1 && claimFactor(70) === 1.24, 'claim factors 62/67/70')
}

const state = {
  profile: { age: '35', grossIncome: '165000', spouseIncome: '90000', monthlyExpenses: '6000', k401ContributionPct: '10', employerMatchPct: '4', iraContribution: '7000', hsaContribution: '4400' },
  retirement: { retireAge: '65', lifeExpectancy: '95', ssClaimAge: '67' },
  accounts: [],
}

console.log('Params assembly')
{
  const p = retirementParams(state, 150000)
  ok(p.ready, 'ready with age/income/expenses')
  ok(p.spendingMonthly === 4800, `default spending = 80% of expenses (${p.spendingMonthly})`)
  ok(Math.abs(p.annualContrib - (16500 + 6600 + 7000 + 4400)) < 1, `contributions: 401k+match+IRA+HSA (${p.annualContrib})`)
  ok(p.ssSpouse > 0 && p.ssMonthlyAt67 === p.ssSelf + p.ssSpouse, 'household SS includes spouse')
  const bad = retirementParams({ profile: {}, retirement: {} }, 0)
  ok(!bad.ready && bad.missing.length === 3, 'missing inputs reported')
}

console.log('Deterministic projection')
{
  const p = retirementParams(state, 150000)
  const det = deterministicProjection(p)
  ok(det.series[0].age === 35 && det.series[det.series.length - 1].age === 95, 'runs age 35→95')
  const atRetire = det.series.find(s => s.age === 65).value
  ok(atRetire > 150000, `grows during accumulation (${Math.round(atRetire).toLocaleString()})`)
  ok(det.depletedAt === null || det.depletedAt > 65, 'never depletes before retirement')
  // A plan that saves nothing and spends a lot must fail
  const poor = retirementParams({ ...state, profile: { ...state.profile, k401ContributionPct: '0', employerMatchPct: '0', iraContribution: '0', hsaContribution: '0' }, retirement: { retireAge: '40', lifeExpectancy: '95', ssClaimAge: '70', spendingMonthly: '9000' } }, 50000)
  const poorDet = deterministicProjection(poor)
  ok(poorDet.depletedAt !== null && poorDet.depletedAt < 60, `hopeless plan depletes early (age ${poorDet.depletedAt})`)
  ok(poorDet.series.every(s => s.value >= 0), 'balance never negative in series')
}

console.log('Monte Carlo')
{
  const p = retirementParams(state, 150000)
  const mc = monteCarloRetirement(p, { trials: 500, rng: mulberry32(42) })
  ok(mc.successRate > 0.5, `healthy plan succeeds most of the time (${(mc.successRate * 100).toFixed(0)}%)`)
  ok(mc.band.length === 95 - 35 + 1, 'band covers every age')
  const mid = mc.band[30]
  ok(mid.p10 <= mid.p50 && mid.p50 <= mid.p90, 'percentiles ordered')
  const zero = monteCarloRetirement(
    retirementParams({ ...state, retirement: { retireAge: '35.5', lifeExpectancy: '95', ssClaimAge: '67', spendingMonthly: '20000' } }, 1000),
    { trials: 200, rng: mulberry32(7) },
  )
  ok(zero.successRate < 0.05, `impossible plan fails (${(zero.successRate * 100).toFixed(0)}%)`)
}

console.log('Social Security explorer')
{
  const p = retirementParams(state, 150000)
  const rows = ssExplorer(p, { trials: 200, rng: mulberry32(9) })
  ok(rows.length === 3 && rows.map(r => r.claimAge).join() === '62,67,70', 'compares 62/67/70')
  ok(rows[2].monthly > rows[1].monthly && rows[1].monthly > rows[0].monthly, 'later claim → bigger check')
  ok(rows.find(r => r.claimAge === 67).chosen, 'marks the plan’s chosen age')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
