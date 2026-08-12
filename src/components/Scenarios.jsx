import React, { useMemo, useState } from 'react'
import { useStore, fmt } from '../store.jsx'
import { scenarioBaseline, runScenario } from '../lib/scenario.js'
import { formatMonths } from '../lib/mortgage.js'
import Icon from './Icon.jsx'

// What-if sandbox: fork the real numbers, move levers, compare side by side.
// Levers live in component state only — nothing here changes stored data.

const PRESETS = [
  { label: 'Single income', apply: b => ({ ...b, spouseIncome: 0 }) },
  { label: 'Spend $1,000/mo less', apply: b => ({ ...b, spendMonthly: Math.max(0, b.spendMonthly - 1000) }) },
  { label: 'Invest $1,000/mo more', apply: b => ({ ...b, extraInvestMonthly: 1000 }) },
  { label: '+$500/mo to mortgage', apply: b => ({ ...b, extraPrincipalMonthly: 500 }) },
  { label: '$50k windfall invested', apply: b => ({ ...b, windfall: 50000 }) },
  { label: 'Retire 3 years earlier', apply: b => ({ ...b, retireAge: Math.max(40, b.retireAge - 3) }) },
]

function Lever({ label, k, levers, setLever, money, hint }) {
  return (
    <label>{label}
      <span className={money ? 'input-money' : undefined}>
        <input
          type="number" inputMode="decimal"
          value={levers[k]}
          onChange={e => setLever(k, e.target.value)}
        />
      </span>
      {hint && <span className="small muted" style={{ display: 'block', marginTop: 3 }}>{hint}</span>}
    </label>
  )
}

const dateLabel = m => new Date(m + '-02').toLocaleString(undefined, { month: 'short', year: 'numeric' })

