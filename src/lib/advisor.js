// Rules-based guidance engine. Educational only — not tax, legal, or investment advice.
// Limits below are the announced 2026 IRS figures; update annually and verify at irs.gov.

import { localToday, localMonth } from './dates.js'
import { txParts } from './tx.js'
import { oopStatus } from './health.js'
import { paystubYearSummary } from './income.js'
import { CURRENT_TAX_YEAR, limitsFor, estimateFederalTax } from './taxTables.js'
import { resolveFacts, policyPremiumAnnual, policyCoverage, toleranceFor } from './facts.js'
import { buildTaxSummary } from './report.js'
import { num } from './num.js'

// Back-compat re-exports — tables now live year-keyed in taxTables.js.
// Named for what they are, not a year that silently goes stale. The `.year`
// field says which table actually applies.
export const CURRENT_LIMITS = limitsFor(CURRENT_TAX_YEAR)
export { estimateFederalTax, limitsFor }

// Aggregates key figures across W-2 documents for the most recent tax year that has them.
export function w2Summary(state) {
  const w2s = (state.documents || []).filter(d => d.kind === 'W-2' && d.fields)
  if (w2s.length === 0) return null
  const year = w2s.map(d => d.year).sort().reverse()[0]
  const docs = w2s.filter(d => d.year === year)
  const sum = key => docs.reduce((s, d) => s + (parseFloat(d.fields?.[key]) || 0), 0)
  return {
    year,
    count: docs.length,
    wages: sum('wages'),
    fedWithholding: sum('fedWithholding'),
    k401: sum('k401'),
    hsa: sum('hsa'),
  }
}


// Comprehensive net worth: accounts (minus any the user excludes — e.g.
// unvested RSUs, which are future income, not an asset yet) plus home equity
// from the Home tab. A linked mortgage account already counts in debt; only
// when there is none does the Home tab's mortgage balance stand in, so the
// house is never double-counted.
// Which hero bucket an account lands in. The user can pin any non-debt
// account to a bucket (a.bucket, set from the Overview tiles); otherwise the
// account type decides. Debt is never overridable — money owed is owed.
export function accountBucket(a) {
  if (['credit card', 'loan', 'mortgage'].includes(a.type)) return 'debt'
  if (['cash', 'investments', 'retirement'].includes(a.bucket)) return a.bucket
  if (['checking', 'savings'].includes(a.type)) return 'cash'
  if (a.type === 'retirement') return 'retirement'
  if (['brokerage', 'hsa', '529'].includes(a.type)) return 'investments'
  return 'other'
}

// Balance in USD. A foreign-currency account converts at its typed rate —
// same rule as foreign pensions: no rate means the balance contributes $0
// (never pounds counted as dollars), and the caller is told via needsFx.
export function usdBalance(a) {
  const b = num(a.balance)
  const cur = String(a.currency || 'USD').toUpperCase()
  if (cur === 'USD') return { usd: b, needsFx: false }
  const fx = num(a.fxToUsd)
  return fx > 0 ? { usd: b * fx, needsFx: false } : { usd: 0, needsFx: true }
}

export function computeTotals(state) {
  let cash = 0, taxableInvest = 0, retirementInvest = 0, debt = 0, other = 0, excluded = 0
  let fxMissing = 0
  let hasMortgageAccount = false
  for (const a of state.accounts) {
    const conv = usdBalance(a)
    if (conv.needsFx) fxMissing++
    const b = conv.usd
    const bucket = accountBucket(a)
    if (a.excludeFromNetWorth) {
      excluded += bucket === 'debt' ? -Math.abs(b) : b
      continue
    }
    if (a.type === 'mortgage') hasMortgageAccount = true
    if (bucket === 'cash') cash += b
    else if (bucket === 'retirement') retirementInvest += b
    else if (bucket === 'investments') taxableInvest += b
    else if (bucket === 'debt') debt += Math.abs(b)
    else other += b
  }
  // totals.investments stays the combined (taxable + retirement) figure every
  // projection consumes; the split is what the hero tiles display.
  const investments = taxableInvest + retirementInvest
  const home = state.home || {}
  const homeValue = num(home.currentValue)
  const homeEquity = homeValue > 0 ? homeValue - (hasMortgageAccount ? 0 : num(home.mortgageBalance)) : 0
  // Rental equity from the Properties tab. Value and loan are both typed on
  // the property record (never a synced account), so there is nothing to
  // double-count — if a rental's mortgage is also synced as an account, the
  // user should exclude that account, and the Properties page says so.
  let propertyValue = 0, propertyDebt = 0
  for (const p of state.properties || []) {
    const v = num(p.currentValue)
    if (v > 0) { propertyValue += v; propertyDebt += num(p.mortgageBalance) }
  }
  const propertyEquity = Math.max(0, propertyValue - propertyDebt)
  const accountsNet = cash + investments + other - debt
  return {
    cash, investments, debt, other, excluded,
    retirementInvest,
    taxableInvest,
    homeValue, homeEquity,
    propertyValue, propertyDebt, propertyEquity,
    fxMissing, // foreign-currency accounts contributing $0 until a rate is set
    propertyCount: (state.properties || []).filter(p => num(p.currentValue) > 0).length,
    accountsNet, // the old accounts-only figure
    netWorth: accountsNet + homeEquity + propertyEquity,
  }
}

