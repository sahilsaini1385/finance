import React, { useMemo, useState } from 'react'
import { useStore, uid, fmt } from '../store.jsx'
import {
  FIXED_CATS, flexibleCategories, effectiveBudgets, hasOverride,
  monthActivity, daysInfo, paceProjection, computeSafeToSpend, sinkingTotal,
  allCategories, EXCLUDED,
} from '../lib/budget.js'
import { detectRecurring } from '../lib/savings.js'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'
import { useAutoCategorize } from './useAutoCategorize.js'

function shiftMonth(month, delta) {
  const d = new Date(month + '-02')
  d.setMonth(d.getMonth() + delta)
  return d.toISOString().slice(0, 7)
}

function roundBudget(v) {
  if (v < 100) return Math.ceil(v / 10) * 10
  return Math.ceil(v / 25) * 25
}

function suggestions(transactions, thisMonth) {
  const months = [shiftMonth(thisMonth, -1), shiftMonth(thisMonth, -2), shiftMonth(thisMonth, -3)]
  const withData = new Set()
  const totals = {}
  for (const t of transactions) {
    const m = t.date?.slice(0, 7)
    if (!months.includes(m) || t.amount >= 0 || EXCLUDED.includes(t.category)) continue
    withData.add(m)
    totals[t.category] = (totals[t.category] || 0) + -t.amount
  }
  const divisor = Math.max(1, withData.size)
  const out = {}
  for (const [cat, total] of Object.entries(totals)) out[cat] = roundBudget(total / divisor)
  return { byCat: out, monthsUsed: divisor }
}

function BudgetInput({ value, isCustom, onChange, onClearOverride, label }) {
  return (
    <span className="nowrap">
      <span className="input-money" style={{ width: 104, display: 'inline-flex' }}>
        <input
          type="number"
          inputMode="decimal"
          placeholder="—"
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          style={{ textAlign: 'right' }}
          aria-label={label}
        />
      </span>
      {isCustom && (
        <button className="chip" title="This month only — click to revert to your default" onClick={onClearOverride} style={{ marginLeft: 4 }}>
          this month ×
        </button>
      )}
    </span>
  )
}

