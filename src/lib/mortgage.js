// Mortgage amortization + payoff math. Pure functions.

import { localMonth } from './dates.js'
import { num } from './num.js'


// Full month-by-month schedule at annualRatePct with a fixed monthly P&I
// payment (+extra). The single source of truth every other payoff figure
// derives from, so numbers can never disagree between views.
// → { feasible:false, reason } |
//   { feasible:true, months, payoffDate, totalInterest, totalPrincipal,
//     totalPaid, crossoverMonth, crossoverDate,
//     rows: [{ n, date, interest, principal, payment, balance,
//              cumInterest, cumPrincipal }] }
export function amortizationSchedule(balance, annualRatePct, monthlyPayment, extra = 0) {
  const b0 = num(balance)
  const r = num(annualRatePct) / 100 / 12
  // extra may vary by payment number (scenario phases): pass a fn(n) → $.
  const extraAt = typeof extra === 'function' ? extra : () => num(extra)
  const basePay = num(monthlyPayment)
  const payFor = n => basePay + Math.max(0, num(extraAt(n)))
  if (b0 <= 0 || payFor(1) <= 0) return { feasible: false, reason: 'missing figures' }
  if (r > 0 && payFor(1) <= b0 * r) {
    return { feasible: false, reason: 'payment does not cover interest — the balance would grow' }
  }

  const start = new Date()
  let bal = b0
  let cumInterest = 0
  let cumPrincipal = 0
  let crossoverMonth = null
  const rows = []
  while (bal > 0 && rows.length < 600) {
    const n = rows.length + 1
    const pay = payFor(n)
    const interest = bal * r
    const principal = Math.min(bal, pay - interest) // final month partial — never overpay
    cumInterest += interest
    cumPrincipal += principal
    bal -= principal
    if (crossoverMonth === null && principal >= interest) crossoverMonth = n
    const d = new Date(start)
    d.setMonth(d.getMonth() + n)
    rows.push({
      n,
      date: localMonth(d),
      interest,
      principal,
      payment: interest + principal,
      balance: bal,
      cumInterest,
      cumPrincipal,
    })
  }
  if (bal > 0) {
    return { feasible: false, reason: 'payoff is more than 50 years away at this payment' }
  }
  const last = rows[rows.length - 1]
  return {
    feasible: true,
    months: rows.length,
    payoffDate: last.date,
    totalInterest: cumInterest,
    totalPrincipal: cumPrincipal,
    totalPaid: cumInterest + cumPrincipal,
    crossoverMonth,
    crossoverDate: crossoverMonth !== null ? rows[crossoverMonth - 1].date : null,
    rows,
  }
}

// Legacy shape kept for existing callers (Dashboard/Advisor area charts):
// derives the thinned balance series from the full schedule.
export function amortize(balance, annualRatePct, monthlyPayment, extra = 0) {
  const s = amortizationSchedule(balance, annualRatePct, monthlyPayment, extra)
  if (!s.feasible) return s
  const series = [{ month: 0, balance: num(balance) }]
  for (const row of s.rows) {
    if (row.n % 3 === 0 || row.balance === 0) series.push({ month: row.n, balance: row.balance })
  }
  return {
    feasible: true,
    months: s.months,
    payoffDate: s.payoffDate,
    totalInterest: s.totalInterest,
    series,
  }
}

// Group schedule rows by calendar year for the chart and table.
// → [{ year, monthsCount, principal, interest, totalPaid, endBalance, cumInterest }]
export function yearlyRollup(rows) {
  const out = []
  let cur = null
  for (const row of rows) {
    const year = Number(row.date.slice(0, 4))
    if (!cur || cur.year !== year) {
      cur = { year, monthsCount: 0, principal: 0, interest: 0, totalPaid: 0, endBalance: 0, cumInterest: 0 }
      out.push(cur)
    }
    cur.monthsCount++
    cur.principal += row.principal
    cur.interest += row.interest
    cur.totalPaid += row.payment
    cur.endBalance = row.balance
    cur.cumInterest = row.cumInterest
  }
  return out
}

// Where the loan stands after a fixed horizon (e.g. 60 or 120 months).
export function horizonOutlook(rows, horizonMonths) {
  if (!rows?.length) return null
  const idx = Math.min(horizonMonths, rows.length) - 1
  const row = rows[idx]
  return {
    interestPaid: row.cumInterest,
    principalPaid: row.cumPrincipal,
    endingBalance: row.balance,
    paidOff: rows.length <= horizonMonths,
  }
}

// What an extra-payment scenario buys vs the base plan, incl. the base-plan
// years the scenario deletes (for the chart's ghost bars).
export function scenarioDelta(baseSchedule, scenSchedule) {
  if (!baseSchedule?.feasible || !scenSchedule?.feasible) return null
  const ghostYears = []
  const scenMonths = scenSchedule.months
  for (const y of yearlyRollup(baseSchedule.rows.slice(scenMonths))) ghostYears.push(y)
  return {
    monthsSaved: baseSchedule.months - scenMonths,
    interestSaved: baseSchedule.totalInterest - scenSchedule.totalInterest,
    payoffDate: scenSchedule.payoffDate,
    ghostYears,
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
