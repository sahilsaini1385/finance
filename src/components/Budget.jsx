import React, { useMemo, useState } from 'react'
import { useStore, fmt } from '../store.jsx'
import { CATEGORIES } from '../lib/categorize.js'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

const EXCLUDED = ['Income', 'Transfers', 'Investments']
const BUDGETABLE = CATEGORIES.filter(c => !EXCLUDED.includes(c))

function shiftMonth(month, delta) {
  const d = new Date(month + '-02')
  d.setMonth(d.getMonth() + delta)
  return d.toISOString().slice(0, 7)
}

// Round a suggested budget to a human number, always upward.
function roundBudget(v) {
  if (v < 100) return Math.ceil(v / 10) * 10
  return Math.ceil(v / 25) * 25
}

// Average monthly spend per category over up to the last 3 FULL months
// (the current partial month would understate everything).
function suggestBudgets(transactions, thisMonth) {
  const months = [shiftMonth(thisMonth, -1), shiftMonth(thisMonth, -2), shiftMonth(thisMonth, -3)]
  const monthsWithData = new Set()
  const totals = {}
  for (const t of transactions) {
    const m = t.date?.slice(0, 7)
    if (!months.includes(m) || t.amount >= 0 || EXCLUDED.includes(t.category)) continue
    monthsWithData.add(m)
    totals[t.category] = (totals[t.category] || 0) + -t.amount
  }
  const divisor = Math.max(1, monthsWithData.size)
  const out = {}
  for (const [cat, total] of Object.entries(totals)) out[cat] = roundBudget(total / divisor)
  return { suggestions: out, monthsUsed: divisor }
}

