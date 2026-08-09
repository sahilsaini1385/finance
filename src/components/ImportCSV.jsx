import React, { useRef, useState } from 'react'
import { useStore, uid } from '../store.jsx'
import { parseStatement } from '../lib/csv.js'
import { categorize } from '../lib/categorize.js'
import ConnectSimpleFIN from './ConnectSimpleFIN.jsx'
import AmazonEnrich from './AmazonEnrich.jsx'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

function txHash(accountId, t) {
  return `${accountId}|${t.date}|${t.amount}|${t.description.slice(0, 40)}`
}

const INSTITUTIONS = ['Chase', 'Bank of America', 'Fidelity', 'Other']
const TYPES = ['checking', 'savings', 'credit card', 'brokerage', 'retirement', 'hsa', '529', 'loan', 'mortgage', 'other']

export default function ImportCSV({ onDone }) {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const fileRef = useRef(null)
  const [accountId, setAccountId] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [newAcct, setNewAcct] = useState({ name: '', institution: 'Chase', type: 'checking' })

  const handleFile = async file => {
    setError('')
    if (!file) return
    const text = await file.text()
    const result = parseStatement(text)
    if (result.error && result.transactions.length === 0) {
      setError(result.error)
      setPreview(null)
      return
    }
    // A detected credit-card format is a better default than 'checking' for
    // the inline create-account flow.
    if (/credit card/i.test(result.format || '')) setNewAcct(f => ({ ...f, type: 'credit card' }))
    setPreview({ ...result, fileName: file.name })
  }

  const onDrop = e => {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  const doImport = () => {
    if (!preview) return
    let targetId = accountId
    if (!targetId && state.accounts.length === 0) {
      if (!newAcct.name.trim()) return
      targetId = uid()
      dispatch({
        type: 'ADD_ACCOUNT',
        payload: { ...newAcct, id: targetId, balance: 0, updated: new Date().toISOString().slice(0, 10) },
      })
    }
    if (!targetId) return
    const existing = new Set(state.transactions.map(t => t.hash))
    // Identical same-day rows in one file are distinct purchases, not dupes —
    // suffix an occurrence counter so overlapping re-imports dedupe row-for-row.
    const seen = new Map()
    const txs = preview.transactions.map(t => {
      const base = txHash(targetId, t)
      const n = (seen.get(base) || 0) + 1
      seen.set(base, n)
      return {
        id: uid(),
        accountId: targetId,
        date: t.date,
        description: t.description,
        amount: t.amount,
        category: categorize(t.description, t.bankCategory, t.amount, state.rules || []),
        source: preview.format,
        hash: n === 1 ? base : `${base}|${n}`,
      }
    })
    const fresh = txs.filter(t => !existing.has(t.hash))
    dispatch({ type: 'ADD_TRANSACTIONS', payload: fresh })
    setPreview(null)
    toast(
      `Imported ${fresh.length} transactions${txs.length - fresh.length > 0 ? ` (${txs.length - fresh.length} duplicates skipped)` : ''}`,
      { kind: 'good' },
    )
    onDone()
  }

  const canImport = accountId || (state.accounts.length === 0 && newAcct.name.trim())

  return (
    <div className="page">
      <h1>Add data</h1>
      <p className="muted small">Everything is processed on this device.</p>

      <div className="grid-2-forms" style={{ marginTop: 16 }}>
        <ConnectSimpleFIN />

        <div className="card">
          <h2>
            <span className="icon-chip"><Icon name="file" /></span>
            Import a CSV
          </h2>
          <div
            className={dragOver ? 'dropzone over' : 'dropzone'}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
          >
            <Icon name="upload" size={24} />
            <strong>Drop a bank CSV or browse</strong>
            <span className="small">Chase, Bank of America &amp; Fidelity formats auto-detected</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={e => { handleFile(e.target.files?.[0]); e.target.value = '' }}
          />
          <div className="trust-note">
            <Icon name="lock" size={12} /> Parsed locally — this file is never uploaded.
          </div>
          <details className="advanced">
            <summary>How to download CSVs from your bank</summary>
            <ul className="how-to small">
              <li><strong>Chase</strong> — account → download icon above activity → <em>Spreadsheet (Excel, CSV)</em>.</li>
              <li><strong>Bank of America</strong> — account → <em>Download</em> above transactions → CSV format.</li>
              <li><strong>Fidelity</strong> — <em>Accounts &amp; Trade → Portfolio → Activity &amp; Orders → Download</em>.</li>
            </ul>
          </details>
          {error && <p className="error">{error}</p>}
        </div>
      </div>

      <AmazonEnrich />

      {preview && (
        <div className="card form-in">
          <h2>Preview — {preview.fileName}</h2>
          <p className="small muted">
            Detected format: <strong>{preview.format}</strong> · {preview.transactions.length} transactions ·
            re-importing overlapping ranges is safe, duplicates are skipped.
          </p>
          <table className="table">
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {preview.transactions.slice(0, 8).map((t, i) => (
                <tr key={i}>
                  <td className="small nowrap">{t.date}</td>
                  <td className="desc">{t.description}</td>
                  <td className="small">{categorize(t.description, t.bankCategory, t.amount)}</td>
                  <td className={`num ${t.amount < 0 ? '' : 'pos'}`}>{Math.abs(t.amount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.transactions.length > 8 && <p className="muted small">…and {preview.transactions.length - 8} more.</p>}

          <div className="row gap wrap" style={{ marginTop: 12 }}>
            {state.accounts.length > 0 ? (
              <label className="inline-label">Import into
                <select value={accountId} onChange={e => setAccountId(e.target.value)}>
                  <option value="">— choose account —</option>
                  {state.accounts.map(a => <option key={a.id} value={a.id}>{a.institution} · {a.name}</option>)}
                </select>
              </label>
            ) : (
              <div className="row gap wrap">
                <span className="small muted">Create the account for these transactions:</span>
                <input
                  placeholder="Account name"
                  value={newAcct.name}
                  onChange={e => setNewAcct(f => ({ ...f, name: e.target.value }))}
                />
                <select value={newAcct.institution} onChange={e => setNewAcct(f => ({ ...f, institution: e.target.value }))}>
                  {INSTITUTIONS.map(i => <option key={i}>{i}</option>)}
                </select>
                <select value={newAcct.type} aria-label="Account type" onChange={e => setNewAcct(f => ({ ...f, type: e.target.value }))}>
                  {TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            )}
            <button className="btn primary" onClick={doImport} disabled={!canImport}>
              Import {preview.transactions.length} transactions
            </button>
            <button className="btn ghost" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
