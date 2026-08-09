// Boldin-style retirement planner engine. Pure functions, all in TODAY'S
// dollars (real returns = nominal minus inflation) so every number on screen
// is comparable to the user's current budget. Educational, not advice.

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/[$,%\s,]/g, ''))
  return Number.isNaN(n) ? 0 : n
}

export const RETIREMENT_DEFAULTS = {
  retireAge: 65,
  lifeExpectancy: 95,       // plan to a long life — outliving money is the risk
  ssClaimAge: 67,           // full retirement age for anyone born 1960+
  expectedReturn: 5,        // % real (≈7–8% nominal minus inflation), working years
  retiredReturn: 3.5,       // % real in retirement (more conservative mix)
  volatility: 11,           // annual std dev of real returns, %
  spendingPct: 0.8,         // default retirement spending = 80% of today's expenses
  trials: 1000,             // Monte Carlo runs (Boldin uses 1,000)
}

// ---------- Social Security ----------
// Rough PIA estimate from current income, assuming a full 35-year career near
// this level. Bend points/wage cap are the published figures (kept approximate
// on purpose — ssa.gov's statement is the real number).
const SS_WAGE_CAP = 176100
const BEND_1 = 1226
const BEND_2 = 7391

export function estimateSSMonthly(annualIncome) {
  const aime = Math.min(num(annualIncome), SS_WAGE_CAP) / 12
  if (aime <= 0) return 0
  const pia =
    0.9 * Math.min(aime, BEND_1) +
    0.32 * Math.max(0, Math.min(aime, BEND_2) - BEND_1) +
    0.15 * Math.max(0, aime - BEND_2)
  return Math.round(pia)
}

// Benefit multiplier vs the age-67 amount (FRA 67, born 1960+):
// early claiming reduces ~6-7%/yr, delaying adds 8%/yr to 70.
const CLAIM_FACTORS = { 62: 0.70, 63: 0.75, 64: 0.80, 65: 0.8667, 66: 0.9333, 67: 1.0, 68: 1.08, 69: 1.16, 70: 1.24 }
export function claimFactor(age) {
  return CLAIM_FACTORS[Math.min(70, Math.max(62, Math.round(num(age) || 67)))] ?? 1.0
}

// ---------- Inputs ----------
// Assemble plan parameters from app state (profile + accounts + retirement
// settings), filling gaps with sensible defaults.
export function retirementParams(state, investmentsTotal) {
  const p = state.profile || {}
  const r = state.retirement || {}
  const age = num(p.age)
  const income = num(p.grossIncome)
  const monthlyExpenses = num(p.monthlyExpenses)

  const missing = []
  if (!age) missing.push('age')
  if (!income) missing.push('gross income')
  if (!monthlyExpenses) missing.push('monthly living expenses')
  if (missing.length > 0) return { ready: false, missing }

  const retireAge = Math.max(age + 1, num(r.retireAge) || RETIREMENT_DEFAULTS.retireAge)
  const lifeExpectancy = Math.max(retireAge + 1, num(r.lifeExpectancy) || RETIREMENT_DEFAULTS.lifeExpectancy)
  const ssClaimAge = num(r.ssClaimAge) || RETIREMENT_DEFAULTS.ssClaimAge

  // Contributions while working (same math as the FI projection)
  const k401 = income * (num(p.k401ContributionPct) / 100)
  const match = income * (Math.min(num(p.employerMatchPct), num(p.k401ContributionPct)) / 100)
  const annualContrib =
    k401 + match + num(p.iraContribution) + num(p.hsaContribution) + num(r.extraMonthlySavings) * 12

  const spendingMonthly = num(r.spendingMonthly) || Math.round(monthlyExpenses * RETIREMENT_DEFAULTS.spendingPct)

  const ssSelf = num(r.ssMonthlyOverride) || estimateSSMonthly(income)
  const spouseIncome = num(p.spouseIncome)
  const ssSpouse = num(r.spouseSsMonthlyOverride) || (spouseIncome > 0 ? estimateSSMonthly(spouseIncome) : 0)
  const ssMonthlyAt67 = ssSelf + ssSpouse

  return {
    ready: true,
    age,
    retireAge,
    lifeExpectancy,
    savings: Math.max(0, investmentsTotal),
    annualContrib,
    spendingAnnual: spendingMonthly * 12,
    spendingMonthly,
    ssClaimAge,
    ssMonthlyAt67,
    ssSelf,
    ssSpouse,
    ssEstimated: !num(r.ssMonthlyOverride),
    pensionAnnual: num(r.pensionMonthly) * 12,
    returnPre: (num(r.expectedReturn) || RETIREMENT_DEFAULTS.expectedReturn) / 100,
    returnPost: (num(r.retiredReturn) || RETIREMENT_DEFAULTS.retiredReturn) / 100,
    volatility: (num(r.volatility) || RETIREMENT_DEFAULTS.volatility) / 100,
  }
}

