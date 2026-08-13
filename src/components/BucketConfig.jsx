import React from 'react'
import { useStore, fmt } from '../store.jsx'
import { computeTotals, accountBucket } from '../lib/advisor.js'
import Icon from './Icon.jsx'

// Assign accounts to net-worth buckets, opened from the Overview hero tiles.
// "Automatic" follows the account type; a pinned choice (account.bucket) wins
// over the type and survives syncs and re-imports. Debt accounts aren't
// listed — money owed is always debt.

const BUCKET_LABELS = { cash: 'Cash', investments: 'Investments', retirement: 'Retirement', other: 'Other' }

export default function BucketConfig({ onClose }) {
  const { state, dispatch } = useStore()
  const totals = computeTotals(state)

  const rows = state.accounts
    .filter(a => accountBucket(a) !== 'debt')
    .sort((x, y) => (parseFloat(y.balance) || 0) - (parseFloat(x.balance) || 0))

  const setBucket = (a, v) =>
    dispatch({
      type: 'UPDATE_ACCOUNT',
      payload: v === 'omit'
        ? { id: a.id, excludeFromNetWorth: true }
        : { id: a.id, excludeFromNetWorth: false, bucket: v === 'auto' ? null : v },
    })

  const omitted = rows.filter(a => a.excludeFromNetWorth)
    .reduce((s, a) => s + (parseFloat(a.balance) || 0), 0)

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" role="dialog" aria-label="Configure net worth buckets" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2 style={{ margin: 0 }}><span className="icon-chip"><Icon name="settings" /></span> What counts where</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="muted small">
          Pick where each account counts. “Automatic” follows the account type — a choice you make here
          wins and sticks, including across family sync. “Not counted” keeps the account tracked but
          leaves it out of net worth entirely — right for money that isn’t yours yet, like unvested RSUs.
        </p>

        <div className="stat-row cols-3" style={{ marginBottom: 12 }}>
          <div className="stat-tile" style={{ cursor: 'default' }}>
            <div className="stat-label">Cash</div>
            <div className="stat-value money" data-testid="bucket-total-cash">{fmt(Math.round(totals.cash))}</div>
          </div>
          <div className="stat-tile" style={{ cursor: 'default' }}>
            <div className="stat-label">Investments</div>
            <div className="stat-value money" data-testid="bucket-total-investments">{fmt(Math.round(totals.taxableInvest))}</div>
          </div>
          <div className="stat-tile" style={{ cursor: 'default' }}>
            <div className="stat-label">Retirement</div>
            <div className="stat-value money" data-testid="bucket-total-retirement">{fmt(Math.round(totals.retirementInvest))}</div>
          </div>
        </div>

        <table className="table">
          <thead>
            <tr><th>Account</th><th className="num">Balance</th><th>Counts as</th></tr>
          </thead>
          <tbody>
            {rows.map(a => {
              const auto = accountBucket({ ...a, bucket: undefined })
              return (
                <tr key={a.id} style={a.excludeFromNetWorth ? { opacity: 0.55 } : undefined}>
                  <td>
                    <div>{a.name}</div>
                    <div className="small muted">
                      {a.institution}
                      {a.excludeFromNetWorth ? ' · not counted' : ''}
                    </div>
                  </td>
                  <td className="num">{fmt(Math.round(parseFloat(a.balance) || 0))}</td>
                  <td>
                    <select
                      aria-label={`Bucket for ${a.name}`}
                      value={a.excludeFromNetWorth ? 'omit' : (a.bucket || 'auto')}
                      onChange={e => setBucket(a, e.target.value)}
                    >
                      <option value="auto">Automatic ({BUCKET_LABELS[auto]})</option>
                      <option value="cash">Cash</option>
                      <option value="investments">Investments</option>
                      <option value="retirement">Retirement</option>
                      <option value="omit">Not counted — omit from net worth</option>
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {omitted !== 0 && (
          <p className="small muted money" style={{ marginBottom: 8 }} data-testid="bucket-total-omitted">
            Not counted: {fmt(Math.round(omitted))} — tracked, but outside net worth (e.g. a stock plan
            account holding unvested shares).
          </p>
        )}
        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
