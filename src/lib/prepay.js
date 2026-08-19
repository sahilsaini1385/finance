// Prepay-the-mortgage vs invest-the-cash math. Pure functions.
//
// Framing: every prepaid dollar earns the note rate, guaranteed, until
// payoff — a bond-like risk-free return. The invest side is a forecast
// median with a wide range. These helpers compute both sides after tax so
// the AI advisor (and the Home card footer) can compare in dollars.

import { num } from './num.js'

const clamp01 = v => Math.max(0, Math.min(1, v))

// Fraction of avoided mortgage interest that was actually deductible: only
// the itemizable amount ABOVE the standard deduction does tax work, so a
// marginal itemizer loses less deduction by prepaying than the headline
// rate suggests.
export function deductibleFraction(itemizableEst, standardDeduction, annualMortgageInterest) {
  const int = num(annualMortgageInterest)
  if (int <= 0) return 0
  return clamp01((num(itemizableEst) - num(standardDeduction)) / int)
}

// The guaranteed after-tax return on a prepaid dollar. Standard-deduction
// households keep the full note rate (their interest wasn't deductible);
// itemizers give back marginal-rate × deductible fraction.
export function afterTaxPrepayRatePct(ratePct, marginalFedPct, deductibleFrac) {
  return num(ratePct) * (1 - (num(marginalFedPct) / 100) * clamp01(num(deductibleFrac)))
}

// Future value of a monthly stream compounding at annualRatePct.
// A prepayment stream compounds inside the loan at exactly the note rate,
// so no second amortization run is needed — UNLESS the extra retires the
// loan before month n; callers near that edge should diff two
// amortizationSchedule() runs and credit the freed P&I as investable from
// the payoff month on.
export function fvAnnuity(monthly, annualRatePct, nMonths) {
  const i = num(annualRatePct) / 100 / 12
  const m = num(monthly)
  const n = Math.max(0, Math.round(nMonths))
  if (i === 0) return m * n
  return (m * (Math.pow(1 + i, n) - 1)) / i
}

// Invest the same monthly stream in a taxable account at rInvPct, gains
// realized at the horizon at the LTCG rate.
export function investFvAfterTax(monthlyExtra, rInvPct, nMonths, tCg = 0.15) {
  const fvPre = fvAnnuity(monthlyExtra, rInvPct, nMonths)
  const basis = num(monthlyExtra) * Math.max(0, Math.round(nMonths))
  return { fvPre, basis, fvAt: fvPre - tCg * Math.max(0, fvPre - basis) }
}

// The taxable pre-tax return that ends with the same after-tax dollars as
// prepaying: x = [((1+i_at)^n − t_cg)/(1−t_cg)]^(1/n) − 1, annualized.
export function breakevenTaxablePct(afterTaxRatePct, nMonths, tCg = 0.15) {
  const iAt = num(afterTaxRatePct) / 100 / 12
  const n = Math.max(1, Math.round(nMonths))
  const x = Math.pow((Math.pow(1 + iAt, n) - tCg) / (1 - tCg), 1 / n) - 1
  return 1200 * x
}

// The advisor-snapshot object: pre/after-tax prepay return, taxable
// breakevens, and a per-$100/mo comparison at 5y and 10y the model can
// scale linearly to any amount the user names.
export function prepayVsInvestSummary({
  ratePct, marginalFedPct = 0, itemizeLikely = false,
  itemizableEst = 0, standardDeduction = 0, annualMortgageInterest = 0,
  rInvPct = 5, tCg = 0.15,
}) {
  const rate = num(ratePct)
  if (rate <= 0) return null
  const frac = itemizeLikely
    ? deductibleFraction(itemizableEst, standardDeduction, annualMortgageInterest)
    : 0
  const afterTax = afterTaxPrepayRatePct(rate, marginalFedPct, frac)
  const r1 = v => Math.round(v * 10) / 10
  const r2 = v => Math.round(v * 100) / 100 // note rates are quoted to 2 decimals
  const r0 = v => Math.round(v)
  const horizon = n => {
    const loanBalanceReduced = fvAnnuity(100, afterTax, n)
    const inv = investFvAfterTax(100, rInvPct, n, tCg)
    return {
      loanBalanceReduced: r0(loanBalanceReduced),
      interestAvoided: r0(loanBalanceReduced - 100 * n),
      investedAfterTax: r0(inv.fvAt), // at rInvPct — named in assumptions
      prepayEdge: r0(loanBalanceReduced - inv.fvAt),
    }
  }
  return {
    guaranteedPreTaxReturnPct: r2(rate),
    afterTaxReturnPct: r2(afterTax),
    afterTaxBasis: frac > 0
      ? `itemizing — ~${Math.round(frac * 100)}% of avoided interest was deductible at ${r1(marginalFedPct)}% marginal, so prepaying keeps ${r1(afterTax)}% after tax`
      : 'standard deduction — avoided interest was not deductible, full rate is after-tax',
    breakevenTaxablePreTaxPct: {
      yr5: r1(breakevenTaxablePct(afterTax, 60, tCg)),
      yr10: r1(breakevenTaxablePct(afterTax, 120, tCg)),
    },
    per100PerMonthExtra: { yr5: horizon(60), yr10: horizon(120) },
    assumptions:
      `invest side: ${r1(rInvPct)}%/yr nominal (10-yr US-equity median forecasts run ~4-6%), taxable account, ` +
      `${Math.round(tCg * 100)}% LTCG realized at horizon; prepay side is contractual, not forecast`,
    liquidityNote:
      'prepaid dollars are locked in home equity until sale/refi/HELOC; the required monthly payment does not change until payoff unless the loan is recast',
  }
}