export function ssAnnualAtClaim(params, claimAge = params.ssClaimAge) {
  return params.ssMonthlyAt67 * 12 * claimFactor(claimAge)
}

// ---------- Projection ----------
// One lifetime path: accumulate to retireAge, then draw spending net of
// Social Security (from claim age) and pension. returnFor(age) supplies each
// year's return, which is how Monte Carlo plugs in.
export function projectPath(params, returnFor, claimAge = params.ssClaimAge) {
  const ssAnnual = ssAnnualAtClaim(params, claimAge)
  let bal = params.savings
  const series = [{ age: params.age, value: bal }]
  let depletedAt = null
  for (let a = params.age + 1; a <= params.lifeExpectancy; a++) {
    bal *= 1 + returnFor(a)
    if (a <= params.retireAge) {
      bal += params.annualContrib
    } else {
      let need = params.spendingAnnual - params.pensionAnnual - (a >= claimAge ? ssAnnual : 0)
      if (need > 0) bal -= need
    }
    if (bal <= 0 && a > params.retireAge) {
      if (depletedAt === null) depletedAt = a
      bal = 0
    }
    series.push({ age: a, value: bal })
  }
  return { series, depletedAt, endBalance: bal }
}

export function deterministicProjection(params, claimAge = params.ssClaimAge) {
  return projectPath(params, a => (a <= params.retireAge ? params.returnPre : params.returnPost), claimAge)
}

// ---------- Monte Carlo ----------
// Normally-distributed real returns (Box–Muller). Success = never running out
// of money before lifeExpectancy. Returns the success rate plus 10/50/90th
// percentile balances per age for the band chart.
export function monteCarloRetirement(params, { trials = RETIREMENT_DEFAULTS.trials, rng = Math.random, claimAge = params.ssClaimAge } = {}) {
  const years = params.lifeExpectancy - params.age + 1
  const perAge = Array.from({ length: years }, () => new Float64Array(trials))
  let successes = 0
  let spare = null
  const normal = () => {
    if (spare !== null) { const s = spare; spare = null; return s }
    let u = 0, v = 0
    while (u === 0) u = rng()
    while (v === 0) v = rng()
    const mag = Math.sqrt(-2 * Math.log(u))
    spare = mag * Math.sin(2 * Math.PI * v)
    return mag * Math.cos(2 * Math.PI * v)
  }

  for (let t = 0; t < trials; t++) {
    const { series, depletedAt } = projectPath(
      params,
      a => (a <= params.retireAge ? params.returnPre : params.returnPost) + params.volatility * normal(),
      claimAge,
    )
    if (depletedAt === null) successes++
    for (let i = 0; i < years; i++) perAge[i][t] = series[i].value
  }

  const pct = (arr, q) => {
    const s = Float64Array.from(arr).sort()
    return s[Math.min(s.length - 1, Math.floor(q * s.length))]
  }
  const band = Array.from({ length: years }, (_, i) => ({
    age: params.age + i,
    p10: pct(perAge[i], 0.10),
    p50: pct(perAge[i], 0.50),
    p90: pct(perAge[i], 0.90),
  }))

  return { successRate: successes / trials, band, trials }
}

// ---------- Social Security explorer ----------
// Compare claiming ages: monthly check, total collected to lifeExpectancy,
// and the plan's Monte Carlo success rate under each.
export function ssExplorer(params, { trials = 400, rng = Math.random } = {}) {
  return [62, 67, 70].map(claimAge => {
    const monthly = Math.round(params.ssMonthlyAt67 * claimFactor(claimAge))
    const yearsCollecting = Math.max(0, params.lifeExpectancy - claimAge)
    const { successRate } = monteCarloRetirement(params, { trials, rng, claimAge })
    return {
      claimAge,
      monthly,
      lifetimeTotal: monthly * 12 * yearsCollecting,
      successRate,
      chosen: Math.round(params.ssClaimAge) === claimAge,
    }
  })
}
