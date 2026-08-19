// Scenario sandbox — fork the household's real numbers, move a few levers,
// and compare the outcomes side by side. Pure functions; nothing here writes
// state, and the page holds levers in component state only.
//
// Scenarios are TIME-BOXED: a scenario is a list of phases, each with its
// own lever values and a duration in years ("spouse off for 2 years, then
// back at 80%"). The last phase runs forever; if every explicit phase is
// finite, life reverts to today's numbers afterward.
//
// The one modeling assumption (stated in the UI): changes to after-tax income
// and spending FLOW THROUGH to investing — earn $1,000/mo less or spend
// $1,000/mo more during a phase and that phase's contributions drop by that
// much (never below zero). Explicit "invest more" and "windfall" levers add
// on top. Taxes use the rough federal estimate only.

import { resolveFacts } from './facts.js'
import { computeTotals } from './advisor.js'
import { retirementParams, deterministicProjection, monteCarloRetirement, RETIREMENT_DEFAULTS } from './retirement.js'
import { FI_ASSUMPTIONS } from './projection.js'
import { estimateFederalTax } from './taxTables.js'
import { amortizationSchedule } from './mortgage.js'
import { num } from './num.js'


// Deterministic RNG (mulberry32) so baseline and scenario runs never jitter
// against each other between renders — a lever at zero shows a zero delta.
export function seededRng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MC_OPTS = { trials: 600 }

// The current values each phase-lever starts from (the form's prefill).
export function scenarioBaseline(state) {
  const p = state.profile || {}
  const r = state.retirement || {}
  const { facts } = resolveFacts(state)
  return {
    income: Math.round(facts.grossIncome?.value || num(p.grossIncome)),
    spouseIncome: Math.round(num(p.spouseIncome)),
    spendMonthly: Math.round(facts.monthlyExpenses?.value || num(p.monthlyExpenses)),
    retireAge: Math.round(num(r.retireAge) || RETIREMENT_DEFAULTS.retireAge),
    extraInvestMonthly: 0,
    extraPrincipalMonthly: 0,
    windfall: 0,
  }
}

// Normalize a phase list so it always ends with an infinite phase: if every
// explicit phase is finite, life reverts to today's numbers afterward.
function resolvePhases(phases, basePhase) {
  const list = (phases || []).map(ph => ({ ...basePhase, ...ph, years: ph.years ? Math.max(1, Math.round(num(ph.years))) : null }))
  if (list.length === 0 || list[list.length - 1].years !== null) list.push({ ...basePhase, years: null })
  return list
}

// year (0-based from now) → phase
function phaseAtYear(phases, y) {
  let cum = 0
  for (const ph of phases) {
    if (ph.years === null || y < cum + ph.years) return ph
    cum += ph.years
  }
  return phases[phases.length - 1]
}

function fiFrom(age, investments, contribForYear, tailSpendMonthly) {
  const fiNumber = (tailSpendMonthly * 12) / FI_ASSUMPTIONS.withdrawalRate
  if (investments >= fiNumber) return { fiNumber, fiAge: age, alreadyThere: true }
  let portfolio = investments
  for (let y = 1; y <= FI_ASSUMPTIONS.maxYears; y++) {
    portfolio = portfolio * (1 + FI_ASSUMPTIONS.realGrowth) + contribForYear(y - 1)
    if (portfolio >= fiNumber) return { fiNumber, fiAge: age + y, alreadyThere: false }
  }
  return { fiNumber, fiAge: null, alreadyThere: false }
}

function metricsFor(params, investments, contribForYear, tailContrib, nowSpendMonthly, tailSpendMonthly, cash, mortgage, extraPrincipalForMonth) {
  const mc = monteCarloRetirement(params, { ...MC_OPTS, rng: seededRng(42) })
  const det = deterministicProjection(params)
  const fi = fiFrom(params.age, investments, contribForYear, tailSpendMonthly)
  const out = {
    fiAge: fi.fiAge,
    fiNumber: Math.round(fi.fiNumber),
    alreadyFI: fi.alreadyThere,
    successPct: Math.round(mc.successRate * 100),
    medianAtRetirement: Math.round(mc.band.find(b => b.age === params.retireAge)?.p50 ?? 0),
    fundsLastUntil: det.depletedAt || `${params.lifeExpectancy}+`,
    annualContrib: Math.round(tailContrib),
    retireAge: params.retireAge,
    efMonths: nowSpendMonthly > 0 ? Math.round((cash / nowSpendMonthly) * 10) / 10 : null,
    mortgage: null,
  }
  if (mortgage) {
    const s = amortizationSchedule(mortgage.balance, mortgage.rate, mortgage.payment, extraPrincipalForMonth)
    if (s.feasible) out.mortgage = { payoffDate: s.payoffDate, months: s.months, interest: Math.round(s.totalInterest) }
  }
  return out
}

