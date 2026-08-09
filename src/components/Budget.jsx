import React, { useMemo, useState } from 'react'
import { useStore, uid, fmt } from '../store.jsx'
import {
  FIXED_CATS, flexibleCategories, effectiveBudgets, hasOverride,
  monthActivity, daysInfo, paceProjection, computeSafeToSpend, sinkingTotal,
  allCategories, EXCLUDED,
} from '../lib/budget.js'
import { detectRecurring, normalizeMerchant } from '../lib/savings.js'
import { localMonth, localToday } from '../lib/dates.js'
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
  // Local draft while editing: the field can be cleared and retyped freely;
  // the value commits on blur (Enter blurs via the global handler in main.jsx).
  const [draft, setDraft] = useState(null)
  const commit = () => {
    if (draft === null) return
    if (draft !== String(value ?? '')) onChange(draft)
    setDraft(null)
  }
  return (
    <span className="nowrap">
      <span className="input-money" style={{ width: 104, display: 'inline-flex' }}>
        <input
          type="number"
          inputMode="decimal"
          placeholder="—"
          value={draft ?? value ?? ''}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
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
  const thisMonth = localMonth()
  const [month, setMonth] = useState(thisMonth)
  const [newCat, setNewCat] = useState('')
  const [sinkForm, setSinkForm] = useState({ name: '', monthlyAmount: '' })
  const [armedId, setArmedId] = useState(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [move, setMove] = useState({ from: '', to: '', amt: '' })

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
    // Union of template + effective categories, so a category zeroed this
    // month is also removed from the default instead of resurrecting.
    const cats = new Set([...Object.keys(state.budgets || {}), ...Object.keys(budgets)])
    for (const cat of cats) dispatch({ type: 'SET_BUDGET', payload: { category: cat, amount: budgets[cat] ?? 0 } })
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

  // Move money between envelopes for this month (YNAB's "cover overspending").
  const applyMove = () => {
    const amt = parseFloat(move.amt)
    if (!amt || amt <= 0 || !move.from || !move.to || move.from === move.to) return
    setBudget(move.from, Math.max(0, (budgets[move.from] || 0) - amt))
    setBudget(move.to, (budgets[move.to] || 0) + amt)
    toast(`Moved ${fmt(amt)} from ${move.from} to ${move.to} for ${monthLabel}`, { kind: 'good' })
    setMove({ from: '', to: '', amt: '' })
    setMoveOpen(false)
  }

  // Bills & subscriptions (Monarch-style recurring manager)
  const billPrefs = state.billPrefs || []
  const prefFor = m => billPrefs.find(p => p.merchant === m)
  const activeBills = recurring.filter(r => prefFor(r.merchant)?.status !== 'ignored')
  const ignoredBills = recurring.filter(r => prefFor(r.merchant)?.status === 'ignored')
  const setBillPref = (merchant, status) => dispatch({ type: 'SET_BILL_PREF', payload: { merchant, status } })
  const CADENCE_STEP = { weekly: 7, biweekly: 14, monthly: 30.44, annual: 365.25 }
  const nextDue = r => {
    const step = CADENCE_STEP[r.cadence]
    const todayD = new Date(localToday() + 'T00:00:00Z')
    let next = new Date(r.lastDate + 'T00:00:00Z')
    let guard = 0
    while (next < todayD && guard++ < 60) next = new Date(next.getTime() + step * 86400000)
    return next.toISOString().slice(0, 10)
  }
  const paidThisMonth = r =>
    state.transactions.some(t => t.amount < 0 && t.date?.startsWith(thisMonth) && normalizeMerchant(t.description) === r.merchant)

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
    const carry = sts.carry?.[cat] || 0
    const availBudget = b + carry // what the envelope really holds with rollover
    const s = spentByCat[cat] || 0
    if (!b && !carry && !s && !state.budgets?.[cat] && !sugg.byCat[cat]) return null
    const proj = showPace && isCurrent && b > 0 && s > 0 ? paceProjection(s, dayOfMonth, daysInMonth) : null
    const over = availBudget > 0 && s > availBudget
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
          {availBudget > 0 && (
            <div className="meter">
              <div className="meter-fill" style={{ width: `${Math.min(100, (s / availBudget) * 100)}%`, background: paceColor(s, availBudget) }} />
            </div>
          )}
        </td>
        <td className="num">{s > 0 ? fmt(s) : '—'}</td>
        <td className="num small" style={proj && proj > availBudget ? { color: 'var(--warning-text)', fontWeight: 600 } : undefined}>
          {proj !== null && Math.abs(proj - s) > 1 ? `→ ${fmt(proj)}` : ''}
        </td>
        <td className="num" style={over ? { color: 'var(--critical)', fontWeight: 600 } : undefined}>
          {availBudget > 0 ? (over ? `−${fmt(s - availBudget)}` : fmt(availBudget - s)) : ''}
          {carry > 0 && <div className="small muted money" style={{ fontWeight: 400 }}>incl. {fmt(carry)} carried</div>}
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
        <div className="row gap wrap" style={{ marginTop: 10 }}>
          <label className="check-pill" title="Leftover flexible budget carries into next month's envelope (YNAB-style). Overspending doesn't dig a hole — envelopes never carry negative.">
            <input
              type="checkbox"
              checked={Boolean(state.budgetConfig?.rollover)}
              onChange={e => dispatch({ type: 'SET_BUDGET_CONFIG', payload: { rollover: e.target.checked } })}
            />
            Roll leftover budgets into next month
          </label>
          {sts.flexCarry > 0 && (
            <span className="small muted money">{fmt(sts.flexCarry)} carried into {monthLabel} from earlier months</span>
          )}
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
      </div>

      {recurring.length > 0 && (
        <div className="card">
          <h2>
            <span className="icon-chip"><Icon name="calendar" /></span>
            Bills &amp; subscriptions
            <span className="badge">~{fmt(activeBills.reduce((s, r) => s + r.monthlyCost, 0))}/mo</span>
          </h2>
          <p className="muted small">
            Detected from your transaction history. Confirm the real ones so they're tracked; mark one-offs
            “not a bill” to drop them from Upcoming bills. Sanity-check your fixed budgets against this total.
          </p>
          <table className="table">
            <thead>
              <tr><th>Bill</th><th>Cadence</th><th>Next due</th><th className="num">~Monthly</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {activeBills.slice(0, 15).map(r => {
                const paid = paidThisMonth(r)
                const confirmed = prefFor(r.merchant)?.status === 'confirmed'
                return (
                  <tr key={r.merchant}>
                    <td>{r.merchant.toLowerCase()}</td>
                    <td className="small">{r.cadence} · {fmt(r.medianAmount, { maximumFractionDigits: 2 })}</td>
                    <td className="small nowrap">
                      {paid
                        ? <span className="delta-chip"><Icon name="check" size={11} /> paid this month</span>
                        : new Date(nextDue(r) + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="num">{fmt(r.monthlyCost)}</td>
                    <td>
                      {confirmed
                        ? <span className="badge">confirmed</span>
                        : <button className="chip" onClick={() => setBillPref(r.merchant, 'confirmed')}>Confirm</button>}
                    </td>
                    <td className="row-actions">
                      <button className="btn ghost small" onClick={() => setBillPref(r.merchant, 'ignored')}>Not a bill</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {activeBills.length > 15 && <p className="muted small">…and {activeBills.length - 15} more detected.</p>}
          {ignoredBills.length > 0 && (
            <details className="advanced">
              <summary>Ignored ({ignoredBills.length})</summary>
              <div className="chip-row" style={{ marginTop: 8 }}>
                {ignoredBills.map(r => (
                  <button key={r.merchant} className="chip" onClick={() => setBillPref(r.merchant, null)}
                    title="Restore to the bills list">
                    {r.merchant.toLowerCase()} <Icon name="x" size={11} />
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <div className="card">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h2>
            <span className="icon-chip"><Icon name="pie-chart" /></span>
            Flexible envelopes
            <span className="badge">{fmt(sts.flexBudgeted)}/mo planned</span>
          </h2>
          <button className="btn small" onClick={() => setMoveOpen(o => !o)} title="Shift budget between envelopes for this month">
            ⇄ Move money
          </button>
        </div>
        {moveOpen && (
          <div className="row gap wrap form-in" style={{ marginTop: 10, alignItems: 'center' }}>
            <select value={move.from} aria-label="Move from category" onChange={e => setMove(m => ({ ...m, from: e.target.value }))}>
              <option value="">From…</option>
              {flexCats.map(c => <option key={c} value={c}>{c} ({fmt(budgets[c] || 0)})</option>)}
            </select>
            <span aria-hidden>→</span>
            <select value={move.to} aria-label="Move to category" onChange={e => setMove(m => ({ ...m, to: e.target.value }))}>
              <option value="">To…</option>
              {flexCats.filter(c => c !== move.from).map(c => <option key={c} value={c}>{c} ({fmt(budgets[c] || 0)})</option>)}
            </select>
            <span className="input-money" style={{ width: 100 }}>
              <input type="number" inputMode="decimal" placeholder="0" value={move.amt}
                onChange={e => setMove(m => ({ ...m, amt: e.target.value }))} />
            </span>
            <button className="btn primary small" onClick={applyMove}
              disabled={!move.from || !move.to || !(parseFloat(move.amt) > 0)}>
              Move for {monthLabel.split(' ')[0]}
            </button>
          </div>
        )}
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
