// Monthly report builder — pure snapshot of a month's story, used both for
// live rendering and for the auto-archived month-end records.

import { normalizeMerchant, detectRecurring } from './savings.js'
import { effectiveBudgets, EXCLUDED } from './budget.js'

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
    if (t.category === 'Income' && t.amount > 0) {
      income += t.amount
      continue
    }
    if (EXCLUDED.includes(t.category)) continue
    const amt = -t.amount // refunds/reimbursements net out
    spend += amt
    byCat[t.category] = (byCat[t.category] || 0) + amt
    if (t.amount < 0) {
      const m = normalizeMerchant(t.description)
      if (m) byMerchant[m] = (byMerchant[m] || 0) + amt
      expenses.push(t)
    }
  }
  for (const c of Object.keys(byCat)) if (byCat[c] <= 0) delete byCat[c]
  if (spend < 0) spend = 0
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
