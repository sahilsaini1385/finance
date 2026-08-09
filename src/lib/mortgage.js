// Mortgage amortization + payoff math. Pure functions.

import { localMonth } from './dates.js'

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/[$,%\s,]/g, ''))
  return Number.isNaN(n) ? 0 : n
}

// Amortize a balance at annualRatePct with a fixed monthly P&I payment (+extra).
// Returns {feasible, months, payoffDate, totalInterest, series:[{month, balance}]}
export function amortize(balance, annualRatePct, monthlyPayment, extra = 0) {
  const b0 = num(balance)
  const r = num(annualRatePct) / 100 / 12
  const pay = num(monthlyPayment) + num(extra)
  if (b0 <= 0 || pay <= 0) return { feasible: false, reason: 'missing figures' }
  if (r > 0 && pay <= b0 * r) {
    return { feasible: false, reason: 'payment does not cover interest — the balance would grow' }
  }

  let bal = b0
  let totalInterest = 0
  const series = [{ month: 0, balance: bal }]
  let months = 0
  while (bal > 0 && months < 600) {
    months++
    const interest = bal * r
    totalInterest += interest
    bal = bal + interest - pay
    if (bal < 0) bal = 0
    // Keep the series small: record every 3rd month plus the last.
    if (months % 3 === 0 || bal === 0) series.push({ month: months, balance: bal })
  }
  if (bal > 0) {
    return { feasible: false, reason: 'payoff is more than 50 years away at this payment' }
  }
  const payoffDate = new Date()
  payoffDate.setMonth(payoffDate.getMonth() + months)
  return {
    feasible: true,
    months,
    payoffDate: localMonth(payoffDate),
    totalInterest,
    series,
  }
}

// Compare extra-payment scenarios against the base schedule.
export function extraPaymentScenarios(balance, annualRatePct, monthlyPayment, extras = [100, 250, 500]) {
  const base = amortize(balance, annualRatePct, monthlyPayment)
  if (!base.feasible) return { base, scenarios: [] }
  const scenarios = extras.map(extra => {
    const s = amortize(balance, annualRatePct, monthlyPayment, extra)
    return {
      extra,
      months: s.months,
      monthsSaved: base.months - s.months,
      interestSaved: base.totalInterest - s.totalInterest,
      payoffDate: s.payoffDate,
    }
  })
  return { base, scenarios }
}

export function formatMonths(m) {
  const y = Math.floor(m / 12)
  const rem = m % 12
  if (y === 0) return `${rem} mo`
  if (rem === 0) return `${y} yr`
  return `${y} yr ${rem} mo`
}