export default function Budget() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const thisMonth = new Date().toISOString().slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const [newCat, setNewCat] = useState('')
  const [sinkForm, setSinkForm] = useState({ name: '', monthlyAmount: '' })
  const [armedId, setArmedId] = useState(null)

  const budgets = effectiveBudgets(state, month)
  const { income, spentByCat, needsReview } = useMemo(() => monthActivity(state, month), [state.transactions, month])
  const sts = useMemo(() => computeSafeToSpend(state, month), [state, month])
  const { daysInMonth, dayOfMonth, isCurrent, daysLeft } = daysInfo(month)
  const sugg = useMemo(() => suggestions(state.transactions, thisMonth), [state.transactions, thisMonth])
  const recurring = useMemo(() => detectRecurring(state.transactions), [state.transactions])
  const flexCats = flexibleCategories(state)
  const monthLabel = new Date(month + '-02').toLocaleString(undefined, { month: 'long', year: 'numeric' })
  const overrideCount = Object.keys((state.budgetMonths || {})[month] || {}).length

  const setBudget = (category, amount) =>
    dispatch({ type: 'SET_MONTH_BUDGET', payload: { month, category, amount } })
  const clearOverride = category =>
    dispatch({ type: 'SET_MONTH_BUDGET', payload: { month, category, amount: '' } })

  const saveAsDefault = () => {
    for (const [cat, v] of Object.entries(budgets)) dispatch({ type: 'SET_BUDGET', payload: { category: cat, amount: v } })
    dispatch({ type: 'CLEAR_MONTH_BUDGETS', payload: month })
    toast('Saved this month’s numbers as your default budget', { kind: 'good' })
  }

  const autoFill = () => {
    let applied = 0
    for (const [cat, amount] of Object.entries(sugg.byCat)) {
      if (!state.budgets?.[cat]) {
        dispatch({ type: 'SET_BUDGET', payload: { category: cat, amount } })
        applied++
      }
    }
    toast(applied > 0 ? `Filled ${applied} defaults from your ${sugg.monthsUsed}-month average` : 'All categories with history already have budgets',
      { kind: applied > 0 ? 'good' : 'info' })
  }

  const reviewTx = useAutoCategorize()

  const addCategory = e => {
    e.preventDefault()
    const name = newCat.trim()
    if (!name) return
    if (allCategories(state).some(c => c.toLowerCase() === name.toLowerCase())) {
      toast('That category already exists', { kind: 'error' })
      return
    }
    dispatch({ type: 'ADD_CATEGORY', payload: { id: uid(), name } })
    setNewCat('')
    toast(`Category "${name}" added`, { kind: 'good' })
  }

  const addSinking = e => {
    e.preventDefault()
    if (!sinkForm.name.trim() || !parseFloat(sinkForm.monthlyAmount)) return
    dispatch({ type: 'ADD_SINKING', payload: { id: uid(), name: sinkForm.name.trim(), monthlyAmount: parseFloat(sinkForm.monthlyAmount) } })
    setSinkForm({ name: '', monthlyAmount: '' })
    toast('Set-aside added', { kind: 'good' })
  }

  const armDelete = (id, action) => {
    if (armedId !== id) {
      setArmedId(id)
      setTimeout(() => setArmedId(cur => (cur === id ? null : cur)), 3000)
      return
    }
    setArmedId(null)
    action()
  }

  const paceColor = (spent, budget) => {
    if (!budget) return 'var(--accent)'
    if (spent > budget) return 'var(--critical)'
    if (!isCurrent) return spent > budget * 0.95 ? 'var(--warning)' : 'var(--accent)'
    const expected = budget * (dayOfMonth / daysInMonth)
    if (spent > Math.max(expected * 1.15, budget * 0.2)) return 'var(--warning)'
    return 'var(--accent)'
  }

  // Pace projection only makes sense for day-by-day spending — fixed bills
  // land as lumps (mortgage on the 1st would "project" to 4× itself).
  const renderRows = (cats, { showPace = true } = {}) => cats.map(cat => {
    const b = budgets[cat] || 0
    const s = spentByCat[cat] || 0
    if (!b && !s && !state.budgets?.[cat] && !sugg.byCat[cat]) return null
    const proj = showPace && isCurrent && b > 0 && s > 0 ? paceProjection(s, dayOfMonth, daysInMonth) : null
    const over = b > 0 && s > b
    const custom = state.customCategories?.find(c => c.name === cat)
    return (
      <tr key={cat}>
        <td>
          {cat}
          {custom && (
            <button
              className="btn ghost small"
              style={{ marginLeft: 2, opacity: 0.6 }}
              aria-label={`Delete category ${cat}`}
              onClick={() => armDelete(custom.id, () => dispatch({ type: 'DELETE_CATEGORY', payload: custom.id }))}
            >
              {armedId === custom.id ? 'Sure?' : <Icon name="x" size={11} />}
            </button>
          )}
        </td>
        <td className="num">
          <BudgetInput
            label={`${cat} budget for ${monthLabel}`}
            value={budgets[cat] ?? ''}
            isCustom={hasOverride(state, month, cat)}
            onChange={v => setBudget(cat, v)}
            onClearOverride={() => clearOverride(cat)}
          />
          {!b && sugg.byCat[cat] && (
            <div>
              <button className="chip" onClick={() => dispatch({ type: 'SET_BUDGET', payload: { category: cat, amount: sugg.byCat[cat] } })}>
                avg {fmt(sugg.byCat[cat])} — use
              </button>
            </div>
          )}
        </td>
        <td style={{ width: '26%' }}>
          {b > 0 && (
            <div className="meter">
              <div className="meter-fill" style={{ width: `${Math.min(100, (s / b) * 100)}%`, background: paceColor(s, b) }} />
            </div>
          )}
        </td>
        <td className="num">{s > 0 ? fmt(s) : '—'}</td>
        <td className="num small" style={proj && proj > b ? { color: 'var(--warning-text)', fontWeight: 600 } : undefined}>
          {proj !== null && Math.abs(proj - s) > 1 ? `→ ${fmt(proj)}` : ''}
        </td>
        <td className="num" style={over ? { color: 'var(--critical)', fontWeight: 600 } : undefined}>
          {b > 0 ? (over ? `−${fmt(s - b)}` : fmt(b - s)) : ''}
        </td>
      </tr>
    )
  })

  const head = (
    <thead>
      <tr>
        <th>Category</th>
        <th className="num" style={{ width: 150 }}>Budget</th>
        <th>Progress</th>
        <th className="num">Spent</th>
        <th className="num">Pace</th>
        <th className="num">Left</th>
      </tr>
    </thead>
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Budget</h1>
          <p className="muted small">
            {isCurrent
              ? `Day ${dayOfMonth} of ${daysInMonth} · ${daysLeft} days left`
              : `${monthLabel} — closed month`}
            {overrideCount > 0 && ` · ${overrideCount} custom amount${overrideCount > 1 ? 's' : ''} this month`}
          </p>
        </div>
        <div className="row gap wrap">
          <button className="btn small" onClick={autoFill} title="Fill empty default budgets from recent spending">
            <Icon name="sparkle" size={13} /> Auto-fill
          </button>
          {overrideCount > 0 && (
            <button className="btn small" onClick={saveAsDefault} title="Make this month's numbers the default going forward">
              Save as default
            </button>
          )}
          <button className="btn small" onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label="Previous month">←</button>
          <strong className="nowrap">{monthLabel}</strong>
          <button className="btn small" onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={month >= thisMonth} aria-label="Next month">→</button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-tile hero-card" style={{ cursor: 'default' }}>
          <div className="stat-label">Safe to spend</div>
          <div className="stat-value money" style={{ fontSize: 26, color: sts.safe < 0 ? 'var(--critical)' : undefined }}>
            {sts.safe < 0 ? '−' : ''}{fmt(Math.abs(sts.safe))}
          </div>
          <div className="stat-sub">
            {sts.perDay !== null && sts.safe > 0 ? `≈ ${fmt(sts.perDay)}/day for ${daysLeft} days · ` : ''}
            income basis: {sts.income.basis === 'target' ? 'your target' : sts.income.basis}
          </div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Fixed bills</div>
          <div className="stat-value money">{fmt(sts.fixedSpent)} <span className="muted" style={{ fontSize: 14 }}>of {fmt(Math.max(sts.fixedBudgeted, sts.fixedCommitted))}</span></div>
          <div className="stat-sub">mortgage, utilities, insurance, subscriptions</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Flexible spending</div>
          <div className="stat-value money">{fmt(sts.flexSpent)} <span className="muted" style={{ fontSize: 14 }}>of {fmt(sts.flexBudgeted)}</span></div>
          <div className="stat-sub">{sts.flexBudgeted > 0 ? `${Math.round((sts.flexSpent / sts.flexBudgeted) * 100)}% used` : 'set envelope budgets below'}</div>
        </div>
      </div>

      <div className="card">
        <div className="row gap wrap" style={{ alignItems: 'center' }}>
          <label className="inline-label">Expected monthly take-home
            <span className="input-money" style={{ width: 130 }}>
              <input
                type="number"
                inputMode="decimal"
                value={state.budgetConfig?.incomeTarget ?? ''}
                placeholder={String(Math.round(sts.income.value) || '')}
                onChange={e => dispatch({ type: 'SET_BUDGET_CONFIG', payload: { incomeTarget: e.target.value } })}
              />
            </span>
          </label>
          <span className="small muted money">
            Planned: {fmt(sts.allocated)} (fixed {fmt(sts.fixedBudgeted)} + flexible {fmt(sts.flexBudgeted)} + set-asides {fmt(sts.sinking)}) ·{' '}
            <strong style={{ color: sts.unallocated < 0 ? 'var(--critical)' : 'var(--good-text)' }}>
              {sts.unallocated < 0 ? `over-planned by ${fmt(-sts.unallocated)}` : `${fmt(sts.unallocated)} unplanned`}
            </strong>
          </span>
        </div>
        {sts.income.value > 0 && (
          <div className="meter" style={{ marginTop: 10, height: 10 }}>
            <div style={{ display: 'flex', height: '100%', width: '100%' }}>
              <div style={{ width: `${Math.min(100, (sts.fixedBudgeted / sts.income.value) * 100)}%`, background: 'var(--series-1)' }} />
              <div style={{ width: `${Math.min(100, (sts.flexBudgeted / sts.income.value) * 100)}%`, background: 'var(--series-2)' }} />
              <div style={{ width: `${Math.min(100, (sts.sinking / sts.income.value) * 100)}%`, background: 'var(--warning)' }} />
            </div>
          </div>
        )}
        <div className="legend" style={{ marginTop: 6, marginBottom: 0 }}>
          <span><i className="swatch" style={{ background: 'var(--series-1)' }} /> Fixed</span>
          <span><i className="swatch" style={{ background: 'var(--series-2)' }} /> Flexible</span>
          <span><i className="swatch" style={{ background: 'var(--warning)' }} /> Set-asides</span>
          <span><i className="swatch" style={{ background: 'var(--surface-3)' }} /> Unplanned</span>
        </div>
      </div>

      {needsReview.length > 0 && (
        <div className="card">
          <h2>
            <span className="sev-chip warning"><Icon name="alert-triangle" size={14} /></span>
            Needs review — {needsReview.length} uncategorized transaction{needsReview.length > 1 ? 's' : ''} skewing this month
          </h2>
          <table className="table">
            <tbody>
              {needsReview.slice(0, 6).map(t => (
                <tr key={t.id}>
                  <td className="small nowrap">{t.date}</td>
                  <td className="desc small">{t.description}</td>
                  <td className="num">{fmt(-t.amount)}</td>
                  <td className="row-actions" style={{ opacity: 1 }}>
                    <select defaultValue="" aria-label="Categorize" onChange={e => e.target.value && reviewTx(t, e.target.value)}>
                      <option value="" disabled>Categorize…</option>
                      {allCategories(state).filter(c => c !== 'Other').map(c => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {needsReview.length > 6 && <p className="muted small">…and {needsReview.length - 6} more in the Transactions tab (filter: Other).</p>}
        </div>
      )}

      <div className="card">
        <h2>
          <span className="icon-chip"><Icon name="home" /></span>
          Fixed bills
          <span className="badge">{fmt(sts.fixedBudgeted)}/mo planned</span>
        </h2>
        <table className="table">
          {head}
          <tbody>{renderRows(FIXED_CATS, { showPace: false })}</tbody>
        </table>
        {recurring.length > 0 && (
          <details className="advanced">
            <summary>Detected recurring bills ({recurring.length} · ~{fmt(recurring.reduce((s, r) => s + r.monthlyCost, 0))}/mo) — sanity-check your fixed budgets against these</summary>
            <p className="muted small" style={{ margin: '8px 0 0' }}>
              {recurring.slice(0, 12).map(r => `${r.merchant.toLowerCase()} ${fmt(r.monthlyCost)}`).join(' · ')}
            </p>
          </details>
        )}
      </div>

      <div className="card">
        <h2>
          <span className="icon-chip"><Icon name="pie-chart" /></span>
          Flexible envelopes
          <span className="badge">{fmt(sts.flexBudgeted)}/mo planned</span>
        </h2>
        {state.transactions.length === 0 && (
          <div className="alert info">
            <span className="alert-icon"><Icon name="info" size={15} /></span>
            <div>No transactions yet — sync or import in <strong>Add data</strong> so spending fills in automatically. You can still plan budgets now.</div>
          </div>
        )}
        <table className="table">
          {head}
          <tbody>{renderRows(flexCats)}</tbody>
        </table>
        <form className="row gap wrap" style={{ marginTop: 10 }} onSubmit={addCategory}>
          <input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="New category (Kids, Pets, Date night…)" style={{ width: 240 }} />
          <button className="btn small" type="submit" disabled={!newCat.trim()}><Icon name="plus" size={13} /> Add category</button>
        </form>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Pace (→) projects the month's end from spending so far. Amounts you edit here apply to {monthLabel} only —
          use “Save as default” to make them every month's starting point.
        </p>
      </div>

      <div className="card">
        <h2>
          <span className="icon-chip"><Icon name="calendar" /></span>
          Monthly set-asides
          <span className="badge">{fmt(sinkingTotal(state))}/mo</span>
        </h2>
        <p className="muted small">
          Smooth irregular costs into every month — holidays, car repairs, annual camp — so December never wrecks the plan.
          Set-asides reduce Safe to spend now instead of surprising you later.
        </p>
        {(state.sinkingFunds || []).length > 0 && (
          <table className="table">
            <tbody>
              {state.sinkingFunds.map(f => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td className="num">{fmt(f.monthlyAmount)}/mo · {fmt(f.monthlyAmount * 12)}/yr</td>
                  <td className="row-actions">
                    <button
                      className={armedId === f.id ? 'btn danger small armed' : 'btn danger small'}
                      onClick={() => armDelete(f.id, () => dispatch({ type: 'DELETE_SINKING', payload: f.id }))}
                    >
                      {armedId === f.id ? 'Confirm?' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form className="row gap wrap" onSubmit={addSinking} style={{ marginTop: 8 }}>
          <input value={sinkForm.name} onChange={e => setSinkForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Holiday gifts" style={{ width: 200 }} />
          <span className="input-money" style={{ width: 110 }}>
            <input type="number" inputMode="decimal" placeholder="/month" value={sinkForm.monthlyAmount} onChange={e => setSinkForm(f => ({ ...f, monthlyAmount: e.target.value }))} />
          </span>
          <button className="btn small" type="submit">Add set-aside</button>
        </form>
      </div>
    </div>
  )
}
