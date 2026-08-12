// Scenario sandbox — fork the household's real numbers, move a few levers,
// and compare the outcomes side by side. Pure functions; nothing here writes
// state, and the page holds levers in component state only.
//
// The one modeling assumption (stated in the UI): changes to after-tax income
// and spending FLOW THROUGH to investing — earn $1,000/mo less or spend
// $1,000/mo more and your annual contributions drop by that much (never below
// zero). Explicit "invest more" and "windfall" levers add on top. Taxes use
// the rough federal estimate only.

import { resolveFacts } from './facts.js'
import { computeTotals } from './advisor.js'
import { retirementParams, deterministicProjection, monteCarloRetirement, RETIREMENT_DEFAULTS } from './retirement.js'
import { FI_ASSUMPTIONS } from './projection.js'
import { estimateFederalTax } from './taxTables.js'
import { amortizationSchedule } from './mortgage.js'

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/[$,%\s,]/g, ''))
  return Number.isNaN(n) ? 0 : n
}

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

// The current values each lever starts from (the form's prefill).
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

function fiFrom(age, investments, annualContrib, spendMonthly) {
  const fiNumber = (spendMonthly * 12) / FI_ASSUMPTIONS.withdrawalRate
  if (investments >= fiNumber) return { fiNumber, fiAge: age, alreadyThere: true }
  let portfolio = investments
  for (let y = 1; y <= FI_ASSUMPTIONS.maxYears; y++) {
    portfolio = portfolio * (1 + FI_ASSUMPTIONS.realGrowth) + annualContrib
    if (portfolio >= fiNumber) return { fiNumber, fiAge: age + y, alreadyThere: false }
  }
  return { fiNumber, fiAge: null, alreadyThere: false }
}

function metricsFor(params, investments, spendMonthly, cash, mortgage, extraPrincipal) {
  const mc = monteCarloRetirement(params, { ...MC_OPTS, rng: seededRng(42) })
  const det = deterministicProjection(params)
  const fi = fiFrom(params.age, investments, params.annualContrib, spendMonthly)
  const out = {
    fiAge: fi.fiAge,
    fiNumber: Math.round(fi.fiNumber),
    alreadyFI: fi.alreadyThere,
    successPct: Math.round(mc.successRate * 100),
    medianAtRetirement: Math.round(mc.band.find(b => b.age === params.retireAge)?.p50 ?? 0),
    fundsLastUntil: det.depletedAt || `${params.lifeExpectancy}+`,
    annualContrib: Math.round(params.annualContrib),
    retireAge: params.retireAge,
    efMonths: spendMonthly > 0 ? Math.round((cash / spendMonthly) * 10) / 10 : null,
    mortgage: null,
  }
  if (mortgage) {
    const s = amortizationSchedule(mortgage.balance, mortgage.rate, mortgage.payment, extraPrincipal)
    if (s.feasible) out.mortgage = { payoffDate: s.payoffDate, months: s.months, interest: Math.round(s.totalInterest) }
  }
  return out
}

// state + levers → { ready, base, scen, flowMonthly, assumptions }
export function runScenario(state, levers) {
  const totals = computeTotals(state)
  const params0 = retirementParams(state, totals.investments)
  if (!params0.ready) return { ready: false, missing: params0.missing }

  const p = state.profile || {}
  const r = state.retirement || {}
  const filing = p.filingStatus || 'single'
  const b = scenarioBaseline(state)

  const afterTax = (income) => income - estimateFederalTax(income, filing).tax
  // Flow-through: after-tax income delta minus spending delta, monthly.
  const flowMonthly =
    (afterTax(num(levers.income) + num(levers.spouseIncome)) - afterTax(b.income + b.spouseIncome)) / 12
    - (num(levers.spendMonthly) - b.spendMonthly)

  const contribScen = Math.max(0, params0.annualContrib + flowMonthly * 12 + num(levers.extraInvestMonthly) * 12)
  const investScen = Math.max(0, totals.investments + num(levers.windfall))

  // Retirement spending: if it was derived from living expenses (no explicit
  // override on the Retirement tab), scale it with the spending lever.
  const spendingExplicit = num(r.spendingMonthly) > 0
  const retSpendScen = spendingExplicit
    ? params0.spendingMonthly
    : Math.round(num(levers.spendMonthly) * RETIREMENT_DEFAULTS.spendingPct)

  const retireAgeScen = Math.round(Math.max(params0.age + 1, num(levers.retireAge) || params0.retireAge))

  const home = state.home || {}
  const mortgage = num(home.mortgageBalance) > 0 && num(home.mortgageRate) > 0 && num(home.monthlyPayment) > 0
    ? { balance: num(home.mortgageBalance), rate: num(home.mortgageRate), payment: num(home.monthlyPayment) }
    : null

  const paramsScen = {
    ...params0,
    savings: investScen,
    annualContrib: contribScen,
    retireAge: retireAgeScen,
    lifeExpectancy: Math.max(params0.lifeExpectancy, retireAgeScen + 1),
    spendingMonthly: retSpendScen,
    spendingAnnual: retSpendScen * 12,
  }

  return {
    ready: true,
    flowMonthly: Math.round(flowMonthly),
    base: metricsFor(params0, totals.investments, b.spendMonthly, totals.cash, mortgage, 0),
    scen: metricsFor(paramsScen, investScen, num(levers.spendMonthly), totals.cash, mortgage, num(levers.extraPrincipalMonthly)),
  }
}
