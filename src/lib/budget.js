// Budget v2 helpers — pure functions over app state.
//
// Concepts:
//   template   — state.budgets {category: amount}: the default month
//   overrides  — state.budgetMonths {'YYYY-MM': {category: amount}}: per-month edits
//   effective  — overrides layered on the template for a given month
//   fixed      — bill-like categories (auto-payable, low discretion)
//   flexible   — envelope categories (the ones a family actually manages)
//   sinking    — monthly set-asides for irregular costs (gifts, car repairs)
//   safe to spend — income − sinking − fixed commitment − flexible spent

import { CATEGORIES } from './categorize.js'
import { localMonth } from './dates.js'

export const EXCLUDED = ['Income', 'Transfers', 'Investments']
export const FIXED_CATS = ['Housing', 'Utilities', 'Insurance', 'Subscriptions', 'Fees']

const num = v => {
  const n = parseFloat(v)
  return Number.isNaN(n) ? 0 : n
}

export function allCategories(state) {
  const customs = (state.customCategories || []).map(c => c.name)
  const base = CATEGORIES.filter(c => c !== 'Other')
  return [...base, ...customs, 'Other']
}

export function budgetableCategories(state) {
  return allCategories(state).filter(c => !EXCLUDED.includes(c))
}

export function flexibleCategories(state) {
  return budgetableCategories(state).filter(c => !FIXED_CATS.includes(c))
}

// Effective budget map for a month: template overlaid with that month's edits.
export function effectiveBudgets(state, month) {
  const template = state.budgets || {}
  const overrides = (state.budgetMonths || {})[month] || {}
  const out = {}
  for (const [c, v] of Object.entries(template)) if (num(v) > 0) out[c] = num(v)
  // An explicit 0 override stays visible as 0 (the user zeroed the category
  // for this month) instead of silently falling back to the template.
  for (const [c, v] of Object.entries(overrides)) out[c] = Math.max(0, num(v))
  return out
}

export function hasOverride(state, month, category) {
  const o = (state.budgetMonths || {})[month]
  return o ? o[category] !== undefined : false
}

// Income, spending by category, and unreviewed transactions for a month.
export function monthActivity(state, month) {
  let income = 0
  const spentByCat = {}
  const needsReview = []
  for (const t of state.transactions) {
    if (!t.date?.startsWith(month)) continue
    if (t.category === 'Income' && t.amount > 0) {
      income += t.amount
      continue
    }
    if (EXCLUDED.includes(t.category)) continue
    // Positive amounts in a spending category are refunds/reimbursements
    // (returns, employer paying back Work expenses) — they net against spend.
    spentByCat[t.category] = (spentByCat[t.category] || 0) + -t.amount
    if (t.amount < 0 && t.category === 'Other') needsReview.push(t)
  }
  for (const c of Object.keys(spentByCat)) if (spentByCat[c] < 0) spentByCat[c] = 0
  needsReview.sort((a, b) => a.amount - b.amount) // largest expense first
  return { income, spentByCat, needsReview }
}

export function daysInfo(month) {
  const today = new Date()
  const thisMonth = localMonth(today)
  const [y, m] = month.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const isCurrent = month === thisMonth
  const dayOfMonth = isCurrent ? today.getDate() : daysInMonth
  return { daysInMonth, dayOfMonth, isCurrent, daysLeft: daysInMonth - dayOfMonth }
}

// Straight-line end-of-month projection for one category.
export function paceProjection(spent, dayOfMonth, daysInMonth) {
  if (dayOfMonth <= 0) return spent
  return (spent / dayOfMonth) * daysInMonth
}

// Income basis: explicit target beats history average beats this month's actual.
export function incomeBasis(state, month) {
  const target = num(state.budgetConfig?.incomeTarget)
  if (target > 0) return { value: target, basis: 'target' }
  const months = new Set()
  const totals = {}
  for (const t of state.transactions) {
    if (t.category !== 'Income' || t.amount <= 0) continue
    const m = t.date?.slice(0, 7)
    if (!m || m >= month) continue
    totals[m] = (totals[m] || 0) + t.amount
    months.add(m)
  }
  const recent = [...months].sort().slice(-3)
  if (recent.length > 0) {
    const avg = recent.reduce((s, m) => s + totals[m], 0) / recent.length
    return { value: avg, basis: `avg of last ${recent.length} mo` }
  }
  const { income } = monthActivity(state, month)
  return { value: income, basis: 'received this month' }
}

export function sinkingTotal(state) {
  return (state.sinkingFunds || []).reduce((s, f) => s + num(f.monthlyAmount), 0)
}

// The headline family number. Fixed commitment counts the larger of budget vs
// actual per fixed category (a bill that already ran high is reality; one not
// yet paid is still owed).
export function computeSafeToSpend(state, month) {
  const budgets = effectiveBudgets(state, month)
  const { spentByCat } = monthActivity(state, month)
  const income = incomeBasis(state, month)
  const sinking = sinkingTotal(state)

  let fixedCommitted = 0
  let fixedBudgeted = 0
  let fixedSpent = 0
  for (const c of FIXED_CATS) {
    const b = budgets[c] || 0
    const s = spentByCat[c] || 0
    fixedCommitted += Math.max(b, s)
    fixedBudgeted += b
    fixedSpent += s
  }

  let flexSpent = 0
  let flexBudgeted = 0
  for (const [c, s] of Object.entries(spentByCat)) {
    if (!FIXED_CATS.includes(c)) flexSpent += s
  }
  for (const [c, b] of Object.entries(budgets)) {
    if (!FIXED_CATS.includes(c)) flexBudgeted += b
  }

  const safe = income.value - sinking - fixedCommitted - flexSpent
  const { daysLeft, isCurrent } = daysInfo(month)
  return {
    safe,
    perDay: isCurrent && daysLeft > 0 ? safe / daysLeft : null,
    income,
    sinking,
    fixedCommitted,
    fixedBudgeted,
    fixedSpent,
    flexSpent,
    flexBudgeted,
    allocated: fixedBudgeted + flexBudgeted + sinking,
    unallocated: income.value - (fixedBudgeted + flexBudgeted + sinking),
  }
}
