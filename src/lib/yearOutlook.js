// Where the full year lands — the two questions payroll can't answer on its own.
//
// 1. TAX. Withholding on a paycheck follows your W-4; withholding on a vest
//    follows the flat 22% supplemental rate. If your marginal rate is 32-35%,
//    every vesting dollar is under-withheld by 10-13 points, and the bill
//    arrives in April with no warning. So the projection doesn't just annualize
//    what has been withheld — it splits the remaining year into cash wages
//    (withheld at the rate payroll has actually been using) and scheduled vests
//    (withheld at the supplemental rate), then compares the total against the
//    tax the projected income would actually owe.
//
// 2. THE AFTER-TAX 401(k) LANE. The employee deferral limit is the famous one,
//    but the real ceiling is IRC 415(c) — deferrals + employer money +
//    after-tax, in one plan. The gap between them is the mega-backdoor lane,
//    and it expires on December 31: unused space cannot be carried forward.
//
// Both are ESTIMATES built from data the app already holds. They are federal
// only, they know nothing about investment income, itemized deductions, or
// credits, and every consumer must say so. Nothing here reads or writes state.

import { paystubYearSummary, yearFrac, annualizeYtd, payFrequencyFromStubs } from './income.js'
import { rsuScheduledAfter } from './rsu.js'
import { limitsFor, estimateFederalTax, marginalRate } from './taxTables.js'
import { supplementalFederal } from './vestTax.js'

import { num } from './num.js'

const SUPP_RATE = 0.22
const r0 = n => Math.round(n)

// Shared spine: the projected-income and projected-deferral figures both
// outlooks need, derived once so the tax card and the lane card can never
// disagree about how much this year earns or defers.
function basis(state, year, today) {
  const summary = paystubYearSummary(state, year)
  if (!summary || !(summary.ytd.gross > 0)) return null
  const ytd = summary.ytd
  const payDate = summary.latest.payDate
  const frac = yearFrac(payDate)
  const limits = limitsFor(Number(year))
  const p = state.profile || {}
  const age = num(p.age)
  const catchUpEligible = age >= 50

  // Cash pace and RSU actuals are kept apart all the way through. Annualizing
  // a year that contains a $105k vest would project four more of them.
  const rsuYtd = num(ytd.rsuVested)
  const cashYtd = Math.max(0, ytd.gross - rsuYtd)
  const cashProjected = Math.max(cashYtd, annualizeYtd(cashYtd, payDate))
  const rsuAhead = Math.max(0, rsuScheduledAfter(state, payDate, year))
  // Same recipe as facts.js grossIncome, deliberately — the Income page shows
  // that number as the headline projection and these cards must match it.
  const gross = r0(cashProjected + rsuYtd + rsuAhead)

  // Employee deferrals: pace each bucket, then hold the pair to the statutory
  // employee limit. Someone already at the cap projects to the cap, not past it.
  const employeeLimit = limits.k401 + (catchUpEligible ? limits.k401CatchUp : 0)
  let tradProjected = Math.max(ytd.k401Trad, annualizeYtd(ytd.k401Trad, payDate))
  let rothProjected = Math.max(ytd.k401Roth, annualizeYtd(ytd.k401Roth, payDate))
  const paced = tradProjected + rothProjected
  if (paced > employeeLimit && paced > 0) {
    const scale = employeeLimit / paced
    tradProjected = Math.max(ytd.k401Trad, tradProjected * scale)
    rothProjected = Math.max(ytd.k401Roth, rothProjected * scale)
  }

  const periodsPerYear = payFrequencyFromStubs(state.paystubs) || 0
  const periodsLeft = periodsPerYear ? Math.max(0, Math.round(periodsPerYear * (1 - frac))) : 0

  return {
    summary, ytd, payDate, frac, limits, profile: p,
    filingStatus: p.filingStatus || 'single',
    catchUpEligible, employeeLimit,
    cashYtd, cashProjected, rsuYtd, rsuAhead, gross,
    tradProjected, rothProjected,
    periodsPerYear, periodsLeft,
    year: Number(year),
  }
}

