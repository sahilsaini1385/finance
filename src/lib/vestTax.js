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

// The Social Security wage base moves every year, so it is year-keyed in
// taxTables rather than frozen here — a hardcoded base silently overstates
// withholding for every high earner the moment the calendar turns.

// Coerce and clamp: Math.max(0, 'abc') is NaN, and a single NaN here poisons
// every downstream figure. A number that isn't finite means "unknown", which
// for a withholding estimate is zero.
const money = v => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

export function supplementalFederal(amount, priorSupplementalYtd = 0) {
  const before = money(priorSupplementalYtd)
  const amt = money(amount)
  const after = before + amt
  const highBefore = Math.max(0, before - SUPP_THRESHOLD)
  const highAfter = Math.max(0, after - SUPP_THRESHOLD)
  const high = highAfter - highBefore
  const low = Math.max(0, amt - high)
  return { low, high, tax: low * SUPP_RATE_LOW + high * SUPP_RATE_HIGH }
}

// → { gross, federal, socialSecurity, medicare, state, withheld, net, rates }
export function vestWithholding({
  amount,
  priorSupplementalYtd = 0,
  wagesYtd = 0,
  filingStatus = 'single',
  statePct = 0,
  year = new Date().getFullYear(),
}) {
  const limits = limitsFor(Number(year))
  const ssWageBase = limits.ssWageBase || 184500
  const surtaxTable = limits.medicareSurtaxAt || { single: 200000, mfj: 250000, hoh: 200000 }
  const gross = money(amount)
  const priorSupp = money(priorSupplementalYtd)
  const wages = money(wagesYtd)
  if (gross === 0) {
    // Same shape as the normal return, zeros throughout. An empty `rates`
    // used to reach the UI as Math.round(undefined) → "NaN%".
    return {
      gross: 0, federal: 0, socialSecurity: 0, medicare: 0, state: 0, withheld: 0, net: 0,
      rates: { federalPct: 0, effectivePct: 0, hitHighBracket: false },
    }
  }

  const fed = supplementalFederal(gross, priorSupp)

  // Social Security stops at the wage base — for a high earner most of the
  // year's vests have no SS withheld at all, and pretending otherwise
  // understates take-home by thousands.
  const ssRoom = Math.max(0, ssWageBase - wages)
  const socialSecurity = Math.min(gross, ssRoom) * SS_RATE

  const surtaxAt = surtaxTable[filingStatus] ?? surtaxTable.single
  const overBefore = Math.max(0, wages - surtaxAt)
  const overAfter = Math.max(0, wages + gross - surtaxAt)
  const medicare = gross * MEDICARE + (overAfter - overBefore) * MEDICARE_SURTAX

  // Clamped: a mistyped rate should not produce a negative paycheck.
  const state = gross * (Math.min(100, Math.max(0, Number(statePct) || 0)) / 100)

  // Withholding can never exceed the payment itself — a mistyped state rate
  // should not render a negative paycheck.
  const withheld = Math.min(gross, fed.tax + socialSecurity + medicare + state)
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
  // A vest we can't value can't answer "what lands" — which is this card's
  // whole purpose. Better silent than a confident "~$0 lands in 92 days".
  if (!(Number(s.nextVest.value) > 0)) return null

  const profile = state.profile || {}
  const year = (today || new Date().toISOString().slice(0, 10)).slice(0, 4)
  const payroll = state.__payrollYtd || {}
  const vestYear = s.nextVest.date.slice(0, 4)

  // Year-to-date wages only apply to a vest in the SAME year. A vest next
  // January starts from zero: the Social Security wage base and the $1M
  // supplemental threshold both reset, so carrying this year's totals over
  // would wrongly skip SS withholding and overstate take-home.
  const sameYear = vestYear === year
  const withholding = vestWithholding({
    year: Number(vestYear),
    amount: s.nextVest.value,
    priorSupplementalYtd: sameYear ? Number(payroll.rsuVested) || 0 : 0,
    wagesYtd: sameYear ? Number(payroll.gross) || 0 : 0,
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
    sameYear,
    ...withholding,
    year,
    limits: limitsFor(Number(year)),
  }
}
