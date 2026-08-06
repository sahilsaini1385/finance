import React, { useState } from 'react'
import { useStore, uid, fmt } from '../store.jsx'

const INSTITUTIONS = ['Fidelity', 'Chase', 'Bank of America', 'Other']
const TYPES = ['checking', 'savings', 'credit card', 'brokerage', 'retirement', 'hsa', '529', 'loan', 'mortgage', 'other']

const blank = { name: '', institution: 'Fidelity', type: 'checking', balance: '' }

export default function Accounts() {
  const { state, dispatch } = useStore()
  const [form, setForm] = useState(blank)
  const [editingId, setEditingId] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = e => {
    e.preventDefault()
    if (!form.name.trim()) return
    const payload = { ...form, balance: parseFloat(form.balance) || 0, updated: new Date().toISOString().slice(0, 10) }
    if (editingId) {
      dispatch({ type: 'UPDATE_ACCOUNT', payload: { ...payload, id: editingId } })
      setEditingId(null)
    } else {
      dispatch({ type: 'ADD_ACCOUNT', payload: { ...payload, id: uid() } })
    }
    setForm(blank)
  }

  const edit = a => {
    setEditingId(a.id)
    setForm({ name: a.name, institution: a.institution, type: a.type, balance: String(a.balance) })
  }

  const byInstitution = INSTITUTIONS.map(inst => [inst, state.accounts.filter(a => a.institution === inst)])

  return (
    <div className="page">
      <h1>Accounts</h1>
      <p className="muted">
        Track every account across Fidelity, Chase, and Bank of America. For debts (credit cards, loans,
        mortgages) enter the amount owed as a positive number — it's treated as a liability automatically.
      </p>

      <form className="card form-grid" onSubmit={submit}>
        <label>Account name
          <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Chase Freedom, Fidelity 401(k)" required />
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
        <label>Current balance ($)
          <input type="number" step="0.01" value={form.balance} onChange={e => set('balance', e.target.value)} placeholder="0.00" />
        </label>
        <div className="form-actions">
          <button className="btn primary" type="submit">{editingId ? 'Save changes' : 'Add account'}</button>
          {editingId && <button className="btn" type="button" onClick={() => { setEditingId(null); setForm(blank) }}>Cancel</button>}
        </div>
      </form>

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
                  <td>{a.name}</td>
                  <td>{a.type}</td>
                  <td className="num">{fmt(a.balance, { maximumFractionDigits: 2 })}</td>
                  <td>{a.updated}</td>
                  <td className="row-actions">
                    <button className="btn small" onClick={() => edit(a)}>Edit</button>
                    <button className="btn small danger" onClick={() => {
                      if (confirm(`Delete "${a.name}" and its transactions?`)) dispatch({ type: 'DELETE_ACCOUNT', payload: a.id })
                    }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
