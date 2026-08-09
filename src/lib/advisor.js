// Rules-based guidance engine. Educational only — not tax, legal, or investment advice.
// Limits below are the announced 2026 IRS figures; update annually and verify at irs.gov.

import { localToday, localMonth } from './dates.js'

export const LIMITS_2026 = {
  year: 2026,
  k401: 24500,
  k401CatchUp: 8000, // age 50+
  ira: 7500,
  iraCatchUp: 1100, // age 50+
  hsaSelf: 4400,
  hsaFamily: 8750,
  hsaCatchUp: 1000, // age 55+
  fsaHealth: 3400,
  standardDeduction: { single: 16100, mfj: 32200, hoh: 24150 },
}

// 2026 marginal brackets on TAXABLE income (rough-estimate use only).
export const TAX_BRACKETS_2026 = {
  single: [[0, 0.10], [12400, 0.12], [50400, 0.22], [105700, 0.24], [201775, 0.32], [256225, 0.35], [640600, 0.37]],
  mfj: [[0, 0.10], [24800, 0.12], [100800, 0.22], [211400, 0.24], [403550, 0.32], [512450, 0.35], [768700, 0.37]],
  hoh: [[0, 0.10], [17700, 0.12], [67450, 0.22], [105700, 0.24], [201750, 0.32], [256200, 0.35], [640600, 0.37]],
}

export function estimateFederalTax(grossWages, filingStatus) {
  const L = LIMITS_2026
  const sd = L.standardDeduction[filingStatus] || L.standardDeduction.single
  const taxable = Math.max(0, grossWages - sd)
  const brackets = TAX_BRACKETS_2026[filingStatus] || TAX_BRACKETS_2026.single
  let tax = 0
  for (let i = 0; i < brackets.length; i++) {
    const [floor, rate] = brackets[i]
    const ceil = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity
    if (taxable <= floor) break
    tax += (Math.min(taxable, ceil) - floor) * rate
  }
  return { taxable, tax: Math.round(tax) }
}

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

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/[$,%\s,]/g, ''))
  return Number.isNaN(n) ? 0 : n
}

export function computeTotals(state) {
  const cashTypes = ['checking', 'savings']
  const investTypes = ['brokerage', 'retirement', 'hsa', '529']
  const debtTypes = ['credit card', 'loan', 'mortgage']
  let cash = 0, investments = 0, debt = 0, other = 0
  for (const a of state.accounts) {
    const b = num(a.balance)
    if (cashTypes.includes(a.type)) cash += b
    else if (investTypes.includes(a.type)) investments += b
    else if (debtTypes.includes(a.type)) debt += Math.abs(b)
    else other += b
  }
  return { cash, investments, debt, other, netWorth: cash + investments + other - debt }
}

function coverageOf(state, kind) {
  return state.insurance
    .filter(p => p.type === kind)
    .reduce((s, p) => s + num(p.coverageAmount), 0)
}

