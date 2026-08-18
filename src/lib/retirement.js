// Boldin-style retirement planner engine. Pure functions, all in TODAY'S
// dollars (real returns = nominal minus inflation) so every number on screen
// is comparable to the user's current budget. Educational, not advice.

import { resolveFacts } from './facts.js'

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

// ---------- Foreign pensions / social security ----------
// CPP, OAS, UK State Pension, and friends: fixed monthly benefits in a
// foreign currency, each with its own start age. Since the Windfall
// Elimination Provision was repealed (Social Security Fairness Act, Jan
// 2025), a foreign pension no longer reduces the US benefit — the streams
// simply add. Converted with a user-typed exchange rate: this app makes no
// network calls on its own, and pretending to know next decade's CAD/USD
// would be false precision anyway. Rate 0/blank → the stream contributes
// nothing rather than silently counting foreign units as dollars.
export function normalizeForeignPensions(list) {
  return (Array.isArray(list) ? list : [])
    .map(f => {
      const monthly = num(f.monthlyAmount)
      const fx = num(f.fxToUsd)
      const currency = (f.currency || 'USD').toUpperCase()
      const usdMonthly = currency === 'USD' ? monthly : monthly * fx
      return {
        id: f.id,
        label: f.label || 'Foreign pension',
        country: f.country || '',
        currency,
        monthlyAmount: monthly,
        fxToUsd: currency === 'USD' ? 1 : fx,
        startAge: Math.round(num(f.startAge)) || 65,
        usdMonthly: Math.max(0, usdMonthly),
        usdAnnual: Math.max(0, usdMonthly) * 12,
        missingFx: currency !== 'USD' && !(fx > 0),
      }
    })
    .filter(f => f.monthlyAmount > 0)
}

export function foreignAnnualAt(pensions, age) {
  return pensions.reduce((s, f) => s + (age >= f.startAge ? f.usdAnnual : 0), 0)
}

// ---------- Inputs ----------
// Assemble plan parameters from app state (profile + accounts + retirement
// settings), filling gaps with sensible defaults.
export function retirementParams(state, investmentsTotal) {
  const p = state.profile || {}
  const r = state.retirement || {}
  const { facts } = resolveFacts(state)
  const age = num(p.age)
  // Reconciled facts beat raw profile fields: payroll-verified income and
  // observed spending when available, typed estimates otherwise.
  const income = facts.grossIncome?.value || num(p.grossIncome)
  const monthlyExpenses = facts.monthlyExpenses?.value || num(p.monthlyExpenses)

  const missing = []
  if (!age) missing.push('age')
  if (!income) missing.push('gross income')
  if (!monthlyExpenses) missing.push('monthly living expenses')
  if (missing.length > 0) return { ready: false, missing }

  // Whole years only — the projection steps annually and the chart marker /
  // claim-age comparisons match on exact ages.
  const ageInt = Math.round(age)
  const retireAge = Math.round(Math.max(ageInt + 1, num(r.retireAge) || RETIREMENT_DEFAULTS.retireAge))
  const lifeExpectancy = Math.round(Math.max(retireAge + 1, num(r.lifeExpectancy) || RETIREMENT_DEFAULTS.lifeExpectancy))
  const ssClaimAge = Math.round(num(r.ssClaimAge) || RETIREMENT_DEFAULTS.ssClaimAge)

  // Contributions while working — the reconciled savings-rate bundle:
  // payroll-verified 401(k) pace (incl. after-tax) when stubs exist,
  // modeled from profile % of base salary otherwise.
  const annualContrib = facts.annualContrib?.value ?? 0
  const contribSource = facts.annualContrib?.source?.label || 'modeled'
  const includesAfterTax = Boolean(facts.annualContrib?.includesAfterTax)

  const spendingMonthly = num(r.spendingMonthly) || Math.round(monthlyExpenses * RETIREMENT_DEFAULTS.spendingPct)

  const foreignPensions = normalizeForeignPensions(r.foreignPensions)

  const ssSelf = num(r.ssMonthlyOverride) || estimateSSMonthly(income)
  const spouseIncome = num(p.spouseIncome)
  const ssSpouse = num(r.spouseSsMonthlyOverride) || (spouseIncome > 0 ? estimateSSMonthly(spouseIncome) : 0)
  const ssMonthlyAt67 = ssSelf + ssSpouse

  return {
    ready: true,
    age: ageInt,
    retireAge,
    lifeExpectancy,
    savings: Math.max(0, investmentsTotal),
    annualContrib,
    contribSource,
    includesAfterTax,
    incomeSource: facts.grossIncome?.source?.label || 'your estimate',
    expensesSource: facts.monthlyExpenses?.source?.label || 'your estimate',
    spendingAnnual: spendingMonthly * 12,
    spendingMonthly,
    ssClaimAge,
    ssMonthlyAt67,
    ssSelf,
    ssSpouse,
    ssEstimated: !num(r.ssMonthlyOverride),
    pensionAnnual: num(r.pensionMonthly) * 12,
    foreignPensions,
    foreignAnnualTotal: foreignPensions.reduce((s, f) => s + f.usdAnnual, 0),
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
  // Contributions may vary by age (scenario phases); constant by default.
  const contribAt = params.contribAt || (() => params.annualContrib)
  let bal = params.savings
  const series = [{ age: params.age, value: bal }]
  let depletedAt = null
  for (let a = params.age + 1; a <= params.lifeExpectancy; a++) {
    bal *= 1 + returnFor(a)
    if (a <= params.retireAge) {
      bal += contribAt(a)
    } else {
      // Each income stream starts on its own clock: US SS at the chosen claim
      // age, each foreign pension (CPP, OAS, …) at its own start age.
      const foreign = foreignAnnualAt(params.foreignPensions || [], a)
      let need = params.spendingAnnual - params.pensionAnnual - foreign - (a >= claimAge ? ssAnnual : 0)
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
