import React, { useMemo, useState } from 'react'
import { useStore, fmt } from '../store.jsx'
import { scenarioBaseline, runScenario } from '../lib/scenario.js'
import { formatMonths } from '../lib/mortgage.js'
import Icon from './Icon.jsx'
import PlanBasics from './PlanBasics.jsx'

// What-if sandbox: fork the real numbers, move levers, compare side by side.
// Scenarios can be time-boxed — phase 1 for N years, an optional "after
// that" phase, then back to today's numbers. Levers live in component state
// only; nothing here changes stored data.

const PHASE_KEYS = ['income', 'spouseIncome', 'spendMonthly', 'extraInvestMonthly', 'extraPrincipalMonthly']
const DURATIONS = [1, 2, 3, 4, 5, 7, 10]

function phaseFrom(b, over = {}) {
  return {
    years: '', income: b.income, spouseIncome: b.spouseIncome, spendMonthly: b.spendMonthly,
    extraInvestMonthly: 0, extraPrincipalMonthly: 0, ...over,
  }
}

function Lever({ label, k, phase, setPhase, money, base }) {
  const changed = base !== undefined && Number(phase[k]) !== Number(base)
  return (
    <label>{label}
      <span className={money ? 'input-money' : undefined}>
        <input
          type="number" inputMode="decimal"
          value={phase[k]}
          onChange={e => setPhase(k, e.target.value === '' ? '' : Number(e.target.value))}
        />
      </span>
      {changed && <span className="small muted" style={{ display: 'block', marginTop: 3 }}>today: {money ? fmt(base) : base}</span>}
    </label>
  )
}

const dateLabel = m => new Date(m + '-02').toLocaleString(undefined, { month: 'short', year: 'numeric' })
const yrs = n => `${n} yr${n === 1 ? '' : 's'}`