// Full-year federal tax projection → refund or amount owed.
export function taxOutlook(state, { year, today } = {}) {
  const y = Number(year) || Number((today || new Date().toISOString().slice(0, 10)).slice(0, 4))
  const b = basis(state, y, today)
  if (!b) return null

  // Pre-tax reductions. pretaxBenefits already carries HSA and premiums and
  // deliberately excludes every 401(k) row, so adding ytd.hsa here would
  // subtract it twice. Roth deferrals don't reduce taxable wages at all.
  const pretaxProjected = Math.max(b.ytd.pretaxBenefits, annualizeYtd(b.ytd.pretaxBenefits, b.payDate))
  const myTaxableWages = Math.max(0, b.gross - b.tradProjected - pretaxProjected)
  const spouseIncome = Math.max(0, num(b.profile.spouseIncome))
  const householdWages = myTaxableWages + spouseIncome

  const est = estimateFederalTax(householdWages, b.filingStatus, y)
  const marginal = marginalRate(est.taxable, b.filingStatus, y)

  // Projected withholding, built the way it is actually collected.
  const fedYtd = num(b.ytd.federalTax)
  const fedOnVestedRsu = supplementalFederal(b.rsuYtd, 0).tax
  const fedOnCashYtd = Math.max(0, fedYtd - fedOnVestedRsu)
  // Clamped: if a stub's federal row parsed oddly, a rate above 100% would
  // project a paycheck that withholds more than it pays.
  const cashRate = b.cashYtd > 0 ? Math.min(1, fedOnCashYtd / b.cashYtd) : 0
  const cashRemaining = Math.max(0, b.cashProjected - b.cashYtd)
  const fedOnCashAhead = cashRemaining * cashRate
  const fedOnRsuAhead = supplementalFederal(b.rsuAhead, b.rsuYtd).tax
  const projectedWithheld = fedYtd + fedOnCashAhead + fedOnRsuAhead

  // Positive = you owe in April. Negative = refund.
  const gap = est.tax - projectedWithheld

  // The equity attribution. RSU income is withheld at 22% but taxed at your
  // marginal rate; the difference is usually most of the shortfall, and it is
  // the part the user can do something about.
  const rsuIncome = b.rsuYtd + b.rsuAhead
  const rsuShortfall = Math.max(0, rsuIncome * Math.max(0, marginal - SUPP_RATE))

  const perPaycheck = b.periodsLeft > 0 && gap > 0 ? gap / b.periodsLeft : 0

  return {
    year: y,
    asOf: b.payDate,
    gross: b.gross,
    cashProjected: r0(b.cashProjected),
    rsuIncome: r0(rsuIncome),
    rsuVestedYtd: r0(b.rsuYtd),
    rsuAhead: r0(b.rsuAhead),
    pretaxProjected: r0(pretaxProjected),
    tradProjected: r0(b.tradProjected),
    spouseIncome: r0(spouseIncome),
    taxableWages: r0(householdWages),
    taxableIncome: r0(est.taxable),
    standardDeduction: b.limits.standardDeduction[b.filingStatus] || b.limits.standardDeduction.single,
    projectedTax: r0(est.tax),
    withheldYtd: r0(fedYtd),
    projectedWithheld: r0(projectedWithheld),
    // Signed one way each so the UI never has to remember which is which.
    owed: gap > 0 ? r0(gap) : 0,
    refund: gap < 0 ? r0(-gap) : 0,
    gap: r0(gap),
    effectiveRate: b.gross > 0 ? (est.tax / b.gross) * 100 : 0,
    marginalRate: marginal * 100,
    rsuShortfall: r0(rsuShortfall),
    rsuUnderWithheldPts: Math.max(0, marginal - SUPP_RATE) * 100,
    perPaycheck: r0(perPaycheck),
    periodsLeft: b.periodsLeft,
    filingStatus: b.filingStatus,
    // No federal row parsed means the refund/owed line is meaningless — the
    // projected tax is still worth showing, the comparison is not.
    withholdingKnown: fedYtd > 0,
    includesSpouse: spouseIncome > 0,
    multiEmployer: b.summary.multiEmployer,
  }
}

