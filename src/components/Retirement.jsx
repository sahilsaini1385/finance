import React, { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useStore, fmt } from '../store.jsx'
import { computeTotals } from '../lib/advisor.js'
import {
  retirementParams, deterministicProjection, monteCarloRetirement, ssExplorer,
  estimateSSMonthly, claimFactor, RETIREMENT_DEFAULTS,
} from '../lib/retirement.js'
import Icon from './Icon.jsx'
import PlanBasics from './PlanBasics.jsx'

// 10th–90th percentile Monte Carlo band with the median path — the picture
// Boldin leads with. Identity via direct labels, magnitude via position.
function BandChart({ band, retireAge }) {
  const wrapRef = useRef(null)
  const [hover, setHover] = useState(null)
  if (!band || band.length < 2) return null
  const W = 640
  const H = 200
  const PAD_Y = 14
  const max = Math.max(1, ...band.map(b => b.p90))
  const x = i => (i / (band.length - 1)) * W
  const y = v => H - PAD_Y - (v / max) * (H - PAD_Y * 2)
  const line = key => band.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(b[key]).toFixed(1)}`).join(' ')
  const area = `${line('p90')} ${band.map((b, i) => `L${x(band.length - 1 - i).toFixed(1)},${y(band[band.length - 1 - i].p10).toFixed(1)}`).join(' ')} Z`
  const retireIdx = band.findIndex(b => b.age === retireAge)

  const onMove = e => {
    const rect = wrapRef.current.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    setHover(Math.round(frac * (band.length - 1)))
  }
  const h = hover === null ? null : band[hover]

  return (
    <div ref={wrapRef} className="area-chart" onMouseMove={onMove} onMouseLeave={() => setHover(null)}
      role="img" aria-label={`Projected portfolio from age ${band[0].age} to ${band[band.length - 1].age}, median ending at ${fmt(band[band.length - 1].p50)}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block' }}>
        <path d={area} fill="var(--series-1)" opacity="0.13" />
        <path d={line('p50')} fill="none" stroke="var(--series-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {retireIdx > 0 && (
          <line x1={x(retireIdx)} x2={x(retireIdx)} y1={2} y2={H} stroke="var(--good)" strokeWidth="1.5"
            strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        )}
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className="legend" style={{ marginTop: 4 }}>
        <span><i className="swatch" style={{ background: 'var(--series-1)' }} /> Median of 1,000 markets</span>
        <span><i className="swatch" style={{ background: 'var(--series-1)', opacity: 0.25 }} /> 10th–90th percentile</span>
        <span><i className="swatch" style={{ background: 'var(--good)' }} /> Retirement at {retireAge}</span>
      </div>
      {h !== null && (
        <div className="chart-tip" style={{ left: `${(hover / (band.length - 1)) * 100}%` }}>
          <strong>{fmt(h.p50)}</strong>
          <span>age {h.age} · range {fmt(h.p10)}–{fmt(h.p90)}</span>
        </div>
      )}
    </div>
  )
}

