import React, { useMemo, useState } from 'react'
import { useStore, fmt } from '../store.jsx'
import { normalizeMerchant, detectRecurring } from '../lib/savings.js'
import { effectiveBudgets } from '../lib/budget.js'
import Icon from './Icon.jsx'

const EXCLUDED = ['Transfers', 'Investments']

function shiftMonth(month, delta) {
  const d = new Date(month + '-02')
  d.setMonth(d.getMonth() + delta)
  return d.toISOString().slice(0, 7)
}

function monthStats(transactions, month) {
  let income = 0
  let spend = 0
  const byCat = {}
  const byMerchant = {}
  const biggest = []
  for (const t of transactions) {
    if (!t.date?.startsWith(month)) continue
    if (t.category === 'Income' && t.amount > 0) {
      income += t.amount
      continue
    }
    if (t.amount >= 0 || EXCLUDED.includes(t.category)) continue
    const amt = -t.amount
    spend += amt
    byCat[t.category] = (byCat[t.category] || 0) + amt
    const m = normalizeMerchant(t.description)
    if (m) byMerchant[m] = (byMerchant[m] || 0) + amt
    biggest.push(t)
  }
  biggest.sort((a, b) => a.amount - b.amount)
  return { income, spend, byCat, byMerchant, biggest: biggest.slice(0, 3) }
}

// Net-worth change across the month from history snapshots.
function netWorthDelta(history, month) {
  const inMonth = history.filter(h => h.date.startsWith(month))
  if (inMonth.length === 0) return null
  const before = history.filter(h => h.date < month + '-01')
  const start = before.length > 0 ? before[before.length - 1] : inMonth[0]
  const end = inMonth[inMonth.length - 1]
  if (start.date === end.date) return null
  return end.netWorth - start.netWorth
}

export default function Report() {
  const { state } = useStore()
  const thisMonth = new Date().toISOString().slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const prevMonth = shiftMonth(month, -1)

  const cur = useMemo(() => monthStats(state.transactions, month), [state.transactions, month])
  const prev = useMemo(() => monthStats(state.transactions, prevMonth), [state.transactions, prevMonth])
  const nwDelta = useMemo(() => netWorthDelta(state.history || [], month), [state.history, month])

  const subsMonthly = useMemo(() => {
    const recurring = detectRecurring(state.transactions)
    return recurring.filter(r => r.cadence === 'monthly' && r.medianAmount <= 100)
      .reduce((s, r) => s + r.monthlyCost, 0)
  }, [state.transactions])

  const net = cur.income - cur.spend
  const savingsRate = cur.income > 0 ? (net / cur.income) * 100 : null
  const monthLabel = new Date(month + '-02').toLocaleString(undefined, { month: 'long', year: 'numeric' })
  const budgets = effectiveBudgets(state, month)

  const cats = Object.entries(cur.byCat).sort((a, b) => b[1] - a[1])
  const maxCat = Math.max(1, ...cats.map(([, v]) => v))
  const merchants = Object.entries(cur.byMerchant).sort((a, b) => b[1] - a[1]).slice(0, 5)

  const overBudget = cats.filter(([c, v]) => budgets[c] && v > budgets[c])
  const underBudget = Object.entries(budgets).filter(([c, b]) => (cur.byCat[c] || 0) <= b)

  const hasData = cur.income > 0 || cur.spend > 0

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{monthLabel} in review</h1>
          <p className="muted small">Everything your money did this month, on one page.</p>
        </div>
        <div className="row gap">
          <button className="btn small" onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label="Previous month">←</button>
          <button className="btn small" onClick={() => setMonth(m => shiftMonth(m, 1))} disabled={month >= thisMonth} aria-label="Next month">→</button>
        </div>
      </div>

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
              <div className="stat-value money pos-text">{fmt(cur.income)}</div>
              <div className="stat-sub">{prev.income > 0 ? `${fmt(prev.income)} last month` : '—'}</div>
            </div>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">Spending</div>
              <div className="stat-value money">{fmt(cur.spend)}</div>
              <div className="stat-sub">
                {prev.spend > 0
                  ? `${cur.spend <= prev.spend ? '↓' : '↑'} ${fmt(Math.abs(cur.spend - prev.spend))} vs last month`
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
                {nwDelta === null ? '—' : `${nwDelta >= 0 ? '+' : '−'}${fmt(Math.abs(nwDelta))}`}
              </div>
              <div className="stat-sub">{nwDelta === null ? 'needs snapshots in this month' : 'change this month'}</div>
            </div>
          </div>

          <div className="grid-2">
            <div className="card">
              <h2>Spending by category</h2>
              <div className="cat-chart">
                {cats.map(([cat, v]) => {
                  const prevV = prev.byCat[cat] || 0
                  const b = budgets[cat]
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
                  {underBudget.length > 0 && <>On track: {underBudget.length} of {Object.keys(budgets).length} budgeted categories.</>}
                </p>
              )}
            </div>

            <div className="card">
              <h2>Top merchants</h2>
              {merchants.length === 0 ? (
                <p className="muted small">No merchant data this month.</p>
              ) : (
                <table className="table">
                  <tbody>
                    {merchants.map(([m, v]) => (
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
                  {cur.biggest.map(t => (
                    <tr key={t.id}>
                      <td className="small nowrap">{t.date}</td>
                      <td className="desc small">{t.description}</td>
                      <td className="num">{fmt(-t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {subsMonthly > 0 && (
                <p className="muted small" style={{ marginBottom: 0 }}>
                  Recurring subscriptions ran ~{fmt(subsMonthly)} this month — the full list lives in the Advisor.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
