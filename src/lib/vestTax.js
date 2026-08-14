// What actually lands in the account from an RSU vest.
//
// Companies withhold on vesting as SUPPLEMENTAL wages, which follows its own
// schedule rather than your W-4:
//   - 22% federal on supplemental wages up to $1,000,000 in a calendar year
//   - 37% federal on the portion ABOVE $1,000,000 (mandatory, not optional)
//   - plus Social Security (6.2% up to the annual wage base, nothing above it)
//   - plus Medicare 1.45%, and an extra 0.9% surtax above the filing-status
//     threshold once total wages pass it
//   - plus state withholding, which varies; WA/TX/FL/NV and friends have none
//
// This is a WITHHOLDING estimate, not a tax bill. Withholding at 22% while
// your marginal rate is 32-37% is exactly why equity-heavy households owe in
// April, so the shortfall is worth showing — but it is an estimate and the UI
// must say so.

import { limitsFor } from './taxTables.js'

const SUPP_THRESHOLD = 1000000
const SUPP_RATE_LOW = 0.22
const SUPP_RATE_HIGH = 0.37
const MEDICARE = 0.0145
const MEDICARE_SURTAX = 0.009
const SS_RATE = 0.062

// 2026 figures; both move most years.
const SS_WAGE_BASE = 184500
const SURTAX_THRESHOLD = { single: 200000, hoh: 200000, mfj: 250000 }

export function supplementalFederal(amount, priorSupplementalYtd = 0) {
  const before = Math.max(0, priorSupplementalYtd)
  const after = before + Math.max(0, amount)
  const highBefore = Math.max(0, before - SUPP_THRESHOLD)
  const highAfter = Math.max(0, after - SUPP_THRESHOLD)
  const high = highAfter - highBefore
  const low = Math.max(0, amount - high)
  return { low, high, tax: low * SUPP_RATE_LOW + high * SUPP_RATE_HIGH }
}

// → { gross, federal, socialSecurity, medicare, state, withheld, net, rates }
export function vestWithholding({
  amount,
  priorSupplementalYtd = 0,
  wagesYtd = 0,
  filingStatus = 'single',
  statePct = 0,
}) {
  const gross = Math.max(0, Number(amount) || 0)
  if (gross === 0) {
    return { gross: 0, federal: 0, socialSecurity: 0, medicare: 0, state: 0, withheld: 0, net: 0, rates: {} }
  }

  const fed = supplementalFederal(gross, priorSupplementalYtd)

  // Social Security stops at the wage base — for a high earner most of the
  // year's vests have no SS withheld at all, and pretending otherwise
  // understates take-home by thousands.
  const ssRoom = Math.max(0, SS_WAGE_BASE - Math.max(0, wagesYtd))
  const socialSecurity = Math.min(gross, ssRoom) * SS_RATE

  const surtaxAt = SURTAX_THRESHOLD[filingStatus] ?? SURTAX_THRESHOLD.single
  const overBefore = Math.max(0, wagesYtd - surtaxAt)
  const overAfter = Math.max(0, wagesYtd + gross - surtaxAt)
  const medicare = gross * MEDICARE + (overAfter - overBefore) * MEDICARE_SURTAX

  const state = gross * (Math.max(0, Number(statePct) || 0) / 100)

  const withheld = fed.tax + socialSecurity + medicare + state
  return {
    gross,
    federal: fed.tax,
    socialSecurity,
    medicare,
    state,
    withheld,
    net: gross - withheld,
    rates: {
      federalPct: (fed.tax / gross) * 100,
      effectivePct: (withheld / gross) * 100,
      hitHighBracket: fed.high > 0,
    },
  }
}

// Everything the Income page needs about the next vest, computed from data the
// app already has. Returns null when there's nothing scheduled.
export function nextVestOutlook(state, summary, { today } = {}) {
  const rsu = state.rsu || {}
  const s = summary
  if (!s?.nextVest) return null

  const profile = state.profile || {}
  const year = (today || new Date().toISOString().slice(0, 10)).slice(0, 4)
  const payroll = state.__payrollYtd || {}

  const withholding = vestWithholding({
    amount: s.nextVest.value,
    priorSupplementalYtd: Number(payroll.rsuVested) || 0,
    wagesYtd: Number(payroll.gross) || 0,
    filingStatus: profile.filingStatus || 'single',
    statePct: Number(profile.stateWithholdingPct) || 0,
  })

  const daysAway = Math.round(
    (new Date(s.nextVest.date + 'T00:00') - new Date((today || new Date().toISOString().slice(0, 10)) + 'T00:00')) / 86400000,
  )

  return {
    date: s.nextVest.date,
    units: s.nextVest.units,
    daysAway,
    ...withholding,
    year,
    limits: limitsFor(Number(year)),
  }
}
