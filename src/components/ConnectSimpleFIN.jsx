import React, { useState } from 'react'
import { useStore } from '../store.jsx'
import { claimAccessUrl, fetchAccounts } from '../lib/simplefin.js'
import { buildSyncPatch } from '../lib/sync.js'

export default function ConnectSimpleFIN() {
  const { state, dispatch } = useStore()
  const conn = state.connections?.simplefin || null
  const [token, setToken] = useState('')
  const [proxyUrl, setProxyUrl] = useState(conn?.proxyUrl || '')
  const [days, setDays] = useState('90')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState(null)

  const setConn = value => dispatch({ type: 'SET_CONNECTION', payload: { kind: 'simplefin', value } })

  const connect = async () => {
    setBusy(true)
    setError('')
    try {
      const accessUrl = await claimAccessUrl(token, { proxyUrl: proxyUrl.trim() || undefined })
      setConn({ accessUrl, connectedAt: new Date().toISOString(), lastSync: null, proxyUrl: proxyUrl.trim() })
      setToken('')
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  const sync = async () => {
    setBusy(true)
    setError('')
    setSummary(null)
    try {
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - parseInt(days, 10))
      const payload = await fetchAccounts(conn.accessUrl, {
        startDate,
        proxyUrl: (conn.proxyUrl || '').trim() || undefined,
      })
      const { patch, summary: s } = buildSyncPatch(payload, state)
      dispatch({ type: 'APPLY_SYNC', payload: patch })
      setConn({ ...conn, lastSync: new Date().toISOString() })
      setSummary(s)
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  const disconnect = () => {
    if (confirm('Disconnect SimpleFIN? Synced accounts and transactions stay; automatic sync stops.')) {
      setConn(null)
      setSummary(null)
    }
  }

  const saveProxy = () => setConn({ ...conn, proxyUrl: proxyUrl.trim() })

  return (
    <div className="card">
      <h2>Automatic sync — SimpleFIN <span className="badge">~$1.50/mo, optional</span></h2>

      {!conn ? (
        <>
          <p className="muted">
            Connect Fidelity, Chase, and Bank of America once at SimpleFIN Bridge, then this app pulls balances
            and transactions automatically. Your bank credentials live with SimpleFIN's bridge — never in this app;
            this app only stores a read-only access URL, and only in your browser.
          </p>
          <ol className="how-to">
            <li>Create an account at <a href="https://beta-bridge.simplefin.org/" target="_blank" rel="noreferrer">SimpleFIN Bridge</a> and connect your banks there.</li>
            <li>On the bridge site, choose <em>New App connection</em> to generate a <strong>setup token</strong>.</li>
            <li>Paste the token below. (Tokens are single-use — generate a fresh one if a claim fails.)</li>
          </ol>
          <div className="form-grid">
            <label className="span-2">Setup token
              <input value={token} onChange={e => setToken(e.target.value)} placeholder="Paste your SimpleFIN setup token" />
            </label>
          </div>
          <details className="advanced">
            <summary>Advanced: CORS proxy</summary>
            <p className="muted small">
              If your browser blocks direct requests to SimpleFIN (CORS), deploy the free one-file proxy in{' '}
              <code>proxy/cloudflare-worker.js</code> to Cloudflare Workers and paste its URL here. See ARCHITECTURE.md.
            </p>
            <input value={proxyUrl} onChange={e => setProxyUrl(e.target.value)} placeholder="https://your-proxy.workers.dev" />
          </details>
          <div className="row gap" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={connect} disabled={busy || !token.trim()}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            Connected since {conn.connectedAt?.slice(0, 10)} · Last sync:{' '}
            {conn.lastSync ? new Date(conn.lastSync).toLocaleString() : 'never'}
          </p>
          <div className="row gap wrap">
            <label className="inline-label">Pull last
              <select value={days} onChange={e => setDays(e.target.value)}>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </select>
            </label>
            <button className="btn primary" onClick={sync} disabled={busy}>{busy ? 'Syncing…' : 'Sync now'}</button>
            <button className="btn danger" onClick={disconnect} disabled={busy}>Disconnect</button>
          </div>
          <details className="advanced">
            <summary>Advanced: CORS proxy</summary>
            <div className="row gap">
              <input value={proxyUrl} onChange={e => setProxyUrl(e.target.value)} placeholder="https://your-proxy.workers.dev" style={{ flex: 1 }} />
              <button className="btn" onClick={saveProxy}>Save</button>
            </div>
          </details>
        </>
      )}

      {error && <p className="error">{error}</p>}
      {summary && (
        <div className="alert good">
          <span className="alert-icon" aria-hidden>✅</span>
          <div>
            <strong>Sync complete</strong>
            <div className="muted small">
              {summary.accountsCreated} new accounts · {summary.accountsUpdated} balances updated ·{' '}
              {summary.txAdded} transactions added · {summary.txSkipped} duplicates skipped
            </div>
            {summary.errors.length > 0 && (
              <div className="error small">SimpleFIN reported: {summary.errors.join('; ')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