// Returns [{id, area: 'tax'|'insurance'|'planning', severity: 'good'|'info'|'warning'|'critical', title, detail}]
export function getRecommendations(state) {
  const recs = []
  const p = state.profile
  const L = LIMITS_2026
  const totals = computeTotals(state)
  const age = num(p.age)
  const income = num(p.grossIncome)
  const householdIncome = income + num(p.spouseIncome)
  const monthlyExpenses = num(p.monthlyExpenses)
  const dependents = num(p.dependents)
  const push = (area, severity, title, detail) => recs.push({ id: `${area}-${recs.length}`, area, severity, title, detail })

  // ---------- Tax ----------
  if (income > 0) {
    const matchPct = num(p.employerMatchPct)
    const contribPct = num(p.k401ContributionPct)
    if (matchPct > 0 && contribPct < matchPct) {
      push('tax', 'critical', 'You are leaving free money on the table',
        `You contribute ${contribPct}% to your 401(k) but your employer matches up to ${matchPct}%. Raise your contribution to at least ${matchPct}% — the match is an instant 100% return (~$${Math.round(((matchPct - contribPct) / 100) * income).toLocaleString()}/yr you're currently forfeiting).`)
    } else if (matchPct > 0) {
      push('tax', 'good', 'Full employer 401(k) match captured', `You contribute ${contribPct}% which meets or exceeds the ${matchPct}% match threshold. Nice.`)
    }

    const k401Dollars = (contribPct / 100) * income
    const k401Limit = L.k401 + (age >= 50 ? L.k401CatchUp : 0)
    if (k401Dollars > 0 && k401Dollars < k401Limit) {
      push('tax', 'info', `Room left in your 401(k) (${L.year} limit: $${k401Limit.toLocaleString()})`,
        `You're on track to contribute ~$${Math.round(k401Dollars).toLocaleString()} this year, leaving ~$${Math.round(k401Limit - k401Dollars).toLocaleString()} of tax-advantaged space. Every pre-tax dollar reduces taxable income now; Roth 401(k) dollars grow tax-free instead.${age >= 50 ? ' Includes your age-50+ catch-up allowance.' : ''}`)
    } else if (k401Dollars >= k401Limit) {
      push('tax', 'good', '401(k) maxed out', `You're at the ${L.year} employee limit of $${k401Limit.toLocaleString()}. Consider a mega-backdoor Roth if your plan allows after-tax contributions.`)
    }
  }

  if (p.hsaEligible !== 'no') {
    const hsaLimit = (p.hsaEligible === 'family' ? L.hsaFamily : L.hsaSelf) + (age >= 55 ? L.hsaCatchUp : 0)
    const hsa = num(p.hsaContribution)
    if (hsa < hsaLimit) {
      push('tax', 'warning', 'HSA not maxed — the most tax-advantaged account that exists',
        `HSAs are triple tax-advantaged: deductible going in, tax-free growth, tax-free out for medical costs. Your ${L.year} limit is $${hsaLimit.toLocaleString()} (${p.hsaEligible} coverage${age >= 55 ? ' + catch-up' : ''}); you've planned $${hsa.toLocaleString()}. If cash flow allows, pay medical bills out of pocket and let the HSA grow invested.`)
    } else {
      push('tax', 'good', 'HSA maxed out', `You're at the ${L.year} HSA limit. Invest the balance rather than leaving it in cash, and save receipts — you can reimburse yourself decades later, tax-free.`)
    }
  }

  const ira = num(p.iraContribution)
  const iraLimit = L.ira + (age >= 50 ? L.iraCatchUp : 0)
  if (ira < iraLimit) {
    push('tax', 'info', `IRA space available ($${iraLimit.toLocaleString()} limit for ${L.year})`,
      `You've planned $${ira.toLocaleString()} of $${iraLimit.toLocaleString()}. If your income exceeds the Roth IRA phase-out, look into a backdoor Roth (contribute non-deductible traditional, then convert). Deadline is tax day of the following year.`)
  } else {
    push('tax', 'good', 'IRA maxed out', 'You\'re using your full IRA space this year.')
  }

  const sd = L.standardDeduction[p.filingStatus] || L.standardDeduction.single
  push('tax', 'info', `Standard deduction for ${L.year}: $${sd.toLocaleString()} (${p.filingStatus.toUpperCase()})`,
    'Itemize only if mortgage interest + state/local taxes (capped) + charitable gifts exceed this. If you\'re close to the line, "bunch" two years of charitable giving into one year (a donor-advised fund makes this easy) and take the standard deduction the other year.')

  // W-2 document review
  const w2 = w2Summary(state)
  if (w2 && w2.wages > 0) {
    const { tax } = estimateFederalTax(w2.wages, p.filingStatus)
    const diff = Math.round(w2.fedWithholding - tax)
    if (Math.abs(diff) > 1000) {
      push('tax', diff < 0 ? 'warning' : 'info',
        diff < 0
          ? `Your ${w2.year} W-2${w2.count > 1 ? 's' : ''} suggest under-withholding (~$${Math.abs(diff).toLocaleString()} owed)`
          : `Your ${w2.year} W-2${w2.count > 1 ? 's' : ''} suggest a large refund (~$${diff.toLocaleString()})`,
        `Rough estimate from Box 1 wages ($${Math.round(w2.wages).toLocaleString()}) with the standard deduction: federal tax ≈ $${tax.toLocaleString()} vs. $${Math.round(w2.fedWithholding).toLocaleString()} withheld (Box 2). ${diff < 0 ? 'Owing at filing can also mean underpayment penalties — adjust your W-4 or make estimated payments.' : 'A big refund is an interest-free loan to the IRS — adjust your W-4 to keep that money in your paycheck (and invested) during the year.'} Estimate ignores credits, other income, and itemizing — verify with real filing software or a CPA.`)
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

  // Home / mortgage documents context
  const home = state.home || {}
  const mortBalance = num(home.mortgageBalance)
  const mortRate = num(home.mortgageRate)
  if (mortBalance > 0 && mortRate > 0) {
    const annualInterest = Math.round(mortBalance * (mortRate / 100))
    const propTax = num(home.propertyTaxAnnual)
    const sdHome = L.standardDeduction[p.filingStatus] || L.standardDeduction.single
    const itemizable = annualInterest + propTax
    if (itemizable > sdHome) {
      push('tax', 'warning', `Itemizing may beat the standard deduction (~$${itemizable.toLocaleString()} vs $${sdHome.toLocaleString()})`,
        `Estimated mortgage interest (~$${annualInterest.toLocaleString()} at ${mortRate}% on $${mortBalance.toLocaleString()}) plus property tax ($${propTax.toLocaleString()}) exceeds your standard deduction — before even counting state income tax and charitable gifts. Check Schedule A at filing time; keep your Form 1098 in the Taxes section.`)
    } else if (itemizable > sdHome * 0.75) {
      push('tax', 'info', 'Close to the itemizing line',
        `Mortgage interest + property tax ≈ $${itemizable.toLocaleString()} vs. a $${sdHome.toLocaleString()} standard deduction. Bunching charitable gifts into one year could push you over in alternating years.`)
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

  // ---------- Insurance ----------
  const lifeCoverage = coverageOf(state, 'life')
  const someoneDependsOnIncome = dependents > 0 || (p.filingStatus === 'mfj' && num(p.spouseIncome) < income * 0.5)
  if (income > 0 && someoneDependsOnIncome) {
    // DIME: Debt + Income replacement (10x) + Mortgage + Education
    const dime = num(p.otherDebt) + income * 10 + num(p.mortgageBalance) + num(p.educationNeeds)
    if (lifeCoverage < dime) {
      push('insurance', lifeCoverage === 0 ? 'critical' : 'warning',
        `Life insurance gap: ~$${Math.round((dime - lifeCoverage) / 1000) * 1000 >= 1000 ? ((dime - lifeCoverage) / 1000000).toFixed(2) + 'M' : (dime - lifeCoverage).toLocaleString()} short of estimated need`,
        `DIME estimate (Debt $${num(p.otherDebt).toLocaleString()} + 10× income $${(income * 10).toLocaleString()} + mortgage $${num(p.mortgageBalance).toLocaleString()} + education $${num(p.educationNeeds).toLocaleString()}) ≈ $${dime.toLocaleString()} of coverage. You have $${lifeCoverage.toLocaleString()}. Level-term insurance (20–30 yr) is cheap while you're healthy; skip whole-life unless you have a specific estate need.`)
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
      if (!t.date?.startsWith(thisMonth) || t.amount >= 0) continue
      spent[t.category] = (spent[t.category] || 0) + -t.amount
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
