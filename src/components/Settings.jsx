import React, { useRef, useState } from 'react'
import { useStore, initialState } from '../store.jsx'
import { wipeAllFiles } from '../lib/files.js'
import { deriveKeys, SETUP_SQL, normalizeSupabaseUrl, probeConnection } from '../lib/familySync.js'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

function FamilySyncCard() {
  const { state, dispatch, syncEngine, syncStatus } = useStore()
  const toast = useToast()
  const conn = state.connections?.familySync || null
  const [form, setForm] = useState({ url: '', anonKey: '', passphrase: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const connect = async () => {
    setErr('')
    const anonKey = form.anonKey.trim()
    const passphrase = form.passphrase.trim()
    try {
      const url = normalizeSupabaseUrl(form.url)
      if (url === null) throw new Error('That looks like a supabase.com page, not your project\'s API address. In your project go to Settings → API and copy the Project URL (https://…supabase.co) — or paste the dashboard address of the project itself and I\'ll convert it.')
      if (!/^https:\/\//.test(url)) throw new Error('Project URL should start with https://')
      if (!anonKey) throw new Error('Paste the anon public key')
      if (passphrase.length < 12) throw new Error('Use a longer passphrase — 4+ random words. It is the only thing protecting your data.')
      setBusy(true)
      if (url !== form.url.trim().replace(/\/+$/, '')) toast(`Using the project API address: ${url}`)
      const { keyB64, householdId } = await deriveKeys(passphrase, url)
      // Check the project is reachable and the table exists BEFORE saving —
      // a connection that 404s on every sync helps no one.
      const probe = await probeConnection({ url, anonKey, householdId })
      if (!probe.ok && probe.reason !== 'table-missing') throw new Error(probe.message)
      if (!probe.ok) throw new Error('Connected to the project, but the budgie_sync table doesn\'t exist yet. Run the SQL snippet from step 1 in the project\'s SQL Editor, then hit this button again.')
      dispatch({
        type: 'SET_CONNECTION',
        payload: { kind: 'familySync', value: { url, anonKey, keyB64, householdId, connectedAt: new Date().toISOString() } },
      })
      setForm({ url: '', anonKey: '', passphrase: '' })
      toast('Family sync on — first sync running', { kind: 'good' })
    } catch (e) {
      setErr(e.message || String(e))
    }
    setBusy(false)
  }

  const disconnect = () => {
    dispatch({ type: 'SET_CONNECTION', payload: { kind: 'familySync', value: null } })
    toast('Family sync off — data stays on this device (and in Supabase until you delete the row)')
  }

  if (!conn) {
    return (
      <div className="card">
        <h2><span className="icon-chip"><Icon name="plug" /></span> Family sync (two phones, one household)</h2>
        <p className="small">
          Share Budgie between your devices — and with your partner. Everything syncs through a free database
          you own, <strong>end-to-end encrypted</strong>: the data is sealed with a family passphrase before it
          leaves the device, so the database only ever stores ciphertext. Works offline; merges when you're back.
        </p>
        <ol className="how-to small">
          <li>
            Create a free project at{' '}
            <a href="https://supabase.com" target="_blank" rel="noreferrer">supabase.com</a>, open its{' '}
            <strong>SQL Editor</strong>, and run this once:
            <pre className="mono small" style={{ userSelect: 'all', whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 8, borderRadius: 6, marginTop: 6 }}>{SETUP_SQL}</pre>
          </li>
          <li>
            From the project's <strong>Settings → API</strong>, copy the <strong>Project URL</strong> and the{' '}
            <strong>anon public</strong> key below.
          </li>
          <li>
            Invent a <strong>family passphrase</strong> (4+ random words). Every device that enters the same
            three values joins the same household — that's how Kathryn's phone connects too.
          </li>
        </ol>
        <div className="form-grid">
          <label>Supabase project URL
            <input value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://xyz.supabase.co" />
          </label>
          <label>anon public key
            <input className="mono" value={form.anonKey} onChange={e => set('anonKey', e.target.value)} placeholder="eyJhbGciOi…" />
          </label>
          <label className="span-2">Family passphrase
            <input className="mono" value={form.passphrase} onChange={e => set('passphrase', e.target.value)} placeholder="e.g. grape jetty maple attic" />
          </label>
          <div className="form-actions">
            <button className="btn primary" onClick={connect} disabled={busy || !form.url || !form.anonKey || !form.passphrase}>
              {busy ? 'Connecting…' : 'Turn on family sync'}
            </button>
          </div>
        </div>
        {err && <p className="error small">{err}</p>}
        <div className="trust-note">
          <Icon name="lock" size={12} /> The passphrase never leaves your devices. Uploaded document files
          (PDFs) stay device-local — everything parsed from them syncs.
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="page-head" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>
          <span className="icon-chip"><Icon name="plug" /></span> Family sync
          <span className="badge">{syncStatus.state === 'syncing' ? 'syncing…' : syncStatus.state === 'error' ? 'error' : 'on'}</span>
        </h2>
        <div className="row gap">
          <button className="btn small" onClick={() => syncEngine.syncNow()} disabled={syncStatus.state === 'syncing'}>Sync now</button>
          <button className="btn ghost small" onClick={disconnect}>Turn off</button>
        </div>
      </div>
      <p className="muted small" style={{ margin: '6px 0 0' }}>
        Household <code>{conn.householdId.slice(0, 8)}…</code> · version {syncStatus.version}
        {syncStatus.lastSync && <> · last synced {new Date(syncStatus.lastSync).toLocaleTimeString()}</>}
      </p>
      {syncStatus.error && <p className="error small">{syncStatus.error}</p>}
      {syncStatus.error && /table|404/i.test(syncStatus.error) && (
        <div className="small" style={{ marginTop: 6 }}>
          <p className="small" style={{ margin: '0 0 4px' }}>
            Run this once in the Supabase project's <strong>SQL Editor</strong>, then hit <strong>Sync now</strong>:
          </p>
          <pre className="mono small" style={{ userSelect: 'all', whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 8, borderRadius: 6, margin: 0 }}>{SETUP_SQL}</pre>
        </div>
      )}
      <p className="muted small" style={{ marginBottom: 0 }}>
        To add another device: open Budgie there → Settings → Family sync → enter the same project URL, anon
        key, and family passphrase. Existing data on both devices merges — nothing is overwritten. Uploaded
        PDF files stay on the device they were added to.
      </p>
    </div>
  )
}

export default function Settings() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const fileRef = useRef(null)
  const [msg, setMsg] = useState('')
  const [armed, setArmed] = useState(false)
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'system')

  const changeTheme = value => {
    setTheme(value)
    if (value === 'system') {
      localStorage.removeItem('theme')
      delete document.documentElement.dataset.theme
    } else {
      localStorage.setItem('theme', value)
      document.documentElement.dataset.theme = value
    }
  }

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `budgie-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('Backup downloaded', { kind: 'good' })
  }

  const importData = async e => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const data = JSON.parse(await file.text())
      if (!data || typeof data !== 'object' || !Array.isArray(data.accounts)) throw new Error('Not a valid backup file')
      dispatch({ type: 'HYDRATE', payload: { ...initialState, ...data } })
      setMsg(`Restored backup: ${data.accounts.length} accounts, ${(data.transactions || []).length} transactions.`)
      toast('Backup restored', { kind: 'good' })
    } catch (err) {
      setMsg(`Import failed: ${err.message}`)
      toast('Restore failed', { kind: 'error' })
    }
    e.target.value = ''
  }

  const eraseAll = async () => {
    if (!armed) {
      setArmed(true)
      setTimeout(() => setArmed(false), 3000)
      return
    }
    dispatch({ type: 'RESET' })
    await wipeAllFiles()
    setArmed(false)
    toast('All data and documents erased')
  }

  return (
    <div className="page">
      <h1>Settings</h1>

      <div className="card">
        <h2>Appearance</h2>
        <label className="inline-label">Theme
          <select value={theme} onChange={e => changeTheme(e.target.value)}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </div>

      <div className="card">
        <h2>Where your data lives</h2>
        <p className="small">
          Everything is stored in this browser — figures and settings in <code>localStorage</code>, uploaded
          documents (W-2s, mortgage paperwork, bills) in IndexedDB. Nothing touches a server, which is what keeps
          this tool free and private. The trade-offs: clearing browser data erases it, it doesn't sync between
          devices, and <strong>document files are not included in the JSON backup</strong> — keep originals safe
          elsewhere. Export a backup regularly.
        </p>
        <button className="btn" onClick={exportData}><Icon name="upload" size={14} /> Export backup</button>
      </div>

      <FamilySyncCard />

      <div className="card">
        <h2>Backup &amp; restore</h2>
        <div className="row gap">
          <button className="btn primary" onClick={exportData}>Export backup (JSON)</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Restore from backup…</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importData} />
        </div>
        {msg && <p className="muted small">{msg}</p>}
      </div>

      <div className="card">
        <h2>Danger zone</h2>
        <button className={armed ? 'btn danger armed' : 'btn danger'} onClick={eraseAll}>
          <Icon name="trash" size={14} />
          {armed ? 'Click again to erase everything' : 'Erase all data'}
        </button>
      </div>

      <div className="card">
        <h2>About account connections</h2>
        <p className="small">
          Fidelity, Chase, and Bank of America don't offer free personal APIs, and aggregators (Plaid, Yodlee, MX)
          charge for live connections. This app supports two free-tier paths: CSV import (always free) and
          SimpleFIN Bridge (~$1.50/mo) for automatic sync — configured in the Add data tab. See ARCHITECTURE.md
          in the repository for how this scales to a hosted, multi-user product.
        </p>
      </div>
    </div>
  )
}