export default function Scenarios() {
  const { state } = useStore()
  const baseline = useMemo(() => scenarioBaseline(state), [state])
  const [p1, setP1] = useState(() => phaseFrom(baseline))
  const [p2, setP2] = useState(() => phaseFrom(baseline))
  const [globals, setGlobals] = useState({ retireAge: baseline.retireAge, windfall: 0 })
  const setPhase1 = (k, v) => setP1(ph => ({ ...ph, [k]: v }))
  const setPhase2 = (k, v) => setP2(ph => ({ ...ph, [k]: v }))
  const reset = () => { setP1(phaseFrom(baseline)); setP2(phaseFrom(baseline)); setGlobals({ retireAge: baseline.retireAge, windfall: 0 }) }

  const timeboxed = p1.years !== '' && Number(p1.years) > 0
  const scenario = {
    retireAge: globals.retireAge,
    windfall: globals.windfall,
    phases: [
      { ...p1, years: timeboxed ? Number(p1.years) : null },
      ...(timeboxed ? [{ ...p2, years: p2.years === '' ? null : Number(p2.years) }] : []),
    ],
  }
  const touched =
    PHASE_KEYS.some(k => Number(p1[k]) !== Number(phaseFrom(baseline)[k])) || timeboxed ||
    (timeboxed && PHASE_KEYS.some(k => Number(p2[k]) !== Number(phaseFrom(baseline)[k]))) ||
    Number(globals.retireAge) !== baseline.retireAge || Number(globals.windfall) !== 0

  const result = useMemo(() => runScenario(state, scenario), [state, JSON.stringify(scenario)])

  if (!result.ready) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Scenarios</h1></div></div>
        <PlanBasics
          icon="lightbulb"
          title="Three numbers to start"
          missing={result.missing}
          blurb="The sandbox replays your plan under a change you're considering."
        />
      </div>
    )
  }

  const { base, scen, phases } = result

  const PRESETS = [
    { label: 'One income for 2 years', apply: () => { reset(); setP1(phaseFrom(baseline, { spouseIncome: 0, years: 2 })) } },
    { label: 'Half income for 1 year', apply: () => { reset(); setP1(phaseFrom(baseline, { income: Math.round(baseline.income / 2), years: 1 })) } },
    { label: 'Spend $1,000/mo less', apply: () => { reset(); setP1(phaseFrom(baseline, { spendMonthly: Math.max(0, baseline.spendMonthly - 1000) })) } },
    { label: 'Invest $1,000/mo more', apply: () => { reset(); setP1(phaseFrom(baseline, { extraInvestMonthly: 1000 })) } },
    { label: '+$500/mo to mortgage for 5 years', apply: () => { reset(); setP1(phaseFrom(baseline, { extraPrincipalMonthly: 500, years: 5 })) } },
    { label: '$50k windfall invested', apply: () => { reset(); setGlobals(g => ({ ...g, windfall: 50000 })) } },
    { label: 'Retire 3 years earlier', apply: () => { reset(); setGlobals(g => ({ ...g, retireAge: Math.max(40, baseline.retireAge - 3) })) } },
  ]

  // Phase labels for the flow note and the contributions chain.
  const phaseLabel = (i, ph) => {
    if (ph.years === null) return i === 0 ? 'Ongoing' : 'After that'
    const start = phases.slice(0, i).reduce((s, x) => s + (x.years || 0), 0)
    return ph.years === 1 ? `Year ${start + 1}` : `Years ${start + 1}–${start + ph.years}`
  }
  const contribChain = phases.length > 1
    ? phases.map(ph => `${fmt(ph.contribAnnual)}${ph.years ? ` for ${yrs(ph.years)}` : ''}`).join(', then ')
    : fmt(scen.annualContrib)

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
      label: 'FI target (25× long-run spending)',
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
      b: fmt(base.annualContrib), s: contribChain,
      delta: scen.annualContrib - base.annualContrib,
      fmtDelta: d => `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}${phases.length > 1 ? ' long-run' : ''}`,
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

  const durationSelect = (value, onChange, foreverLabel) => (
    <select value={value} onChange={e => onChange(e.target.value)} aria-label="Phase duration">
      <option value="">{foreverLabel}</option>
      {DURATIONS.map(n => <option key={n} value={n}>{yrs(n)}</option>)}
    </select>
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Scenarios</h1>
          <p className="muted small">
            A sandbox copy of your real numbers. Move a lever, see what changes — nothing here edits your data.
          </p>
        </div>
        {touched && <button className="btn" onClick={reset}>Reset to today</button>}
      </div>

      <div className="card">
        <h2><span className="icon-chip"><Icon name="lightbulb" /></span> What if…</h2>
        <div className="chip-row" style={{ marginBottom: 10 }}>
          {PRESETS.map(pr => (
            <button key={pr.label} className="chip" onClick={pr.apply}>{pr.label}</button>
          ))}
        </div>

        <div className="row gap wrap" style={{ alignItems: 'center', marginBottom: 8 }}>
          <strong className="small">{timeboxed ? `First ${yrs(Number(p1.years))}` : 'The change'}</strong>
          <span className="small muted">lasts</span>
          {durationSelect(p1.years, v => setPhase1('years', v), 'from now on')}
        </div>
        <div className="form-grid">
          <Lever label="Your gross income" k="income" phase={p1} setPhase={setPhase1} money base={baseline.income} />
          <Lever label="Spouse gross income" k="spouseIncome" phase={p1} setPhase={setPhase1} money base={baseline.spouseIncome} />
          <Lever label="Monthly spending" k="spendMonthly" phase={p1} setPhase={setPhase1} money base={baseline.spendMonthly} />
          <Lever label="Extra invested per month" k="extraInvestMonthly" phase={p1} setPhase={setPhase1} money />
          <Lever label="Extra mortgage principal per month" k="extraPrincipalMonthly" phase={p1} setPhase={setPhase1} money />
        </div>

        {timeboxed && (
          <>
            <div className="row gap wrap" style={{ alignItems: 'center', margin: '14px 0 8px' }}>
              <strong className="small">After that</strong>
              <span className="small muted">for</span>
              {durationSelect(p2.years, v => setPhase2('years', v), 'ever after')}
              {p2.years !== '' && <span className="small muted">— then back to today's numbers</span>}
            </div>
            <div className="form-grid">
              <Lever label="Your gross income" k="income" phase={p2} setPhase={setPhase2} money base={baseline.income} />
              <Lever label="Spouse gross income" k="spouseIncome" phase={p2} setPhase={setPhase2} money base={baseline.spouseIncome} />
              <Lever label="Monthly spending" k="spendMonthly" phase={p2} setPhase={setPhase2} money base={baseline.spendMonthly} />
              <Lever label="Extra invested per month" k="extraInvestMonthly" phase={p2} setPhase={setPhase2} money />
              <Lever label="Extra mortgage principal per month" k="extraPrincipalMonthly" phase={p2} setPhase={setPhase2} money />
            </div>
          </>
        )}

        <div className="form-grid" style={{ marginTop: 14 }}>
          <label>Retire at age
            <input type="number" inputMode="decimal" value={globals.retireAge}
              onChange={e => setGlobals(g => ({ ...g, retireAge: e.target.value === '' ? '' : Number(e.target.value) }))} />
            {Number(globals.retireAge) !== baseline.retireAge && <span className="small muted" style={{ display: 'block', marginTop: 3 }}>plan today: {baseline.retireAge}</span>}
          </label>
          <label>One-time windfall, invested
            <span className="input-money">
              <input type="number" inputMode="decimal" value={globals.windfall}
                onChange={e => setGlobals(g => ({ ...g, windfall: e.target.value === '' ? '' : Number(e.target.value) }))} />
            </span>
          </label>
        </div>

        {touched && phases.some(ph => ph.flowMonthly !== 0) && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            Cash-flow change:{' '}
            {phases.filter(ph => ph.flowMonthly !== 0 || phases.length > 1).map((ph, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                {phaseLabel(phases.indexOf(ph), ph)}:{' '}
                <strong className={ph.flowMonthly >= 0 ? 'pos-text' : 'neg-text'}>
                  {ph.flowMonthly >= 0 ? '+' : '−'}{fmt(Math.abs(ph.flowMonthly))}/mo
                </strong>
              </span>
            ))}
            {' '}after rough federal tax — assumed to flow into (or out of) investing.
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
          Assumptions: income/spending changes flow through to investing during their phase (never below $0);
          federal tax only, rough brackets; 5% real growth and the 4% rule for FI, judged against long-run
          spending; retirement odds from the same simulation as the Retirement tab (seeded, so deltas are real,
          not noise). Educational, not a plan.
        </p>
      </div>
    </div>
  )
}
