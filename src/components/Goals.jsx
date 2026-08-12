import React, { useState } from 'react'
import { useStore, uid, fmt } from '../store.jsx'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

import { goalPace } from '../lib/goals.js'

const blank = { name: '', target: '', targetDate: '', accountIds: [], note: '', returnPct: '' }

export default function Goals() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [form, setForm] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [armedId, setArmedId] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const balanceOf = ids =>
    state.accounts.filter(a => ids.includes(a.id)).reduce((s, a) => s + (parseFloat(a.balance) || 0), 0)

  const toggleAccount = id =>
    set('accountIds', form.accountIds.includes(id) ? form.accountIds.filter(x => x !== id) : [...form.accountIds, id])

  const submit = e => {
    e.preventDefault()
    if (!form.name.trim() || !parseFloat(form.target)) return
    const payload = { ...form, target: parseFloat(form.target), returnPct: parseFloat(form.returnPct) || 0 }
    if (editingId) {
      dispatch({ type: 'UPDATE_GOAL', payload: { ...payload, id: editingId } })
      setEditingId(null)
      toast('Goal updated', { kind: 'good' })
    } else {
      dispatch({ type: 'ADD_GOAL', payload: { ...payload, id: uid() } })
      toast('Goal added', { kind: 'good' })
    }
    setForm(blank)
    setShowForm(false)
  }

  const remove = g => {
    if (armedId !== g.id) {
      setArmedId(g.id)
      setTimeout(() => setArmedId(cur => (cur === g.id ? null : cur)), 3000)
      return
    }
    dispatch({ type: 'DELETE_GOAL', payload: g.id })
    setArmedId(null)
    toast('Goal deleted')
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Goals</h1>
          <p className="muted small">Link accounts to a target and watch it fund itself.</p>
        </div>
        <button
          className="btn primary"
          onClick={() => {
            // While editing, "Add" switches to a blank create form instead of
            // silently closing the form and discarding the edit.
            if (editingId) setShowForm(true)
            else setShowForm(s => !s)
            setEditingId(null)
            setForm(blank)
          }}
        >
          <Icon name="plus" size={14} /> Add goal
        </button>
      </div>

      {(showForm || editingId) && (
        <form className="card form-grid form-in" onSubmit={submit}>
          <label>Goal name
            <input autoFocus value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Emergency fund, House down payment" required />
          </label>
          <label>Target amount
            <span className="input-money">
              <input type="number" inputMode="decimal" value={form.target} onChange={e => set('target', e.target.value)} placeholder="20000" required />
            </span>
          </label>
          <label>Target date (optional)
            <input type="date" value={form.targetDate} onChange={e => set('targetDate', e.target.value)} />
          </label>
          <label>Expected annual return %
            <input
              type="number" inputMode="decimal" step="0.5" min="0" max="15"
              value={form.returnPct} onChange={e => set('returnPct', e.target.value)}
              placeholder="0 = cash · invested ≈ 5–7"
            />
          </label>
          <label className="span-2">Note
            <input value={form.note} onChange={e => set('note', e.target.value)} placeholder="optional" />
          </label>
          <div className="span-2">
            <div className="small" style={{ marginBottom: 6, color: 'var(--text-2)', fontWeight: 500 }}>Funded by</div>
            {state.accounts.length === 0 ? (
              <p className="muted small">Add accounts first — goals track their combined balance.</p>
            ) : (
              <div className="row gap wrap">
                {state.accounts.map(a => (
                  <label key={a.id} className="check-pill">
                    <input
                      type="checkbox"
                      checked={form.accountIds.includes(a.id)}
                      onChange={() => toggleAccount(a.id)}
                    />
                    {a.institution} · {a.name}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="form-actions">
            <button className="btn primary" type="submit">{editingId ? 'Save changes' : 'Add goal'}</button>
            <button className="btn" type="button" onClick={() => { setEditingId(null); setShowForm(false); setForm(blank) }}>Cancel</button>
          </div>
        </form>
      )}

      {state.goals.length === 0 && !showForm ? (
        <div className="card">
          <div className="empty">
            <Icon name="target" />
            <strong>No goals yet</strong>
            <span className="small">Classic first goal: an emergency fund of 3–6 months of expenses, funded by your savings account.</span>
            <button className="btn primary" onClick={() => setShowForm(true)}><Icon name="plus" size={14} /> Add goal</button>
          </div>
        </div>
      ) : (
        state.goals.map(g => {
          // One source of truth for all goal math (incl. the growth assumption).
          const p = goalPace(state, g)
          const saved = p.saved
          const pct = g.target > 0 ? Math.min(100, (saved / g.target) * 100) : 0
          const done = saved >= g.target
          const months = p.monthsLeft
          const monthlyNeeded = p.neededMonthly
          const linkedCount = (g.accountIds || []).filter(id => state.accounts.some(a => a.id === id)).length
          return (
            <div className="card" key={g.id}>
              <div className="page-head" style={{ marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>
                  {done ? <Icon name="check-circle" size={15} /> : <Icon name="target" size={15} />}
                  {g.name}
                </h2>
                <div className="row gap">
                  <button className="btn ghost small" onClick={() => { setEditingId(g.id); setShowForm(true); setForm({ name: g.name, target: String(g.target), targetDate: g.targetDate || '', accountIds: g.accountIds || [], note: g.note || '', returnPct: g.returnPct ? String(g.returnPct) : '' }) }}>Edit</button>
                  <button className={armedId === g.id ? 'btn danger small armed' : 'btn danger small'} onClick={() => remove(g)}>
                    {armedId === g.id ? 'Confirm?' : 'Delete'}
                  </button>
                </div>
              </div>
              <div className="goal-numbers money">
                <strong>{fmt(saved)}</strong>
                <span className="muted"> of {fmt(g.target)} · {pct.toFixed(0)}%</span>
                {done && <span className="delta-chip" style={{ verticalAlign: 1 }}>Funded 🎉</span>}
              </div>
              <div className="meter" style={{ marginTop: 8 }}>
                <div className="meter-fill" style={{ width: `${pct}%`, background: done ? 'var(--good)' : 'var(--accent)' }} />
              </div>
              <div className="muted small" style={{ marginTop: 8 }}>
                {linkedCount === 0
                  ? 'No accounts linked — edit the goal to link funding accounts.'
                  : `Funded by ${linkedCount} account${linkedCount > 1 ? 's' : ''}`}
                {g.targetDate && !done && months !== null && (
                  <>
                    {' · '}{months} months to {g.targetDate}
                    {monthlyNeeded !== null && ` — needs ${fmt(monthlyNeeded)}/mo`}
                    {' '}<span title="Growth assumed on the current balance and future deposits. Edit the goal to change it.">
                      assuming {p.returnPct}% annual return{p.returnPct === 0 ? ' (cash)' : ''}
                    </span>
                  </>
                )}
                {g.note && <> · {g.note}</>}
              </div>
              {!done && (() => {
                if (p.status === 'no-data') {
                  return linkedCount > 0 ? (
                    <div className="muted small money" style={{ marginTop: 4 }}>
                      Pace unknown — the linked account{linkedCount > 1 ? 's have' : ' has'} no synced transactions yet.
                    </div>
                  ) : null
                }
                const paceText = p.pace > 0
                  ? `Adding ~${fmt(p.pace)}/mo (net, last 3 months)`
                  : p.pace < 0
                    ? `Net withdrawals of ~${fmt(-p.pace)}/mo over the last 3 months`
                    : 'No net deposits in the last 3 months'
                return (
                  <div className="small money" style={{ marginTop: 4 }}>
                    {p.status === 'on-track' && (
                      <span style={{ color: 'var(--good-text)', fontWeight: 600 }}>On track</span>
                    )}
                    {p.status === 'behind' && (
                      <span style={{ color: 'var(--warning-text)', fontWeight: 600 }}>Behind pace</span>
                    )}
                    {(p.status === 'on-track' || p.status === 'behind') && ' · '}
                    <span className="muted">
                      {paceText}
                      {p.status === 'behind' && p.neededMonthly !== null && ` — needs ${fmt(p.neededMonthly)}/mo for ${g.targetDate}`}
                      {p.etaLabel && (p.status === 'behind' || p.status === 'pacing') && ` · at this pace: ~${p.etaLabel}`}
                      {p.status === 'stalled' && ' — set up an automatic transfer to get moving'}
                    </span>
                  </div>
                )
              })()}
            </div>
          )
        })
      )}
    </div>
  )
}
