import React, { useRef, useState } from 'react'
import { useStore, uid } from '../store.jsx'
import { parseStatement } from '../lib/csv.js'
import { num } from '../lib/num.js'
import { categorize } from '../lib/categorize.js'
import ConnectSimpleFIN from './ConnectSimpleFIN.jsx'
import AmazonEnrich from './AmazonEnrich.jsx'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

function txHash(accountId, t) {
  return `${accountId}|${t.date}|${t.amount}|${t.description.slice(0, 40)}`
}

const INSTITUTIONS = ['Chase', 'Bank of America', 'Fidelity', 'Monzo', 'Starling', 'Other']
const CUR_SYMBOL = { USD: '$', GBP: '£', EUR: '€', CAD: 'CA$' }
const TYPES = ['checking', 'savings', 'credit card', 'brokerage', 'retirement', 'hsa', '529', 'loan', 'mortgage', 'other']

export default function ImportCSV({ onDone }) {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const fileRef = useRef(null)
  const [accountId, setAccountId] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [newAcct, setNewAcct] = useState({ name: '', institution: 'Chase', type: 'checking', currency: 'USD', fxToUsd: '' })
  // Rate typed in the preview for a foreign-currency account that has none yet.
  const [previewFx, setPreviewFx] = useState('')

  const handleFile = async (file, dateStyle) => {
    setError('')
    if (!file) return
    const text = await file.text()
    const result = parseStatement(text, dateStyle ? { dateStyle } : {})
    if (result.error && result.transactions.length === 0) {
      setError(result.error)
      setPreview(null)
      return
    }
    // A detected credit-card format is a better default than 'checking' for
    // the inline create-account flow; a UK format defaults the currency.
    if (/credit card/i.test(result.format || '')) setNewAcct(f => ({ ...f, type: 'credit card' }))
    if (result.currency === 'GBP') setNewAcct(f => ({ ...f, currency: 'GBP', institution: /monzo/i.test(result.format) ? 'Monzo' : /starling/i.test(result.format) ? 'Starling' : f.institution }))
    // Keep the file so the DD/MM toggle can re-read it with the other rule.
    setPreview({ ...result, fileName: file.name, file })
  }

  const onDrop = e => {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  const target = state.accounts.find(a => a.id === accountId)
  // Foreign-currency target: transactions are converted to USD at the
  // account's rate ON IMPORT (stored USD, original kept for display), so
  // budgets and every other consumer stay single-currency. The rate is the
  // account's — typed here if it doesn't have one yet.
  const targetCurrency = target ? (target.currency || 'USD') : (state.accounts.length === 0 ? newAcct.currency : 'USD')
  const targetFx = target ? num(target.fxToUsd) || num(previewFx) : num(newAcct.fxToUsd) || num(previewFx)
  const needsFx = targetCurrency !== 'USD' && !(targetFx > 0)

  const doImport = () => {
    if (!preview || needsFx) return
    let targetId = accountId
    if (!targetId && state.accounts.length === 0) {
      if (!newAcct.name.trim()) return
      targetId = uid()
      dispatch({
        type: 'ADD_ACCOUNT',
        payload: { ...newAcct, fxToUsd: newAcct.currency !== 'USD' ? String(targetFx) : '', id: targetId, balance: 0, updated: new Date().toISOString().slice(0, 10) },
      })
    }
    if (!targetId) return
    // A rate typed in the preview belongs on the account, so the next import
    // and the balance conversion agree with it.
    if (target && targetCurrency !== 'USD' && !(num(target.fxToUsd) > 0) && targetFx > 0) {
      dispatch({ type: 'UPDATE_ACCOUNT', payload: { id: target.id, fxToUsd: String(targetFx) } })
    }
    const existing = new Set(state.transactions.map(t => t.hash))
    // Identical same-day rows in one file are distinct purchases, not dupes —
    // suffix an occurrence counter so overlapping re-imports dedupe row-for-row.
    const seen = new Map()
    const txs = preview.transactions.map(t => {
      const base = txHash(targetId, t)
      const n = (seen.get(base) || 0) + 1
      seen.set(base, n)
      const converted = targetCurrency !== 'USD'
      return {
        id: uid(),
        accountId: targetId,
        date: t.date,
        description: t.description,
        amount: converted ? Math.round(t.amount * targetFx * 100) / 100 : t.amount,
        ...(converted ? { originalAmount: t.amount, currency: targetCurrency, fxUsed: targetFx } : {}),
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

  const canImport = (accountId || (state.accounts.length === 0 && newAcct.name.trim())) && !needsFx

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
            <span className="small">Chase, BofA, Fidelity, Monzo, Starling &amp; Revolut auto-detected — UK dates and £ handled</span>
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
              <li><strong>UK banks</strong> — Monzo/Starling/Revolut export CSV from the app (Monzo: <em>Home → statement → CSV</em>; Starling: <em>Statements → CSV</em>). Most high-street banks (HSBC, Barclays, NatWest) have a download link on the statement page. DD/MM dates and £ amounts are handled — create the account as GBP with an exchange rate and everything stores in USD at your rate.</li>
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
            dates read as <strong>{preview.dateStyle === 'dmy' ? 'DD/MM (UK)' : 'MM/DD (US)'}</strong> ·
            re-importing overlapping ranges is safe, duplicates are skipped.
            {targetCurrency !== 'USD' && (targetFx > 0
              ? <> Amounts are {targetCurrency}, stored as USD at {targetFx} — the rate lives on the account.</>
              : <> This account is in {targetCurrency}: set its → USD rate below before importing, so pounds are never stored as dollars.</>)}
          </p>
          {preview.dateAmbiguous && (
            <div className="alert info" style={{ marginBottom: 10 }}>
              <span className="alert-icon"><Icon name="alert-triangle" size={15} /></span>
              <div className="small">
                Every date in this file could be read either way (no day above 12), so MM/DD was assumed.
                A UK export read as MM/DD silently swaps March 4th and April 3rd — check the dates below.{' '}
                <button className="btn small" onClick={() => handleFile(preview.file, preview.dateStyle === 'dmy' ? 'mdy' : 'dmy')}>
                  Read as {preview.dateStyle === 'dmy' ? 'MM/DD (US)' : 'DD/MM (UK)'} instead
                </button>
              </div>
            </div>
          )}
          <table className="table">
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {preview.transactions.slice(0, 8).map((t, i) => (
                <tr key={i}>
                  <td className="small nowrap">{t.date}</td>
                  <td className="desc">{t.description}</td>
                  <td className="small">{categorize(t.description, t.bankCategory, t.amount)}</td>
                  <td className={`num ${t.amount < 0 ? '' : 'pos'}`}>
                    {(CUR_SYMBOL[targetCurrency] || '$')}{Math.abs(t.amount).toFixed(2)}
                    {targetCurrency !== 'USD' && targetFx > 0 && <span className="small muted"> → ${Math.abs(t.amount * targetFx).toFixed(2)}</span>}
                  </td>
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
                <select value={newAcct.currency} aria-label="Account currency" onChange={e => setNewAcct(f => ({ ...f, currency: e.target.value }))}>
                  {['USD', 'GBP', 'EUR', 'CAD'].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            )}
            {targetCurrency !== 'USD' && (
              <label className="inline-label">{targetCurrency} → USD rate
                <input type="number" inputMode="decimal" step="0.01" style={{ width: 90 }}
                  value={target && num(target.fxToUsd) > 0 ? String(target.fxToUsd) : previewFx}
                  disabled={Boolean(target && num(target.fxToUsd) > 0)}
                  onChange={e => setPreviewFx(e.target.value)}
                  placeholder={targetCurrency === 'GBP' ? '1.28' : '1.00'} />
              </label>
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