export default function Scenarios() {
  const { state } = useStore()
  const baseline = useMemo(() => scenarioBaseline(state), [state])
  const [levers, setLevers] = useState(baseline)
  const setLever = (k, v) => setLevers(l => ({ ...l, [k]: v === '' ? '' : Number(v) }))

  const touched = JSON.stringify(levers) !== JSON.stringify(baseline)
  const result = useMemo(() => runScenario(state, levers), [state, levers])

  if (!result.ready) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Scenarios</h1></div></div>
        <div className="card">
          <p className="muted small" style={{ margin: 0 }}>
            The sandbox needs your {result.missing.join(' and ')} — fill them in on the Advisor tab
            (the profile there can pull most of it from your data in one click).
          </p>
        </div>
      </div>
    )
  }

  const { base, scen, flowMonthly } = result
  const rows = [
    {
      label: 'Financial independence at age',
      b: base.alreadyFI ? 'now' : base.fiAge ?? '60+ yrs away',
      s: scen.alreadyFI ? 'now' : scen.fiAge ?? '60+ yrs away',
      delta: base.fiAge && scen.fiAge ? scen.fiAge - base.fiAge : null,
      fmtDelta: d => `${d > 0 ? '+' : ''}${d} yr${Math.abs(d) === 1 ? '' : 's'}`,
      goodWhenNegative: true,
    },
    {
      label: 'FI target (25× spending)',
      b: fmt(base.fiNumber), s: fmt(scen.fiNumber),
      delta: scen.fiNumber - base.fiNumber, fmtDelta: d => `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`,
      goodWhenNegative: true,
    },
    {
      label: `Retirement success odds (at ${scen.retireAge})`,
      b: `${base.successPct}%`, s: `${scen.successPct}%`,
      delta: scen.successPct - base.successPct, fmtDelta: d => `${d > 0 ? '+' : ''}${d} pts`,
      goodWhenNegative: false,
    },
    {
      label: 'Median portfolio at retirement',
      b: fmt(base.medianAtRetirement), s: fmt(scen.medianAtRetirement),
      delta: scen.medianAtRetirement - base.medianAtRetirement, fmtDelta: d => `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`,
      goodWhenNegative: false,
    },
    {
      label: 'Money lasts until age',
      b: base.fundsLastUntil, s: scen.fundsLastUntil, delta: null,
    },
    {
      label: 'Investing per year',
      b: fmt(base.annualContrib), s: fmt(scen.annualContrib),
      delta: scen.annualContrib - base.annualContrib, fmtDelta: d => `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`,
      goodWhenNegative: false,
    },
    {
      label: 'Emergency fund covers',
      b: base.efMonths !== null ? `${base.efMonths} mo` : '—',
      s: scen.efMonths !== null ? `${scen.efMonths} mo` : '—',
      delta: base.efMonths !== null && scen.efMonths !== null ? Math.round((scen.efMonths - base.efMonths) * 10) / 10 : null,
      fmtDelta: d => `${d > 0 ? '+' : ''}${d} mo`,
      goodWhenNegative: false,
    },
    ...(base.mortgage && scen.mortgage ? [
      {
        label: 'Mortgage paid off',
        b: dateLabel(base.mortgage.payoffDate), s: dateLabel(scen.mortgage.payoffDate),
        delta: scen.mortgage.months - base.mortgage.months,
        fmtDelta: d => `${formatMonths(Math.abs(d))} ${d < 0 ? 'sooner' : 'later'}`,
        goodWhenNegative: true,
      },
      {
        label: 'Mortgage interest remaining',
        b: fmt(base.mortgage.interest), s: fmt(scen.mortgage.interest),
        delta: scen.mortgage.interest - base.mortgage.interest, fmtDelta: d => `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`,
        goodWhenNegative: true,
      },
    ] : []),
  ]

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Scenarios</h1>
          <p className="muted small">
            A sandbox copy of your real numbers. Move a lever, see what changes — nothing here edits your data.
          </p>
        </div>
        {touched && <button className="btn" onClick={() => setLevers(baseline)}>Reset to today</button>}
      </div>

      <div className="card">
        <h2><span className="icon-chip"><Icon name="lightbulb" /></span> What if…</h2>
        <div className="chip-row" style={{ marginBottom: 10 }}>
          {PRESETS.map(pr => (
            <button key={pr.label} className="chip" onClick={() => setLevers(pr.apply(baseline))}>{pr.label}</button>
          ))}
        </div>
        <div className="form-grid">
          <Lever label="Your gross income" k="income" levers={levers} setLever={setLever} money
            hint={levers.income !== baseline.income ? `today: ${fmt(baseline.income)}` : undefined} />
          <Lever label="Spouse gross income" k="spouseIncome" levers={levers} setLever={setLever} money
            hint={levers.spouseIncome !== baseline.spouseIncome ? `today: ${fmt(baseline.spouseIncome)}` : undefined} />
          <Lever label="Monthly spending" k="spendMonthly" levers={levers} setLever={setLever} money
            hint={levers.spendMonthly !== baseline.spendMonthly ? `today: ${fmt(baseline.spendMonthly)}` : undefined} />
          <Lever label="Retire at age" k="retireAge" levers={levers} setLever={setLever}
            hint={levers.retireAge !== baseline.retireAge ? `plan today: ${baseline.retireAge}` : undefined} />
          <Lever label="Extra invested per month" k="extraInvestMonthly" levers={levers} setLever={setLever} money />
          <Lever label="Extra mortgage principal per month" k="extraPrincipalMonthly" levers={levers} setLever={setLever} money />
          <Lever label="One-time windfall, invested" k="windfall" levers={levers} setLever={setLever} money />
        </div>
        {touched && flowMonthly !== 0 && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            Cash-flow change: <strong className={flowMonthly > 0 ? 'pos-text' : 'neg-text'}>
            {flowMonthly > 0 ? '+' : '−'}{fmt(Math.abs(flowMonthly))}/mo</strong> after rough federal tax —
            assumed to flow into (or out of) investing.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Today vs this scenario</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr><th>Outcome</th><th className="num">Today</th><th className="num">Scenario</th><th className="num">Change</th></tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const good = row.delta !== null && row.delta !== 0 && ((row.delta < 0) === row.goodWhenNegative)
                return (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className="num">{row.b}</td>
                    <td className="num" style={{ fontWeight: touched ? 600 : 400 }}>{row.s}</td>
                    <td className={`num ${row.delta ? (good ? 'pos-text' : 'neg-text') : ''}`}>
                      {row.delta ? row.fmtDelta(row.delta) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Assumptions: income/spending changes flow through to investing (never below $0); federal tax only,
          rough brackets; {`${Math.round(100 * 0.05)}`}% real growth and the 4% rule for FI; retirement odds from
          the same simulation as the Retirement tab (seeded, so deltas are real, not noise). Changes here are
          modeled as permanent — a one-year change lands somewhere in between. Educational, not a plan.
        </p>
      </div>
    </div>
  )
}
