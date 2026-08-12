import React, { useMemo } from 'react'
import { useStore, fmt } from '../store.jsx'
import { getRecommendations, LIMITS_2026 } from '../lib/advisor.js'
import { getSavingsInsights } from '../lib/savings.js'
import { projectFI, FI_ASSUMPTIONS } from '../lib/projection.js'
import { profileSuggestions } from '../lib/facts.js'
import { computeTotals } from '../lib/advisor.js'
import Icon from './Icon.jsx'
import AreaChart from './AreaChart.jsx'
import AskAdvisor from './AskAdvisor.jsx'
import ConflictBanner from './ConflictBanner.jsx'

const SEV_ICON = { critical: 'octagon-alert', warning: 'alert-triangle', info: 'lightbulb', good: 'check-circle' }
const SEV_ORDER = { critical: 0, warning: 1, info: 2, good: 3 }
const AREAS = [
  ['savings', 'Where you can save'],
  ['tax', 'Tax management'],
  ['insurance', 'Insurance coverage'],
  ['planning', 'Planning & cash'],
]

const PROFILE_FIELDS = [
  'age', 'filingStatus', 'grossIncome', 'spouseIncome', 'dependents', 'monthlyExpenses',
  'mortgageBalance', 'otherDebt', 'educationNeeds', 'k401ContributionPct', 'employerMatchPct',
  'hsaEligible', 'hsaContribution', 'iraContribution',
]

function Field({ label, k, profile, onChange, money, suggest }) {
  const input = (
    <input
      type="number"
      inputMode="decimal"
      value={profile[k]}
      onChange={e => onChange({ [k]: e.target.value })}
    />
  )
  return (
    <label>{label}
      {money ? <span className="input-money">{input}</span> : input}
      {suggest && (
        <span className="small muted" style={{ display: 'block', marginTop: 3 }}>
          From your data: {suggest.label}{' '}
          <button type="button" className="btn ghost small" style={{ padding: '0 8px' }} onClick={() => onChange({ [k]: suggest.value })}>
            Use
          </button>
        </span>
      )}
    </label>
  )
}

