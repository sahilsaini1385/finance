import React, { useState } from 'react'
import { useStore, uid } from '../store.jsx'
import { parseStatement } from '../lib/csv.js'
import { categorize } from '../lib/categorize.js'
import ConnectSimpleFIN from './ConnectSimpleFIN.jsx'

function txHash(accountId, t) {
  return `${accountId}|${t.date}|${t.amount}|${t.description.slice(0, 40)}`
}

export default function ImportCSV({ onDone }) {
  const { state, dispatch } = useStore()
  const [accountId, setAccountId] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [imported, setImported] = useState(null)

  const onFile = async e => {
    setError('')
    setImported(null)
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const result = parseStatement(text)
    if (result.error && result.transactions.length === 0) {
      setError(result.error)
      setPreview(null)
      return
    }
    setPreview({ ...result, fileName: file.name })
    e.target.value = ''
  }

  const doImport = () => {
    if (!preview || !accountId) return
    const existing = new Set(state.transactions.map(t => t.hash))
    const txs = preview.transactions.map(t => ({
      id: uid(),
      accountId,
      date: t.date,
      description: t.description,
      amount: t.amount,
      category: categorize(t.description, t.bankCategory, t.amount),
      source: preview.format,
      hash: txHash(accountId, t),
    }))
    const fresh = txs.filter(t => !existing.has(t.hash))
    dispatch({ type: 'ADD_TRANSACTIONS', payload: fresh })
    setImported({ added: fresh.length, skipped: txs.length - fresh.length })
    setPreview(null)
  }

  return (
    <div className="page">
      <h1>Connect &amp; import</h1>
      <ConnectSimpleFIN />
      <div className="card">
        <h2>Manual import — how to export CSVs from your banks</h2>
        <ul className="how-to">
          <li><strong>Chase</strong> — log in → pick the account → the download icon (⬇) above activity → File type <em>Spreadsheet (Excel, CSV)</em> → choose date range → Download.</li>
          <li><strong>Bank of America</strong> — log in → account → <em>Download</em> link above transactions → File type <em>Microsoft Excel format / CSV</em> → Download transactions.</li>
          <li><strong>Fidelity</strong> — log in → <em>Accounts &amp; Trade → Portfolio → Activity &amp; Orders</em> → set range → <em>Download</em> (top-right of the history table). Fidelity credit card CSVs from the card portal work too.</li>
        </ul>
        <p className="muted small">Formats are auto-detected. Re-importing the same file is safe — duplicates are skipped automatically.</p>
      </div>

      <div className="card">
        <h2>Upload</h2>
        {state.accounts.length === 0 ? (
          <p className="muted">Add at least one account first (Accounts tab), so imported transactions have a home.</p>
        ) : (
          <div className="form-grid">
            <label>Import into account
              <select value={accountId} onChange={e => setAccountId(e.target.value)}>
                <option value="">— choose account —</option>
                {state.accounts.map(a => <option key={a.id} value={a.id}>{a.institution} · {a.name}</option>)}
              </select>
            </label>
            <label>CSV file
              <input type="file" accept=".csv,text/csv" onChange={onFile} />
            </label>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {imported && (
          <div className="alert good">
            <span className="alert-icon" aria-hidden>✅</span>
            <div>
              <strong>Imported {imported.added} transactions</strong>
              {imported.skipped > 0 && <div className="muted small">{imported.skipped} duplicates skipped.</div>}
              <button className="btn link" onClick={onDone}>View transactions →</button>
            </div>
          </div>
        )}
      </div>

      {preview && (
        <div className="card">
          <h2>Preview — {preview.fileName}</h2>
          <p>Detected format: <strong>{preview.format}</strong> · {preview.transactions.length} transactions</p>
          <table className="table">
            <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {preview.transactions.slice(0, 8).map((t, i) => (
                <tr key={i}>
                  <td>{t.date}</td>
                  <td className="desc">{t.description}</td>
                  <td className={`num ${t.amount < 0 ? 'neg' : 'pos'}`}>{t.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.transactions.length > 8 && <p className="muted small">…and {preview.transactions.length - 8} more.</p>}
          <div className="row gap">
            <button className="btn primary" onClick={doImport} disabled={!accountId}>
              {accountId ? 'Import all' : 'Choose an account first'}
            </button>
            <button className="btn" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
