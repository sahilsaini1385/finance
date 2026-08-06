import React, { useState } from 'react'
import { useStore, uid, fmt } from '../store.jsx'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

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
  const toast = useToast()
  const [form, setForm] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [armedId, setArmedId] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = e => {
    e.preventDefault()
    if (!form.name.trim()) return
    if (editingId) {
      dispatch({ type: 'UPDATE_BENEFIT', payload: { ...form, id: editingId } })
      setEditingId(null)
      toast('Benefit updated', { kind: 'good' })
    } else {
      dispatch({ type: 'ADD_BENEFIT', payload: { ...form, id: uid() } })
      toast('Benefit added', { kind: 'good' })
    }
    setForm(blank)
    setShowForm(false)
  }

  const remove = b => {
    if (armedId !== b.id) {
      setArmedId(b.id)
      setTimeout(() => setArmedId(cur => (cur === b.id ? null : cur)), 3000)
      return
    }
    dispatch({ type: 'DELETE_BENEFIT', payload: b.id })
    setArmedId(null)
    toast('Benefit deleted')
  }

  const totalValue = state.benefits.reduce((s, b) => s + (parseFloat(b.annualValue) || 0), 0)
  const notEnrolled = state.benefits.filter(b => b.enrolled === 'no')

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Benefits</h1>
          <p className="muted small money">
            Estimated annual value on record: <strong>{fmt(totalValue)}</strong>
          </p>
        </div>
        <button className="btn primary" onClick={() => { setShowForm(s => !s); setEditingId(null); setForm(blank) }}>
          <Icon name="plus" size={14} /> Add benefit
        </button>
      </div>

      {notEnrolled.length > 0 && (
        <div className="alert warning">
          <span className="alert-icon"><Icon name="alert-triangle" size={15} /></span>
          <div><strong>Not enrolled:</strong> {notEnrolled.map(b => b.name).join(', ')} — review at the next open enrollment.</div>
        </div>
      )}

      {(showForm || editingId) && (
        <form className="card form-grid form-in" onSubmit={submit}>
          <label>Benefit name
            <input autoFocus value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Fidelity 401(k), Cigna PPO" required />
          </label>
          <label>Type
            <select value={form.type} onChange={e => set('type', e.target.value)}>
              {BENEFIT_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>Provider
            <input value={form.provider} onChange={e => set('provider', e.target.value)} placeholder="e.g. Fidelity" />
          </label>
          <label>Estimated annual value
            <span className="input-money">
              <input type="number" step="1" inputMode="decimal" value={form.annualValue} onChange={e => set('annualValue', e.target.value)} placeholder="match dollars, subsidy…" />
            </span>
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
            <button className="btn" type="button" onClick={() => { setEditingId(null); setShowForm(false); setForm(blank) }}>Cancel</button>
          </div>
        </form>
      )}

      {state.benefits.length === 0 && !showForm ? (
        <div className="card">
          <div className="empty">
            <Icon name="gift" />
            <strong>No benefits tracked yet</strong>
            <span className="small">Log everything your employer offers — enrolled or not — so nothing goes unused at open enrollment.</span>
            <button className="btn primary" onClick={() => setShowForm(true)}><Icon name="plus" size={14} /> Add benefit</button>
          </div>
        </div>
      ) : state.benefits.length > 0 && (
        <div className="card">
          <table className="table">
            <thead>
              <tr><th>Benefit</th><th>Type</th><th>Provider</th><th className="num">Annual value</th><th>Enrolled</th><th>Notes</th><th></th></tr>
            </thead>
            <tbody>
              {state.benefits.map(b => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td className="small">{b.type}</td>
                  <td className="small">{b.provider || '—'}</td>
                  <td className="num">{fmt(b.annualValue)}</td>
                  <td>{b.enrolled === 'yes' ? <Icon name="check" size={14} /> : <span className="small muted">No</span>}</td>
                  <td className="desc small">{b.notes || '—'}</td>
                  <td className="row-actions">
                    <button className="btn ghost small" onClick={() => { setEditingId(b.id); setShowForm(true); setForm({ name: b.name, type: b.type, provider: b.provider, annualValue: b.annualValue, enrolled: b.enrolled, notes: b.notes }) }}>Edit</button>
                    <button className={armedId === b.id ? 'btn danger small armed' : 'btn danger small'} onClick={() => remove(b)}>
                      {armedId === b.id ? 'Confirm?' : 'Delete'}
                    </button>
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
