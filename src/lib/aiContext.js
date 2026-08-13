// Builds the compact financial snapshot the AI advisor receives as context.
// Everything the app knows, distilled to a few KB of JSON: totals, budget
// month, bills, insurance, goals, retirement outlook, home. No transaction
// descriptions beyond top merchants, no document contents, no identifiers —
// this is the ONLY data that ever leaves the device, and only when the user
// asks the AI a question.

import { computeTotals, getRecommendations, estimateFederalTax, TAX_BRACKETS_2026, LIMITS_2026 } from './advisor.js'
import { resolveFacts } from './facts.js'
import { marginalRate } from './taxTables.js'
import { buildTaxSummary } from './report.js'
import { effectiveBudgets, monthActivity, computeSafeToSpend } from './budget.js'
import { monthStats } from './report.js'
import { detectRecurring, benchmarkBill } from './savings.js'
import { retirementParams, deterministicProjection, monteCarloRetirement } from './retirement.js'
import { localMonth } from './dates.js'
import { oopStatus } from './health.js'
import { paystubYearSummary } from './income.js'
import { amortizationSchedule, horizonOutlook, extraPaymentScenarios } from './mortgage.js'
import { prepayVsInvestSummary } from './prepay.js'
import { goalPace } from './goals.js'
import { policyCoverage, enrollmentEvidence } from './facts.js'
import { projectFI } from './projection.js'
import { rsuSummary } from './rsu.js'

const r0 = n => Math.round(Number(n) || 0)

