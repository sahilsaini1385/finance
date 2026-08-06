import React, { useState } from 'react'
import { useStore, uid, fmt } from '../store.jsx'

const BENEFIT_TYPES = [
  '401(k) / 403(b)',
  'Employer match',
  'HSA',
  'FSA (health)',
  'FSA (dependent care)',
  'ESPP',
  'RSU / equity',
  'Health plan',
  'Dental plan',
  'Vision plan',
  'Life insurance (employer)',
  'Disability (employer)',
  'Commuter benefit',
  'Tuition assistance',
  'Wellness stipend',
  'PTO / leave',
  'Other',
]

const blank = { name: '', type: '401(k) / 403(b)', provider: '', annualValue: '', enrolled: 'yes', notes: '' }

export default function Benefits() {
  const { state, dispatch } = useStore()
  const [form, setForm] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = e => {
    e.preventDefault()
    if (!form.name.trim()) return
    if (editingId) {
      dispatch({ type: 'UPDATE_BENEFIT', payload: { ...form, id: editingId } })
      setEditingId(null)
    } else {
      dispatch({ type: 'ADD_BENEFIT', payload: { ...form, id: uid() } })
    }
    setForm(blank)
  }

  const totalValue = state.benefits.reduce((s, b) => s + (parseFloat(b.annualValue) || 0), 0)
  const notEnrolled = state.benefits.filter(b => b.enrolled === 'no')

  return (
    <div className="page">
      <h1>Benefits</h1>
      <p className="muted">
        Track everything your employer offers — enrolled or not — so nothing is left unused during open
        enrollment. Estimated annual value on record: <strong>{fmt(totalValue)}</strong>.
      </p>

      {notEnrolled.length > 0 && (
        <div className="alert warning">
          <span className="alert-icon" aria-hidden>⚠️</span>
          <div><strong>Not enrolled:</strong> {notEnrolled.map(b => b.name).join(', ')} — review at the next open enrollment.</div>
        </div>
      )}

      <form className="card form-grid" onSubmit={submit}>
        <label>Benefit name
          <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Fidelity 401(k), Cigna PPO" required />
        </label>
        <label>Type
          <select value={form.type} onChange={e => set('type', e.target.value)}>
            {BENEFIT_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>Provider
          <input value={form.provider} onChange={e => set('provider', e.target.value)} placeholder="e.g. Fidelity" />
        </label>
        <label>Estimated annual value ($)
          <input type="number" step="1" value={form.annualValue} onChange={e => set('annualValue', e.target.value)} placeholder="e.g. match dollars, premium subsidy" />
        </label>
        <label>Enrolled?
          <select value={form.enrolled} onChange={e => set('enrolled', e.target.value)}>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label className="span-2">Notes
          <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="e.g. 100% match up to 4%, vests over 3 years" />
        </label>
        <div className="form-actions">
          <button className="btn primary" type="submit">{editingId ? 'Save changes' : 'Add benefit'}</button>
          {editingId && <button className="btn" type="button" onClick={() => { setEditingId(null); setForm(blank) }}>Cancel</button>}
        </div>
      </form>

      {state.benefits.length > 0 && (
        <div className="card">
          <table className="table">
            <thead>
              <tr><th>Benefit</th><th>Type</th><th>Provider</th><th className="num">Annual value</th><th>Enrolled</th><th>Notes</th><th></th></tr>
            </thead>
            <tbody>
              {state.benefits.map(b => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>{b.type}</td>
                  <td>{b.provider || '—'}</td>
                  <td className="num">{fmt(b.annualValue)}</td>
                  <td>{b.enrolled === 'yes' ? '✓' : '✗'}</td>
                  <td className="desc">{b.notes || '—'}</td>
                  <td className="row-actions">
                    <button className="btn small" onClick={() => { setEditingId(b.id); setForm({ name: b.name, type: b.type, provider: b.provider, annualValue: b.annualValue, enrolled: b.enrolled, notes: b.notes }) }}>Edit</button>
                    <button className="btn small danger" onClick={() => dispatch({ type: 'DELETE_BENEFIT', payload: b.id })}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