// Salary-multiple policies re-derive from the current base salary (see
// facts.policyCoverage), so DIME and AD&D checks self-heal as pay changes.
function coverageOf(state, kind) {
  return state.insurance
    .filter(p => p.type === kind)
    .reduce((s, p) => s + (policyCoverage(state, p)?.value || 0), 0)
}

// Returns [{id, area: 'tax'|'insurance'|'planning', severity: 'good'|'info'|'warning'|'critical', title, detail}]
export function getRecommendations(state) {
  const recs = []
  const p = state.profile
  const L = CURRENT_LIMITS
  const totals = computeTotals(state)
  const age = num(p.age)
  // Reconciled facts: one income, one expenses, one debt figure everywhere —
  // payroll/synced sources beat typed estimates (see facts.js for the policy).
  const { facts } = resolveFacts(state)
  const income = facts.grossIncome?.value || num(p.grossIncome)
  const incomeVerified = facts.grossIncome?.source?.origin === 'payroll'
  const householdIncome = income + num(p.spouseIncome)
  const monthlyExpenses = facts.monthlyExpenses?.value || num(p.monthlyExpenses)
  const dependents = num(p.dependents)
  const payrollVerified = Boolean(facts.payroll)
  const push = (area, severity, title, detail) => recs.push({ id: `${area}-${recs.length}`, area, severity, title, detail })

  // ---------- Tax ----------
  if (income > 0) {
    const matchPct = num(p.employerMatchPct)
    // Payroll-implied deferral % (of base salary) beats the typed % once
    // stubs exist — the two used to produce contradictory match verdicts.
    const typedPct = num(p.k401ContributionPct)
    const impliedPct = payrollVerified && facts.k401Deferrals && facts.baseSalary?.value > 0
      ? (facts.k401Deferrals.pace / facts.baseSalary.value) * 100
      : null
    const contribPct = impliedPct ?? typedPct
    const matchBase = facts.baseSalary?.value || income
    if (matchPct > 0 && contribPct < matchPct) {
      push('tax', 'critical', 'You are leaving free money on the table',
        `You contribute ${contribPct.toFixed(1)}% to your 401(k)${impliedPct !== null ? ' (payroll-implied)' : ''} but your employer matches up to ${matchPct}%. Raise your contribution to at least ${matchPct}% — the match is an instant 100% return (~$${Math.round(((matchPct - contribPct) / 100) * matchBase).toLocaleString()}/yr modeled on your base salary).`)
    } else if (matchPct > 0) {
      push('tax', 'good', 'Full employer 401(k) match captured', `You contribute ${Math.round(contribPct * 10) / 10}%${impliedPct !== null ? ' (payroll-implied)' : ''} which meets or exceeds the ${matchPct}% match threshold. Nice.`)
    }

    // SUPPRESSION: the profile-%-modeled 401(k) space rec only fires when no
    // payroll data exists — otherwise the payroll-pace rec below is the only
    // voice, so the list can never say both "room left" and "limit reached".
    if (!payrollVerified) {
      const k401Dollars = (typedPct / 100) * (facts.baseSalary?.value || income)
      const k401Limit = L.k401 + (age >= 50 ? L.k401CatchUp : 0)
      if (k401Dollars > 0 && k401Dollars < k401Limit) {
        push('tax', 'info', `Room left in your 401(k) (${L.year} limit: $${k401Limit.toLocaleString()})`,
          `Modeled from your ${typedPct}% deferral: ~$${Math.round(k401Dollars).toLocaleString()} this year, leaving ~$${Math.round(k401Limit - k401Dollars).toLocaleString()} of tax-advantaged space. Every pre-tax dollar reduces taxable income now; Roth 401(k) dollars grow tax-free instead. Upload a pay statement on the Income tab for payroll-verified tracking.`)
      } else if (k401Dollars >= k401Limit) {
        push('tax', 'good', '401(k) maxed out', `You're at the ${L.year} employee limit of $${k401Limit.toLocaleString()}.${facts.k401AfterTax ? '' : ' Consider a mega-backdoor Roth if your plan allows after-tax contributions.'}`)
      }
    }
  }

  // HSA — tri-state eligibility: blank is UNKNOWN, not "yes". Recommending
  // max-out to someone whose plan isn't HSA-eligible suggests an illegal
  // excess contribution, so unknown gets a question, not a warning.
  const hsaEligibility = facts.hsaStatus?.eligibility || 'unknown'
  if (hsaEligibility === 'self' || hsaEligibility === 'family') {
    const hsaLimit = (hsaEligibility === 'family' ? L.hsaFamily : L.hsaSelf) + (age >= 55 ? L.hsaCatchUp : 0)
    const hsaRaw = facts.hsaStatus?.contribution?.value ?? num(p.hsaContribution)
    const hsaVerified = facts.hsaStatus?.contribution?.source?.origin === 'payroll'
    // Payroll figures are YTD — compare the annualized PACE against the
    // annual limit, or an on-pace contributor gets nagged all year.
    const hsa = hsaVerified && facts.payroll
      ? Math.round(hsaRaw / Math.max(0.02, (new Date(facts.payroll.latest.payDate + 'T00:00') - new Date(`${localToday().slice(0, 4)}-01-01T00:00`) + 86400000) / (365 * 86400000)))
      : hsaRaw
    if (hsa < hsaLimit * 0.97) {
      push('tax', 'warning', 'HSA not maxed — the most tax-advantaged account that exists',
        `HSAs are triple tax-advantaged: deductible going in, tax-free growth, tax-free out for medical costs. Your ${L.year} limit is $${hsaLimit.toLocaleString()} (${hsaEligibility} coverage${age >= 55 ? ' + catch-up' : ''}); ${hsaVerified ? `payroll pace projects ~$${hsa.toLocaleString()} for the year` : `you've planned $${hsaRaw.toLocaleString()}`}. If cash flow allows, pay medical bills out of pocket and let the HSA grow invested.`)
    } else {
      push('tax', 'good', hsaVerified ? 'HSA on pace for the limit' : 'HSA maxed out', `You're ${hsaVerified ? `on pace for the ${L.year} HSA limit (payroll-verified)` : `at the ${L.year} HSA limit`}. Invest the balance rather than leaving it in cash, and save receipts — you can reimburse yourself decades later, tax-free.`)
    }
  } else if (hsaEligibility === 'contributing') {
    push('tax', 'info', 'HSA contributions detected in payroll',
      `Payroll shows $${Math.round(facts.hsaStatus.contribution?.value || 0).toLocaleString()} of HSA contributions YTD, but your profile doesn't say whether your coverage is self-only or family — set it in the Advisor profile so the limit check can run.`)
  } else if (hsaEligibility === 'unknown' && (state.insurance || []).some(pl => pl.type === 'health')) {
    push('tax', 'info', 'Is your health plan HSA-eligible?',
      'Your profile doesn\'t say. Only high-deductible plans qualify — if yours does, the HSA is the most tax-advantaged account there is; if not (most copay-based plans, like a $0-deductible plan), ignore HSA advice entirely. Set it in the Advisor profile.')
  }

  const ira = num(p.iraContribution)
  const iraLimit = L.ira + (age >= 50 ? L.iraCatchUp : 0)
  if (ira < iraLimit) {
    // The app knows household income — resolve the Roth phase-out question
    // instead of hedging with "if your income exceeds…". MAGI proxy: gross
    // minus the pre-tax deferrals we know about (trad 401k, HSA); precise
    // enough to place someone relative to a band, and the in-band message
    // hedges where precision would actually matter.
    const iraFiling = p.filingStatus || 'single'
    const [phaseStart, phaseEnd] = L.rothPhaseOut[iraFiling] || L.rothPhaseOut.single
    const tradK401 = facts.k401Deferrals?.pace ?? facts.k401Deferrals?.value ?? 0
    const hsaPretax = facts.hsaStatus?.contribution?.value ?? num(p.hsaContribution)
    const magiApprox = Math.max(0, householdIncome - tradK401 - hsaPretax)
    const filingLabel = iraFiling.toUpperCase()
    const planned = `You've planned $${ira.toLocaleString()} of $${iraLimit.toLocaleString()}.`
    const deadline = 'Deadline is tax day of the following year.'
    if (householdIncome <= 0) {
      push('tax', 'info', `IRA space available ($${iraLimit.toLocaleString()} limit for ${L.year})`,
        `${planned} If your income exceeds the Roth IRA phase-out, look into a backdoor Roth (contribute non-deductible traditional, then convert). ${deadline}`)
    } else if (magiApprox > phaseEnd) {
      push('tax', 'info', `IRA space available — use the backdoor ($${iraLimit.toLocaleString()} limit for ${L.year})`,
        `${planned} Your household income (~$${Math.round(magiApprox).toLocaleString()} after pre-tax deferrals) is above the ${L.year} Roth IRA phase-out ($${phaseEnd.toLocaleString()} ${filingLabel}), so direct Roth contributions are out — use the backdoor Roth: contribute non-deductible traditional, then convert. Watch the pro-rata rule if you hold pre-tax traditional IRA balances. ${deadline}`)
    } else if (magiApprox >= phaseStart) {
      push('tax', 'info', `IRA space available ($${iraLimit.toLocaleString()} limit for ${L.year})`,
        `${planned} Your household income (~$${Math.round(magiApprox).toLocaleString()} after pre-tax deferrals) falls inside the ${L.year} Roth phase-out ($${phaseStart.toLocaleString()}–$${phaseEnd.toLocaleString()} ${filingLabel}) — a partial direct Roth is allowed, but the backdoor Roth (non-deductible traditional, then convert) sidesteps the math entirely. ${deadline}`)
    } else {
      push('tax', 'info', `IRA space available ($${iraLimit.toLocaleString()} limit for ${L.year})`,
        `${planned} Your household income (~$${Math.round(magiApprox).toLocaleString()}) is under the ${L.year} Roth IRA phase-out (starts at $${phaseStart.toLocaleString()} ${filingLabel}), so you can contribute directly to a Roth IRA — no backdoor needed. ${deadline}`)
    }
  } else {
    push('tax', 'good', 'IRA maxed out', 'You\'re using your full IRA space this year.')
  }

  const filing = p.filingStatus || 'single'
  const sd = L.standardDeduction[filing] || L.standardDeduction.single
  push('tax', 'info', `Standard deduction for ${L.year}: $${sd.toLocaleString()} (${filing.toUpperCase()})`,
    'Itemize only if mortgage interest + state/local taxes (capped) + charitable gifts exceed this. If you\'re close to the line, "bunch" two years of charitable giving into one year (a donor-advised fund makes this easy) and take the standard deduction the other year.')

  // W-2 document review — PRIOR tax year, estimated with THAT year's
  // brackets. Demoted to info when current-year payroll data exists, so at
  // most one withholding message carries weight in the list.
  const w2 = w2Summary(state)
  if (w2 && w2.wages > 0) {
    const { tax, year: estYear } = estimateFederalTax(w2.wages, p.filingStatus, Number(w2.year))
    const diff = Math.round(w2.fedWithholding - tax)
    if (Math.abs(diff) > 1000) {
      push('tax', payrollVerified ? 'info' : diff < 0 ? 'warning' : 'info',
        diff < 0
          ? `${w2.year} tax year: your W-2${w2.count > 1 ? 's' : ''} suggest under-withholding (~$${Math.abs(diff).toLocaleString()} owed)`
          : `${w2.year} tax year: your W-2${w2.count > 1 ? 's' : ''} suggest a large refund (~$${diff.toLocaleString()})`,
        `Rough estimate from Box 1 wages ($${Math.round(w2.wages).toLocaleString()}) with the ${estYear} standard deduction and brackets: federal tax ≈ $${tax.toLocaleString()} vs. $${Math.round(w2.fedWithholding).toLocaleString()} withheld (Box 2). ${diff < 0 ? 'Owing at filing can also mean underpayment penalties — adjust your W-4 or make estimated payments.' : 'A big refund is an interest-free loan to the IRS — adjust your W-4 to keep that money in your paycheck (and invested) during the year.'} Estimate ignores credits, other income, and itemizing — verify with real filing software or a CPA.${payrollVerified ? ' Your current-year withholding is tracked from payroll below.' : ''}`)
    } else {
      push('tax', 'good', `Withholding on your ${w2.year} W-2 looks well-calibrated`,
        `Estimated federal tax ≈ $${tax.toLocaleString()} vs. $${Math.round(w2.fedWithholding).toLocaleString()} withheld — within $1,000. Nice.`)
    }
    if (w2.k401 > 0) {
      const k401Limit = L.k401 + (age >= 50 ? L.k401CatchUp : 0)
      if (w2.k401 < k401Limit * 0.9) {
        push('tax', 'info', `W-2 Box 12 shows $${Math.round(w2.k401).toLocaleString()} of 401(k) deferrals in ${w2.year}`,
          `That left ~$${Math.round(k401Limit - w2.k401).toLocaleString()} of the $${k401Limit.toLocaleString()} employee limit unused (today's limit shown). If cash flow allows, raise your deferral percentage for this year.`)
      }
    }
  }

  // Itemize vs standard — ONE shared formula (buildTaxSummary's: mortgage
  // interest on the reconciled balance + property tax + Giving transactions)
  // so this rec and the AI's verdict can never disagree near the threshold.
  const home = state.home || {}
  const mortRate = num(home.mortgageRate)
  const curYear = Number(localToday().slice(0, 4))
  const ts = buildTaxSummary(state, curYear, limitsFor(curYear))
  if (ts.itemizableEst > 0 && ts.standardDeduction > 0) {
    const itemizable = Math.round(ts.itemizableEst)
    const sdHome = ts.standardDeduction
    const parts = `mortgage interest ~$${Math.round(ts.deductions.mortgageInterestEst).toLocaleString()}${mortRate ? ` (${mortRate}%${facts.mortgageBalance ? ` on $${facts.mortgageBalance.value.toLocaleString()}` : ''})` : ''} + property tax $${Math.round(ts.deductions.propertyTax).toLocaleString()} + charitable giving $${Math.round(ts.deductions.giving).toLocaleString()}`
    if (itemizable > sdHome) {
      push('tax', 'warning', `Itemizing may beat the standard deduction (~$${itemizable.toLocaleString()} vs $${sdHome.toLocaleString()})`,
        `${parts} exceeds your standard deduction — before even counting state income tax. Check Schedule A at filing time; keep your Form 1098 in the Taxes section.`)
    } else if (itemizable > sdHome * 0.75) {
      push('tax', 'info', 'Close to the itemizing line',
        `${parts} ≈ $${itemizable.toLocaleString()} vs. a $${sdHome.toLocaleString()} standard deduction. Bunching charitable gifts into one year could push you over in alternating years.`)
    }
  }

  const hasBrokerage = state.accounts.some(a => a.type === 'brokerage')
  if (hasBrokerage) {
    push('tax', 'info', 'Tax-loss harvesting & asset location',
      'In taxable brokerage accounts: harvest losses to offset gains (+ up to $3,000/yr of ordinary income), but mind the 30-day wash-sale rule. Hold tax-inefficient assets (bonds, REITs) in retirement accounts and broad index funds in taxable. Hold winners >1 year for long-term capital-gains rates.')
  }

  if (dependents > 0) {
    push('tax', 'info', 'Dependent-related tax breaks',
      'Check eligibility for the Child Tax Credit and the Child & Dependent Care Credit. A Dependent Care FSA (up to $7,500/household for 2026) pays daycare with pre-tax dollars. A 529 plan grows tax-free for education; many states give a deduction for contributions.')
  }

  // ---------- Payroll (parsed pay statements — verified numbers beat estimates) ----------
  const payYear = localToday().slice(0, 4)
  const stubSum = paystubYearSummary(state, payYear)
  if (stubSum && payrollVerified) {
    const k401Limit = L.k401 + (age >= 50 ? L.k401CatchUp : 0)
    const employee401k = facts.k401Deferrals?.value ?? 0
    const projected = facts.k401Deferrals?.pace ?? 0
    if (employee401k >= k401Limit) {
      push('tax', 'good', `401(k) employee limit reached (payroll-verified)`,
        `Your pay statements show $${Math.round(employee401k).toLocaleString()} of employee deferrals — the ${payYear} limit is done. Anything further goes to after-tax (mega-backdoor) if your plan allows.`)
    } else if (projected < k401Limit * 0.97) {
      push('tax', 'warning', `Payroll pace leaves ~$${Math.round(k401Limit - projected).toLocaleString()} of 401(k) space unused`,
        `Through ${stubSum.latest.payDate} you've deferred $${Math.round(employee401k).toLocaleString()} (payroll-verified); at this pace you'd finish ${payYear} around $${Math.round(projected).toLocaleString()} vs the $${k401Limit.toLocaleString()} employee limit. Raising the deferral percentage now spreads the catch-up over the remaining paychecks.`)
    }
    if (stubSum.ytd.k401AfterTax > 0) {
      push('tax', 'info', `$${Math.round(stubSum.ytd.k401AfterTax).toLocaleString()} of after-tax 401(k) this year — confirm the Roth conversion is automatic`,
        `After-tax contributions only become the mega-backdoor Roth when they're converted; unconverted, their growth is taxed later. Most plans (including Amazon's) offer automatic daily in-plan Roth conversion — verify it's switched on with your plan administrator.`)
    }
    // Current-year withholding vs liability, payroll-verified — the one
    // withholding rec that fires with weight when stubs exist.
    const wh = facts.withholding
    if (wh) {
      const t = toleranceFor('withholding')
      if (Math.abs(wh.gap) > Math.max(t.abs, t.rel * wh.expectedYtd)) {
        push('tax', wh.gap < 0 ? 'warning' : 'info',
          wh.gap < 0
            ? `${payYear} withholding running ~$${Math.abs(wh.gap).toLocaleString()} behind your estimated liability`
            : `${payYear} withholding running ~$${wh.gap.toLocaleString()} ahead — a refund in the making`,
          `Payroll shows $${wh.value.toLocaleString()} of federal tax withheld YTD vs ~$${wh.expectedYtd.toLocaleString()} expected by now on your annualized taxable pace (~$${wh.taxableAnnual.toLocaleString()}, standard deduction, ${payYear} brackets). ${wh.gap < 0 ? 'RSU vests often withhold at the 22% supplemental rate while your marginal rate is higher — a common cause. Consider extra withholding on your W-4 or estimated payments to avoid penalties.' : 'Over-withholding is an interest-free loan to the IRS — adjust your W-4 if you\'d rather have it during the year.'} Rough estimate; credits and itemizing not included.`)
      }
    }
  }

  // ---------- Insurance ----------
  const lifeCoverage = coverageOf(state, 'life')
  const someoneDependsOnIncome = dependents > 0 || (p.filingStatus === 'mfj' && num(p.spouseIncome) < income * 0.5)
  // DIME: Debt + Income replacement (10x) + Mortgage + Education — all four
  // inputs reconciled, so this cites the same debt/income figures as every
  // other rec in the list.
  const dimeDebt = facts.nonMortgageDebt?.value ?? num(p.otherDebt)
  const dimeMortgage = facts.mortgageBalance?.value ?? num(p.mortgageBalance)
  const dime = income > 0 && someoneDependsOnIncome
    ? dimeDebt + income * 10 + dimeMortgage + num(p.educationNeeds)
    : 0
  if (dime > 0) {
    if (lifeCoverage < dime) {
      push('insurance', lifeCoverage === 0 ? 'critical' : 'warning',
        `Life insurance gap: ~$${Math.round((dime - lifeCoverage) / 1000) * 1000 >= 1000000 ? ((dime - lifeCoverage) / 1000000).toFixed(2) + 'M' : Math.round(dime - lifeCoverage).toLocaleString()} short of estimated need`,
        `DIME estimate (Debt $${Math.round(dimeDebt).toLocaleString()} + 10× income $${Math.round(income * 10).toLocaleString()}${incomeVerified ? ' (payroll-verified)' : ''} + mortgage $${Math.round(dimeMortgage).toLocaleString()} + education $${num(p.educationNeeds).toLocaleString()}) ≈ $${Math.round(dime).toLocaleString()} of coverage. You have $${lifeCoverage.toLocaleString()}. Level-term insurance (20–30 yr) is cheap while you're healthy; skip whole-life unless you have a specific estate need.`)
    } else if (lifeCoverage > 0) {
      push('insurance', 'good', 'Life insurance meets DIME estimate', `Coverage of $${lifeCoverage.toLocaleString()} meets the estimated need. Re-check after major life events (new child, new house).`)
    }
  }

  const hasDisability = state.insurance.some(pl => pl.type === 'disability')
  if (income > 0 && !hasDisability) {
    push('insurance', 'warning', 'No disability insurance on file',
      `Your ability to earn is likely your biggest asset — a 30-year career at your income is worth ~$${(income * 30 / 1000000).toFixed(1)}M. Long-term disability should replace ~60% of income. Check what your employer provides (often 50–60%); a supplemental "own-occupation" policy fills the gap. Note: benefits from employer-paid premiums are taxable; from premiums you pay after-tax, they're not.`)
  }

  const hasUmbrella = state.insurance.some(pl => pl.type === 'umbrella')
  if (totals.netWorth > 500000 && !hasUmbrella) {
    push('insurance', 'warning', 'Consider an umbrella policy',
      `Your net worth (~$${Math.round(totals.netWorth).toLocaleString()}) exceeds typical auto/home liability limits. A $1M umbrella policy usually costs $150–$300/yr and protects savings from lawsuits. Rule of thumb: coverage ≥ net worth, rounded up to the next $1M.`)
  }

  const hasAnyData = state.accounts.length > 0 || state.insurance.length > 0 || income > 0
  const hasHealth = state.insurance.some(pl => pl.type === 'health')
  if (hasAnyData && !hasHealth) {
    push('insurance', 'critical', 'No health insurance on file',
      'Medical bills are the leading cause of personal bankruptcy in the US. If you have coverage, add it in the Insurance tab so renewals and deductibles are tracked. If genuinely uninsured, check healthcare.gov — subsidies phase in well into middle incomes.')
  }

  const soon = new Date()
  soon.setDate(soon.getDate() + 45)
  const today = localToday()
  const soonStr = localToday(soon)
  for (const pol of state.insurance) {
    if (pol.renewalDate && pol.renewalDate >= today && pol.renewalDate <= soonStr) {
      push('insurance', 'info', `${pol.type[0].toUpperCase() + pol.type.slice(1)} policy renews ${pol.renewalDate}`,
        `"${pol.policyName || pol.provider}" renews soon. Get 2–3 competing quotes before auto-renewal — loyalty is routinely penalized in insurance pricing, and re-shopping every 1–2 years typically saves 10–25%.`)
    }
  }

  // ---------- Insurance right-sizing ----------
  // Insurance exists to transfer risks you can't absorb. Once savings can
  // absorb a risk, premium dollars stop buying protection — so the advisor
  // flags excess, not just gaps.
  const annualPremiumOf = pol => {
    const prem = num(pol.premium)
    return pol.premiumFreq === 'month' ? prem * 12 : prem
  }
  const cashMonths = monthlyExpenses > 0 ? totals.cash / monthlyExpenses : 0

  if (dime > 0 && lifeCoverage > dime * 1.5) {
    const paidLife = state.insurance.filter(pl => pl.type === 'life' && annualPremiumOf(pl) > 0)
    const paidPrem = Math.round(paidLife.reduce((s, pl) => s + annualPremiumOf(pl), 0))
    push('insurance', 'info', `Possibly over-insured on life: $${(lifeCoverage / 1000000).toFixed(2)}M vs ~$${(dime / 1000000).toFixed(2)}M estimated need`,
      `Your life coverage exceeds the DIME estimate by ~$${Math.round((lifeCoverage - dime) / 1000) * 1000 >= 1000000 ? ((lifeCoverage - dime) / 1000000).toFixed(2) + 'M' : Math.round(lifeCoverage - dime).toLocaleString()}. Coverage beyond what your family would actually need is premium spent on nothing${paidPrem > 0 ? ` — you're paying ~$${paidPrem.toLocaleString()}/yr on the policies you fund` : ''}. At the next open enrollment, consider trimming supplemental tiers first (employer basic coverage is usually free).`)
  }

  if (!someoneDependsOnIncome && lifeCoverage > 0) {
    const paidPrem = Math.round(state.insurance.filter(pl => pl.type === 'life').reduce((s, pl) => s + annualPremiumOf(pl), 0))
    if (paidPrem > 0) {
      push('insurance', 'info', 'Paying for life insurance with no one depending on your income',
        `Life insurance replaces income for people who rely on it. With no dependents on file, the ~$${paidPrem.toLocaleString()}/yr you spend on it likely does more good in savings. Keep free employer coverage; reconsider anything you pay for.`)
    }
  }

  const addCoverage = coverageOf(state, 'ad&d')
  if (addCoverage > 0 && dime > 0 && lifeCoverage < dime) {
    push('insurance', 'warning', 'AD&D is not life insurance — and your life coverage has a gap',
      `You carry $${addCoverage.toLocaleString()} of AD&D but only $${lifeCoverage.toLocaleString()} of life coverage against a ~$${(dime / 1000000).toFixed(2)}M DIME estimate. AD&D pays only for accidental death (~5–7% of deaths) — it can't close a life-insurance gap. Price level-term life for the difference; it's usually cheap at your age.`)
  } else if (addCoverage > lifeCoverage && lifeCoverage > 0) {
    push('insurance', 'info', 'More AD&D than life insurance',
      `AD&D ($${addCoverage.toLocaleString()}) pays only on accidental death, so treat it as a lottery ticket, not protection. Your real family protection is the $${lifeCoverage.toLocaleString()} of life coverage — size that to your need and treat AD&D as a bonus.`)
  }

  const nichePolicies = state.insurance.filter(pl => ['critical illness', 'accident'].includes(pl.type) && annualPremiumOf(pl) > 0)
  const nichePrem = Math.round(nichePolicies.reduce((s, pl) => s + annualPremiumOf(pl), 0))
  if (nichePrem > 0 && cashMonths >= 4) {
    const oopMaxes = state.insurance.filter(pl => pl.type === 'health' && num(pl.oopMax) > 0).map(pl => num(pl.oopMax))
    const oopNote = oopMaxes.length ? ` and your health plan already caps a bad year at $${Math.min(...oopMaxes).toLocaleString()} out-of-pocket` : ''
    push('insurance', 'info', `$${nichePrem.toLocaleString()}/yr on critical-illness/accident policies you can likely self-insure`,
      `These products pay out a low share of premiums (state filings typically show ~50% or less, vs ~85%+ for major medical). With ${cashMonths.toFixed(1)} months of expenses in cash${oopNote}, your emergency fund already absorbs these risks. Worth dropping at the next open enrollment unless you have a specific known exposure.`)
  }

  for (const pol of state.insurance) {
    if (pol.type === 'auto' && num(pol.deductible) > 0 && num(pol.deductible) <= 500 && cashMonths >= 3) {
      push('insurance', 'info', `Low auto deductible ($${num(pol.deductible).toLocaleString()}) — you're paying to insure money you have`,
        `With ${cashMonths.toFixed(1)} months of cash on hand, a $500 fender-bender isn't a financial emergency. Raising the deductible to $1,000–$2,500 typically cuts the premium 10–20%; ask for a quote at renewal. Same logic applies to home/renters deductibles.`)
      break
    }
  }

  const homeValue = num((state.home || {}).currentValue)
  const homePolicies = state.insurance.filter(pl => pl.type === 'home' && num(pl.coverageAmount) > 0)
  if (homeValue > 0 && homePolicies.length > 0) {
    const homeCov = homePolicies.reduce((s, pl) => s + num(pl.coverageAmount), 0)
    if (homeCov < homeValue * 0.5) {
      push('insurance', 'warning', `Home dwelling coverage ($${homeCov.toLocaleString()}) looks low vs your home's value ($${homeValue.toLocaleString()})`,
        `Dwelling coverage should track rebuild cost, not market value (land isn't rebuilt) — but a gap this large is worth a call to your insurer. Underinsured homes can trigger coinsurance penalties on partial claims. Ask for a replacement-cost estimate and inflation-guard endorsement.`)
    } else if (homeCov > homeValue * 1.5) {
      push('insurance', 'info', 'Home coverage well above the home\'s value',
        `Dwelling coverage of $${homeCov.toLocaleString()} vs a $${homeValue.toLocaleString()} home — unless rebuild costs in your area genuinely run that high, you may be paying for coverage you can't use. Insurers only pay to rebuild; ask for a replacement-cost estimate at renewal.`)
    }
  }

  const spouseIncome = num(p.spouseIncome)
  if (p.filingStatus === 'mfj' && spouseIncome > 0 && dependents > 0) {
    const spouseLifeCov = state.insurance
      .filter(pl => pl.type === 'life' && /spouse|partner/i.test(pl.policyName || ''))
      .reduce((s, pl) => s + num(pl.coverageAmount), 0)
    const spouseNeed = spouseIncome * 5
    if (spouseLifeCov < spouseNeed) {
      push('insurance', 'info', 'Your spouse\'s life coverage looks thin',
        `Employer spouse plans are usually ½–1× salary — against ~$${spouseIncome.toLocaleString()} of income your family also relies on, 5–10× is the usual guide (~$${spouseNeed.toLocaleString()}+). A level-term policy on a healthy adult is often $20–$50/mo. If your spouse mainly provides childcare, insure that too: replacing it costs real money.`)
    }
  }

  // Premiums prefer the live payroll deduction over the imported snapshot.
  const premiumOf = pl => policyPremiumAnnual(state, pl)?.value ?? annualPremiumOf(pl)
  const totalAnnualPremiums = Math.round(state.insurance.reduce((s, pl) => s + premiumOf(pl), 0))
  if (householdIncome > 0 && totalAnnualPremiums > householdIncome * 0.08) {
    const top = [...state.insurance].sort((a, b) => premiumOf(b) - premiumOf(a)).slice(0, 3)
      .map(pl => `${pl.policyName || pl.provider || pl.type} ($${Math.round(premiumOf(pl)).toLocaleString()}/yr)`).join(', ')
    push('insurance', 'info', `Insurance eats ${Math.round((totalAnnualPremiums / householdIncome) * 100)}% of household income ($${totalAnnualPremiums.toLocaleString()}/yr)`,
      `Above ~8% is worth a deliberate review. Biggest lines: ${top}. Re-shop the shoppable ones (auto/home routinely price loyalty penalties), raise deductibles where cash reserves allow, and drop low-payout add-ons.`)
  }

  // Health-plan out-of-pocket accumulator — timing care around the OOP max
  // is one of the few levers a family has on medical costs.
  for (const pol of state.insurance) {
    if (pol.type !== 'health') continue
    const oop = oopStatus(state, pol)
    if (!oop) continue
    const [py, pm, pd2] = oop.planYearStart.split('-').map(Number)
    const resetDate = `${py + 1}-${String(pm).padStart(2, '0')}-${String(pd2).padStart(2, '0')}`
    if (oop.metOopMax) {
      push('insurance', 'info', 'Out-of-pocket max reached — covered care is 100% paid until the plan year resets',
        `You've hit the $${oop.oopMax.toLocaleString()} in-network out-of-pocket max on "${pol.policyName || pol.provider}". Every in-network covered service is free until ${resetDate}. If anyone in the family has been putting off a procedure, imaging, PT, or a specialist visit, schedule it before the reset.`)
    } else if (oop.pct >= 0.75) {
      push('insurance', 'info', `${Math.round(oop.pct * 100)}% of the way to your out-of-pocket max`,
        `$${Math.round(oop.spent).toLocaleString()} of the $${oop.oopMax.toLocaleString()} in-network max on "${pol.policyName || pol.provider}" — $${Math.round(oop.remaining).toLocaleString()} to go before the ${resetDate} reset. If more care is coming this plan year, once you cross the max the rest is fully covered — worth weighing when scheduling elective care.`)
    }
    if (oop.staleManual) {
      push('insurance', 'info', 'Your out-of-pocket portal figure looks stale',
        `Health-category spending this plan year ($${Math.round(oop.auto).toLocaleString()}) has pulled well ahead of the figure you recorded from the insurer's portal ($${Math.round(oop.spent).toLocaleString()}${oop.manualAsOf ? ` on ${oop.manualAsOf}` : ''}). Claims may have processed since — check the portal and update the policy so the "care is free after the max" alert can't miss.`)
    }
  }

  // ---------- Planning ----------
  if (monthlyExpenses > 0) {
    const months = totals.cash / monthlyExpenses
    if (months < 3) {
      push('planning', 'critical', `Emergency fund covers only ${months.toFixed(1)} months`,
        `You hold $${Math.round(totals.cash).toLocaleString()} in cash against $${Math.round(monthlyExpenses).toLocaleString()}/mo of expenses. Build to 3–6 months ($${(monthlyExpenses * 3).toLocaleString()}–$${(monthlyExpenses * 6).toLocaleString()}) in a high-yield savings account before investing beyond the employer match.`)
    } else if (months <= 8) {
      push('planning', 'good', `Emergency fund: ${months.toFixed(1)} months of expenses`, 'Solid. Keep it in a high-yield savings account or T-bills/money-market fund so it at least keeps pace with inflation.')
    } else {
      push('planning', 'info', `${months.toFixed(1)} months of cash — possibly too much`,
        'Beyond ~6–12 months of expenses, cash loses to inflation. Consider moving the excess into investments aligned with your goals.')
    }
  }

  // Budget overruns — current month (per-month overrides respected)
  const thisMonth = localMonth()
  const monthOverrides = (state.budgetMonths || {})[thisMonth] || {}
  const budgets = { ...(state.budgets || {}) }
  for (const [c, v] of Object.entries(monthOverrides)) {
    if (parseFloat(v) > 0) budgets[c] = parseFloat(v)
    else delete budgets[c]
  }
  if (Object.keys(budgets).length > 0) {
    const spent = {}
    for (const t of state.transactions) {
      if (!t.date?.startsWith(thisMonth)) continue
      for (const p of txParts(t)) {
        if (p.amount >= 0) continue
        spent[p.category] = (spent[p.category] || 0) + -p.amount
      }
    }
    const over = Object.entries(budgets)
      .map(([cat, b]) => [cat, (spent[cat] || 0) - b])
      .filter(([, d]) => d > 0)
      .sort((a, b) => b[1] - a[1])
    if (over.length > 0) {
      push('planning', 'warning', `Over budget in ${over.length} categor${over.length === 1 ? 'y' : 'ies'} this month`,
        over.slice(0, 3).map(([cat, d]) => `${cat} is $${Math.round(d).toLocaleString()} over`).join(' · ') +
        `${over.length > 3 ? ` · +${over.length - 3} more` : ''}. See the Budget tab for the full picture.`)
    }
  }

  // Utility-bill creep
  const bills = state.homeBills || []
  if (bills.length >= 4) {
    const byMonth = {}
    for (const b of bills) byMonth[b.month] = (byMonth[b.month] || 0) + num(b.amount)
    const monthsSorted = Object.keys(byMonth).sort()
    const latest = monthsSorted[monthsSorted.length - 1]
    const prior = monthsSorted.slice(-4, -1)
    if (prior.length >= 2) {
      const avg = prior.reduce((s, m) => s + byMonth[m], 0) / prior.length
      if (byMonth[latest] > avg * 1.25) {
        push('planning', 'info', `Home bills for ${latest} are ${Math.round(((byMonth[latest] - avg) / avg) * 100)}% above your recent average`,
          `$${Math.round(byMonth[latest]).toLocaleString()} vs. a ~$${Math.round(avg).toLocaleString()} average over the prior ${prior.length} months. Worth a look — rate hikes, seasonal usage, or a billing error.`)
      }
    }
  }

  const ccDebt = state.accounts.filter(a => a.type === 'credit card').reduce((s, a) => s + Math.abs(num(a.balance)), 0)
  if (ccDebt > 0) {
    push('planning', 'critical', `Credit card balances: $${Math.round(ccDebt).toLocaleString()}`,
      'At ~22%+ APR, paying this off beats any investment return you can reliably get. Attack it before investing beyond the employer match (avalanche: highest APR first).')
  }

  if (recs.filter(r => r.severity !== 'good').length === 0 && recs.length > 0) {
    push('planning', 'good', 'Strong financial position', 'No major gaps detected by the rules engine. Revisit after any major life event.')
  }
  if (income === 0 && state.accounts.length === 0) {
    push('planning', 'info', 'Add your data to get personalized guidance',
      'Fill in your Profile (in this tab), add accounts, and log insurance policies — the recommendations here update automatically as your data changes.')
  }

  const order = { critical: 0, warning: 1, info: 2, good: 3 }
  recs.sort((a, b) => order[a.severity] - order[b.severity])
  return recs
}
