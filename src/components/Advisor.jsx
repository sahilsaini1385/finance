import React from 'react'
import { useStore } from '../store.jsx'
import { getRecommendations, LIMITS_2026 } from '../lib/advisor.js'

const ICONS = { critical: '⛔', warning: '⚠️', info: '💡', good: '✅' }
const AREAS = [
  ['tax', 'Tax management'],
  ['insurance', 'Insurance coverage'],
  ['planning', 'Planning & cash'],
]

function Field({ label, k, profile, onChange, type = 'number', children }) {
  return (
    <label>{label}
      {children || <input type={type} value={profile[k]} onChange={e => onChange({ [k]: e.target.value })} />}
    </label>
  )
}

export default function Advisor() {
  const { state, dispatch } = useStore()
  const p = state.profile
  const setP = payload => dispatch({ type: 'SET_PROFILE', payload })
  const recs = getRecommendations(state)

  return (
    <div className="page">
      <h1>Advisor</h1>
      <p className="muted">
        Rules-based guidance computed locally from your data — using {LIMITS_2026.year} IRS limits
        (401(k) ${LIMITS_2026.k401.toLocaleString()}, IRA ${LIMITS_2026.ira.toLocaleString()}, HSA $
        {LIMITS_2026.hsaSelf.toLocaleString()}/{LIMITS_2026.hsaFamily.toLocaleString()}). Educational only — confirm
        specifics with a CPA or fee-only fiduciary advisor.
      </p>

      <div className="card">
        <h2>Your profile</h2>
        <p className="muted small">Everything stays in your browser. The more you fill in, the sharper the recommendations.</p>
        <div className="form-grid">
          <Field label="Age" k="age" profile={p} onChange={setP} />
          <label>Filing status
            <select value={p.filingStatus} onChange={e => setP({ filingStatus: e.target.value })}>
              <option value="single">Single</option>
              <option value="mfj">Married filing jointly</option>
              <option value="hoh">Head of household</option>
            </select>
          </label>
          <Field label="Your gross annual income ($)" k="grossIncome" profile={p} onChange={setP} />
          <Field label="Spouse gross income ($)" k="spouseIncome" profile={p} onChange={setP} />
          <Field label="Dependents" k="dependents" profile={p} onChange={setP} />
          <Field label="Monthly living expenses ($)" k="monthlyExpenses" profile={p} onChange={setP} />
          <Field label="Mortgage balance ($)" k="mortgageBalance" profile={p} onChange={setP} />
          <Field label="Other debt ($)" k="otherDebt" profile={p} onChange={setP} />
          <Field label="Future education costs ($)" k="educationNeeds" profile={p} onChange={setP} />
          <Field label="Your 401(k) contribution (% of salary)" k="k401ContributionPct" profile={p} onChange={setP} />
          <Field label="Employer matches up to (%)" k="employerMatchPct" profile={p} onChange={setP} />
          <label>HDHP / HSA-eligible coverage?
            <select value={p.hsaEligible} onChange={e => setP({ hsaEligible: e.target.value })}>
              <option value="no">No</option>
              <option value="self">Yes — self-only</option>
              <option value="family">Yes — family</option>
            </select>
          </label>
          <Field label="Planned HSA contribution this year ($)" k="hsaContribution" profile={p} onChange={setP} />
          <Field label="Planned IRA contribution this year ($)" k="iraContribution" profile={p} onChange={setP} />
        </div>
      </div>

      {AREAS.map(([area, title]) => {
        const items = recs.filter(r => r.area === area)
        if (items.length === 0) return null
        return (
          <div className="card" key={area}>
            <h2>{title}</h2>
            {items.map(r => (
              <div key={r.id} className={`alert ${r.severity}`}>
                <span className="alert-icon" aria-hidden>{ICONS[r.severity]}</span>
                <div>
                  <strong>{r.title}</strong>
                  <div className="rec-detail">{r.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )
      })}

      <div className="card">
        <h2>Evergreen best practices</h2>
        <ul className="best-practices">
          <li><strong>Order of operations for every dollar:</strong> 401(k) to the full match → high-interest debt → emergency fund (3–6 mo) → max HSA → max IRA (backdoor Roth if over the income limit) → max 401(k) → taxable brokerage in low-cost index funds.</li>
          <li><strong>Roth vs. traditional:</strong> pay tax now (Roth) if you expect a higher tax rate in retirement or are early-career; defer (traditional) in peak earning years. Splitting is a legitimate hedge.</li>
          <li><strong>Insurance principle:</strong> insure only catastrophes you cannot self-fund. Raise deductibles to what your emergency fund can absorb and put the premium savings toward coverage limits, not gadgets like extended warranties.</li>
          <li><strong>Term over whole life:</strong> for income protection, level-term is ~10× cheaper for the same death benefit. Buy coverage while healthy; policies are cheapest in your 20s–30s.</li>
          <li><strong>Re-shop auto/home every 1–2 years:</strong> loyalty pricing works against you. Bundling and raising deductibles are the two fastest premium cuts.</li>
          <li><strong>Beneficiaries & basics:</strong> keep beneficiaries current on every account and policy (they override your will), and keep a simple will / power of attorney / healthcare proxy in place.</li>
          <li><strong>Year-end tax checklist (Oct–Dec):</strong> top up 401(k)/HSA, harvest losses, make charitable gifts (appreciated shares beat cash), take any RMDs, spend down health FSA, and consider Roth conversions in low-income years.</li>
        </ul>
      </div>
    </div>
  )
}