// state + scenario → { ready, base, scen, phases:[{years, flowMonthly, contribAnnual, spendMonthly}] }
// scenario: { retireAge, windfall, phases: [{years|null, income, spouseIncome,
//             spendMonthly, extraInvestMonthly, extraPrincipalMonthly}] }
export function runScenario(state, scenario) {
  const totals = computeTotals(state)
  const params0 = retirementParams(state, totals.investments)
  if (!params0.ready) return { ready: false, missing: params0.missing }

  const p = state.profile || {}
  const r = state.retirement || {}
  const filing = p.filingStatus || 'single'
  const b = scenarioBaseline(state)
  const basePhase = {
    income: b.income, spouseIncome: b.spouseIncome, spendMonthly: b.spendMonthly,
    extraInvestMonthly: 0, extraPrincipalMonthly: 0,
  }

  const afterTax = income => income - estimateFederalTax(income, filing).tax
  const baseAT = afterTax(b.income + b.spouseIncome)

  // Per-phase cash-flow delta and resulting contributions.
  const phases = resolvePhases(scenario.phases, basePhase).map(ph => {
    const flowMonthly = (afterTax(num(ph.income) + num(ph.spouseIncome)) - baseAT) / 12
      - (num(ph.spendMonthly) - b.spendMonthly)
    const contribAnnual = Math.max(0, params0.annualContrib + flowMonthly * 12 + num(ph.extraInvestMonthly) * 12)
    return { ...ph, flowMonthly: Math.round(flowMonthly), contribAnnual: Math.round(contribAnnual) }
  })
  const tail = phases[phases.length - 1]

  const contribForYear = y => phaseAtYear(phases, y).contribAnnual
  const investScen = Math.max(0, totals.investments + num(scenario.windfall))

  // Retirement spending: if it was derived from living expenses (no explicit
  // override on the Retirement tab), scale it with the long-run spending.
  const spendingExplicit = num(r.spendingMonthly) > 0
  const retSpendScen = spendingExplicit
    ? params0.spendingMonthly
    : Math.round(num(tail.spendMonthly) * RETIREMENT_DEFAULTS.spendingPct)

  const retireAgeScen = Math.round(Math.max(params0.age + 1, num(scenario.retireAge) || params0.retireAge))

  const home = state.home || {}
  const mortgage = num(home.mortgageBalance) > 0 && num(home.mortgageRate) > 0 && num(home.monthlyPayment) > 0
    ? { balance: num(home.mortgageBalance), rate: num(home.mortgageRate), payment: num(home.monthlyPayment) }
    : null

  const paramsScen = {
    ...params0,
    savings: investScen,
    annualContrib: tail.contribAnnual,
    contribAt: age => contribForYear(Math.max(0, age - params0.age - 1)),
    retireAge: retireAgeScen,
    lifeExpectancy: Math.max(params0.lifeExpectancy, retireAgeScen + 1),
    spendingMonthly: retSpendScen,
    spendingAnnual: retSpendScen * 12,
  }

  const extraPrincipalForMonth = n => num(phaseAtYear(phases, Math.floor((n - 1) / 12)).extraPrincipalMonthly)

  return {
    ready: true,
    phases: phases.map(ph => ({
      years: ph.years, flowMonthly: ph.flowMonthly, contribAnnual: ph.contribAnnual,
      spendMonthly: Math.round(num(ph.spendMonthly)),
    })),
    base: metricsFor(
      params0, totals.investments, () => params0.annualContrib, params0.annualContrib,
      b.spendMonthly, b.spendMonthly, totals.cash, mortgage, 0,
    ),
    scen: metricsFor(
      paramsScen, investScen, contribForYear, tail.contribAnnual,
      num(phases[0].spendMonthly), num(tail.spendMonthly), totals.cash, mortgage, extraPrincipalForMonth,
    ),
  }
}