// The after-tax 401(k) (mega-backdoor Roth) lane: how much 415(c) room is left,
// and what it would take per paycheck to use it before December 31.
export function megaBackdoorOutlook(state, { year, today, employerMatch = 0 } = {}) {
  const y = Number(year) || Number((today || new Date().toISOString().slice(0, 10)).slice(0, 4))
  const b = basis(state, y, today)
  if (!b) return null

  const limit = b.limits.totalDC
  const afterTaxYtd = Math.max(0, num(b.ytd.k401AfterTax))
  const afterTaxPace = Math.max(afterTaxYtd, annualizeYtd(afterTaxYtd, b.payDate))
  const employee = b.tradProjected + b.rothProjected
  const match = Math.max(0, num(employerMatch))

  // Catch-up contributions are excluded from 415(c), so an over-50 saver's
  // deferrals count against the cap only up to the base employee limit.
  const employeeAgainstCap = b.catchUpEligible ? Math.min(employee, b.limits.k401) : employee

  const used = employeeAgainstCap + match + afterTaxYtd
  const room = Math.max(0, limit - used)
  const projectedUsed = employeeAgainstCap + match + afterTaxPace
  const unusedAtPace = Math.max(0, limit - projectedUsed)
  const perPaycheck = b.periodsLeft > 0 ? room / b.periodsLeft : 0

  return {
    year: y,
    asOf: b.payDate,
    limit,
    employeeDeferrals: r0(employee),
    employeeAgainstCap: r0(employeeAgainstCap),
    employerMatch: r0(match),
    matchKnown: match > 0,
    afterTaxYtd: r0(afterTaxYtd),
    afterTaxPace: r0(afterTaxPace),
    used: r0(used),
    room: r0(room),
    unusedAtPace: r0(unusedAtPace),
    projectedTotal: r0(Math.min(limit, projectedUsed)),
    perPaycheck: r0(perPaycheck),
    periodsLeft: b.periodsLeft,
    // A plan that has already run after-tax dollars through payroll clearly
    // permits them — no need to hedge about whether the lane exists.
    planSupports: afterTaxYtd > 0,
    catchUpEligible: b.catchUpEligible,
    pctUsed: limit > 0 ? Math.min(100, (used / limit) * 100) : 0,
  }
}

export function yearOutlook(state, opts = {}) {
  return { tax: taxOutlook(state, opts), lane: megaBackdoorOutlook(state, opts) }
}

// ---------- payroll money headed for an account ----------
//
// Some savings never appear as a deposit. After-tax 401(k) dollars come out of
// payroll all year and only land in the Roth when the conversion posts — so a
// goal linked to that Roth sees no transactions and a balance that ignores
// everything contributed since January. It reads as stalled while it is in
// fact the fastest-funding goal the household has.
//
// This describes such a stream: what is already in the plan (real money the
// user owns, just not in the account yet), and what the year will add.

export const PAYROLL_INFLOWS = {
  k401AfterTax: {
    id: 'k401AfterTax',
    label: 'After-tax 401(k), converted at year end',
    short: 'after-tax 401(k)',
    // Contributed through payroll, held in the plan, moved into the linked
    // account in one lump when the conversion runs.
    holdsUntilConversion: true,
  },
}

// → { source, ytd, projected, remaining, monthly, capped } or null when the
// stream doesn't exist in this household's payroll.
export function payrollInflowOutlook(state, { source = 'k401AfterTax', year, today, employerMatch = 0 } = {}) {
  const spec = PAYROLL_INFLOWS[source]
  if (!spec) return null
  const y = Number(year) || Number((today || new Date().toISOString().slice(0, 10)).slice(0, 4))
  const lane = megaBackdoorOutlook(state, { year: y, today, employerMatch })
  if (!lane) return null
  const ytd = lane.afterTaxYtd
  // No after-tax dollars on this year's statements means nothing to project.
  // In January that is also what stops last year's contributions — already
  // converted and sitting in the balance — from being counted a second time.
  if (!(ytd > 0)) return null

  // The pace can't exceed what 415(c) still allows.
  const ceiling = ytd + lane.room
  const projected = Math.min(lane.afterTaxPace, ceiling)

  return {
    source: spec.id,
    label: spec.label,
    short: spec.short,
    year: y,
    asOf: lane.asOf,
    ytd,
    projected,
    remaining: Math.max(0, projected - ytd),
    // Annual rate spread monthly: the run rate a multi-year goal should
    // assume, not just what is left of this year.
    monthly: projected / 12,
    capped: lane.afterTaxPace > projected,
    periodsLeft: lane.periodsLeft,
  }
}
