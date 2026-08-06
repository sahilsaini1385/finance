import React, { useState } from 'react'
import { useStore, uid, fmt } from '../store.jsx'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

const POLICY_TYPES = ['health', 'dental', 'vision', 'life', 'disability', 'auto', 'home', 'renters', 'umbrella', 'pet', 'other']
const FREQS = ['month', 'year']

const blank = {
  type: 'health', provider: '', policyName: '', coverageAmount: '',
  premium: '', premiumFreq: 'month', deductible: '', renewalDate: '', notes: '',
}

export default function Insurance() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [form, setForm] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [armedId, setArmedId] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = e => {
    e.preventDefault()
    if (!form.provider.trim() && !form.policyName.trim()) return
    if (editingId) {
      dispatch({ type: 'UPDATE_INSURANCE', payload: { ...form, id: editingId } })
      setEditingId(null)
      toast('Policy updated', { kind: 'good' })
    } else {
      dispatch({ type: 'ADD_INSURANCE', payload: { ...form, id: uid() } })
      toast('Policy added', { kind: 'good' })
    }
    setForm(blank)
    setShowForm(false)
  }

  const remove = p => {
    if (armedId !== p.id) {
      setArmedId(p.id)
      setTimeout(() => setArmedId(cur => (cur === p.id ? null : cur)), 3000)
      return
    }
    dispatch({ type: 'DELETE_INSURANCE', payload: p.id })
    setArmedId(null)
    toast('Policy deleted')
  }

  const annualPremiums = state.insurance.reduce((s, p) => {
    const prem = parseFloat(p.premium) || 0
    return s + (p.premiumFreq === 'month' ? prem * 12 : prem)
  }, 0)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Insurance</h1>
          <p className="muted small money">
            Total annual premiums: <strong>{fmt(annualPremiums)}</strong> · the Advisor checks coverage against your estimated needs.
          </p>
        </div>
        <button className="btn primary" onClick={() => { setShowForm(s => !s); setEditingId(null); setForm(blank) }}>
          <Icon name="plus" size={14} /> Add policy
        </button>
      </div>

      {(showForm || editingId) && (
        <form className="card form-grid form-in" onSubmit={submit}>
          <label>Policy type
            <select autoFocus value={form.type} onChange={e => set('type', e.target.value)}>
              {POLICY_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>Provider
            <input value={form.provider} onChange={e => set('provider', e.target.value)} placeholder="e.g. Geico, MetLife, Aetna" />
          </label>
          <label>Policy name / number
            <input value={form.policyName} onChange={e => set('policyName', e.target.value)} placeholder="e.g. Term 20 #12345" />
          </label>
          <label>Coverage amount
            <span className="input-money">
              <input type="number" step="1" inputMode="decimal" value={form.coverageAmount} onChange={e => set('coverageAmount', e.target.value)} placeholder="500000" />
            </span>
          </label>
          <label>Premium
            <span className="input-money">
              <input type="number" step="0.01" inputMode="decimal" value={form.premium} onChange={e => set('premium', e.target.value)} />
            </span>
          </label>
          <label>Premium frequency
            <select value={form.premiumFreq} onChange={e => set('premiumFreq', e.target.value)}>
              {FREQS.map(f => <option key={f}>{f}</option>)}
            </select>
          </label>
          <label>Deductible
            <span className="input-money">
              <input type="number" step="1" inputMode="decimal" value={form.deductible} onChange={e => set('deductible', e.target.value)} />
            </span>
          </label>
          <label>Renewal date
            <input type="date" value={form.renewalDate} onChange={e => set('renewalDate', e.target.value)} />
          </label>
          <label className="span-2">Notes
            <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="e.g. through employer, includes spouse" />
          </label>
          <div className="form-actions">
            <button className="btn primary" type="submit">{editingId ? 'Save changes' : 'Add policy'}</button>
            <button className="btn" type="button" onClick={() => { setEditingId(null); setShowForm(false); setForm(blank) }}>Cancel</button>
          </div>
        </form>
      )}

      {state.insurance.length === 0 && !showForm ? (
        <div className="card">
          <div className="empty">
            <Icon name="shield" />
            <strong>No policies tracked yet</strong>
            <span className="small">Track coverage, premiums, deductibles and renewal dates — renewals within 45 days get a re-shop reminder.</span>
            <button className="btn primary" onClick={() => setShowForm(true)}><Icon name="plus" size={14} /> Add policy</button>
          </div>
        </div>
      ) : state.insurance.length > 0 && (
        <div className="card">
          <table className="table">
            <thead>
              <tr><th>Type</th><th>Provider</th><th>Policy</th><th className="num">Coverage</th><th className="num">Premium</th><th className="num">Deductible</th><th>Renews</th><th></th></tr>
            </thead>
            <tbody>
              {state.insurance.map(p => (
                <tr key={p.id}>
                  <td>{p.type}</td>
                  <td>{p.provider || '—'}</td>
                  <td className="desc small">{p.policyName || '—'}</td>
                  <td className="num">{fmt(p.coverageAmount)}</td>
                  <td className="num">{fmt(p.premium)} / {p.premiumFreq}</td>
                  <td className="num">{fmt(p.deductible)}</td>
                  <td className="small">{p.renewalDate || '—'}</td>
                  <td className="row-actions">
                    <button className="btn ghost small" onClick={() => { setEditingId(p.id); setShowForm(true); setForm({ type: p.type, provider: p.provider, policyName: p.policyName, coverageAmount: p.coverageAmount, premium: p.premium, premiumFreq: p.premiumFreq, deductible: p.deductible, renewalDate: p.renewalDate, notes: p.notes }) }}>Edit</button>
                    <button className={armedId === p.id ? 'btn danger small armed' : 'btn danger small'} onClick={() => remove(p)}>
                      {armedId === p.id ? 'Confirm?' : 'Delete'}
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
