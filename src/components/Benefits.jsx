import React, { useMemo, useRef, useState } from 'react'
import { useStore, uid, fmt } from '../store.jsx'
import { parseBenefitsStatement, toAppEntities } from '../lib/benefitsImport.js'
import { extractPdfText } from '../lib/extract.js'
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

const PAY_FREQS = [
  ['12', 'Monthly'],
  ['24', 'Semi-monthly (twice a month)'],
  ['26', 'Every 2 weeks'],
  ['52', 'Weekly'],
]

// Paste-a-statement importer: parses an employer benefits confirmation
// statement (Amazon A-to-Z format) into insurance policies + benefit rows.
function StatementImport({ state, dispatch, toast, onClose }) {
  const [text, setText] = useState('')
  const [freq, setFreq] = useState('12')
  const [baseSalary, setBaseSalary] = useState('')
  const [reading, setReading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef(null)

  const readFile = async file => {
    if (!file) return
    setReading(true)
    try {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
      const content = isPdf ? await extractPdfText(file) : await file.text()
      if (!content || content.trim().length < 40) {
        toast('Couldn’t read text from that file — if it’s a scanned PDF, paste the text instead', { kind: 'error' })
      } else {
        setText(content)
      }
    } catch {
      toast('Couldn’t read that file — paste the statement text instead', { kind: 'error' })
    }
    setReading(false)
  }

  const items = useMemo(() => (text.trim().length > 40 ? parseBenefitsStatement(text) : []), [text])
  const ops = useMemo(() => (items.length
    ? toAppEntities(items, {
        periodsPerYear: parseInt(freq, 10),
        baseSalary: parseFloat(baseSalary) || 0,
        existingInsurance: state.insurance,
        existingBenefits: state.benefits,
      })
    : null), [items, freq, baseSalary, state.insurance, state.benefits])

  const apply = () => {
    let added = 0, updated = 0
    for (const op of ops.policies) {
      if (op.action === 'add') { dispatch({ type: 'ADD_INSURANCE', payload: { ...op.data, id: uid() } }); added++ }
      else { dispatch({ type: 'UPDATE_INSURANCE', payload: { ...op.data, id: op.id } }); updated++ }
    }
    for (const op of ops.benefits) {
      if (op.action === 'add') { dispatch({ type: 'ADD_BENEFIT', payload: { ...op.data, id: uid() } }); added++ }
      else { dispatch({ type: 'UPDATE_BENEFIT', payload: { ...op.data, id: op.id } }); updated++ }
    }
    toast(`Imported: ${added} added, ${updated} updated`, { kind: 'good' })
    onClose()
  }

  return (
    <div className="card form-in">
      <h2>Import from a benefits statement</h2>
      <p className="small muted">
        Drop in your benefits confirmation statement PDF (Amazon: A to Z → Benefits), or paste its text.
        Policies land in the Insurance tab, programs land here. Everything is read entirely in your
        browser — the file is never uploaded anywhere, and dependent or beneficiary names are never read.
      </p>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); readFile(e.dataTransfer.files?.[0]) }}
        style={dragOver ? { outline: '2px dashed var(--accent)', outlineOffset: 4, borderRadius: 8 } : undefined}
      >
        <div className="row gap" style={{ marginBottom: 8, alignItems: 'center' }}>
          <button className="btn" type="button" onClick={() => fileRef.current?.click()} disabled={reading}>
            <Icon name="file" size={14} /> {reading ? 'Reading PDF…' : 'Choose PDF…'}
          </button>
          <span className="small muted">or drag it anywhere in this box, or paste the text below</span>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf,text/plain,.txt" hidden
            onChange={e => { readFile(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        <textarea
          rows={7}
          style={{ width: '100%', resize: 'vertical' }}
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Paste the statement text here…"
          aria-label="Statement text"
        />
      </div>
      <div className="form-grid" style={{ marginTop: 10 }}>
        <label>Pay frequency (statement costs are per pay period)
          <select value={freq} onChange={e => setFreq(e.target.value)}>
            {PAY_FREQS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>Annual base salary (optional)
          <span className="input-money">
            <input type="number" step="1000" inputMode="decimal" value={baseSalary} onChange={e => setBaseSalary(e.target.value)}
              placeholder="sizes 2×/5× salary coverage" />
          </span>
        </label>
      </div>
      {text.trim().length > 40 && items.length === 0 && (
        <p className="small muted">Nothing recognized yet — make sure the elections table (“Benefit / Plan / Coverage / Cost” rows) is included in the paste.</p>
      )}
      {ops && (
        <>
          <table className="table" style={{ marginTop: 8 }}>
            <thead><tr><th>Found</th><th>Goes to</th><th className="num">Monthly cost</th><th>Action</th></tr></thead>
            <tbody>
              {ops.policies.map((op, i) => (
                <tr key={`p${i}`}>
                  <td>{op.label || op.data.policyName}</td>
                  <td className="small">Insurance · {op.data.type || 'update'}</td>
                  <td className="num">{op.data.premium ? fmt(op.data.premium) : '—'}</td>
                  <td className="small">{op.action === 'add' ? 'add' : 'update existing'}</td>
                </tr>
              ))}
              {ops.benefits.map((op, i) => (
                <tr key={`b${i}`}>
                  <td>{op.label || op.data.name}</td>
                  <td className="small">Benefits</td>
                  <td className="num">{op.data.annualValue > 0 ? `${fmt(op.data.annualValue / 12)}` : '—'}</td>
                  <td className="small">{op.action === 'add' ? 'add' : 'update existing'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form-actions" style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={apply}>
              Import {ops.policies.length + ops.benefits.length} items
            </button>
            <button className="btn" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </div>
  )
}

export default function Benefits() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [form, setForm] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
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
        <div className="row gap">
          <button className="btn" onClick={() => setShowImport(s => !s)}>
            <Icon name="upload" size={14} /> Import statement
          </button>
          <button
            className="btn primary"
            onClick={() => {
              if (editingId) setShowForm(true) // switch edit → blank create, don't discard-and-close
              else setShowForm(s => !s)
              setEditingId(null)
              setForm(blank)
            }}
          >
            <Icon name="plus" size={14} /> Add benefit
          </button>
        </div>
      </div>

      {showImport && (
        <StatementImport state={state} dispatch={dispatch} toast={toast} onClose={() => setShowImport(false)} />
      )}

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

      {state.benefits.length === 0 && !showForm && !showImport ? (
        <div className="card">
          <div className="empty">
            <Icon name="gift" />
            <strong>No benefits tracked yet</strong>
            <span className="small">Log everything your employer offers — enrolled or not — so nothing goes unused at open enrollment. Fastest path: paste your benefits confirmation statement.</span>
            <div className="row gap">
              <button className="btn primary" onClick={() => setShowImport(true)}><Icon name="upload" size={14} /> Import statement</button>
              <button className="btn" onClick={() => setShowForm(true)}><Icon name="plus" size={14} /> Add benefit</button>
            </div>
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