export function buildFinancialContext(state) {
  const totals = computeTotals(state)
  const month = localMonth()
  const { income, spentByCat } = monthActivity(state, month)
  const sts = computeSafeToSpend(state, month)
  const [yy, mm] = month.split('-').map(Number)
  const pd = new Date(yy, mm - 2, 1)
  const prev = monthStats(state.transactions, `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`)

  const recurring = detectRecurring(state.transactions)
  const ignored = new Set((state.billPrefs || []).filter(p => p.status === 'ignored').map(p => p.merchant))
  const bills = recurring
    .filter(b => !ignored.has(b.merchant))
    .slice(0, 20)
    .map(b => {
      const bm = benchmarkBill(b)
      return {
        name: b.merchant.toLowerCase(), cadence: b.cadence, monthly: r0(b.monthlyCost),
        ...(bm ? { typicalMarketRange: `$${bm.low}-$${bm.high}/mo (rough national)`, aboveTypical: bm.over } : {}),
      }
    })

  const ctx = {
    today: new Date().toDateString(),
    profile: {
      age: state.profile?.age || null,
      filingStatus: state.profile?.filingStatus,
      grossIncome: r0(state.profile?.grossIncome),
      spouseIncome: r0(state.profile?.spouseIncome),
      dependents: state.profile?.dependents,
      monthlyExpenses: r0(state.profile?.monthlyExpenses),
      k401Pct: state.profile?.k401ContributionPct,
      employerMatchPct: state.profile?.employerMatchPct,
      hsa: state.profile?.hsaEligible,
    },
    netWorth: {
      total: r0(totals.netWorth),
      cash: r0(totals.cash),
      investments: r0(totals.investments),
      investmentsTaxable: r0(totals.taxableInvest),
      investmentsRetirement: r0(totals.retirementInvest),
      homeEquity: r0(totals.homeEquity),
      debt: r0(totals.debt),
      ...(totals.excluded !== 0 ? { excludedUnvested: r0(totals.excluded) } : {}),
      history90d: (state.history || []).slice(-45).filter((_, i) => i % 5 === 0).map(h => [h.date, r0(h.netWorth)]),
    },
    accounts: (state.accounts || []).map(a => ({
      name: `${a.institution} ${a.name}`, type: a.type, balance: r0(a.balance),
      ...(a.bucket ? { countsAs: a.bucket } : {}),
      ...(a.excludeFromNetWorth ? { excludedFromNetWorth: true } : {}),
    })),
    budgetThisMonth: {
      month,
      incomeSoFar: r0(income),
      incomeBasis: r0(sts.income.value),
      safeToSpend: r0(sts.safe),
      budgets: Object.fromEntries(Object.entries(effectiveBudgets(state, month)).map(([c, v]) => [c, r0(v)])),
      spentByCategory: Object.fromEntries(
        Object.entries(spentByCat).filter(([, v]) => v > 0.5).map(([c, v]) => [c, r0(v)]),
      ),
      rolloverEnabled: Boolean(state.budgetConfig?.rollover),
      setAsidesMonthly: r0(sts.sinking),
    },
    lastMonth: { income: r0(prev.income), spend: r0(prev.spend) },
    recurringBills: bills,
    workBenefits: (state.benefits || []).map(b => ({
      name: b.name, type: b.type, annualValue: r0(b.annualValue), enrolled: b.enrolled !== 'no',
    })),
    payroll: (() => {
      const s = paystubYearSummary(state, localMonth().slice(0, 4))
      if (!s) return undefined
      return {
        source: s.latest.balanced
          ? 'parsed pay statements (verified — reconciles to the penny)'
          : 'parsed pay statements (UNVERIFIED — statement did not fully reconcile, treat as approximate)',
        employer: s.employer,
        latest: { payDate: s.latest.payDate, gross: r0(s.latest.gross), net: r0(s.latest.net), fedTaxablePerPeriod: r0(s.latest.fedTaxable) },
        ytd: {
          gross: r0(s.ytd.gross), federalTax: r0(s.ytd.federalTax), allTaxes: r0(s.ytd.allTaxes),
          k401Trad: r0(s.ytd.k401Trad), k401Roth: r0(s.ytd.k401Roth), k401AfterTax: r0(s.ytd.k401AfterTax),
          hsa: r0(s.ytd.hsa), rsuVested: r0(s.ytd.rsuVested),
          pretaxBenefits: r0(s.ytd.pretaxBenefits),
        },
      }
    })(),
    rsu: (() => {
      const s = rsuSummary(state)
      if (!s.totalUnvestedValue) return undefined
      return {
        note: 'Unvested RSUs — future income, deliberately EXCLUDED from net worth. Vests remaining this year are already inside the reconciled gross-income estimate.',
        ...(state.rsu?.symbol ? { symbol: state.rsu.symbol } : {}),
        assumedPricePerShare: Number(state.rsu?.price) || null,
        totalUnvestedValue: r0(s.totalUnvestedValue),
        totalUnvestedUnits: Math.round(s.totalUnvestedUnits),
        remainingThisYearValue: r0(s.remainingThisYear),
        nextVest: s.nextVest ? { date: s.nextVest.date, value: r0(s.nextVest.value) } : null,
        byYear: s.byYear.map(y => ({ year: y.year, value: r0(y.value) })),
      }
    })(),
    insurance: (state.insurance || []).map(p => {
      const cov = policyCoverage(state, p)
      const enrolled = enrollmentEvidence(state, p)
      const base = {
        type: p.type, provider: p.provider,
        coverage: cov ? r0(cov.value) : 0,
        ...(cov?.estimated ? { coverageBasis: cov.basis } : {}),
        ...(enrolled ? { enrolled: enrolled === 'payroll' ? 'verified in payroll' : 'employer-paid per benefits statement' } : {}),
        premium: r0(p.premium), per: p.premiumFreq, renews: p.renewalDate || null,
      }
      if (p.type === 'health') {
        const oop = oopStatus(state, p)
        if (oop) {
          base.healthPlan = {
            inNetworkDeductible: r0(p.deductible),
            oopMax: r0(oop.oopMax),
            oopMaxPerPerson: r0(p.oopMaxIndividual) || undefined,
            oopSpentThisPlanYear: r0(oop.spent),
            oopSource: oop.manual ? 'insurer portal' : 'estimated from Health spending',
            planYearStart: oop.planYearStart,
            oonDeductible: r0(p.oonDeductible) || undefined,
            oonOopMax: r0(p.oonOopMax) || undefined,
          }
        }
      }
      return base
    }),
    goals: (state.goals || []).map(g => {
      const p = goalPace(state, g)
      return {
        name: g.name, target: r0(g.target), targetDate: g.targetDate || null,
        saved: r0(p.saved),
        depositPaceMonthly: r0(p.pace),
        neededMonthly: p.neededMonthly !== null ? r0(p.neededMonthly) : undefined,
        assumedAnnualReturnPct: p.returnPct,
        status: p.status,
      }
    }),
    home: (() => {
      const h = state.home || {}
      // Mortgage figures alone are enough for payoff context — don't require
      // a home-value estimate.
      if (!h.currentValue && !h.mortgageBalance) return null
      const base = {
        value: r0(h.currentValue),
        mortgageBalance: r0(h.mortgageBalance),
        rate: h.mortgageRate,
        monthlyPI: r0(h.monthlyPayment),
        propertyTaxAnnual: r0(h.propertyTaxAnnual),
      }
      const s = amortizationSchedule(h.mortgageBalance, h.mortgageRate, h.monthlyPayment)
      if (s.feasible) {
        const o = out => out && {
          interestPaid: r0(out.interestPaid), principalPaid: r0(out.principalPaid),
          endingBalance: r0(out.endingBalance), paidOff: out.paidOff,
        }
        base.payoff = {
          payoffDate: s.payoffDate,
          monthsRemaining: s.months,
          interestRemaining: r0(s.totalInterest),
          totalRemainingCost: r0(s.totalPaid),
          thisMonthSplit: { interest: r0(s.rows[0].interest), principal: r0(s.rows[0].principal) },
          principalInterestCrossover: s.crossoverDate,
          outlook5y: o(horizonOutlook(s.rows, 60)),
          outlook10y: o(horizonOutlook(s.rows, 120)),
          extraPaymentScenarios: extraPaymentScenarios(h.mortgageBalance, h.mortgageRate, h.monthlyPayment)
            .scenarios.map(x => ({ extra: x.extra, interestSaved: r0(x.interestSaved), monthsSaved: x.monthsSaved, payoffDate: x.payoffDate })),
        }
      }
      return base
    })(),
    appAlerts: getRecommendations(state)
      .filter(rec => rec.severity === 'critical' || rec.severity === 'warning')
      .slice(0, 8)
      .map(rec => rec.title),
  }

  // Retirement outlook (only when the profile supports it) — keep trials low;
  // this runs per question, not per keystroke.
  const params = retirementParams(state, totals.investments)
  if (params.ready) {
    const mc = monteCarloRetirement(params, { trials: 300 })
    const det = deterministicProjection(params)
    ctx.retirement = {
      retireAge: params.retireAge,
      planToAge: params.lifeExpectancy,
      spendMonthly: r0(params.spendingMonthly),
      ssMonthlyAt67: r0(params.ssMonthlyAt67),
      ssClaimAge: params.ssClaimAge,
      annualSavings: r0(params.annualContrib),
      chanceOfSuccess: Math.round(mc.successRate * 100),
      medianAtRetirement: r0(mc.band.find(b => b.age === params.retireAge)?.p50 ?? 0),
      fundsLastUntil: det.depletedAt || `${params.lifeExpectancy}+`,
    }
  }
  const fi = projectFI(state, totals.investments)
  if (fi.ready && fi.fiAge) ctx.financialIndependence = { fiNumber: r0(fi.fiNumber), projectedAge: fi.fiAge }

  // Tax picture — reconciled: payroll-verified income and deferrals when pay
  // statements exist, profile estimates otherwise, each labeled with its
  // source so the model never averages disagreeing numbers.
  const { facts, conflicts } = resolveFacts(state)
  const myIncome = facts.grossIncome?.value || r0(state.profile?.grossIncome)
  const gross = r0(myIncome) + r0(state.profile?.spouseIncome)
  if (gross > 0) {
    const filing = state.profile?.filingStatus || 'single'
    // Marginal rate on the reconciled taxable pace when payroll exists — but
    // payroll only covers ONE earner; with spouse income in the household,
    // estimate on household gross so the bracket isn't understated.
    const spouse = r0(state.profile?.spouseIncome)
    const usePayrollTax = facts.withholding && spouse === 0
    const taxableBase = usePayrollTax ? facts.withholding.taxableAnnual : estimateFederalTax(gross, filing).taxable
    const estTax = usePayrollTax ? facts.withholding.estAnnualTax : estimateFederalTax(gross, filing).tax
    const marginal = marginalRate(taxableBase, filing, LIMITS_2026.year)

    const ts = buildTaxSummary(state, new Date().getFullYear(), LIMITS_2026)
    const payrollK401 = facts.k401Deferrals?.source?.origin === 'payroll'
    const hsaElig = facts.hsaStatus?.eligibility
    const hsaLimit =
      hsaElig === 'family' ? LIMITS_2026.hsaFamily
      : hsaElig === 'self' ? LIMITS_2026.hsaSelf
      : hsaElig === 'no' ? 0 : null // null = unknown eligibility, don't assume

    ctx.tax = {
      year: LIMITS_2026.year,
      state: state.profile?.state || null,
      filingStatus: filing,
      dependents: state.profile?.dependents || '0',
      householdGrossIncome: gross,
      incomeSource: facts.grossIncome?.source?.label || 'your estimate',
      estFederalTax: r0(estTax),
      marginalFedRatePct: Math.round(marginal * 100),
      contributions: {
        // Payroll-verified YTD + pace replaces the modeled "planned" figure
        // when statements exist (the raw profile % stays in ctx.profile).
        ...(payrollK401
          ? { k401Ytd: r0(facts.k401Deferrals.value), k401PaceAnnual: r0(facts.k401Deferrals.pace), k401Source: 'payroll-verified' }
          : { k401Planned: r0(Math.min((facts.k401Deferrals?.value || 0), LIMITS_2026.k401)), k401Source: 'modeled from profile %' }),
        k401Limit: LIMITS_2026.k401,
        k401AfterTaxYtd: facts.k401AfterTax ? r0(facts.k401AfterTax.value) : undefined,
        hsaPlanned: r0(facts.hsaStatus?.contribution?.value ?? state.profile?.hsaContribution),
        hsaEligibility: hsaElig,
        hsaLimit,
        iraPlanned: r0(state.profile?.iraContribution),
        iraLimit: LIMITS_2026.ira,
      },
      deductibleSpendingSeenThisYear: {
        charitableGiving: r0(ts.deductions.giving),
        medical: r0(ts.deductions.medical),
        propertyTax: r0(ts.deductions.propertyTax),
        mortgageInterestEst: r0(ts.deductions.mortgageInterestEst),
      },
      itemizableEst: r0(ts.itemizableEst),
      standardDeduction: r0(ts.standardDeduction),
      itemizeLikely: ts.itemizeLikely,
    }
  }

  // Prepay-vs-invest: guaranteed after-tax return on extra principal vs a
  // taxable investment. Attached after the tax block because the after-tax
  // rate depends on itemization; without tax data the full note rate stands
  // (standard-deduction fallback) and the basis string says so.
  if (ctx.home?.payoff) {
    ctx.home.prepayVsInvest = prepayVsInvestSummary({
      ratePct: state.home.mortgageRate,
      marginalFedPct: ctx.tax?.marginalFedRatePct || 0,
      itemizeLikely: Boolean(ctx.tax?.itemizeLikely),
      itemizableEst: ctx.tax?.itemizableEst || 0,
      standardDeduction: ctx.tax?.standardDeduction || 0,
      annualMortgageInterest: ctx.tax?.deductibleSpendingSeenThisYear?.mortgageInterestEst || 0,
    })
  }

  // Cross-section disagreements the app has detected — surface, never average.
  if (conflicts.length > 0) {
    ctx.dataConflicts = conflicts.slice(0, 6).map(c => c.message)
  }

  return ctx
}

export function contextDisclosure(ctx) {
  return `${Object.keys(ctx.accounts || {}).length} account balances, this month's budget, ` +
    'recurring bills, insurance, goals, mortgage payoff outlook, and retirement outlook'
}
