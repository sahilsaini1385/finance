import React, { useRef, useState } from 'react'
import { useStore, initialState } from '../store.jsx'

export default function Settings() {
  const { state, dispatch } = useStore()
  const fileRef = useRef(null)
  const [msg, setMsg] = useState('')

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `finance-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importData = async e => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const data = JSON.parse(await file.text())
      if (!data || typeof data !== 'object' || !Array.isArray(data.accounts)) throw new Error('Not a valid backup file')
      dispatch({ type: 'HYDRATE', payload: { ...initialState, ...data } })
      setMsg(`Restored backup: ${data.accounts.length} accounts, ${(data.transactions || []).length} transactions.`)
    } catch (err) {
      setMsg(`Import failed: ${err.message}`)
    }
    e.target.value = ''
  }

  return (
    <div className="page">
      <h1>Settings & data</h1>

      <div className="card">
        <h2>Where your data lives</h2>
        <p>
          Everything is stored in this browser's <code>localStorage</code> — it never touches a server, which is
          what keeps this tool free and private. The trade-off: clearing browser data erases it, and it doesn't
          sync between devices. Export a backup regularly (it's a plain JSON file you can keep anywhere safe).
        </p>
      </div>

      <div className="card">
        <h2>Backup & restore</h2>
        <div className="row gap">
          <button className="btn primary" onClick={exportData}>Export backup (JSON)</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Restore from backup…</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importData} />
        </div>
        {msg && <p className="muted">{msg}</p>}
      </div>

      <div className="card">
        <h2>Danger zone</h2>
        <button
          className="btn danger"
          onClick={() => {
            if (confirm('Erase ALL data (accounts, transactions, benefits, insurance, profile)? This cannot be undone.')) {
              dispatch({ type: 'RESET' })
              setMsg('All data erased.')
            }
          }}
        >
          Erase all data
        </button>
      </div>

      <div className="card">
        <h2>About account connections</h2>
        <p>
          Fidelity, Chase, and Bank of America don't offer free direct APIs to individuals, and aggregators
          (Plaid, Yodlee, MX) charge for live connections — so a truly free tool works from the CSV activity
          files every one of these banks lets you download. Importing takes about a minute a month per account,
          and duplicates are detected automatically. If you ever want live syncing, SimpleFIN Bridge (~$1.50/mo)
          is the cheapest reputable option, and this app's import pipeline could be extended to consume it.
        </p>
      </div>
    </div>
  )
}