export default function Advisor() {
  const { state, dispatch } = useStore()
  const p = state.profile
  const setP = payload => dispatch({ type: 'SET_PROFILE', payload })
  const savings = useMemo(() => getSavingsInsights(state), [state.transactions])
  const recs = [...savings.recs, ...getRecommendations(state)]
  const urgent = recs
    .filter(r => r.severity === 'critical' || r.severity === 'warning')
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
  const totals = computeTotals(state)
  const fi = projectFI(state, totals.investments)

  // Fields the rest of the app can answer — offered as one-click fills,
  // never auto-written (same rule as conflict fixes).
  const suggestions = useMemo(() => profileSuggestions(state), [state])
  const sug = Object.fromEntries(suggestions.map(s => [s.field, s]))
  const fillAll = () => {
    setP(Object.fromEntries(suggestions.map(s => [s.field, s.value])))
  }

  const answered = PROFILE_FIELDS.filter(k => {
    const v = p[k]
    if (k === 'filingStatus') return v && v !== 'single'
    if (k === 'hsaEligible') return v && v !== 'no'
    return v !== '' && v !== null && v !== undefined
  }).length

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Advisor</h1>
          <p className="muted small">
            Rules-based guidance computed locally from your data, using {LIMITS_2026.year} IRS limits.{' '}
            <span className="badge">Educational only</span>
          </p>
        </div>
      </div>

      <AskAdvisor />

      <ConflictBanner surface="advisor" />

      {urgent.length > 0 && (
        <div className="card">
          <h2><span className="sev-chip warning"><Icon name="alert-triangle" size={14} /></span> Top priorities ({urgent.length})</h2>
          <p className="muted small">The items most worth acting on, across every area — details repeat in their sections below.</p>
          {urgent.slice(0, 6).map(r => (
            <div key={`top-${r.id}`} className={`alert ${r.severity}`}>
              <span className="alert-icon"><Icon name={SEV_ICON[r.severity]} size={15} /></span>
              <div>
                <strong>{r.title}</strong>
                <span className="badge" style={{ marginLeft: 8 }}>{(AREAS.find(([a]) => a === r.area) || [null, r.area])[1]}</span>
              </div>
            </div>
          ))}
          {urgent.length > 6 && <p className="muted small" style={{ marginBottom: 0 }}>…and {urgent.length - 6} more below.</p>}
        </div>
      )}

      {AREAS.map(([area, title]) => {
        const items = recs.filter(r => r.area === area).sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
        if (items.length === 0) return null
        return (
          <div className="card" key={area}>
            <h2>{title}</h2>
            {items.map(r => (
              <div key={r.id} className={`alert ${r.severity}`}>
                <span className="alert-icon"><Icon name={SEV_ICON[r.severity]} size={15} /></span>
                <div>
                  <strong>{r.title}</strong>
                  <div className="rec-detail">{r.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )
      })}

      {savings.recurring.length > 0 && (
        <div className="card">
          <h2>Recurring charges detected · ~{fmt(savings.monthlyTotal)}/mo · ~{fmt(savings.monthlyTotal * 12)}/yr</h2>
          <p className="muted small">
            Found by pattern-matching your transactions (steady amounts on a steady cadence). Scan for anything
            you haven't used lately — cancelling an unused subscription is the highest-certainty saving there is.
          </p>
          <table className="table">
            <thead>
              <tr><th>Merchant</th><th>Cadence</th><th className="num">Amount</th><th className="num">≈ Monthly</th><th className="num">≈ Yearly</th><th>Last charged</th></tr>
            </thead>
            <tbody>
              {savings.recurring.map(r => (
                <tr key={r.merchant}>
                  <td>
                    {r.merchant.toLowerCase()}
                    {r.increased && <span className="badge" style={{ marginLeft: 6 }}>price ↑</span>}
                  </td>
                  <td className="small">{r.cadence}</td>
                  <td className="num">{fmt(r.medianAmount, { maximumFractionDigits: 2 })}</td>
                  <td className="num">{fmt(r.monthlyCost)}</td>
                  <td className="num">{fmt(r.monthlyCost * 12)}</td>
                  <td className="small">{r.lastDate}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td><td></td><td></td>
                <td className="num">{fmt(savings.monthlyTotal)}</td>
                <td className="num">{fmt(savings.monthlyTotal * 12)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="card">
        <details className="advanced" open={answered < 7}>
          <summary>
            <strong>Your profile</strong> — {answered} of {PROFILE_FIELDS.length} answered · sharper advice as you fill in
          </summary>
          <div className="row gap" style={{ margin: '10px 0' }}>
            <div className="meter"><div className="meter-fill" style={{ width: `${(answered / PROFILE_FIELDS.length) * 100}%` }} /></div>
          </div>
          <div className="trust-note" style={{ marginBottom: 12 }}>
            <Icon name="lock" size={12} /> Stays in your browser.
          </div>
          {suggestions.length > 0 && (
            <div className="alert info" style={{ marginBottom: 12 }}>
              <span className="alert-icon"><Icon name="sparkle" size={15} /></span>
              <div>
                <strong>{suggestions.length} field{suggestions.length > 1 ? 's' : ''} can be filled from your data</strong>
                <div className="rec-detail">Paystubs, linked accounts, the Home tab, and goals already answer some of these.</div>
              </div>
              <button className="btn primary small" style={{ marginLeft: 'auto', alignSelf: 'center' }} onClick={fillAll}>
                Fill {suggestions.length}
              </button>
            </div>
          )}
          <div className="form-grid">
            <Field label="Age" k="age" profile={p} onChange={setP} />
            <label>Filing status
              <select value={p.filingStatus} onChange={e => setP({ filingStatus: e.target.value })}>
                <option value="single">Single</option>
                <option value="mfj">Married filing jointly</option>
                <option value="hoh">Head of household</option>
              </select>
            </label>
            <Field label="Your gross annual income" k="grossIncome" profile={p} onChange={setP} money suggest={sug.grossIncome} />
            <Field label="Spouse gross income" k="spouseIncome" profile={p} onChange={setP} money />
            <Field label="Dependents" k="dependents" profile={p} onChange={setP} />
            <Field label="Monthly living expenses" k="monthlyExpenses" profile={p} onChange={setP} money suggest={sug.monthlyExpenses} />
            <Field label="Mortgage balance" k="mortgageBalance" profile={p} onChange={setP} money suggest={sug.mortgageBalance} />
            <Field label="Other debt" k="otherDebt" profile={p} onChange={setP} money suggest={sug.otherDebt} />
            <Field label="Future education costs" k="educationNeeds" profile={p} onChange={setP} money suggest={sug.educationNeeds} />
            <Field label="Your 401(k) contribution (% of salary)" k="k401ContributionPct" profile={p} onChange={setP} suggest={sug.k401ContributionPct} />
            <Field label="Employer matches up to (%)" k="employerMatchPct" profile={p} onChange={setP} />
            <label>HDHP / HSA-eligible coverage?
              <select value={p.hsaEligible} onChange={e => setP({ hsaEligible: e.target.value })}>
                <option value="">Not sure</option>
                <option value="no">No</option>
                <option value="self">Yes — self-only</option>
                <option value="family">Yes — family</option>
              </select>
            </label>
            <Field label="Planned HSA contribution this year" k="hsaContribution" profile={p} onChange={setP} money suggest={sug.hsaContribution} />
            <Field label="Planned IRA contribution this year" k="iraContribution" profile={p} onChange={setP} money />
          </div>
        </details>
      </div>

      <div className="card">
        <h2>
          <span className="icon-chip"><Icon name="trending-up" /></span>
          Path to financial independence
        </h2>
        {!fi.ready ? (
          <p className="muted small" style={{ margin: 0 }}>
            Fill in your {fi.missing.join(' and ')} in the profile above to see when your investments could cover
            your lifestyle on their own.
          </p>
        ) : (
          <>
            <div className="goal-numbers money">
              {fi.alreadyThere ? (
                <strong>You're there — your portfolio already covers ~{fmt(fi.annualExpenses)}/yr of spending.</strong>
              ) : fi.fiAge ? (
                <>
                  <strong>Financially independent around age {fi.fiAge}</strong>
                  <span className="muted"> · target {fmt(fi.fiNumber)} ({fmt(fi.annualExpenses)}/yr × 25) · {fi.years} years away</span>
                </>
              ) : (
                <span>
                  At the current contribution rate ({fmt(fi.annualContrib)}/yr), the {fmt(fi.fiNumber)} target is
                  more than {FI_ASSUMPTIONS.maxYears} years out — raising savings rate moves this more than
                  raising returns.
                </span>
              )}
            </div>
            {fi.series.length > 2 && (
              <AreaChart
                id="fi"
                points={fi.series.map(p => ({ x: `age ${p.age}`, value: Math.round(p.value) }))}
                height={120}
                marker={fi.fiAge ? fi.series.findIndex(p => p.age === fi.fiAge) : null}
              />
            )}
            <p className="muted small" style={{ marginBottom: 0 }}>
              Assumes {(FI_ASSUMPTIONS.realGrowth * 100).toFixed(0)}% real (after-inflation) growth,
              the {(FI_ASSUMPTIONS.withdrawalRate * 100).toFixed(0)}% rule, and today's contributions
              ({fmt(fi.annualContrib)}/yr incl. employer match) held constant — a compass, not a guarantee.
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h2>Evergreen best practices</h2>
        <ul className="best-practices">
          <li><strong>Order of operations for every dollar:</strong> 401(k) to the full match → high-interest debt → emergency fund (3–6 mo) → max HSA → max IRA (backdoor Roth if over the income limit) → max 401(k) → taxable brokerage in low-cost index funds.</li>
          <li><strong>Roth vs. traditional:</strong> pay tax now (Roth) if you expect a higher tax rate in retirement or are early-career; defer (traditional) in peak earning years. Splitting is a legitimate hedge.</li>
          <li><strong>Insurance principle:</strong> insure only catastrophes you cannot self-fund. Raise deductibles to what your emergency fund can absorb and put the premium savings toward coverage limits, not gadgets like extended warranties.</li>
          <li><strong>Term over whole life:</strong> for income protection, level-term is ~10× cheaper for the same death benefit. Buy coverage while healthy; policies are cheapest in your 20s–30s.</li>
          <li><strong>Re-shop auto/home every 1–2 years:</strong> loyalty pricing works against you. Bundling and raising deductibles are the two fastest premium cuts.</li>
          <li><strong>Beneficiaries &amp; basics:</strong> keep beneficiaries current on every account and policy (they override your will), and keep a simple will / power of attorney / healthcare proxy in place.</li>
          <li><strong>Year-end tax checklist (Oct–Dec):</strong> top up 401(k)/HSA, harvest losses, make charitable gifts (appreciated shares beat cash), take any RMDs, spend down health FSA, and consider Roth conversions in low-income years.</li>
        </ul>
      </div>

      <p className="muted small">
        {LIMITS_2026.year} limits used: 401(k) ${LIMITS_2026.k401.toLocaleString()} · IRA ${LIMITS_2026.ira.toLocaleString()} ·
        HSA ${LIMITS_2026.hsaSelf.toLocaleString()}/{LIMITS_2026.hsaFamily.toLocaleString()}. Verify at irs.gov; confirm decisions with a CPA or fee-only fiduciary.
      </p>
    </div>
  )
}
