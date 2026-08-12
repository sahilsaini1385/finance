import React, { useMemo, useState } from 'react'
import { useStore, fmt } from '../store.jsx'
import { buildYearReport, savingsRate as savingsRateFor } from '../lib/report.js'
import Icon from './Icon.jsx'

export default function YearReport({ year }) {
  const { state } = useStore()
  const r = useMemo(() => buildYearReport(state, year), [state.transactions, state.history, year])
  const [hover, setHover] = useState(null)

  const net = r.income - r.spend
  const savingsRate = savingsRateFor(r.income, r.spend)
  const cats = Object.entries(r.byCat).sort((a, b) => b[1] - a[1])
  const maxCat = Math.max(1, ...cats.map(([, v]) => v))
  const maxFlow = Math.max(1, ...r.series.map(s => Math.max(s.income, s.spend)))

  if (r.monthsWithData === 0) {
    return (
      <div className="card">
        <div className="empty">
          <Icon name="bar-chart" />
          <strong>No activity recorded in {year}</strong>
          <span className="small">Sync or import transactions covering {year} to build its story.</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Income</div>
          <div className="stat-value money pos-text">{fmt(r.income)}</div>
          <div className="stat-sub">{r.prev.income > 0 ? `${fmt(r.prev.income)} in ${year - 1}` : `${r.monthsWithData} months of data`}</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Spending</div>
          <div className="stat-value money">{fmt(r.spend)}</div>
          <div className="stat-sub">
            {r.prev.spend > 0 ? `${r.spend <= r.prev.spend ? '↓' : '↑'} ${fmt(Math.abs(r.spend - r.prev.spend))} vs ${year - 1}` : `≈ ${fmt(r.spend / Math.max(1, r.monthsWithData))}/mo`}
          </div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">{net >= 0 ? 'Saved' : 'Overspent'}</div>
          <div className="stat-value money" style={net < 0 ? { color: 'var(--critical)' } : undefined}>{fmt(Math.abs(net))}</div>
          <div className="stat-sub">{savingsRate !== null ? `${savingsRate.toFixed(0)}% savings rate` : 'savings rate — needs more income data'}</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Net worth</div>
          <div className="stat-value money">
            {r.nwDelta === null ? '—' : `${r.nwDelta >= 0 ? '+' : '−'}${fmt(Math.abs(r.nwDelta))}`}
          </div>
          <div className="stat-sub">{r.nwDelta === null ? 'needs snapshots in this year' : `change during ${year}`}</div>
        </div>
      </div>

      <div className="card">
        <h2>Month by month</h2>
        <div className="legend">
          <span><i className="swatch s1" /> Income</span>
          <span><i className="swatch s2" /> Spending</span>
        </div>
        <div className="flow-chart" role="img" aria-label={`Monthly income and spending for ${year}`}>
          {r.series.map(s => (
            <div key={s.month} className="flow-month" onMouseEnter={() => setHover(s.month)} onMouseLeave={() => setHover(null)}>
              {hover === s.month && (s.income > 0 || s.spend > 0) && (
                <div className="tooltip">
                  <strong>{new Date(s.month + '-02').toLocaleString(undefined, { month: 'short' })}</strong>
                  <div className="tip-row"><span><i className="dot" style={{ background: 'var(--series-1)' }} /> In</span><span className="num">{fmt(s.income)}</span></div>
                  <div className="tip-row"><span><i className="dot" style={{ background: 'var(--series-2)' }} /> Out</span><span className="num">{fmt(s.spend)}</span></div>
                </div>
              )}
              <div className="flow-bars">
                <div className="bar income" style={{ height: `${(s.income / maxFlow) * 100}%` }} />
                <div className="bar expense" style={{ height: `${(s.spend / maxFlow) * 100}%` }} />
              </div>
              <div className="flow-label">{new Date(s.month + '-02').toLocaleString(undefined, { month: 'narrow' })}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Spending by category — {year}</h2>
          <div className="cat-chart">
            {cats.map(([cat, v]) => {
              const prevV = r.prev.byCat[cat] || 0
              return (
                <div key={cat} className="cat-row" style={{ gridTemplateColumns: '110px 1fr 150px' }}>
                  <span className="cat-name">{cat}</span>
                  <div className="cat-track"><div className="cat-bar" style={{ width: `${(v / maxCat) * 100}%` }} /></div>
                  <span className="cat-value">
                    {fmt(v)}
                    <span className="muted small">
                      {' '}{prevV > 0 && Math.abs(v - prevV) >= 1 ? (v < prevV ? '↓' : '↑') + fmt(Math.abs(v - prevV)) : ''}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card">
          <h2>Top merchants — {year}</h2>
          <table className="table">
            <tbody>
              {r.topMerchants.map(([m, v]) => (
                <tr key={m}><td>{m.toLowerCase()}</td><td className="num">{fmt(v)}</td></tr>
              ))}
            </tbody>
          </table>
          <h2 style={{ marginTop: 16 }}>Largest transactions</h2>
          <table className="table">
            <tbody>
              {r.biggest.map((t, i) => (
                <tr key={i}>
                  <td className="small nowrap">{t.date}</td>
                  <td className="desc small">{t.description}</td>
                  <td className="num">{fmt(-t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