export default function Budget() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const thisMonth = new Date().toISOString().slice(0, 7)
  const [month, setMonth] = useState(thisMonth)

  const { suggestions, monthsUsed } = useMemo(
    () => suggestBudgets(state.transactions, thisMonth),
    [state.transactions, thisMonth],
  )

  const applyAllSuggestions = () => {
    let applied = 0
    for (const [cat, amount] of Object.entries(suggestions)) {
      if (!state.budgets?.[cat]) {
        dispatch({ type: 'SET_BUDGET', payload: { category: cat, amount } })
        applied++
      }
    }
    toast(
      applied > 0
        ? `Filled ${applied} budgets from your ${monthsUsed}-month spending average`
        : 'All categories with spending history already have budgets',
      { kind: applied > 0 ? 'good' : 'info' },
    )
  }

  const spent = useMemo(() => {
    const m = {}
    let income = 0
    for (const t of state.transactions) {
      if (!t.date?.startsWith(month)) continue
      if (t.category === 'Income' && t.amount > 0) income += t.amount
      if (t.amount >= 0 || EXCLUDED.includes(t.category)) continue
      m[t.category] = (m[t.category] || 0) + -t.amount
    }
    return { byCat: m, income }
  }, [state.transactions, month])

  const budgets = state.budgets || {}
  const totalBudget = Object.values(budgets).reduce((s, v) => s + v, 0)
  const totalSpent = Object.values(spent.byCat).reduce((s, v) => s + v, 0)
  const budgetedSpent = Object.keys(budgets).reduce((s, c) => s + (spent.byCat[c] || 0), 0)

  const rows = BUDGETABLE
    .map(cat => ({ cat, budget: budgets[cat] || 0, actual: spent.byCat[cat] || 0 }))
    .sort((a, b) => (b.budget || b.actual) - (a.budget || a.actual))

  const monthLabel = new Date(month + '-02').toLocaleString(undefined, { month: 'long', year: 'numeric' })
  const overCats = rows.filter(r => r.budget > 0 && r.actual > r.budget)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Budget</h1>
          <p className="muted small">Set a monthly amount per category — actuals come from your imported and synced transactions.</p>
        </div>
        <div className="row gap wrap">
          {Object.keys(suggestions).length > 0 && (
            <button className="btn small" onClick={applyAllSuggestions} title="Fill empty budgets from your recent average spending">
              <Icon name="sparkle" size={13} /> Auto-fill from spending
            </button>
          )}
          <button className="btn small" onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label="Previous month">←</button>
          <strong className="nowrap">{monthLabel}</strong>
          <button className="btn small" onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={month >= thisMonth} aria-label="Next month">→</button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Budgeted</div>
          <div className="stat-value money">{totalBudget > 0 ? fmt(totalBudget) : '—'}</div>
          <div className="stat-sub">{Object.keys(budgets).length} categories</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Spent</div>
          <div className="stat-value money">{fmt(totalSpent)}</div>
          <div className="stat-sub">{monthLabel}</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">{totalBudget > 0 ? 'Remaining in budgets' : 'Income this month'}</div>
          <div className="stat-value money" style={totalBudget > 0 && totalBudget - budgetedSpent < 0 ? { color: 'var(--critical)' } : undefined}>
            {totalBudget > 0 ? fmt(totalBudget - budgetedSpent) : fmt(spent.income)}
          </div>
          <div className="stat-sub">{totalBudget > 0 ? 'across budgeted categories' : 'from Income transactions'}</div>
        </div>
      </div>

      {overCats.length > 0 && month === thisMonth && (
        <div className="alert warning">
          <span className="alert-icon"><Icon name="alert-triangle" size={15} /></span>
          <div>
            <strong>Over budget:</strong>{' '}
            {overCats.map(r => `${r.cat} (+${fmt(r.actual - r.budget)})`).join(' · ')}
          </div>
        </div>
      )}

      <div className="card">
        {state.transactions.length === 0 && (
          <div className="alert info">
            <span className="alert-icon"><Icon name="info" size={15} /></span>
            <div>No transactions yet — sync or import in <strong>Add data</strong> so actuals fill in automatically. You can still set budgets now.</div>
          </div>
        )}
        <table className="table">
          <thead>
            <tr>
              <th>Category</th>
              <th className="num" style={{ width: 130 }}>Monthly budget</th>
              <th style={{ width: '34%' }}>Progress</th>
              <th className="num">Spent</th>
              <th className="num">Left</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ cat, budget, actual }) => {
              const pct = budget > 0 ? Math.min(100, (actual / budget) * 100) : 0
              const over = budget > 0 && actual > budget
              return (
                <tr key={cat}>
                  <td>{cat}</td>
                  <td className="num">
                    <span className="input-money" style={{ width: 110, display: 'inline-flex' }}>
                      <input
                        type="number"
                        inputMode="decimal"
                        placeholder="—"
                        value={budgets[cat] ?? ''}
                        onChange={e => dispatch({ type: 'SET_BUDGET', payload: { category: cat, amount: e.target.value } })}
                        style={{ textAlign: 'right' }}
                        aria-label={`${cat} monthly budget`}
                      />
                    </span>
                    {!budgets[cat] && suggestions[cat] && (
                      <div>
                        <button
                          className="chip"
                          title={`Set from your ${monthsUsed}-month average`}
                          onClick={() => dispatch({ type: 'SET_BUDGET', payload: { category: cat, amount: suggestions[cat] } })}
                        >
                          avg {fmt(suggestions[cat])} — use
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    {budget > 0 ? (
                      <div className="meter">
                        <div
                          className="meter-fill"
                          style={{ width: `${pct}%`, background: over ? 'var(--critical)' : pct > 85 ? 'var(--warning)' : 'var(--accent)' }}
                        />
                      </div>
                    ) : actual > 0 ? (
                      <span className="small muted">unbudgeted spending</span>
                    ) : null}
                  </td>
                  <td className="num">{actual > 0 ? fmt(actual) : '—'}</td>
                  <td className="num" style={over ? { color: 'var(--critical)', fontWeight: 600 } : undefined}>
                    {budget > 0 ? (over ? `−${fmt(actual - budget)}` : fmt(budget - actual)) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {totalBudget > 0 && (
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{fmt(totalBudget)}</td>
                <td></td>
                <td className="num">{fmt(budgetedSpent)}</td>
                <td className="num" style={totalBudget - budgetedSpent < 0 ? { color: 'var(--critical)', fontWeight: 600 } : undefined}>
                  {fmt(totalBudget - budgetedSpent)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
        <p className="muted small">
          Budgets apply to every month. “Auto-fill from spending” sets each empty budget to your average over the
          last {monthsUsed === 1 ? 'full month' : `${monthsUsed} full months`} of transactions (rounded up) — then
          trim the two categories you most want to change; small, specific cuts stick better than across-the-board ones.
        </p>
      </div>
    </div>
  )
}
