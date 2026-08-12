import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, fmt } from '../store.jsx'
import { computeTotals, getRecommendations } from '../lib/advisor.js'
import { monthActivity } from '../lib/budget.js'
import { localMonth } from '../lib/dates.js'
import { detectRecurring, upcomingBills } from '../lib/savings.js'
import { txParts } from '../lib/tx.js'
import ConflictBanner from './ConflictBanner.jsx'
import Icon from './Icon.jsx'

// Cut preview text at a word boundary — mid-word cuts ("(avalan…") read broken.
function truncateAtWord(s, max) {
  if (!s || s.length <= max) return s
  const cut = s.slice(0, max)
  const at = cut.lastIndexOf(' ')
  return (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:.]$/, '') + '…'
}
import AreaChart from './AreaChart.jsx'

function monthKey(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : ''
}

function lastNMonths(n) {
  const out = []
  const d = new Date()
  d.setDate(1)
  for (let i = 0; i < n; i++) {
    out.unshift(localMonth(d))
    d.setMonth(d.getMonth() - 1)
  }
  return out
}

function useCountUp(target, duration = 600) {
  const [value, setValue] = useState(target)
  const prev = useRef(target)
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || prev.current === target) {
      prev.current = target
      setValue(target)
      return
    }
    const from = prev.current
    prev.current = target
    const start = performance.now()
    let raf
    const step = now => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(from + (target - from) * eased)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

const GHOST_FLOW = [0.55, 0.4, 0.7, 0.5, 0.85, 0.6]
const GHOST_CATS = [0.9, 0.65, 0.5, 0.35, 0.2]