export default function Retirement() {
  const { state, dispatch } = useStore()
  const totals = computeTotals(state)
  const r = state.retirement || {}
  const p = state.profile || {}
  const set = payload => dispatch({ type: 'SET_RETIREMENT', payload })

  const params = useMemo(() => retirementParams(state, totals.investments), [state.retirement, state.profile, state.accounts]) // eslint-disable-line react-hooks/exhaustive-deps

  // Defer the heavy work: typing in a lever stays instant, and the ~1,000
  // simulations re-run right behind the keystroke.
  const simParams = useDeferredValue(params)
  const results = useMemo(() => {
    if (!simParams.ready) return null
    const det = deterministicProjection(simParams)
    const mc = monteCarloRetirement(simParams)
    const ss = ssExplorer(simParams)
    return { det, mc, ss, params: simParams }
  }, [simParams])

  if (!params.ready) {
    return (
      <div className="page">
        <h1>Retirement</h1>
        <PlanBasics
          title="Three numbers to start"
          missing={params.missing}
          blurb="The planner projects your savings through age 95 across 1,000 simulated markets."
        />
      </div>
    )
  }

  if (!results) {
    return (
      <div className="page">
        <h1>Retirement</h1>
        <div className="card"><p className="muted small">Running simulations…</p></div>
      </div>
    )
  }

  const { det, mc, ss } = results
  const score = Math.round(mc.successRate * 100)
  const scoreColor = score >= 80 ? 'var(--good-text, var(--good))' : score >= 50 ? 'var(--warning-text, var(--warning))' : 'var(--critical)'
  const medianEnd = mc.band[mc.band.length - 1].p50
  const medianAtRetire = mc.band.find(b => b.age === results.params.retireAge)?.p50 ?? 0
  // Works for any claim age, not just the explorer's 62/67/70 rows
  const ssMonthlyChosen = Math.round(params.ssMonthlyAt67 * claimFactor(params.ssClaimAge))
  // Foreign benefits counted at full strength — each starts on its own clock
  // in the simulation, this tile shows the picture once they've all begun.
  const foreignMonthly = Math.round((params.foreignAnnualTotal || 0) / 12)
  const checksMonthly = ssMonthlyChosen + params.pensionAnnual / 12 + foreignMonthly
  const gapMonthly = Math.max(0, params.spendingMonthly - checksMonthly)

  const numInput = (label, key, { width = 90, placeholder = '', money = false, title = '' } = {}) => (
    <label className="inline-label" title={title}>{label}
      {money ? (
        <span className="input-money" style={{ width }}>
          <input type="number" inputMode="decimal" value={r[key] ?? ''} placeholder={placeholder}
            onChange={e => set({ [key]: e.target.value })} />
        </span>
      ) : (
        <input type="number" inputMode="decimal" style={{ width }} value={r[key] ?? ''} placeholder={placeholder}
          onChange={e => set({ [key]: e.target.value })} />
      )}
    </label>
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Retirement</h1>
          <p className="muted small">
            1,000 simulated market lifetimes, in today's dollars. Change any lever below and the plan re-runs instantly.
          </p>
        </div>
      </div>

      <div className="stat-row cols-4">
        <div className="stat-tile hero-card" style={{ cursor: 'default' }}>
          <div className="stat-label">Chance of success</div>
          <div className="stat-value money" style={{ fontSize: 30, color: scoreColor }}>{score}%</div>
          <div className="stat-sub">
            money lasts to {params.lifeExpectancy} in {score}% of {mc.trials.toLocaleString()} simulations
          </div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">At retirement ({params.retireAge})</div>
          <div className="stat-value money">{fmt(medianAtRetire)}</div>
          <div className="stat-sub">median portfolio · {fmt(totals.investments)} today</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Spending covered by checks</div>
          <div className="stat-value money">
            {fmt(checksMonthly)}<span className="muted" style={{ fontSize: 14 }}>/mo</span>
          </div>
          <div className="stat-sub">
            {gapMonthly > 0
              ? `portfolio must cover the other ${fmt(gapMonthly)}/mo`
              : `Social Security${foreignMonthly > 0 ? ', foreign benefits,' : ''} + pension cover your target spending`}
          </div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">{det.depletedAt ? 'Funds last until' : 'At age ' + params.lifeExpectancy}</div>
          <div className="stat-value money" style={det.depletedAt ? { color: 'var(--critical)' } : undefined}>
            {det.depletedAt ? `age ${det.depletedAt}` : fmt(medianEnd)}
          </div>
          <div className="stat-sub">{det.depletedAt ? 'in the steady-average scenario' : 'median left for legacy / long-tail care'}</div>
        </div>
      </div>

      <div className="card">
        <h2><span className="icon-chip"><Icon name="trending-up" /></span> Portfolio through age {results.params.lifeExpectancy}</h2>
        <BandChart band={mc.band} retireAge={results.params.retireAge} />
      </div>

      <div className="card">
        <h2><span className="icon-chip"><Icon name="settings" /></span> Plan levers</h2>
        <div className="row gap wrap" style={{ rowGap: 12 }}>
          {numInput('Retire at', 'retireAge', { placeholder: String(RETIREMENT_DEFAULTS.retireAge), width: 74 })}
          {numInput('Plan to age', 'lifeExpectancy', { placeholder: String(RETIREMENT_DEFAULTS.lifeExpectancy), width: 74, title: 'Plan long — outliving your money is the risk being measured' })}
          {numInput('Spend / mo in retirement', 'spendingMonthly', { money: true, width: 110, placeholder: String(params.spendingMonthly), title: `Defaults to 80% of today's expenses` })}
          {numInput('Extra savings / mo', 'extraMonthlySavings', { money: true, width: 100, placeholder: '0', title: 'On top of the 401(k)/IRA/HSA contributions from your Advisor profile' })}
          {numInput('Pension / mo', 'pensionMonthly', { money: true, width: 100, placeholder: '0' })}
          {numInput('Return above inflation %', 'expectedReturn', { placeholder: String(RETIREMENT_DEFAULTS.expectedReturn), width: 70, title: 'Real return while working. ~5% ≈ a 70/30 portfolio after inflation' })}
          {numInput('In retirement %', 'retiredReturn', { placeholder: String(RETIREMENT_DEFAULTS.retiredReturn), width: 70, title: 'Real return after retiring (usually a more conservative mix)' })}
          {numInput('Volatility %', 'volatility', { placeholder: String(RETIREMENT_DEFAULTS.volatility), width: 70, title: 'Annual standard deviation of returns — the market’s mood swings' })}
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Working years add <strong>{fmt(params.annualContrib)}/yr</strong> ({params.contribSource.toLowerCase()}
          {params.includesAfterTax ? ', includes your after-tax 401(k)' : ''}) — 401(k), match, IRA, HSA and extra savings.
          {params.contribSource.includes('Payroll') ? ' Verified from your pay statements on the Income tab.' : ' Edit the inputs in the Advisor profile, or upload a pay statement for payroll-verified figures.'}
          {' '}Spending basis: {params.expensesSource.toLowerCase()}. Portfolio counted today: {fmt(totals.investments)} (retirement + brokerage + HSA accounts).
        </p>
      </div>

      <div className="card">
        <h2><span className="icon-chip"><Icon name="calendar" /></span> Social Security explorer</h2>
        <p className="muted small">
          Household benefit {params.ssEstimated ? 'estimated from income' : 'from your entered amount'}
          {params.ssSpouse > 0 ? ` (you ${fmt(params.ssSelf)} + spouse ${fmt(params.ssSpouse)} at 67)` : ` (${fmt(params.ssSelf)}/mo at 67)`}.
          Claiming early shrinks every check; waiting until 70 grows them 24% — for life.
        </p>
        <table className="table">
          <thead>
            <tr><th>Claim at</th><th className="num">Monthly check</th><th className="num">Collected by {params.lifeExpectancy}</th><th className="num">Plan success</th><th></th></tr>
          </thead>
          <tbody>
            {ss.map(row => (
              <tr key={row.claimAge} style={row.chosen ? { background: 'var(--tint-accent)' } : undefined}>
                <td>{row.claimAge}{row.claimAge === 67 ? ' (full)' : ''}</td>
                <td className="num">{fmt(row.monthly)}</td>
                <td className="num">{fmt(row.lifetimeTotal)}</td>
                <td className="num">{Math.round(row.successRate * 100)}%</td>
                <td className="row-actions" style={{ opacity: 1 }}>
                  {row.chosen
                    ? <span className="badge">your plan</span>
                    : <button className="chip" onClick={() => set({ ssClaimAge: String(row.claimAge) })}>Use {row.claimAge}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row gap wrap" style={{ marginTop: 8 }}>
          {numInput('Your benefit at 67 (from ssa.gov)', 'ssMonthlyOverride', { money: true, width: 110, placeholder: String(estimateSSMonthly(p.grossIncome)) })}
          {Number(p.spouseIncome) > 0 && numInput('Spouse benefit at 67', 'spouseSsMonthlyOverride', { money: true, width: 110, placeholder: String(estimateSSMonthly(p.spouseIncome)) })}
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          The estimate assumes a full 35-year career near current income — your real number is on{' '}
          <a href="https://www.ssa.gov/myaccount/" target="_blank" rel="noreferrer">ssa.gov</a>; paste it above for accuracy.
        </p>
      </div>

      <ForeignPensionCard r={r} set={set} params={params} />

      <div className="card">
        <h2><span className="icon-chip"><Icon name="info" /></span> How this is calculated</h2>
        <ul className="how-to small">
          <li>Everything is in <strong>today's dollars</strong>: returns are real (after inflation), so “{fmt(params.spendingMonthly)}/mo” always means what it buys today.</li>
          <li>Each simulation draws a random return every year (normal distribution around your assumptions) — this captures <strong>sequence-of-returns risk</strong>: bad markets early in retirement hurt far more than the same markets later.</li>
          <li>After age {params.retireAge}, the portfolio pays out {fmt(params.spendingMonthly)}/mo minus Social Security{params.pensionAnnual > 0 ? ' and pension' : ''} once they start.</li>
          <li>Taxes, Medicare/IRMAA, RMD timing, and Roth-conversion strategy are not modeled — for that depth, a dedicated planner like Boldin or a fee-only CFP is the right tool. Educational, not advice.</li>
        </ul>
      </div>
    </div>
  )
}

// Foreign social security and pensions — CPP, OAS, QPP, the UK State Pension.
// Fixed benefits in a foreign currency, each with its own start age, folded
// into every simulation on this page (and into Scenarios, which shares the
// engine). Amounts stay in the home currency in the form; the typed exchange
// rate is what converts them, and a stream with no rate contributes NOTHING
// rather than counting loonies as dollars.
const FOREIGN_PRESETS = [
  { label: 'CPP', country: 'Canada', currency: 'CAD', startAge: 65 },
  { label: 'OAS', country: 'Canada', currency: 'CAD', startAge: 65 },
  { label: 'UK State Pension', country: 'UK', currency: 'GBP', startAge: 67 },
]

function ForeignPensionCard({ r, set, params }) {
  const rows = Array.isArray(r.foreignPensions) ? r.foreignPensions : []
  const update = (id, patch) => set({ foreignPensions: rows.map(x => (x.id === id ? { ...x, ...patch } : x)) })
  const remove = id => set({ foreignPensions: rows.filter(x => x.id !== id) })
  const add = preset => set({
    foreignPensions: [...rows, {
      id: Math.random().toString(36).slice(2, 10),
      label: preset?.label || 'Pension',
      country: preset?.country || '',
      currency: preset?.currency || 'USD',
      monthlyAmount: '',
      fxToUsd: '',
      startAge: String(preset?.startAge ?? 65),
    }],
  })
  const norm = params.foreignPensions || []
  const total = params.foreignAnnualTotal || 0

  return (
    <div className="card">
      <h2><span className="icon-chip"><Icon name="landmark" /></span> Foreign pensions &amp; social security</h2>
      <p className="muted small">
        Worked in another country? CPP, OAS, and similar benefits are real retirement income — enter them in
        their own currency and they join every simulation above from their start age. Since the Windfall
        Elimination Provision was repealed (2025), a foreign pension no longer reduces your US Social Security.
      </p>

      {rows.length > 0 && (
        <table className="table">
          <thead>
            <tr><th>Benefit</th><th>Currency</th><th className="num">Amount / mo</th><th className="num">→ USD rate</th><th className="num">Starts at</th><th className="num">USD / mo</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const n = norm.find(x => x.id === row.id)
              return (
                <tr key={row.id}>
                  <td><input value={row.label} onChange={e => update(row.id, { label: e.target.value })} style={{ width: 110 }} aria-label="Benefit name" /></td>
                  <td>
                    <input value={row.currency} onChange={e => update(row.id, { currency: e.target.value.toUpperCase() })}
                      style={{ width: 58 }} maxLength={3} aria-label="Currency" />
                  </td>
                  <td className="num">
                    <input type="number" inputMode="decimal" value={row.monthlyAmount}
                      onChange={e => update(row.id, { monthlyAmount: e.target.value })} style={{ width: 90 }} aria-label={`${row.label} monthly amount`} />
                  </td>
                  <td className="num">
                    {String(row.currency).toUpperCase() === 'USD' ? <span className="muted">—</span> : (
                      <input type="number" inputMode="decimal" step="0.01" value={row.fxToUsd}
                        onChange={e => update(row.id, { fxToUsd: e.target.value })} style={{ width: 70 }}
                        placeholder="0.73" aria-label={`${row.currency} to USD rate`} />
                    )}
                  </td>
                  <td className="num">
                    <input type="number" inputMode="numeric" value={row.startAge}
                      onChange={e => update(row.id, { startAge: e.target.value })} style={{ width: 56 }} aria-label={`${row.label} start age`} />
                  </td>
                  <td className="num money">
                    {n ? (n.missingFx ? <span style={{ color: 'var(--warning-text)' }}>needs rate</span> : fmt(Math.round(n.usdMonthly))) : '—'}
                  </td>
                  <td className="row-actions" style={{ opacity: 1 }}>
                    <button className="btn ghost small" onClick={() => remove(row.id)} aria-label={`Remove ${row.label}`}><Icon name="x" size={13} /></button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="row gap wrap" style={{ marginTop: rows.length ? 8 : 0 }}>
        {FOREIGN_PRESETS.map(pr => (
          <button key={pr.label} className="chip" onClick={() => add(pr)}>+ {pr.label} ({pr.country})</button>
        ))}
        <button className="chip" onClick={() => add(null)}>+ Other</button>
      </div>

      {total > 0 && (
        <p className="small money" style={{ marginTop: 10, marginBottom: 0 }}>
          Counted in the plan: <strong>{fmt(Math.round(total / 12))}/mo</strong> ({fmt(Math.round(total))}/yr) once all benefits have started,
          each from its own start age.
        </p>
      )}
      <p className="muted small" style={{ marginBottom: 0, marginTop: total > 0 ? 4 : 10 }}>
        The exchange rate is yours to set (and revisit) — this app makes no network calls, and today's rate is only an
        estimate of the rate decades from now. Your real CPP/OAS figures are on{' '}
        <a href="https://www.canada.ca/en/services/benefits/publicpensions.html" target="_blank" rel="noreferrer">canada.ca</a>{' '}
        under My Service Canada Account. Foreign benefit taxation follows the US–Canada tax treaty — worth a cross-border
        accountant's hour before you claim.
      </p>
    </div>
  )
}
