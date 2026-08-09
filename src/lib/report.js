// Monthly report builder — pure snapshot of a month's story, used both for
// live rendering and for the auto-archived month-end records.

import { normalizeMerchant, detectRecurring } from './savings.js'
import { effectiveBudgets, EXCLUDED } from './budget.js'
import { txParts } from './tx.js'

export function shiftMonth(month, delta) {
  const d = new Date(month + '-02')
  d.setMonth(d.getMonth() + delta)
  return d.toISOString().slice(0, 7)
}

export function monthStats(transactions, month) {
  let income = 0
  let spend = 0
  const byCat = {}
  const byMerchant = {}
  const expenses = []
  for (const t of transactions) {
    if (!t.date?.startsWith(month)) continue
    let isExpense = false
    for (const p of txParts(t)) {
      if (p.category === 'Income' && p.amount > 0) {
        income += p.amount
        continue
      }
      if (EXCLUDED.includes(p.category)) continue
      const amt = -p.amount // refunds/reimbursements net out
      byCat[p.category] = (byCat[p.category] || 0) + amt
      if (p.amount < 0) isExpense = true
    }
    if (isExpense) {
      const m = normalizeMerchant(t.description)
      if (m) byMerchant[m] = (byMerchant[m] || 0) + -t.amount
      expenses.push(t)
    }
  }
  // Same netting rule as budget.js monthActivity: clamp each category at 0,
  // and make the headline total the sum of the clamped categories so the
  // Report and Budget pages (and the bars vs the headline) always agree.
  for (const c of Object.keys(byCat)) if (byCat[c] <= 0) delete byCat[c]
  spend = Object.values(byCat).reduce((s, v) => s + v, 0)
  expenses.sort((a, b) => a.amount - b.amount)
  return { income, spend, byCat, byMerchant, expenses }
}

function netWorthDelta(history, month) {
  const inMonth = (history || []).filter(h => h.date.startsWith(month))
  if (inMonth.length === 0) return null
  const before = history.filter(h => h.date < month + '-01')
  const start = before.length > 0 ? before[before.length - 1] : inMonth[0]
  const end = inMonth[inMonth.length - 1]
  if (start.date === end.date) return null
  return end.netWorth - start.netWorth
}

// The complete, self-contained report for a month. Safe to store: contains
// plain values only, no references back into live state.
export function buildMonthlyReport(state, month) {
  const cur = monthStats(state.transactions, month)
  const prev = monthStats(state.transactions, shiftMonth(month, -1))
  const recurring = detectRecurring(state.transactions)
  const subsMonthly = recurring
    .filter(r => r.cadence === 'monthly' && r.medianAmount <= 100)
    .reduce((s, r) => s + r.monthlyCost, 0)
  return {
    month,
    generatedAt: new Date().toISOString(),
    income: cur.income,
    spend: cur.spend,
    byCat: cur.byCat,
    topMerchants: Object.entries(cur.byMerchant).sort((a, b) => b[1] - a[1]).slice(0, 5),
    biggest: cur.expenses.slice(0, 3).map(t => ({ date: t.date, description: t.description, amount: t.amount })),
    nwDelta: netWorthDelta(state.history, month),
    subsMonthly,
    budgets: effectiveBudgets(state, month),
    prev: { income: prev.income, spend: prev.spend, byCat: prev.byCat },
  }
}

export function reportHasData(r) {
  return r.income > 0 || r.spend > 0
}

// ---------- Year in review ----------

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/[$,%\s,]/g, ''))
  return Number.isNaN(n) ? 0 : n
}

function yearMonths(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
}

export function buildYearReport(state, year) {
  const months = yearMonths(year)
  const series = months.map(m => {
    const s = monthStats(state.transactions, m)
    return { month: m, income: s.income, spend: s.spend }
  })
  const byCat = {}
  const byMerchant = {}
  let income = 0
  let spend = 0
  const expenses = []
  for (const m of months) {
    const s = monthStats(state.transactions, m)
    income += s.income
    spend += s.spend
    for (const [c, v] of Object.entries(s.byCat)) byCat[c] = (byCat[c] || 0) + v
    for (const [mc, v] of Object.entries(s.byMerchant)) byMerchant[mc] = (byMerchant[mc] || 0) + v
    expenses.push(...s.expenses)
  }
  const prevByCat = {}
  let prevIncome = 0
  let prevSpend = 0
  for (const m of yearMonths(year - 1)) {
    const s = monthStats(state.transactions, m)
    prevIncome += s.income
    prevSpend += s.spend
    for (const [c, v] of Object.entries(s.byCat)) prevByCat[c] = (prevByCat[c] || 0) + v
  }
  expenses.sort((a, b) => a.amount - b.amount)

  const inYear = (state.history || []).filter(h => h.date.startsWith(String(year)))
  const before = (state.history || []).filter(h => h.date < `${year}-01-01`)
  let nwDelta = null
  if (inYear.length > 0) {
    const start = before.length > 0 ? before[before.length - 1] : inYear[0]
    const end = inYear[inYear.length - 1]
    if (start.date !== end.date) nwDelta = end.netWorth - start.netWorth
  }

  return {
    year,
    income,
    spend,
    byCat,
    prev: { income: prevIncome, spend: prevSpend, byCat: prevByCat },
    topMerchants: Object.entries(byMerchant).sort((a, b) => b[1] - a[1]).slice(0, 10),
    biggest: expenses.slice(0, 5).map(t => ({ date: t.date, description: t.description, amount: t.amount })),
    series,
    nwDelta,
    monthsWithData: series.filter(s => s.income > 0 || s.spend > 0).length,
  }
}

