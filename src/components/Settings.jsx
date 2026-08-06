import React, { useRef, useState } from 'react'
import { useStore, initialState } from '../store.jsx'
import { wipeAllFiles } from '../lib/files.js'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

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
    a.download = `finance-backup-${new Date().toISOString().slice(0, 10)}.json`
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
