import React, { useMemo, useState } from 'react'
import { useStore, fmt } from '../store.jsx'
import { computeTotals, getRecommendations } from '../lib/advisor.js'

function monthKey(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : ''
}

function lastNMonths(n) {
  const out = []
  const d = new Date()
  d.setDate(1)
  for (let i = 0; i < n; i++) {
    out.unshift(d.toISOString().slice(0, 7))
    d.setMonth(d.getMonth() - 1)
  }
  return out
}

export default function Dashboard({ onNavigate }) {
  const { state } = useStore()
  const totals = computeTotals(state)
  const [hoverCat, setHoverCat] = useState(null)
  const [hoverMonth, setHoverMonth] = useState(null)

  const months = useMemo(() => lastNMonths(6), [])
  const flows = useMemo(() => {
    const m = Object.fromEntries(months.map(k => [k, { income: 0, expense: 0 }]))
    for (const t of state.transactions) {
      const k = monthKey(t.date)
      if (!(k in m) || t.category === 'Transfers') continue
      if (t.amount > 0) m[k].income += t.amount
      else m[k].expense += -t.amount
    }
    return m
  }, [state.transactions, months])

  const thisMonth = new Date().toISOString().slice(0, 7)
  const spendByCat = useMemo(() => {
    const m = {}
    for (const t of state.transactions) {
      if (monthKey(t.date) !== thisMonth || t.amount >= 0) continue
      if (t.category === 'Transfers' || t.category === 'Investments') continue
      m[t.category] = (m[t.category] || 0) + -t.amount
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [state.transactions, thisMonth])

  const recs = getRecommendations(state)
  const alerts = recs.filter(r => r.severity === 'critical' || r.severity === 'warning').slice(0, 3)

  const maxFlow = Math.max(1, ...months.map(k => Math.max(flows[k].income, flows[k].expense)))
  const maxCat = Math.max(1, ...spendByCat.map(([, v]) => v))
  const empty = state.accounts.length === 0 && state.transactions.length === 0

  return (
    <div className="page">
      <h1>Dashboard</h1>

      {empty && (
        <div className="card welcome">
          <h2>Welcome 👋</h2>
          <p>This is your private, in-browser finance hub. Nothing you enter leaves this device.</p>
          <ol>
            <li><strong>Add accounts</strong> — your Fidelity, Chase, and Bank of America accounts with current balances.</li>
            <li><strong>Import transactions</strong> — download CSV activity from each bank's website and drop it in the Import tab. Formats are auto-detected.</li>
            <li><strong>Log benefits &amp; insurance</strong> — 401(k) match, HSA, policies and renewal dates.</li>
            <li><strong>Open the Advisor</strong> — fill in your profile to get tax and insurance-coverage guidance.</li>
          </ol>
          <div className="row gap">
            <button className="btn primary" onClick={() => onNavigate('accounts')}>Add first account</button>
            <button className="btn" onClick={() => onNavigate('import')}>Import a CSV</button>
          </div>
        </div>
      )}

      <div className="stat-row">
        <div className="stat-tile">
          <div className="stat-label">Net worth</div>
          <div className="stat-value">{fmt(totals.netWorth)}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Cash</div>
          <div className="stat-value">{fmt(totals.cash)}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Investments</div>
          <div className="stat-value">{fmt(totals.investments)}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-label">Debt</div>
          <div className="stat-value">{fmt(totals.debt)}</div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="card">
          <h2>Needs attention</h2>
          {alerts.map(r => (
            <div key={r.id} className={`alert ${r.severity}`}>
              <span className="alert-icon" aria-hidden>{r.severity === 'critical' ? '⛔' : '⚠️'}</span>
              <div>
                <strong>{r.title}</strong>
                <div className="muted small">{r.detail.slice(0, 160)}{r.detail.length > 160 ? '…' : ''}</div>
              </div>
            </div>
          ))}
          <button className="btn link" onClick={() => onNavigate('advisor')}>See all recommendations →</button>
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <h2>Cash flow — last 6 months</h2>
          <div className="legend">
            <span><i className="swatch s1" /> Income</span>
            <span><i className="swatch s2" /> Spending</span>
          </div>
          <div className="flow-chart" role="img" aria-label="Monthly income and spending bars">
            {months.map(k => (
              <div
                key={k}
                className="flow-month"
                onMouseEnter={() => setHoverMonth(k)}
                onMouseLeave={() => setHoverMonth(null)}
              >
                {hoverMonth === k && (
                  <div className="tooltip">
                    <strong>{k}</strong>
                    <div>In: {fmt(flows[k].income)}</div>
                    <div>Out: {fmt(flows[k].expense)}</div>
                  </div>
                )}
                <div className="flow-bars">
                  <div className="bar income" style={{ height: `${(flows[k].income / maxFlow) * 100}%` }} />
                  <div className="bar expense" style={{ height: `${(flows[k].expense / maxFlow) * 100}%` }} />
                </div>
                <div className="flow-label">{k.slice(5)}</div>
              </div>
            ))}
          </div>
          {state.transactions.length === 0 && <p className="muted">Import transactions to see cash flow.</p>}
        </div>

        <div className="card">
          <h2>Spending by category — this month</h2>
          {spendByCat.length === 0 && <p className="muted">No spending recorded this month yet.</p>}
          <div className="cat-chart">
            {spendByCat.map(([cat, v]) => (
              <div
                key={cat}
                className="cat-row"
                onMouseEnter={() => setHoverCat(cat)}
                onMouseLeave={() => setHoverCat(null)}
              >
                <span className="cat-name">{cat}</span>
                <div className="cat-track">
                  <div className="cat-bar" style={{ width: `${(v / maxCat) * 100}%` }} />
                </div>
                <span className="cat-value">{hoverCat === cat ? fmt(v, { maximumFractionDigits: 2 }) : fmt(v)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {state.insurance.length > 0 && (
        <div className="card">
          <h2>Insurance snapshot</h2>
          <table className="table">
            <thead>
              <tr><th>Type</th><th>Provider</th><th>Coverage</th><th>Premium</th><th>Renews</th></tr>
            </thead>
            <tbody>
              {state.insurance.map(p => (
                <tr key={p.id}>
                  <td>{p.type}</td>
                  <td>{p.provider}</td>
                  <td>{fmt(p.coverageAmount)}</td>
                  <td>{fmt(p.premium)} / {p.premiumFreq}</td>
                  <td>{p.renewalDate || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
