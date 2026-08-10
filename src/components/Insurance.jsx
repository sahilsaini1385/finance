import React, { useState } from 'react'
import { useStore, uid, fmt } from '../store.jsx'
import { oopStatus } from '../lib/health.js'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

const POLICY_TYPES = ['health', 'dental', 'vision', 'life', 'ad&d', 'accident', 'critical illness', 'disability', 'auto', 'home', 'renters', 'umbrella', 'pet', 'other']
const FREQS = ['month', 'year']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const blank = {
  type: 'health', provider: '', policyName: '', coverageAmount: '',
  premium: '', premiumFreq: 'month', deductible: '', renewalDate: '', notes: '',
  // Health-plan design (shown only for type: health)
  oopMax: '', oopMaxIndividual: '', oonDeductible: '', oonOopMax: '',
  planYearStartMonth: '1', oopSpentManual: '',
}

// One-click prefills for common plan designs. Values come from the plan's
// official summary — always double-check against the current year's SPD.
const HEALTH_TEMPLATES = [
  {
    label: 'Amazon Premium Plan (Aetna) — family',
    fields: {
      type: 'health', provider: 'Aetna', policyName: 'Amazon Premium Plan — Employee + Family',
      deductible: '0', oopMax: '7500', oopMaxIndividual: '2500',
      oonDeductible: '3000', oonOopMax: '15000', planYearStartMonth: '1',
      notes: 'In-network: no deductible. Copays: PCP $30 · specialist $60 · urgent care $60 · ER $300 · labs $30 · x-ray $60 · complex imaging $90/test · inpatient $1,000/admission · ambulance $300/trip. Acupuncture/massage $60 (18 visits/yr combined). Out-of-network: 30% coinsurance after deductible. Preventive care 100%. Plan year = calendar year.',
    },
  },
]

function nextJanFirst() {
  const now = new Date()
  return `${now.getFullYear() + 1}-01-01`
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
        <button
          className="btn primary"
          onClick={() => {
            if (editingId) setShowForm(true) // switch edit → blank create, don't discard-and-close
            else setShowForm(s => !s)
            setEditingId(null)
            setForm(blank)
          }}
        >
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
          {form.type === 'health' && (
            <>
              <div className="span-2">
                <div className="row gap" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="small muted">Health plan details — deductible above is <strong>in-network</strong> (enter 0 if your plan has none). Prefill:</span>
                  {HEALTH_TEMPLATES.map(t => (
                    <button key={t.label} type="button" className="btn ghost small"
                      onClick={() => setForm(f => ({ ...f, ...t.fields, renewalDate: f.renewalDate || nextJanFirst() }))}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <label>OOP max (in-network, your tier)
                <span className="input-money">
                  <input type="number" step="1" inputMode="decimal" value={form.oopMax} onChange={e => set('oopMax', e.target.value)} placeholder="7500" />
                </span>
              </label>
              <label>OOP max (per person, embedded)
                <span className="input-money">
                  <input type="number" step="1" inputMode="decimal" value={form.oopMaxIndividual} onChange={e => set('oopMaxIndividual', e.target.value)} placeholder="2500" />
                </span>
              </label>
              <label>Out-of-network deductible
                <span className="input-money">
                  <input type="number" step="1" inputMode="decimal" value={form.oonDeductible} onChange={e => set('oonDeductible', e.target.value)} />
                </span>
              </label>
              <label>Out-of-network OOP max
                <span className="input-money">
                  <input type="number" step="1" inputMode="decimal" value={form.oonOopMax} onChange={e => set('oonOopMax', e.target.value)} />
                </span>
              </label>
              <label>Plan year starts
                <select value={form.planYearStartMonth} onChange={e => set('planYearStartMonth', e.target.value)}>
                  {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
                </select>
              </label>
              <label>OOP paid so far (from insurer portal)
                <span className="input-money">
                  <input type="number" step="0.01" inputMode="decimal" value={form.oopSpentManual} onChange={e => set('oopSpentManual', e.target.value)} placeholder="blank = auto-track" />
                </span>
              </label>
            </>
          )}
          <label className="span-2">Notes
            <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="e.g. through employer, includes spouse" />
          </label>
          <div className="form-actions">
            <button className="btn primary" type="submit">{editingId ? 'Save changes' : 'Add policy'}</button>
            <button className="btn" type="button" onClick={() => { setEditingId(null); setShowForm(false); setForm(blank) }}>Cancel</button>
          </div>
        </form>
      )}

      {state.insurance.filter(p => p.type === 'health').map(p => {
        const s = oopStatus(state, p)
        if (!s) return null
        const startLabel = new Date(s.planYearStart + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
        return (
          <div className="card" key={`oop-${p.id}`}>
            <h2>{p.provider || 'Health plan'} — out-of-pocket progress</h2>
            <p className="small muted money" style={{ marginTop: 2 }}>
              <strong>{fmt(s.spent)}</strong> of {fmt(s.oopMax)} in-network out-of-pocket max
              {s.metOopMax
                ? ' — max reached: covered care is 100% paid for the rest of this plan year.'
                : ` · ${fmt(s.remaining)} to go`}
              {' '}· plan year since {startLabel}
            </p>
            <div className="meter" style={{ marginTop: 8 }}>
              <div
                className="meter-fill"
                style={{ width: `${Math.round(s.pct * 100)}%`, background: s.metOopMax ? 'var(--good)' : 'var(--accent)' }}
              />
            </div>
            {s.deductible > 0 && (
              <p className="small muted money">
                Deductible: {s.deductibleMet ? 'met' : `${fmt(Math.min(s.spent, s.deductible))} of ${fmt(s.deductible)}`}
              </p>
            )}
            <p className="small muted">
              {s.manual
                ? 'Using the figure you entered from your insurer’s portal — update it there as claims process.'
                : 'Estimated from Health-category spending this plan year. Copays and bills paid by card land here automatically; for the exact accumulator, enter “OOP paid so far” from your insurer’s portal on this policy.'}
              {parseFloat(p.oopMaxIndividual) > 0 && ` No single family member pays more than ${fmt(p.oopMaxIndividual)} (embedded individual max).`}
            </p>
          </div>
        )
      })}

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
                    <button className="btn ghost small" onClick={() => { setEditingId(p.id); setShowForm(true); const { id: _id, ...rest } = p; setForm({ ...blank, ...rest }) }}>Edit</button>
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
