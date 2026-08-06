import React, { useState } from 'react'
import { useStore } from '../store.jsx'
import { claimAccessUrl, fetchAccounts } from '../lib/simplefin.js'
import { buildSyncPatch } from '../lib/sync.js'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

export default function ConnectSimpleFIN() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const conn = state.connections?.simplefin || null
  const [token, setToken] = useState('')
  const [proxyUrl, setProxyUrl] = useState(conn?.proxyUrl || '')
  const [days, setDays] = useState('90')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState(null)
  const [armed, setArmed] = useState(false)

  const setConn = value => dispatch({ type: 'SET_CONNECTION', payload: { kind: 'simplefin', value } })

  const connect = async () => {
    setBusy(true)
    setError('')
    try {
      const accessUrl = await claimAccessUrl(token, { proxyUrl: proxyUrl.trim() || undefined })
      setConn({ accessUrl, connectedAt: new Date().toISOString(), lastSync: null, proxyUrl: proxyUrl.trim() })
      setToken('')
      toast('Bank connection linked', { kind: 'good' })
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
      toast(`Sync complete — ${s.txAdded} transactions added`, { kind: 'good' })
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  const disconnect = () => {
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 3000)
      return
    }
    setConn(null)
    setSummary(null)
    setArmed(false)
    toast('SimpleFIN disconnected — synced data kept')
  }

  const saveProxy = () => {
    setConn({ ...conn, proxyUrl: proxyUrl.trim() })
    toast('Proxy saved')
  }

  return (
    <div className="card">
      <h2>
        <span className="icon-chip"><Icon name="plug" /></span>
        Connect a bank
        <span className="badge">Recommended</span>
      </h2>

      {!conn ? (
        <>
          <p className="muted small">
            Automatic sync via SimpleFIN Bridge (~$1.50/mo). Your bank credentials live with the bridge —
            never in this app.
          </p>
          <ol className="how-to small">
            <li>Create an account at <a href="https://beta-bridge.simplefin.org/" target="_blank" rel="noreferrer">SimpleFIN Bridge</a> and connect Fidelity, Chase &amp; Bank of America there.</li>
            <li>Choose <em>New App connection</em> to generate a <strong>setup token</strong>.</li>
            <li>Paste the token below — tokens are single-use.</li>
          </ol>
          <input
            className="mono"
            style={{ width: '100%' }}
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Paste your SimpleFIN setup token"
            aria-label="SimpleFIN setup token"
          />
          <div className="trust-note">
            <Icon name="lock" size={12} /> Exchanged for an access URL stored only in this browser.
          </div>
          <details className="advanced">
            <summary>Advanced: CORS proxy</summary>
            <p className="muted small">
              If the browser blocks direct requests (CORS), deploy the free one-file proxy in{' '}
              <code>proxy/cloudflare-worker.js</code> and paste its URL here. See ARCHITECTURE.md.
            </p>
            <input value={proxyUrl} onChange={e => setProxyUrl(e.target.value)} placeholder="https://your-proxy.workers.dev" />
          </details>
          <div className="row gap" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={connect} disabled={busy || !token.trim()}>
              {busy && <span className="spinner" />}
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            <span className={busy ? 'dot-live busy' : 'dot-live'} />
            Connected since {conn.connectedAt?.slice(0, 10)} · last sync{' '}
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
            <button className="btn primary" onClick={sync} disabled={busy}>
              {busy && <span className="spinner" />}
              {busy ? 'Syncing…' : 'Sync now'}
            </button>
            <button className={armed ? 'btn danger armed' : 'btn danger'} onClick={disconnect} disabled={busy}>
              {armed ? 'Confirm disconnect?' : 'Disconnect'}
            </button>
          </div>
          {busy && (
            <div aria-hidden>
              <div className="skeleton" style={{ width: '70%' }} />
              <div className="skeleton" style={{ width: '50%' }} />
              <div className="skeleton" style={{ width: '60%' }} />
            </div>
          )}
          <details className="advanced">
            <summary>Advanced: CORS proxy</summary>
            <div className="row gap" style={{ marginTop: 6 }}>
              <input value={proxyUrl} onChange={e => setProxyUrl(e.target.value)} placeholder="https://your-proxy.workers.dev" style={{ flex: 1, marginTop: 0 }} />
              <button className="btn" onClick={saveProxy}>Save</button>
            </div>
          </details>
        </>
      )}

      {error && <p className="error small">{error}</p>}
      {summary && !busy && (
        <div className="alert good">
          <span className="alert-icon"><Icon name="check-circle" size={15} /></span>
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