export default function Dashboard({ onNavigate }) {
  const { state } = useStore()
  const totals = computeTotals(state)
  const [hoverMonth, setHoverMonth] = useState(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const months = useMemo(() => lastNMonths(6), [])
  // Canonical month definition (budget.js monthActivity): income = Income
  // category only; spend excludes Income/Transfers/Investments with refunds
  // netted. The old any-positive-is-income rule counted 401(k) rollovers as
  // income and brokerage buys as spending.
  const flows = useMemo(() => {
    const m = {}
    for (const k of months) {
      const { income, spentByCat } = monthActivity(state, k)
      m[k] = { income, expense: Object.values(spentByCat).reduce((s, v) => s + v, 0) }
    }
    return m
  }, [state.transactions, months])

  const thisMonth = localMonth()
  const spendByCat = useMemo(() => {
    const m = {}
    for (const t of state.transactions) {
      if (monthKey(t.date) !== thisMonth) continue
      for (const p of txParts(t)) {
        if (p.category === 'Transfers' || p.category === 'Investments' || p.category === 'Income') continue
        m[p.category] = (m[p.category] || 0) + -p.amount // refunds/reimbursements net out
      }
    }
    return Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [state.transactions, thisMonth])

  const recs = useMemo(() => getRecommendations(state), [state])
  const alerts = recs.filter(r => r.severity === 'critical' || r.severity === 'warning')

  const upcoming = useMemo(() => {
    const ignored = new Set((state.billPrefs || []).filter(p => p.status === 'ignored').map(p => p.merchant))
    const recurring = detectRecurring(state.transactions).filter(r => !ignored.has(r.merchant))
    return upcomingBills(recurring, state.insurance, 30)
  }, [state.transactions, state.insurance, state.billPrefs])

  const maxFlow = Math.max(1, ...months.map(k => Math.max(flows[k].income, flows[k].expense)))
  const maxCat = Math.max(1, ...spendByCat.map(([, v]) => v))
  const hasTx = state.transactions.length > 0
  const hasAccounts = state.accounts.length > 0

  const netFlow = flows[thisMonth] ? flows[thisMonth].income - flows[thisMonth].expense : 0

  const p = state.profile
  const steps = [
    { label: 'Add an account', done: hasAccounts, cta: 'Accounts', nav: 'accounts' },
    { label: 'Bring in transactions', done: hasTx, cta: 'Add data', nav: 'import' },
    { label: 'Add insurance & benefits', done: state.insurance.length + state.benefits.length > 0, cta: 'Insurance', nav: 'insurance' },
    { label: 'Answer the Advisor profile', done: Boolean(p.age && p.grossIncome), cta: 'Advisor', nav: 'advisor' },
  ]
  const doneCount = steps.filter(s => s.done).length

  const heroValue = useCountUp(totals.netWorth)
  const cash = useCountUp(totals.cash)
  const invest = useCountUp(totals.investments)
  const debt = useCountUp(totals.debt)
  const homeEquity = useCountUp(totals.homeEquity)

  // Chart points: daily snapshots, downsampled to one per ISO week past 240
  // points so years of history stay a light SVG path. First and last raw
  // snapshots always survive, so the "Since <date>" math stays exact.
  const chartPoints = useMemo(() => {
    let h = state.history
    if (h.length > 240) {
      const byWeek = new Map()
      for (const snap of h.slice(1, -1)) {
        const d = new Date(snap.date + 'T12:00')
        const day = (d.getDay() + 6) % 7
        const monday = new Date(d)
        monday.setDate(d.getDate() - day)
        byWeek.set(monday.toISOString().slice(0, 10), snap) // last snapshot wins
      }
      h = [h[0], ...byWeek.values(), h[h.length - 1]]
    }
    return h.map(p => ({
      x: new Date(p.date + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      value: p.netWorth,
    }))
  }, [state.history])

  const accountCount = type => {
    const n = state.accounts.filter(a => type.includes(a.type)).length
    return `${n} account${n === 1 ? '' : 's'}`
  }

  const monthLabel = k => new Date(k + '-02').toLocaleString(undefined, { month: 'short', year: 'numeric' })

  return (
    <div className="page">
      <h1>Overview</h1>
      <ConflictBanner surface="dashboard" />

      {doneCount < 4 && (
        <div className="card">
          <h2>
            Set up in ~3 minutes
            <span className="badge">{doneCount} of 4</span>
          </h2>
          {steps.map(s => (
            <div key={s.label} className={s.done ? 'checklist-step done' : 'checklist-step'}>
              <span className={s.done ? 'step-dot done' : 'step-dot'}>
                {s.done && <Icon name="check" size={12} />}
              </span>
              <span className="step-text">{s.label}</span>
              {!s.done && (
                <button className="btn small" onClick={() => onNavigate(s.nav)}>
                  {s.cta} →
                </button>
              )}
            </div>
          ))}
          <div className="progress-segments" aria-hidden>
            {steps.map((s, i) => <i key={i} className={s.done ? 'on' : ''} />)}
          </div>
        </div>
      )}

      <div className="card hero-card">
        <div className="eyebrow">Net worth</div>
        <div className="hero-value money">
          {hasAccounts ? fmt(Math.round(heroValue)) : '—'}
          {hasTx && netFlow !== 0 && (
            <span className={netFlow >= 0 ? 'delta-chip' : 'delta-chip down'}>
              <Icon name={netFlow >= 0 ? 'arrow-up-right' : 'arrow-down-right'} size={12} />
              {netFlow >= 0 ? '+' : '−'}{fmt(Math.abs(Math.round(netFlow)))} this month
            </span>
          )}
        </div>
        {!hasAccounts && <div className="hero-sub">Add an account to start</div>}
        {(() => {
          const go = () => onNavigate('accounts')
          const key = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } }
          const cell = (label, value, sub) => (
            <div className="hs-cell" role="button" tabIndex={0} onClick={go} onKeyDown={key} aria-label={`${label} — open Accounts`}>
              <div className="stat-label">{label}</div>
              <div className="stat-value sm money">{hasAccounts ? fmt(Math.round(value)) : '—'}</div>
              <div className="stat-sub">{sub}</div>
            </div>
          )
          return (
            <div className="hero-stats">
              {cell('Cash', cash, `${accountCount(['checking', 'savings'])}${totals.other !== 0 ? ` · ${fmt(totals.other)} other` : ''}`)}
              {cell('Investments', invest, `${accountCount(['brokerage', 'retirement', 'hsa', '529'])}${totals.excluded !== 0 ? ` · ${fmt(Math.abs(totals.excluded))} unvested excluded` : ''}`)}
              {totals.homeEquity !== 0 && cell('Home equity', homeEquity, 'included in net worth')}
              {cell('Debt', debt, accountCount(['credit card', 'loan', 'mortgage']))}
            </div>
          )
        })()}
        {state.history.length >= 2 ? (
          <>
            <AreaChart id="nw" points={chartPoints} height={64} />
            <div className="hero-sub">
              Since {new Date(state.history[0].date + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}:{' '}
              {(() => {
                const d = state.history[state.history.length - 1].netWorth - state.history[0].netWorth
                return `${d >= 0 ? '+' : '−'}${fmt(Math.abs(Math.round(d)))}`
              })()}
              {state.history.length < 14 && <> · snapshots record automatically whenever balances change</>}
            </div>
          </>
        ) : hasAccounts ? (
          <div className="hero-sub">History starts now — your net-worth chart draws itself as balances update over the coming days.</div>
        ) : null}
      </div>

      {alerts.length > 0 && (
        <div className="card">
          <h2>Needs attention ({alerts.length})</h2>
          {alerts.slice(0, 2).map(r => (
            <div key={r.id} className={`alert ${r.severity}`}>
              <span className={`sev-chip ${r.severity}`}>
                <Icon name={r.severity === 'critical' ? 'octagon-alert' : 'alert-triangle'} size={14} />
              </span>
              <div>
                <strong>{r.title}</strong>
                <div className="rec-detail">{truncateAtWord(r.detail, 140)}</div>
              </div>
            </div>
          ))}
          <button className="btn link" onClick={() => onNavigate('advisor')}>Review all in Advisor →</button>
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <h2>Cash flow — last 6 months</h2>
          <div className="legend">
            <span><i className="swatch s1" /> Income</span>
            <span><i className="swatch s2" /> Spending</span>
          </div>
          {hasTx ? (
            <div className="flow-chart" role="group" aria-label="Monthly income and spending — select a month to open its report">
              {months.map(k => (
                <div
                  key={k}
                  className="flow-month clickable"
                  role="button"
                  tabIndex={0}
                  aria-label={`Open the ${monthLabel(k)} report`}
                  onClick={() => onNavigate('report', k)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate('report', k) } }}
                  onMouseEnter={() => setHoverMonth(k)}
                  onMouseLeave={() => setHoverMonth(null)}
                  onFocus={() => setHoverMonth(k)}
                  onBlur={() => setHoverMonth(null)}
                >
                  {hoverMonth === k && (
                    <div className="tooltip">
                      <strong>{monthLabel(k)}</strong>
                      <div className="tip-row"><span><i className="dot" style={{ background: 'var(--series-1)' }} /> In</span><span className="num">{fmt(flows[k].income)}</span></div>
                      <div className="tip-row"><span><i className="dot" style={{ background: 'var(--series-2)' }} /> Out</span><span className="num">{fmt(flows[k].expense)}</span></div>
                      <div className="tip-row muted"><span>Open report</span><span>→</span></div>
                    </div>
                  )}
                  <div className="flow-bars">
                    <div className="bar income" style={{ height: mounted ? `${(flows[k].income / maxFlow) * 100}%` : 0 }} />
                    <div className="bar expense" style={{ height: mounted ? `${(flows[k].expense / maxFlow) * 100}%` : 0 }} />
                  </div>
                  <div className="flow-label">{monthLabel(k).split(' ')[0]}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ghost-wrap">
              <div className="flow-chart ghost-chart">
                {GHOST_FLOW.map((h, i) => (
                  <div key={i} className="flow-month">
                    <div className="flow-bars">
                      <div className="bar income" style={{ height: `${h * 100}%` }} />
                      <div className="bar expense" style={{ height: `${h * 70}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="ghost-overlay">
                Sample — bring in transactions to see yours
                <button className="btn small" onClick={() => onNavigate('import')}>Add data</button>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Spending — this month</h2>
          {spendByCat.length > 0 ? (
            <div className="cat-chart">
              {spendByCat.map(([cat, v]) => (
                <div key={cat} className="cat-row">
                  <span className="cat-name">{cat}</span>
                  <div className="cat-track">
                    <div className="cat-bar" style={{ width: mounted ? `${(v / maxCat) * 100}%` : 0 }} />
                  </div>
                  <span className="cat-value" title={fmt(v, { maximumFractionDigits: 2 })}>{fmt(v)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="ghost-wrap">
              <div className="cat-chart ghost-chart">
                {GHOST_CATS.map((w, i) => (
                  <div key={i} className="cat-row">
                    <span className="cat-name">·····</span>
                    <div className="cat-track"><div className="cat-bar" style={{ width: `${w * 100}%` }} /></div>
                    <span className="cat-value">—</span>
                  </div>
                ))}
              </div>
              <div className="ghost-overlay">No spending recorded this month yet</div>
            </div>
          )}
        </div>
      </div>

      {upcoming.bills.length > 0 && (
        <div className="card">
          <h2>
            <span className="icon-chip"><Icon name="calendar" /></span>
            Upcoming bills — next 30 days · ~{fmt(upcoming.total)}
          </h2>
          <table className="table">
            <thead><tr><th>Due</th><th>Bill</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {upcoming.bills.slice(0, 10).map((b, i) => (
                <tr key={i}>
                  <td className="small nowrap">{new Date(b.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                  <td>{b.label} {b.kind === 'renewal' && <span className="badge">renewal — re-shop</span>}</td>
                  <td className="num">{fmt(b.amount, { maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {upcoming.bills.length > 10 && <p className="muted small">…and {upcoming.bills.length - 10} more. Projected from your detected recurring charges.</p>}
        </div>
      )}

      {state.insurance.length > 0 && (
        <div className="card">
          <h2>Insurance snapshot</h2>
          <table className="table">
            <thead>
              <tr><th>Type</th><th>Provider</th><th className="num">Coverage</th><th className="num">Premium</th><th>Renews</th></tr>
            </thead>
            <tbody>
              {state.insurance.map(pol => (
                <tr key={pol.id}>
                  <td>{pol.type}</td>
                  <td>{pol.provider}</td>
                  <td className="num">{fmt(pol.coverageAmount)}</td>
                  <td className="num">{fmt(pol.premium)} / {pol.premiumFreq}</td>
                  <td>{pol.renewalDate || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
