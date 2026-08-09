import React, { useMemo, useState } from 'react'
import { useStore, fmt } from '../store.jsx'
import { buildMonthlyReport, shiftMonth } from '../lib/report.js'
import { localMonth } from '../lib/dates.js'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'
import YearReport from './YearReport.jsx'
import TaxSummary from './TaxSummary.jsx'

export default function Report() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const thisMonth = localMonth()
  const thisYear = new Date().getFullYear()
  const [mode, setMode] = useState('month')
  const [month, setMonth] = useState(thisMonth)
  const [year, setYear] = useState(thisYear)
  const isCurrent = month === thisMonth

  const saved = (state.reports || []).find(r => r.month === month)
  const live = useMemo(
    () => (isCurrent || !saved ? buildMonthlyReport(state, month) : null),
    [state.transactions, state.history, month, isCurrent, saved],
  )
  // Closed months render their archived record; the current month is live.
  const r = !isCurrent && saved ? saved : live

  const refreshSnapshot = () => {
    dispatch({ type: 'SAVE_REPORT', payload: buildMonthlyReport(state, month) })
    toast(`Report for ${monthLabel} re-archived with today's data`, { kind: 'good' })
  }

  const net = r.income - r.spend
  const savingsRate = r.income > 0 ? (net / r.income) * 100 : null
  const monthLabel = new Date(month + '-02').toLocaleString(undefined, { month: 'long', year: 'numeric' })
  const cats = Object.entries(r.byCat).sort((a, b) => b[1] - a[1])
  const maxCat = Math.max(1, ...cats.map(([, v]) => v))
  const overBudget = cats.filter(([c, v]) => r.budgets[c] && v > r.budgets[c])
  const underBudget = Object.entries(r.budgets).filter(([c, b]) => (r.byCat[c] || 0) <= b)
  const hasData = r.income > 0 || r.spend > 0
  const archive = [...(state.reports || [])].sort((a, b) => (a.month < b.month ? 1 : -1))

  const modeBtn = (id, label) => (
    <button className={mode === id ? 'btn small primary' : 'btn small'} onClick={() => setMode(id)}>{label}</button>
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>
            {mode === 'month' ? `${monthLabel} in review` : mode === 'year' ? `${year} in review` : `Tax summary — ${year}`}
          </h1>
          <p className="muted small">
            {mode === 'tax'
              ? 'Annual totals a preparer actually asks for, from your categorized data.'
              : mode === 'year'
                ? 'The whole year at a glance.'
                : isCurrent
                  ? 'Live — this month is still in progress; it archives automatically when it closes.'
                  : saved
                    ? `Archived ${new Date(saved.generatedAt).toLocaleDateString()} — frozen month-end record.`
                    : 'Everything your money did this month, on one page.'}
          </p>
        </div>
        <div className="row gap wrap">
          {modeBtn('month', 'Month')}
          {modeBtn('year', 'Year')}
          {modeBtn('tax', 'Tax')}
          {mode === 'month' ? (
            <>
              {!isCurrent && saved && (
                <button className="btn small" onClick={refreshSnapshot} title="Rebuild this archive from current data (late transactions, recategorizations)">
                  Refresh snapshot
                </button>
              )}
              <button className="btn small" onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label="Previous month">←</button>
              <button className="btn small" onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={month >= thisMonth} aria-label="Next month">→</button>
            </>
          ) : (
            <>
              <button className="btn small" onClick={() => setYear(y => y - 1)} aria-label="Previous year">←</button>
              <strong className="nowrap">{year}</strong>
              <button className="btn small" onClick={() => setYear(y => y + 1)} disabled={year >= thisYear} aria-label="Next year">→</button>
            </>
          )}
        </div>
      </div>

      {mode === 'year' && <YearReport year={year} />}
      {mode === 'tax' && <TaxSummary year={year} />}
      {mode === 'month' && (
      <>


      {archive.length > 0 && (
        <div className="chip-row">
          <span>Saved reports:</span>
          {archive.slice(0, 12).map(rep => (
            <button
              key={rep.month}
              className="chip"
              style={rep.month === month ? { outline: '2px solid var(--accent)' } : undefined}
              onClick={() => setMonth(rep.month)}
            >
              {new Date(rep.month + '-02').toLocaleString(undefined, { month: 'short', year: '2-digit' })}
            </button>
          ))}
        </div>
      )}

      {!hasData ? (
        <div className="card">
          <div className="empty">
            <Icon name="bar-chart" />
            <strong>No activity recorded for {monthLabel}</strong>
            <span className="small">Sync or import transactions covering this month to build its report.</span>
          </div>
        </div>
      ) : (
        <>
          <div className="stat-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">Income</div>
              <div className="stat-value money pos-text">{fmt(r.income)}</div>
              <div className="stat-sub">{r.prev.income > 0 ? `${fmt(r.prev.income)} last month` : '—'}</div>
            </div>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">Spending</div>
              <div className="stat-value money">{fmt(r.spend)}</div>
              <div className="stat-sub">
                {r.prev.spend > 0
                  ? `${r.spend <= r.prev.spend ? '↓' : '↑'} ${fmt(Math.abs(r.spend - r.prev.spend))} vs last month`
                  : '—'}
              </div>
            </div>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">{net >= 0 ? 'Saved' : 'Overspent'}</div>
              <div className="stat-value money" style={net < 0 ? { color: 'var(--critical)' } : undefined}>
                {fmt(Math.abs(net))}
              </div>
              <div className="stat-sub">{savingsRate !== null ? `${savingsRate.toFixed(0)}% savings rate` : '—'}</div>
            </div>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">Net worth</div>
              <div className="stat-value money">
                {r.nwDelta === null || r.nwDelta === undefined ? '—' : `${r.nwDelta >= 0 ? '+' : '−'}${fmt(Math.abs(r.nwDelta))}`}
              </div>
              <div className="stat-sub">{r.nwDelta === null || r.nwDelta === undefined ? 'needs snapshots in this month' : 'change this month'}</div>
            </div>
          </div>

          <div className="grid-2">
            <div className="card">
              <h2>Spending by category</h2>
              <div className="cat-chart">
                {cats.map(([cat, v]) => {
                  const prevV = r.prev.byCat[cat] || 0
                  const b = r.budgets[cat]
                  return (
                    <div key={cat} className="cat-row" style={{ gridTemplateColumns: '110px 1fr 150px' }}>
                      <span className="cat-name">{cat}</span>
                      <div className="cat-track">
                        <div
                          className="cat-bar"
                          style={{ width: `${(v / maxCat) * 100}%`, background: b && v > b ? 'var(--critical)' : 'var(--series-2)' }}
                        />
                      </div>
                      <span className="cat-value">
                        {fmt(v)}
                        <span className="muted small">
                          {' '}{b ? `/ ${fmt(b)}` : prevV > 0 && Math.abs(v - prevV) >= 1 ? (v < prevV ? '↓' : '↑') + fmt(Math.abs(v - prevV)) : ''}
                        </span>
                      </span>
                    </div>
                  )
                })}
              </div>
              {(overBudget.length > 0 || underBudget.length > 0) && (
                <p className="muted small" style={{ marginBottom: 0 }}>
                  {overBudget.length > 0 && <>Over budget: {overBudget.map(([c]) => c).join(', ')}. </>}
                  {underBudget.length > 0 && <>On track: {underBudget.length} of {Object.keys(r.budgets).length} budgeted categories.</>}
                </p>
              )}
            </div>

            <div className="card">
              <h2>Top merchants</h2>
              {r.topMerchants.length === 0 ? (
                <p className="muted small">No merchant data this month.</p>
              ) : (
                <table className="table">
                  <tbody>
                    {r.topMerchants.map(([m, v]) => (
                      <tr key={m}>
                        <td>{m.toLowerCase()}</td>
                        <td className="num">{fmt(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
              {r.subsMonthly > 0 && (
                <p className="muted small" style={{ marginBottom: 0 }}>
                  Recurring subscriptions ran ~{fmt(r.subsMonthly)} this month — the full list lives in the Advisor.
                </p>
              )}
            </div>
          </div>
        </>
      )}
      </>
      )}
    </div>
  )
}
