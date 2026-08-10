// Financial-independence projection. Deliberately simple and transparent:
// real (inflation-adjusted) growth on today's dollars, the 4% rule for the
// target, contributions held constant. Educational, not a plan.

import { resolveFacts } from './facts.js'

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/[$,%\s,]/g, ''))
  return Number.isNaN(n) ? 0 : n
}

export const FI_ASSUMPTIONS = {
  realGrowth: 0.05, // ~7% nominal minus ~2% inflation
  withdrawalRate: 0.04, // the "4% rule" → target = 25× annual spending
  maxYears: 60,
}

// state → {ready, missing[]} | {fiNumber, portfolio, annualContrib, fiAge, years, series}
export function projectFI(state, investmentsTotal) {
  const p = state.profile
  const { facts } = resolveFacts(state)
  const age = num(p.age)
  const monthlyExpenses = facts.monthlyExpenses?.value || num(p.monthlyExpenses)

  const missing = []
  if (!age) missing.push('age')
  if (!monthlyExpenses) missing.push('monthly living expenses')
  if (missing.length > 0) return { ready: false, missing }

  const annualExpenses = monthlyExpenses * 12
  const fiNumber = annualExpenses / FI_ASSUMPTIONS.withdrawalRate

  // Reconciled savings bundle — payroll-verified pace (incl. after-tax
  // 401(k)) when pay statements exist, modeled from profile otherwise.
  const annualContrib = facts.annualContrib?.value ?? 0

  let portfolio = investmentsTotal
  const series = [{ age, value: portfolio }]
  let fiAge = null
  for (let y = 1; y <= FI_ASSUMPTIONS.maxYears; y++) {
    portfolio = portfolio * (1 + FI_ASSUMPTIONS.realGrowth) + annualContrib
    series.push({ age: age + y, value: portfolio })
    if (fiAge === null && portfolio >= fiNumber) fiAge = age + y
    if (fiAge !== null && y >= (fiAge - age) + 5) break // a little context past the crossing
  }

  return {
    ready: true,
    alreadyThere: investmentsTotal >= fiNumber,
    fiNumber,
    portfolio: investmentsTotal,
    annualExpenses,
    annualContrib,
    fiAge,
    years: fiAge === null ? null : fiAge - age,
    series,
  }
}
