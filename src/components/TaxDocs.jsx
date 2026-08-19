import React, { useState } from 'react'
import { useStore, uid, fmt } from '../store.jsx'
import { estimateFederalTax, w2Summary } from '../lib/advisor.js'
import { limitsFor } from '../lib/taxTables.js'
import { parseW2 } from '../lib/income.js'
import { extractPdfTextLayout } from '../lib/extract.js'
import { putFile, deleteFile, openFile, getFile, formatBytes } from '../lib/files.js'
import FileDrop from './FileDrop.jsx'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

const DOC_KINDS = ['W-2', '1099-INT', '1099-DIV', '1099-B', '1099-NEC / MISC', '1098 (mortgage interest)', '1095 (health coverage)', 'K-1', 'Prior tax return', 'Property tax bill', 'Charitable receipts', 'Other']

const currentYear = new Date().getFullYear()
const YEARS = Array.from({ length: 6 }, (_, i) => String(currentYear - i))

const W2_FIELDS = [
  ['wages', 'Box 1 — wages'],
  ['fedWithholding', 'Box 2 — federal tax withheld'],
  ['k401', 'Box 12 D/AA — 401(k) deferrals'],
  ['hsa', 'Box 12 W — HSA contributions'],
]

export default function TaxDocs() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [kind, setKind] = useState('W-2')
  const [year, setYear] = useState(String(currentYear - 1))
  const [expandedId, setExpandedId] = useState(null)
  const [armedId, setArmedId] = useState(null)

  const docs = state.documents
    .filter(d => d.section === 'tax')
    .sort((a, b) => (a.year === b.year ? (a.uploadedAt < b.uploadedAt ? 1 : -1) : a.year < b.year ? 1 : -1))

  // Read a W-2 PDF's box figures in-browser. Returns {fields, year} or null.
  const readW2 = async blob => {
    try {
      const text = await extractPdfTextLayout(blob)
      const w2p = parseW2(text)
      if (!w2p) return null
      return {
        year: w2p.year || null,
        fields: {
          wages: String(w2p.wages),
          fedWithholding: String(w2p.fedWithholding),
          ...(w2p.k401 > 0 ? { k401: String(w2p.k401) } : {}),
          ...(w2p.hsa > 0 ? { hsa: String(w2p.hsa) } : {}),
        },
      }
    } catch {
      return null
    }
  }

  const upload = async file => {
    if (!file) return
    const id = uid()
    try {
      await putFile(id, file)
    } catch (e) {
      toast(e.message, { kind: 'error' })
      return
    }
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    const w2read = kind === 'W-2' && isPdf ? await readW2(file) : null
    dispatch({
      type: 'ADD_DOCUMENT',
      payload: {
        id, section: 'tax', kind,
        year: w2read?.year || year,
        name: file.name, size: file.size, mime: file.type,
        uploadedAt: new Date().toISOString().slice(0, 10),
        fields: kind === 'W-2' ? (w2read?.fields || {}) : undefined,
      },
    })
    if (w2read) {
      toast(`W-2 read: ${fmt(w2read.fields.wages)} wages, ${fmt(w2read.fields.fedWithholding)} withheld${w2read.year ? ` (${w2read.year})` : ''}`, { kind: 'good' })
    } else {
      toast(`${kind} uploaded — stored only in this browser${kind === 'W-2' ? '; couldn’t auto-read boxes, enter them below' : ''}`, { kind: w2read === null && kind === 'W-2' && isPdf ? undefined : 'good' })
    }
    if (kind === 'W-2') setExpandedId(id)
  }

  const rereadW2 = async d => {
    const blob = await getFile(d.id).catch(() => null)
    if (!blob) return toast('Original file not found in this browser', { kind: 'error' })
    const w2read = await readW2(blob)
    if (!w2read) return toast('Couldn’t find W-2 boxes in this file — enter them manually', { kind: 'error' })
    dispatch({ type: 'UPDATE_DOCUMENT', payload: { id: d.id, fields: { ...d.fields, ...w2read.fields }, ...(w2read.year ? { year: w2read.year } : {}) } })
    toast(`Read from PDF: ${fmt(w2read.fields.wages)} wages, ${fmt(w2read.fields.fedWithholding)} withheld`, { kind: 'good' })
  }

  const remove = async d => {
    if (armedId !== d.id) {
      setArmedId(d.id)
      setTimeout(() => setArmedId(cur => (cur === d.id ? null : cur)), 3000)
      return
    }
    await deleteFile(d.id).catch(() => {})
    dispatch({ type: 'DELETE_DOCUMENT', payload: d.id })
    setArmedId(null)
    toast('Document deleted')
  }

  const setField = (doc, key, value) => {
    dispatch({ type: 'UPDATE_DOCUMENT', payload: { id: doc.id, fields: { ...doc.fields, [key]: value } } })
  }

  const w2 = w2Summary(state)
  const est = w2 && w2.wages > 0 ? estimateFederalTax(w2.wages, state.profile.filingStatus, Number(w2.year)) : null
  const diff = est ? Math.round(w2.fedWithholding - est.tax) : 0

  return (
    <div className="page">
      <h1>Taxes</h1>
      <p className="muted small">
        Keep W-2s, 1099s, and filing paperwork in one place. Drop in a W-2 PDF and the box figures read
        themselves — the Advisor then reviews your withholding and retirement deferrals for that tax year.
      </p>

      <div className="grid-2-forms" style={{ marginTop: 16 }}>
        <div className="card">
          <h2><span className="icon-chip"><Icon name="file-text" /></span> Upload a document</h2>
          <div className="row gap wrap" style={{ marginBottom: 12 }}>
            <label className="inline-label">Type
              <select value={kind} onChange={e => setKind(e.target.value)}>
                {DOC_KINDS.map(k => <option key={k}>{k}</option>)}
              </select>
            </label>
            <label className="inline-label">Tax year
              <select value={year} onChange={e => setYear(e.target.value)}>
                {YEARS.map(y => <option key={y}>{y}</option>)}
              </select>
            </label>
          </div>
          <FileDrop
            onFile={upload}
            accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.csv,.txt"
            title="Drop a PDF or photo, or browse"
            subtitle="Up to 15MB per file"
          />
          <div className="trust-note">
            <Icon name="lock" size={12} /> Stored in this browser only — never uploaded anywhere.
          </div>
        </div>

        <div className="card">
          <h2><span className="icon-chip"><Icon name="sparkle" /></span> Advisor read on your W-2s</h2>
          {!w2 || w2.wages === 0 ? (
            <div className="empty" style={{ padding: '20px 8px' }}>
              <Icon name="file-text" />
              <strong>No W-2 figures yet</strong>
              <span className="small">Drop in a W-2 PDF and the boxes read themselves — the Advisor then estimates your refund/balance due and checks your 401(k) and HSA deferrals against that year's limits.</span>
            </div>
          ) : (
            <>
              <p className="small muted">
                Tax year {w2.year} · {w2.count} W-2{w2.count > 1 ? 's' : ''} · filing as {state.profile.filingStatus.toUpperCase()}
              </p>
              <table className="table">
                <tbody>
                  <tr><td>Total Box 1 wages</td><td className="num">{fmt(w2.wages)}</td></tr>
                  <tr><td>Federal tax withheld</td><td className="num">{fmt(w2.fedWithholding)}</td></tr>
                  <tr><td>Est. federal tax (standard deduction)</td><td className="num">{fmt(est.tax)}</td></tr>
                  <tr>
                    <td><strong>{diff >= 0 ? 'Projected refund' : 'Projected balance due'}</strong></td>
                    <td className={`num ${diff >= 0 ? 'pos' : ''}`} style={diff < 0 ? { color: 'var(--critical)' } : undefined}>
                      <strong>{fmt(Math.abs(diff))}</strong>
                    </td>
                  </tr>
                  {w2.k401 > 0 && <tr><td>401(k) deferrals (Box 12)</td><td className="num">{fmt(w2.k401)} of {fmt(limitsFor(Number(w2.year)).k401)} limit</td></tr>}
                  {w2.hsa > 0 && <tr><td>HSA via payroll (Box 12 W)</td><td className="num">{fmt(w2.hsa)}</td></tr>}
                </tbody>
              </table>
              <p className="muted small" style={{ marginBottom: 0 }}>
                Rough estimate: ignores credits, other income, and itemized deductions. Detailed recommendations appear in the Advisor tab.
              </p>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Documents ({docs.length})</h2>
        {docs.length === 0 ? (
          <div className="empty">
            <Icon name="file" />
            <strong>Nothing here yet</strong>
            <span className="small">A good starter set: last year's return, W-2s, 1099s, and Form 1098 if you own a home.</span>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Document</th><th>Type</th><th>Year</th><th className="num">Size</th><th>Added</th><th></th></tr>
            </thead>
            <tbody>
              {docs.map(d => (
                <React.Fragment key={d.id}>
                  <tr>
                    <td className="desc">{d.name}</td>
                    <td className="small">{d.kind}</td>
                    <td className="small">{d.year}</td>
                    <td className="num small">{formatBytes(d.size)}</td>
                    <td className="small">{d.uploadedAt}</td>
                    <td className="row-actions">
                      <button className="btn ghost small" onClick={() => openFile(d.id, d.name).catch(e => toast(e.message, { kind: 'error' }))}>
                        <Icon name="eye" size={13} /> View
                      </button>
                      {d.kind === 'W-2' && (
                        <button className="btn ghost small" onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}>
                          Key figures
                        </button>
                      )}
                      <button className={armedId === d.id ? 'btn danger small armed' : 'btn danger small'} onClick={() => remove(d)}>
                        {armedId === d.id ? 'Confirm?' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                  {d.kind === 'W-2' && expandedId === d.id && (
                    <tr>
                      <td colSpan={6}>
                        <div className="row gap" style={{ paddingTop: 8 }}>
                          <button className="btn ghost small" onClick={() => rereadW2(d)}>
                            <Icon name="file-text" size={13} /> Read boxes from PDF
                          </button>
                        </div>
                        <div className="form-grid form-in" style={{ padding: '8px 0' }}>
                          {W2_FIELDS.map(([key, label]) => (
                            <label key={key}>{label}
                              <span className="input-money">
                                <input
                                  type="number"
                                  step="0.01"
                                  inputMode="decimal"
                                  value={d.fields?.[key] ?? ''}
                                  onChange={e => setField(d, key, e.target.value)}
                                />
                              </span>
                            </label>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">
          Document files live in this browser's IndexedDB and are <strong>not</strong> included in the JSON backup —
          keep the originals somewhere safe too.
        </p>
      </div>
    </div>
  )
}
