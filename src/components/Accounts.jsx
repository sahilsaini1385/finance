import React, { useState } from 'react'
import { useStore, uid, fmt, fmtCents } from '../store.jsx'
import { suggestAccountType } from '../lib/simplefin.js'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

const INSTITUTIONS = ['Fidelity', 'Chase', 'Bank of America', 'Other']
const TYPES = ['checking', 'savings', 'credit card', 'brokerage', 'retirement', 'hsa', '529', 'loan', 'mortgage', 'other']
const DEBT_TYPES = ['credit card', 'loan', 'mortgage']

const blank = { name: '', institution: 'Fidelity', type: 'checking', balance: '', excludeFromNetWorth: false }

export default function Accounts() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [form, setForm] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [armedId, setArmedId] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = e => {
    e.preventDefault()
    if (!form.name.trim()) return
    const payload = { ...form, balance: parseFloat(form.balance) || 0, excludeFromNetWorth: Boolean(form.excludeFromNetWorth), updated: new Date().toISOString().slice(0, 10) }
    if (editingId) {
      dispatch({ type: 'UPDATE_ACCOUNT', payload: { ...payload, id: editingId } })
      setEditingId(null)
      toast('Account updated', { kind: 'good' })
    } else {
      dispatch({ type: 'ADD_ACCOUNT', payload: { ...payload, id: uid() } })
      toast('Account added', { kind: 'good' })
    }
    setForm(blank)
    setShowForm(false)
  }

  const edit = a => {
    setEditingId(a.id)
    setShowForm(true)
    setForm({ name: a.name, institution: a.institution, type: a.type, balance: String(a.balance), excludeFromNetWorth: Boolean(a.excludeFromNetWorth) })
  }

  const remove = a => {
    if (armedId !== a.id) {
      setArmedId(a.id)
      setTimeout(() => setArmedId(cur => (cur === a.id ? null : cur)), 3000)
      return
    }
    dispatch({ type: 'DELETE_ACCOUNT', payload: a.id })
    setArmedId(null)
    toast('Account deleted')
  }

  // Type audit — accounts typed as cash whose names say "investment". Mistyped
  // accounts inflate Cash and understate Investments on the Overview.
  const suggestions = state.accounts
    .filter(a => !a.typeSuggestionDismissed && !a.bucket) // a pinned bucket is an explicit placement — don't second-guess it
    .map(a => ({ account: a, to: suggestAccountType(a) }))
    .filter(s => s.to)
  const applySuggestion = s => {
    dispatch({ type: 'UPDATE_ACCOUNT', payload: { id: s.account.id, type: s.to } })
    toast(`${s.account.name} → ${s.to}`, { kind: 'good' })
  }
  const dismissSuggestion = s =>
    dispatch({ type: 'UPDATE_ACCOUNT', payload: { id: s.account.id, typeSuggestionDismissed: true } })

  const totalAssets = state.accounts.filter(a => !DEBT_TYPES.includes(a.type)).reduce((s, a) => s + (parseFloat(a.balance) || 0), 0)
  const totalDebt = state.accounts.filter(a => DEBT_TYPES.includes(a.type)).reduce((s, a) => s + Math.abs(parseFloat(a.balance) || 0), 0)
  const byInstitution = INSTITUTIONS.map(inst => [inst, state.accounts.filter(a => a.institution === inst)])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Accounts</h1>
          {state.accounts.length > 0 && (
            <p className="muted small money">
              Total assets {fmt(totalAssets)} · Total debt {fmt(totalDebt)}
            </p>
          )}
        </div>
        <button
          className="btn primary"
          onClick={() => {
            if (editingId) setShowForm(true) // switch edit → blank create, don't discard-and-close
            else setShowForm(s => !s)
            setEditingId(null)
            setForm(blank)
          }}
        >
          <Icon name="plus" size={14} /> Add account
        </button>
      </div>

      {suggestions.length > 0 && (
        <div className="card">
          <h2><span className="icon-chip"><Icon name="lightbulb" /></span> These look like investment accounts</h2>
          <p className="muted small">
            They're typed as cash right now, which inflates the Cash number on your Overview. One click
            moves each to where it belongs — retirement (401(k)/IRA/Roth) stays separate from taxable investments.
          </p>
          <table className="table">
            <tbody>
              {suggestions.map(s => (
                <tr key={s.account.id}>
                  <td>{s.account.institution} · {s.account.name}</td>
                  <td className="small muted">{s.account.type} → <strong>{s.to}</strong></td>
                  <td className="num">{fmt(parseFloat(s.account.balance) || 0)}</td>
                  <td className="row-actions">
                    <button className="btn primary small" onClick={() => applySuggestion(s)}>Change to {s.to}</button>
                    <button className="btn ghost small" onClick={() => dismissSuggestion(s)} title="It really is a cash account — don't ask again">Keep as is</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {suggestions.length > 1 && (
            <div className="row-actions" style={{ marginTop: 8 }}>
              <button className="btn small" onClick={() => suggestions.forEach(applySuggestion)}>Apply all {suggestions.length}</button>
            </div>
          )}
        </div>
      )}

      {(showForm || editingId) && (
        <form className="card form-grid form-in" onSubmit={submit}>
          {editingId && <div className="span-2 small muted">Editing: {form.name}</div>}
          <label>Account name
            <input autoFocus value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Chase Freedom, Fidelity 401(k)" required />
          </label>
          <label>Institution
            <select value={form.institution} onChange={e => set('institution', e.target.value)}>
              {INSTITUTIONS.map(i => <option key={i}>{i}</option>)}
            </select>
          </label>
          <label>Type
            <select value={form.type} onChange={e => set('type', e.target.value)}>
              {TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>Current balance
            <span className="input-money">
              <input type="number" step="0.01" inputMode="decimal" value={form.balance} onChange={e => set('balance', e.target.value)} placeholder="0.00" />
            </span>
          </label>
          <label className="span-2 check-pill" style={{ justifySelf: 'start' }}>
            <input
              type="checkbox"
              checked={Boolean(form.excludeFromNetWorth)}
              onChange={e => set('excludeFromNetWorth', e.target.checked)}
            />
            Exclude from net worth — for money that isn't yours yet (unvested RSUs, a 529 you manage for someone else)
          </label>
          <div className="form-actions">
            <button className="btn primary" type="submit">{editingId ? 'Save changes' : 'Add account'}</button>
            <button className="btn" type="button" onClick={() => { setEditingId(null); setShowForm(false); setForm(blank) }}>Cancel</button>
          </div>
          <p className="span-2 small muted" style={{ margin: 0 }}>
            For debts (credit cards, loans, mortgages) enter the amount owed as a positive number — it's treated as a liability automatically.
          </p>
        </form>
      )}

      {state.accounts.length === 0 && !showForm && (
        <div className="card">
          <div className="empty">
            <Icon name="landmark" />
            <strong>No accounts yet</strong>
            <span className="small">Add your Fidelity, Chase, and Bank of America accounts to see your full picture.</span>
            <button className="btn primary" onClick={() => setShowForm(true)}><Icon name="plus" size={14} /> Add account</button>
          </div>
        </div>
      )}

      {byInstitution.map(([inst, accts]) => accts.length > 0 && (
        <div className="card" key={inst}>
          <h2>{inst}</h2>
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Type</th><th className="num">Balance</th><th>Updated</th><th></th></tr>
            </thead>
            <tbody>
              {accts.map(a => (
                <tr key={a.id}>
                  <td>
                    {a.name}
                    {a.excludeFromNetWorth && <span className="badge" style={{ marginLeft: 6 }} title="Tracked here, but not counted in your net worth">not in net worth</span>}
                    {!a.excludeFromNetWorth && a.bucket && <span className="badge" style={{ marginLeft: 6 }} title="Pinned to this net-worth bucket from the Overview — the account type no longer decides">counts as {a.bucket}</span>}
                  </td>
                  <td>{a.type}</td>
                  <td className="num">{fmtCents(a.balance)}</td>
                  <td className="small">{a.updated}</td>
                  <td className="row-actions">
                    <button className="btn ghost small" onClick={() => edit(a)}>Edit</button>
                    <button
                      className={armedId === a.id ? 'btn danger small armed' : 'btn danger small'}
                      onClick={() => remove(a)}
                    >
                      {armedId === a.id ? 'Confirm delete?' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Subtotal</td>
                <td></td>
                <td className="num">{fmtCents(accts.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0))}</td>
                <td></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}
    </div>
  )
}
