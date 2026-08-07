import React, { useState } from 'react'
import { useStore, uid, fmt } from '../store.jsx'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

const blank = { name: '', target: '', targetDate: '', accountIds: [], note: '' }

function monthsUntil(dateStr) {
  if (!dateStr) return null
  const now = new Date()
  const d = new Date(dateStr)
  return Math.max(0, (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth())
}

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
    const payload = { ...form, target: parseFloat(form.target) }
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
        <button className="btn primary" onClick={() => { setShowForm(s => !s); setEditingId(null); setForm(blank) }}>
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
          const saved = balanceOf(g.accountIds || [])
          const pct = g.target > 0 ? Math.min(100, (saved / g.target) * 100) : 0
          const done = saved >= g.target
          const months = monthsUntil(g.targetDate)
          const monthlyNeeded = months > 0 && !done ? (g.target - saved) / months : null
          return (
            <div className="card" key={g.id}>
              <div className="page-head" style={{ marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>
                  {done ? <Icon name="check-circle" size={15} /> : <Icon name="target" size={15} />}
                  {g.name}
                </h2>
                <div className="row gap">
                  <button className="btn ghost small" onClick={() => { setEditingId(g.id); setShowForm(true); setForm({ name: g.name, target: String(g.target), targetDate: g.targetDate || '', accountIds: g.accountIds || [], note: g.note || '' }) }}>Edit</button>
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
                {(g.accountIds || []).length === 0
                  ? 'No accounts linked — edit the goal to link funding accounts.'
                  : `Funded by ${(g.accountIds || []).length} account${g.accountIds.length > 1 ? 's' : ''}`}
                {g.targetDate && !done && months !== null && (
                  <> · {months} months to {g.targetDate}{monthlyNeeded ? ` — needs ${fmt(monthlyNeeded)}/mo` : ''}</>
                )}
                {g.note && <> · {g.note}</>}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
