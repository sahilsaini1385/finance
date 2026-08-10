// Builds the compact financial snapshot the AI advisor receives as context.
// Everything the app knows, distilled to a few KB of JSON: totals, budget
// month, bills, insurance, goals, retirement outlook, home. No transaction
// descriptions beyond top merchants, no document contents, no identifiers —
// this is the ONLY data that ever leaves the device, and only when the user
// asks the AI a question.

import { computeTotals, getRecommendations } from './advisor.js'
import { effectiveBudgets, monthActivity, computeSafeToSpend } from './budget.js'
import { monthStats } from './report.js'
import { detectRecurring } from './savings.js'
import { retirementParams, deterministicProjection, monteCarloRetirement } from './retirement.js'
import { localMonth } from './dates.js'
import { projectFI } from './projection.js'

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
    .map(b => ({ name: b.merchant.toLowerCase(), cadence: b.cadence, monthly: r0(b.monthlyCost) }))

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
      debt: r0(totals.debt),
      history90d: (state.history || []).slice(-45).filter((_, i) => i % 5 === 0).map(h => [h.date, r0(h.netWorth)]),
    },
    accounts: (state.accounts || []).map(a => ({ name: `${a.institution} ${a.name}`, type: a.type, balance: r0(a.balance) })),
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
    insurance: (state.insurance || []).map(p => ({
      type: p.type, provider: p.provider, coverage: r0(p.coverageAmount),
      premium: r0(p.premium), per: p.premiumFreq, renews: p.renewalDate || null,
    })),
    goals: (state.goals || []).map(g => ({
      name: g.name, target: r0(g.target), targetDate: g.targetDate || null,
      saved: r0((state.accounts || []).filter(a => (g.accountIds || []).includes(a.id))
        .reduce((s, a) => s + (parseFloat(a.balance) || 0), 0)),
    })),
    home: state.home?.currentValue ? {
      value: r0(state.home.currentValue),
      mortgageBalance: r0(state.home.mortgageBalance),
      rate: state.home.mortgageRate,
      monthlyPI: r0(state.home.monthlyPayment),
      propertyTaxAnnual: r0(state.home.propertyTaxAnnual),
    } : null,
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

  return ctx
}

export function contextDisclosure(ctx) {
  return `${Object.keys(ctx.accounts || {}).length} account balances, this month's budget, ` +
    'recurring bills, insurance, goals, and retirement outlook'
}