// ---------- Tax summary ----------

const INT_DIV_RE = /dividend|interest|int pymt|int paid/i

export function buildTaxSummary(state, year, limits) {
  const y = String(year)
  let incomeTotal = 0
  let intDiv = 0
  for (const t of state.transactions) {
    if (!t.date?.startsWith(y) || t.category !== 'Income' || t.amount <= 0) continue
    incomeTotal += t.amount
    if (INT_DIV_RE.test(t.description)) intDiv += t.amount
  }

  const byCat = {}
  for (const m of yearMonths(year)) {
    const s = monthStats(state.transactions, m)
    for (const [c, v] of Object.entries(s.byCat)) byCat[c] = (byCat[c] || 0) + v
  }

  const home = state.home || {}
  const mortgageInterestEst =
    num(home.mortgageBalance) > 0 && num(home.mortgageRate) > 0
      ? Math.round(num(home.mortgageBalance) * (num(home.mortgageRate) / 100))
      : 0
  const propertyTax = num(home.propertyTaxAnnual)

  // W-2 figures entered for this tax year in the Taxes vault.
  const w2s = (state.documents || []).filter(d => d.kind === 'W-2' && d.year === y && d.fields)
  const sum = key => w2s.reduce((s, d) => s + num(d.fields?.[key]), 0)
  const w2 = w2s.length > 0
    ? { count: w2s.length, wages: sum('wages'), fedWithholding: sum('fedWithholding'), k401: sum('k401'), hsa: sum('hsa') }
    : null

  const deductions = {
    giving: byCat['Giving'] || 0,
    medical: byCat['Health'] || 0,
    propertyTax,
    mortgageInterestEst,
    education: byCat['Education'] || 0,
    workExpenses: byCat['Work expenses'] || 0,
    fees: byCat['Fees'] || 0,
  }
  const itemizableEst = deductions.giving + deductions.propertyTax + deductions.mortgageInterestEst
  const filingStatus = state.profile?.filingStatus || 'single'
  const standardDeduction = limits?.standardDeduction?.[filingStatus] || 0
  const docsCount = (state.documents || []).filter(d => d.section === 'tax' && d.year === y).length

  return {
    year,
    incomeTotal,
    intDiv,
    w2,
    deductions,
    itemizableEst,
    standardDeduction,
    itemizeLikely: standardDeduction > 0 && itemizableEst > standardDeduction,
    docsCount,
    filingStatus,
  }
}

export function taxSummaryCSV(s) {
  const rows = [
    ['Tax summary', String(s.year)],
    ['Filing status', s.filingStatus.toUpperCase()],
    [''],
    ['INCOME (from transactions)'],
    ['Total deposits categorized as Income', s.incomeTotal.toFixed(2)],
    ['  of which interest/dividends (by description)', s.intDiv.toFixed(2)],
  ]
  if (s.w2) {
    rows.push([''], [`W-2 figures entered (${s.w2.count} form${s.w2.count > 1 ? 's' : ''})`],
      ['Box 1 wages', s.w2.wages.toFixed(2)],
      ['Box 2 federal withholding', s.w2.fedWithholding.toFixed(2)],
      ['401(k) deferrals (Box 12)', s.w2.k401.toFixed(2)],
      ['HSA via payroll (Box 12 W)', s.w2.hsa.toFixed(2)])
  }
  rows.push([''], ['POTENTIAL DEDUCTIONS & CREDITS (verify with your CPA)'],
    ['Charitable giving (Giving category)', s.deductions.giving.toFixed(2)],
    ['Medical/health spending (Health category)', s.deductions.medical.toFixed(2)],
    ['Property tax (from Home profile)', s.deductions.propertyTax.toFixed(2)],
    ['Mortgage interest (ESTIMATE: balance x rate)', s.deductions.mortgageInterestEst.toFixed(2)],
    ['Education (Education category)', s.deductions.education.toFixed(2)],
    ['Unreimbursed work expenses (net)', s.deductions.workExpenses.toFixed(2)],
    ['Bank/service fees', s.deductions.fees.toFixed(2)],
    [''],
    ['Itemizable estimate (giving + property tax + mortgage interest)', s.itemizableEst.toFixed(2)],
    ['Standard deduction (' + s.filingStatus.toUpperCase() + ')', s.standardDeduction.toFixed(2)],
    ['Itemizing likely worth it?', s.itemizeLikely ? 'YES - review Schedule A' : 'Standard deduction likely wins'],
    [''],
    ['Tax documents stored in app for this year', String(s.docsCount)],
    ['Generated', new Date().toISOString().slice(0, 10)],
    ['Note', 'Educational estimate from your transaction data. Not tax advice.'])
  return rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
}
