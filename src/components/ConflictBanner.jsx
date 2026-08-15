import React, { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { getDataConflicts } from '../lib/facts.js'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

// Cross-section disagreements surfaced by the reconciliation layer. Fixes are
// guarded: the from→to preview is shown and nothing changes without a click.
export default function ConflictBanner({ surface }) {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [dismissed, setDismissed] = useState(() => new Set())

  const conflicts = useMemo(
    () => getDataConflicts(state).filter(c => !surface || (c.surfaces || []).includes(surface)),
    [state, surface],
  )
  const visible = conflicts.filter(c => !dismissed.has(c.factId + c.message))
  if (visible.length === 0) return null

  const applyFix = c => {
    for (const d of c.fix.dispatches) dispatch({ type: d.action, payload: d.payload })
    toast(`Updated: ${c.fix.preview.from} → ${c.fix.preview.to}`, { kind: 'good' })
  }

  return (
    <div className="card" style={{ borderColor: 'var(--warning)' }}>
      <h2><span className="icon-chip"><Icon name="alert-triangle" /></span> Sections disagree</h2>
      {visible.map(c => (
        <div key={c.factId + c.message} className="row gap wrap" style={{ alignItems: 'center', padding: '6px 0' }}>
          <span className="small money" style={{ flex: 1, minWidth: 240 }}>{c.message}</span>
          {c.fix && (
            <button className="btn small wrap-label" onClick={() => applyFix(c)} title={`${c.fix.preview.from} → ${c.fix.preview.to}`}>
              {c.fix.label} ({c.fix.preview.from} → {c.fix.preview.to})
            </button>
          )}
          <button className="btn ghost small" aria-label="Dismiss"
            onClick={() => setDismissed(s => new Set([...s, c.factId + c.message]))}>
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
      <p className="small muted" style={{ marginBottom: 0 }}>
        Advice already uses the more reliable source for each — fixing just brings the other sections in line.
      </p>
    </div>
  )
}
