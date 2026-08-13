// The reconciliation layer — one place that decides, for every fact the app
// stores in more than one section, which source is the truth right now.
//
// Principles (from the source-of-truth ruling):
//   - Payroll-verified beats typed beats inferred — but payroll wins only
//     when the latest stub passed its balanced self-check and is current-year.
//   - Facts carry provenance: {origin, label, detail, asOf} plus every
//     candidate value inspected, so nothing is hidden — just ranked.
//   - Different years are different facts, never conflicts. Comparisons only
//     happen after unit/basis normalization, against central tolerances, so
//     rounding noise stays quiet.
//   - Conflicts are surfaced, never auto-fixed: a fix is a previewed,
//     user-clicked dispatch of an existing reducer action.
//
// Pure functions over state; memoized per state object; no persistence.

import { localMonth } from './dates.js'
import { monthActivity } from './budget.js'
import {
  paystubYearSummary, payFrequencyFromStubs, yearFrac, annualizeYtd,
  baseSalaryRunRate, K401_ROTH_RE,
} from './income.js'
import { estimateFederalTax } from './taxTables.js'
import { rsuScheduledAfter } from './rsu.js'

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/[$,%\s,]/g, ''))
  return Number.isNaN(n) ? 0 : n
}
const r0 = n => Math.round(Number(n) || 0)

// Central tolerance table — the single place to tune "how different is a
// real disagreement". Quiet when |a−b| <= max(abs, rel × max(|a|,|b|)).
const TOLERANCES = {
  grossIncome: { abs: 5000, rel: 0.10 },
  monthlyExpenses: { abs: 300, rel: 0.15 },
  mortgageBalance: { abs: 2000, rel: 0.02 },
  nonMortgageDebt: { abs: 500, rel: 0.20 },
  premiumAnnual: { abs: 60, rel: 0.03 },
  withholding: { abs: 2000, rel: 0.03 },
  deferralRatePts: { abs: 1.5, rel: 0 },
  employerMatch: { abs: 1000, rel: 0.25 },
  incomeTargetVsPaystub: { abs: 250, rel: 0.10 },
  hsaContribution: { abs: 300, rel: 0.10 },
}
export function toleranceFor(id) {
  return TOLERANCES[id] || { abs: 100, rel: 0.02 }
}
export function withinTolerance(id, a, b) {
  const t = toleranceFor(id)
  return Math.abs(a - b) <= Math.max(t.abs, t.rel * Math.max(Math.abs(a), Math.abs(b)))
}

const fact = (id, value, source, extra = {}) => ({
  id, value, source, unit: extra.unit || 'usd/yr', year: extra.year ?? null,
  estimated: Boolean(extra.estimated), candidates: extra.candidates || [], ...extra.rest,
})

// Payroll data qualifies as a source of truth only when it self-reconciled
// and describes the current year with enough of it elapsed.
export function payrollTrusted(state, year) {
  const s = paystubYearSummary(state, year)
  if (!s) return null
  const latest = s.latest
  const ok = latest.balanced === true &&
    (latest.payDate || '').startsWith(String(year)) &&
    (s.count >= 2 || latest.payDate >= `${year}-03-01`)
  return ok ? s : null
}

function resolve(state) {
  const year = localMonth().slice(0, 4)
  const month = localMonth()
  const p = state.profile || {}
  const conflicts = []
  const push = c => conflicts.push(c)

  const payroll = payrollTrusted(state, year)
  const frac = payroll ? yearFrac(payroll.latest.payDate) : 1
  const payFreq = payFrequencyFromStubs(state.paystubs)

  // ---- base salary (anchor for salary-multiples and modeled figures) ----
  const baseRun = baseSalaryRunRate(state, year)
  const typedIncome = num(p.grossIncome)
  let baseSalary = null
  if (baseRun) {
    baseSalary = fact('baseSalary', baseRun,
      { origin: 'payroll', label: 'Payroll base run-rate', detail: 'Regular earnings × pay frequency', asOf: payroll?.latest.payDate || null },
      { estimated: true, year: Number(year) })
  } else if (typedIncome > 0) {
    baseSalary = fact('baseSalary', typedIncome,
      { origin: 'typed', label: 'Your estimate (basis ambiguous)', detail: 'profile gross income', asOf: null },
      { year: Number(year) })
  }

  // ---- RSU income (first consumer of paystub earnings) ----
  const rsuYtd = payroll ? payroll.ytd.rsuVested : 0
  const rsuIncome = payroll ? fact('rsuIncome', r0(rsuYtd),
    { origin: 'payroll', label: 'Payroll-verified', detail: 'RSU vested YTD — counted as actuals, never extrapolated', asOf: payroll.latest.payDate },
    { year: Number(year) }) : null

  // ---- current-year gross income ----
  // Guard: a stub whose YTD column failed to parse (grossYtd = 0) must never
  // become a trusted $0/negative income fact — fall through to typed.
  let grossIncome = null
  if (payroll && payroll.ytd.gross > 0) {
    const cashRun = Math.max(0, annualizeYtd(payroll.ytd.gross - rsuYtd, payroll.latest.payDate))
    // Vests scheduled strictly after the latest stub, this year: income the
    // paycheck can't see yet. Strictly-after so a vest already inside the YTD
    // never counts twice.
    const rsuScheduled = r0(rsuScheduledAfter(state, payroll.latest.payDate, year))
    const total = r0(cashRun + rsuYtd + rsuScheduled)
    grossIncome = fact('grossIncome', total,
      { origin: 'payroll', label: 'Payroll-verified, annualized', detail: `cash pace ${fmtUsd(r0(cashRun))}/yr + ${fmtUsd(r0(rsuYtd))} RSU vested YTD${rsuScheduled > 0 ? ` + ${fmtUsd(rsuScheduled)} still scheduled to vest` : ''}`, asOf: payroll.latest.payDate },
      { estimated: true, year: Number(year), candidates: [
        { origin: 'payroll', value: total, note: rsuScheduled > 0 ? 'cash run-rate + RSU actuals + scheduled vests' : 'cash run-rate + RSU actuals' },
        ...(typedIncome > 0 ? [{ origin: 'typed', value: typedIncome, note: 'profile gross income' }] : []),
      ] })
    if (typedIncome > 0 && !withinTolerance('grossIncome', total, typedIncome)) {
      push({
        factId: 'grossIncome', severity: 'warning',
        message: `Your profile income (${fmtUsd(typedIncome)}) is far from payroll pace (~${fmtUsd(total)}/yr incl. RSU vests). Advice is using payroll.`,
        surfaces: ['advisor', 'dashboard', 'ai'],
        fix: { label: 'Update profile income', dispatches: [{ action: 'SET_PROFILE', payload: { grossIncome: String(total) } }], preview: { from: fmtUsd(typedIncome), to: fmtUsd(total) } },
      })
    }
  } else if (typedIncome > 0) {
    grossIncome = fact('grossIncome', typedIncome,
      { origin: 'typed', label: 'Your estimate', detail: 'profile gross income', asOf: null }, { year: Number(year) })
  }

  // ---- 401(k) employee deferrals (trad + Roth), current year ----
  let k401 = null
  if (payroll) {
    const ytd = payroll.ytd.k401Trad + payroll.ytd.k401Roth
    const pace = annualizeYtd(ytd, payroll.latest.payDate)
    k401 = fact('k401Deferrals', r0(ytd),
      { origin: 'payroll', label: 'Payroll-verified', detail: `YTD; pace ~${fmtUsd(r0(pace))}/yr`, asOf: payroll.latest.payDate },
      { year: Number(year), rest: { pace: r0(pace) } })
    const profilePct = num(p.k401ContributionPct)
    if (profilePct > 0 && baseSalary?.value > 0) {
      const impliedPct = (pace / baseSalary.value) * 100
      if (Math.abs(impliedPct - profilePct) > TOLERANCES.deferralRatePts.abs) {
        push({
          factId: 'k401Deferrals', severity: 'notice',
          message: `Profile says ${profilePct}% to the 401(k); payroll implies ~${impliedPct.toFixed(1)}% of base. Using payroll.`,
          surfaces: ['advisor', 'income'],
          fix: { label: 'Update profile %', dispatches: [{ action: 'SET_PROFILE', payload: { k401ContributionPct: String(Math.round(impliedPct * 10) / 10) } }], preview: { from: `${profilePct}%`, to: `${impliedPct.toFixed(1)}%` } },
        })
      }
    }
  } else if (num(p.k401ContributionPct) > 0 && baseSalary) {
    const modeled = r0(baseSalary.value * num(p.k401ContributionPct) / 100)
    k401 = fact('k401Deferrals', modeled,
      { origin: 'model', label: 'Modeled from your %', detail: `${p.k401ContributionPct}% of ${baseSalary.source.origin === 'payroll' ? 'payroll base' : 'estimated'} salary`, asOf: null },
      { estimated: true, year: Number(year), rest: { pace: modeled } })
  }

  const k401AfterTax = payroll && payroll.ytd.k401AfterTax > 0
    ? fact('k401AfterTax', r0(payroll.ytd.k401AfterTax),
        { origin: 'payroll', label: 'Payroll-verified', detail: `YTD; pace ~${fmtUsd(r0(annualizeYtd(payroll.ytd.k401AfterTax, payroll.latest.payDate)))}/yr`, asOf: payroll.latest.payDate },
        { year: Number(year), rest: { pace: r0(annualizeYtd(payroll.ytd.k401AfterTax, payroll.latest.payDate)) } })
    : null

  // ---- HSA (tri-state eligibility; blank is UNKNOWN, not "yes") ----
  const explicit = p.hsaEligible
  let eligibility = 'unknown'
  if (explicit === 'no') eligibility = 'no'
  else if (explicit === 'self' || explicit === 'family') eligibility = explicit
  else {
    const hsaYtd = payroll ? payroll.ytd.hsa : 0
    if (hsaYtd > 0) eligibility = 'contributing' // eligible; tier unknown
    else {
      const health = (state.insurance || []).find(pl => pl.type === 'health')
      if (health && /health savings|hdhp|hsa/i.test(health.policyName || '')) eligibility = 'unknown'
      else if (health && /shared deductible|standard|premium/i.test(health.policyName || '') && payroll) eligibility = 'likely-no'
    }
  }
  const hsaContribution = payroll && payroll.ytd.hsa > 0
    ? fact('hsaContribution', r0(payroll.ytd.hsa),
        { origin: 'payroll', label: 'Payroll-verified', detail: 'HSA deductions YTD', asOf: payroll.latest.payDate }, { year: Number(year) })
    : num(p.hsaContribution) > 0
      ? fact('hsaContribution', num(p.hsaContribution),
          { origin: 'typed', label: 'Planned (your estimate)', detail: 'profile', asOf: null }, { year: Number(year) })
      : null
  const hsaStatus = { eligibility, contribution: hsaContribution }
  // Payroll contradicting an explicit "not eligible" answer is worth a flag —
  // deductions can only ride an HSA-eligible plan. No one-click fix: whether
  // the coverage is self-only or family is the user's to answer.
  if (explicit === 'no' && payroll && payroll.ytd.hsa > 0) {
    push({
      factId: 'hsaStatus', severity: 'warning',
      message: `Profile says no HSA-eligible coverage, but payroll shows ${fmtUsd(r0(payroll.ytd.hsa))} of HSA deductions this year. Set self-only or family in the Advisor profile so limit checks can run.`,
      surfaces: ['advisor', 'ai'],
    })
  }
  // Typed plan vs payroll pace drift (both known): payroll wins; offer sync.
  if (num(p.hsaContribution) > 0 && payroll && payroll.ytd.hsa > 0) {
    const hsaPace = r0(annualizeYtd(payroll.ytd.hsa, payroll.latest.payDate))
    if (!withinTolerance('hsaContribution', hsaPace, num(p.hsaContribution))) {
      push({
        factId: 'hsaContribution', severity: 'notice',
        message: `Planned HSA contribution (${fmtUsd(num(p.hsaContribution))}) is off payroll pace (~${fmtUsd(hsaPace)}/yr). Using payroll.`,
        surfaces: ['advisor'],
        fix: { label: 'Update planned HSA', dispatches: [{ action: 'SET_PROFILE', payload: { hsaContribution: String(hsaPace) } }], preview: { from: fmtUsd(num(p.hsaContribution)), to: fmtUsd(hsaPace) } },
      })
    }
  }

  // ---- monthly living expenses (observed median beats stale estimate) ----
  const spendMonths = []
  for (let i = 1; Array.isArray(state.transactions) && i <= 6; i++) {
    const d = new Date(`${month}-15T00:00`)
    d.setMonth(d.getMonth() - i)
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const { spentByCat } = monthActivity(state, m)
    const spend = Object.values(spentByCat).reduce((s, v) => s + v, 0)
    // Only months with actual categorized spending count — an income-only
    // month (e.g. payroll synced before any spending imports) would drag the
    // median toward zero.
    if (spend > 0) spendMonths.push(spend)
  }
  const typedExpenses = num(p.monthlyExpenses)
  let monthlyExpenses = null
  if (spendMonths.length >= 3) {
    const sorted = [...spendMonths].sort((a, b) => a - b)
    const median = r0(sorted[Math.floor(sorted.length / 2)])
    monthlyExpenses = fact('monthlyExpenses', median,
      { origin: 'transactions', label: 'Observed spending', detail: `median of last ${spendMonths.length} months (excludes payroll-deducted costs)`, asOf: month },
      { unit: 'usd/mo', candidates: typedExpenses > 0 ? [{ origin: 'typed', value: typedExpenses, note: 'profile estimate' }] : [] })
    if (typedExpenses > 0 && !withinTolerance('monthlyExpenses', median, typedExpenses)) {
      push({
        factId: 'monthlyExpenses', severity: 'warning',
        message: `Observed spending is ~${fmtUsd(median)}/mo; your profile says ${fmtUsd(typedExpenses)}/mo. Emergency-fund and FI math use observed.`,
        surfaces: ['advisor', 'retirement', 'ai'],
        fix: { label: 'Update profile expenses', dispatches: [{ action: 'SET_PROFILE', payload: { monthlyExpenses: String(median) } }], preview: { from: fmtUsd(typedExpenses), to: fmtUsd(median) } },
      })
    }
  } else if (typedExpenses > 0) {
    monthlyExpenses = fact('monthlyExpenses', typedExpenses,
      { origin: 'typed', label: 'Your estimate', detail: 'profile', asOf: null }, { unit: 'usd/mo' })
  }

  // ---- mortgage balance (one amortizing loan, three frozen copies) ----
  const mortAccounts = (state.accounts || []).filter(a => a.type === 'mortgage')
  const synced = mortAccounts.reduce((s, a) => s + Math.abs(num(a.balance)), 0)
  const homeBal = num((state.home || {}).mortgageBalance)
  const profBal = num(p.mortgageBalance)
  const mortCandidates = [
    ...(synced > 0 ? [{ origin: 'synced', value: r0(synced), note: 'linked mortgage account' }] : []),
    ...(homeBal > 0 ? [{ origin: 'typed', value: r0(homeBal), note: 'Home tab' }] : []),
    ...(profBal > 0 ? [{ origin: 'typed', value: r0(profBal), note: 'Advisor profile' }] : []),
  ]
  let mortgageBalance = null
  if (mortCandidates.length > 0) {
    const winner = mortCandidates[0]
    mortgageBalance = fact('mortgageBalance', winner.value,
      { origin: winner.origin, label: winner.origin === 'synced' ? 'Synced account' : winner.note, detail: winner.note, asOf: winner.origin === 'synced' ? mortAccounts[0]?.updated || null : null },
      { unit: 'usd', candidates: mortCandidates })
    const stale = mortCandidates.filter(c => !withinTolerance('mortgageBalance', winner.value, c.value))
    if (stale.length > 0) {
      const dispatches = []
      if (homeBal > 0 && !withinTolerance('mortgageBalance', winner.value, homeBal) && winner.value !== r0(homeBal)) dispatches.push({ action: 'SET_HOME', payload: { mortgageBalance: String(winner.value) } })
      if (profBal > 0 && !withinTolerance('mortgageBalance', winner.value, profBal) && winner.value !== r0(profBal)) dispatches.push({ action: 'SET_PROFILE', payload: { mortgageBalance: String(winner.value) } })
      push({
        factId: 'mortgageBalance', severity: 'notice',
        message: `Mortgage balance differs between sections (${mortCandidates.map(c => `${fmtUsd(c.value)} ${c.note}`).join(' / ')}). Using ${fmtUsd(winner.value)}.`,
        surfaces: ['advisor', 'home', 'dashboard'],
        ...(dispatches.length ? { fix: { label: 'Align to current balance', dispatches, preview: { from: stale.map(c => fmtUsd(c.value)).join(', '), to: fmtUsd(winner.value) } } } : {}),
      })
    }
  }

  // ---- home double-count guard ----
  // The old tip said "add the house as an 'other' account"; home equity now
  // counts automatically from the Home tab, so such an account would count
  // the house twice.
  const homeVal = num((state.home || {}).currentValue)
  if (homeVal > 0) {
    const dupe = (state.accounts || []).find(a =>
      a.type === 'other' && !a.excludeFromNetWorth &&
      Math.abs(Math.abs(num(a.balance)) - homeVal) <= homeVal * 0.05)
    if (dupe) {
      push({
        factId: 'homeEquity', severity: 'warning',
        message: `“${dupe.institution} ${dupe.name}” (${fmtUsd(num(dupe.balance))}) looks like your home's value. Home equity now counts automatically from the Home tab, so that account double-counts the house.`,
        surfaces: ['dashboard', 'advisor'],
        fix: {
          label: 'Exclude it from net worth',
          dispatches: [{ action: 'UPDATE_ACCOUNT', payload: { id: dupe.id, excludeFromNetWorth: true } }],
          preview: { from: 'house counted twice', to: 'counted once' },
        },
      })
    }
  }

  // ---- non-mortgage debt ----
  const debtAccounts = (state.accounts || []).filter(a => a.type === 'credit card' || a.type === 'loan')
  const syncedDebt = debtAccounts.reduce((s, a) => s + Math.abs(num(a.balance)), 0)
  const typedDebt = num(p.otherDebt)
  let nonMortgageDebt = null
  if (debtAccounts.length > 0) {
    nonMortgageDebt = fact('nonMortgageDebt', r0(syncedDebt),
      { origin: 'synced', label: 'Synced accounts', detail: `${debtAccounts.length} credit/loan account${debtAccounts.length > 1 ? 's' : ''}`, asOf: null },
      { unit: 'usd', candidates: typedDebt > 0 ? [{ origin: 'typed', value: typedDebt, note: 'profile' }] : [] })
    if (typedDebt > 0 && !withinTolerance('nonMortgageDebt', syncedDebt, typedDebt)) {
      push({
        factId: 'nonMortgageDebt', severity: 'notice',
        message: `Profile lists ${fmtUsd(typedDebt)} of other debt but linked accounts show ${fmtUsd(r0(syncedDebt))}. Using accounts.`,
        surfaces: ['advisor'],
        fix: { label: 'Update profile debt', dispatches: [{ action: 'SET_PROFILE', payload: { otherDebt: String(r0(syncedDebt)) } }], preview: { from: fmtUsd(typedDebt), to: fmtUsd(r0(syncedDebt)) } },
      })
    }
  } else if (typedDebt > 0) {
    nonMortgageDebt = fact('nonMortgageDebt', typedDebt,
      { origin: 'typed', label: 'Your estimate', detail: 'profile', asOf: null }, { unit: 'usd' })
  }

  // ---- employer 401(k) match: a typed dollar figure beats the model ----
  const typedMatch = (state.benefits || []).find(b => b.type === 'Employer match' && num(b.annualValue) > 0)
  const matchPct = num(p.employerMatchPct)
  const deferralPctForModel = k401 && baseSalary?.value > 0 && k401.source.origin === 'payroll'
    ? (k401.pace / baseSalary.value) * 100
    : num(p.k401ContributionPct)
  const modeledMatch = matchPct > 0 && baseSalary?.value > 0
    ? r0(baseSalary.value * Math.min(matchPct, deferralPctForModel) / 100)
    : 0
  let employerMatch = null
  if (typedMatch) {
    employerMatch = fact('employerMatch', num(typedMatch.annualValue),
      { origin: 'typed', label: 'From your Benefits entry', detail: typedMatch.name, asOf: null },
      { candidates: modeledMatch > 0 ? [{ origin: 'model', value: modeledMatch, note: 'modeled from match % × base salary' }] : [] })
    if (modeledMatch > 0 && !withinTolerance('employerMatch', num(typedMatch.annualValue), modeledMatch)) {
      push({
        factId: 'employerMatch', severity: 'notice',
        message: `Match estimates disagree: ${fmtUsd(num(typedMatch.annualValue))} entered vs ~${fmtUsd(modeledMatch)} modeled — check your plan formula.`,
        surfaces: ['advisor', 'benefits'],
      })
    }
  } else if (modeledMatch > 0) {
    employerMatch = fact('employerMatch', modeledMatch,
      { origin: 'model', label: 'Modeled — not on your paystub', detail: `min(${matchPct}%, deferral) × base salary`, asOf: null },
      { estimated: true })
  }

  // ---- retirement/FI annual contributions (the savings-rate bundle) ----
  const extra = num((state.retirement || {}).extraMonthlySavings) * 12
  const iraPlanned = num(p.iraContribution)
  const hsaAnnual = hsaContribution
    ? (hsaContribution.source.origin === 'payroll' ? annualizeYtd(hsaContribution.value, payroll.latest.payDate) : hsaContribution.value)
    : 0
  let annualContrib = null
  if (payroll && k401) {
    const value = r0(k401.pace + (k401AfterTax ? k401AfterTax.pace : 0) + (employerMatch?.value || 0) + iraPlanned + hsaAnnual + extra)
    annualContrib = fact('annualContrib', value,
      { origin: 'payroll', label: 'Payroll-verified pace', detail: `401(k) ${fmtUsd(k401.pace)}${k401AfterTax ? ` + after-tax ${fmtUsd(k401AfterTax.pace)}` : ''}${employerMatch ? ` + match ${fmtUsd(employerMatch.value)}` : ''} + IRA/HSA/extra`, asOf: payroll.latest.payDate },
      { estimated: true, rest: { includesAfterTax: Boolean(k401AfterTax) } })
  } else {
    const base = baseSalary?.value || typedIncome
    const k = base * num(p.k401ContributionPct) / 100
    annualContrib = fact('annualContrib', r0(k + (employerMatch?.value || 0) + iraPlanned + num(p.hsaContribution) + extra),
      { origin: 'model', label: 'Modeled from profile', detail: 'contribution % × salary + IRA + HSA + extra', asOf: null },
      { estimated: true, rest: { includesAfterTax: false } })
  }

  // ---- current-year withholding check (payroll-only; prior year is the W-2's job) ----
  let withholding = null
  if (payroll && grossIncome) {
    const filing = p.filingStatus || 'single'
    const pretaxPace = annualizeYtd(payroll.ytd.pretaxBenefits, payroll.latest.payDate)
    // Only TRADITIONAL deferrals reduce federal taxable wages — Roth counts
    // toward the employee limit (k401.pace) but not here.
    const tradPace = annualizeYtd(payroll.ytd.k401Trad, payroll.latest.payDate)
    const taxableAnnual = Math.max(0, grossIncome.value - tradPace - pretaxPace)
    const est = estimateFederalTax(taxableAnnual, filing, Number(year))
    const expectedYtd = r0(est.tax * frac)
    const gap = r0(payroll.ytd.federalTax - expectedYtd)
    withholding = fact('federalWithholding', r0(payroll.ytd.federalTax),
      { origin: 'payroll', label: 'Payroll-verified', detail: `YTD vs ~${fmtUsd(expectedYtd)} expected by now`, asOf: payroll.latest.payDate },
      { year: Number(year), rest: { expectedYtd, gap, estAnnualTax: est.tax, taxableAnnual: r0(taxableAnnual) } })
  }

  const facts = {
    payFrequency: payFreq,
    baseSalary, rsuIncome, grossIncome,
    k401Deferrals: k401, k401AfterTax, hsaStatus,
    monthlyExpenses, mortgageBalance, nonMortgageDebt,
    employerMatch, annualContrib, withholding,
    payroll,
  }
  return { facts, conflicts }
}

function fmtUsd(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString()
}

// ---- memoized entry points ----
// Keyed on the state object (replaced immutably on every dispatch) AND the
// current month, so a long-lived idle tab can't serve stale month-scoped
// facts across a month boundary.
const memo = new WeakMap()
export function resolveFacts(state) {
  const monthKey = localMonth()
  const hit = memo.get(state)
  if (hit && hit.monthKey === monthKey) return hit.out
  const out = resolve(state)
  memo.set(state, { monthKey, out })
  return out
}

export function getDataConflicts(state) {
  return resolveFacts(state).conflicts
}

// Annual premium for a policy, preferring the live payroll deduction row over
// the imported/typed premium (which is a snapshot that drifts after open
// enrollment). Falls through when no deduction row matches unambiguously.
const DEDUCTION_MAP = [
  // FSA rows are accounts, not premiums — never match them to a policy.
  ['health', /pre.?tax medical|\bmedical\b(?!.{0,10}fsa)/i],
  ['dental', /dental(?!.{0,10}fsa)/i],
  ['vision', /vision/i],
  ['critical illness', /critic/i],
  ['accident', /^accident/i],
  // Word-bounded so "Addl Life" can't read as AD&D.
  ['ad&d', /\bad\s?[/&]?\s?d\b|supp\.? ?ad/i],
  ['legal', /legal/i],
]
// Coverage for salary-multiple policies, re-derived from the CURRENT base
// salary instead of frozen import-time dollars. The multiple comes from the
// persisted salaryMultiple field, or the policy name ("… — 5× base salary")
// for policies imported before the field existed. Spouse policies are never
// derived from the employee's salary. Falls back to the stored amount.
const NAME_MULTIPLE_RE = /(\d+(?:\.\d+)?)\s*×\s*base salary/i
export function policyCoverage(state, policy) {
  const stored = num(policy.coverageAmount)
  const isSpouse = /spouse|partner/i.test(policy.policyName || '')
  // salaryMultiple (import-managed) always re-derives; a multiple that only
  // lives in the policy NAME derives only when no exact amount was entered —
  // a typed coverage figure must win over a name-parsed estimate.
  const multiple = num(policy.salaryMultiple) || (stored === 0 ? num((policy.policyName || '').match(NAME_MULTIPLE_RE)?.[1]) : 0)
  if (!isSpouse && multiple > 0) {
    const { facts } = resolveFacts(state)
    if (facts.baseSalary?.value > 0) {
      return {
        value: Math.round(multiple * facts.baseSalary.value),
        estimated: true,
        basis: `${multiple}× ${facts.baseSalary.source.origin === 'payroll' ? 'payroll base salary' : 'estimated salary'}`,
      }
    }
  }
  return stored > 0 ? { value: stored, estimated: false, basis: 'entered amount' } : null
}

// Is this policy actually enrolled? Two kinds of evidence:
//   'payroll'   — its premium shows up as a deduction on the latest paystub
//   'statement' — imported as employer-paid from the benefits statement
export function enrollmentEvidence(state, policy) {
  const prem = policyPremiumAnnual(state, policy)
  if (prem?.origin === 'payroll') return 'payroll'
  const year = localMonth().slice(0, 4)
  const payroll = payrollTrusted(state, year)
  if (payroll && policy.type === 'life' && /spouse|partner/i.test(policy.policyName || '')) {
    if ((payroll.latest.deductions || []).some(d => /slifsp|spouse.{0,6}life/i.test(d.label))) return 'payroll'
  }
  if (/employer.?paid/i.test(policy.notes || '')) return 'statement'
  return null
}

export function policyPremiumAnnual(state, policy) {
  const declared = num(policy.premium) * (policy.premiumFreq === 'month' ? 12 : 1)
  const year = localMonth().slice(0, 4)
  const payroll = payrollTrusted(state, year)
  const freq = payFrequencyFromStubs(state.paystubs)
  if (payroll && freq) {
    const entry = DEDUCTION_MAP.find(([type]) => type === policy.type)
    // Only override when the match is unambiguous BOTH ways: one deduction
    // row of this kind AND one policy of this type — otherwise a self-priced
    // second policy would inherit the employer premium and double-count.
    const policiesOfType = (state.insurance || []).filter(pl => pl.type === policy.type)
    if (entry && policiesOfType.length === 1) {
      const rows = (payroll.latest.deductions || []).filter(d => entry[1].test(d.label) && !/fsa/i.test(d.label) && !K401_ROTH_RE.test(d.label))
      if (rows.length === 1) {
        const annual = Math.round(rows[0].amount * freq * 100) / 100
        return {
          value: annual, origin: 'payroll', label: 'From payroll', perPeriod: rows[0].amount,
          declared, drifted: declared > 0 && !withinTolerance('premiumAnnual', annual, declared),
        }
      }
    }
  }
  return declared > 0 ? { value: declared, origin: 'policy', label: 'From policy entry', declared, drifted: false } : null
}

// Prefill suggestions for EMPTY Advisor-profile fields, drawn from data the
// app already holds elsewhere (payroll, linked accounts, Home tab, goals).
// Offered in the form as one-click fills — never auto-applied, same rule as
// conflict fixes. Fields with a value are the drift-conflict system's job.
export function profileSuggestions(state) {
  const p = state.profile || {}
  const { facts } = resolveFacts(state)
  const out = []
  const isEmpty = k => p[k] === '' || p[k] === null || p[k] === undefined
  const add = (field, value, label) => out.push({ field, value: String(value), label })

  if (isEmpty('grossIncome') && facts.grossIncome?.source?.origin === 'payroll') {
    add('grossIncome', facts.grossIncome.value, `${fmtUsd(facts.grossIncome.value)} — payroll pace (Income tab)`)
  }
  if (isEmpty('monthlyExpenses') && facts.monthlyExpenses?.source?.origin === 'transactions') {
    add('monthlyExpenses', facts.monthlyExpenses.value, `${fmtUsd(facts.monthlyExpenses.value)}/mo — your median spending`)
  }
  if (isEmpty('mortgageBalance') && facts.mortgageBalance) {
    const src = facts.mortgageBalance.source
    add('mortgageBalance', facts.mortgageBalance.value, `${fmtUsd(facts.mortgageBalance.value)} — ${src.detail || src.label}`)
  }
  if (isEmpty('otherDebt') && facts.nonMortgageDebt?.source?.origin === 'synced') {
    add('otherDebt', facts.nonMortgageDebt.value, `${fmtUsd(facts.nonMortgageDebt.value)} — linked credit/loan accounts`)
  }
  if (isEmpty('k401ContributionPct') && facts.k401Deferrals?.source?.origin === 'payroll' && facts.baseSalary?.value > 0) {
    const pct = Math.round((facts.k401Deferrals.pace / facts.baseSalary.value) * 1000) / 10
    if (pct > 0) add('k401ContributionPct', pct, `${pct}% — implied by payroll deferrals vs base pay`)
  }
  if (isEmpty('hsaContribution') && facts.hsaStatus?.contribution?.source?.origin === 'payroll') {
    const c = facts.hsaStatus.contribution
    const pace = r0(annualizeYtd(c.value, c.source.asOf))
    if (pace > 0) add('hsaContribution', pace, `${fmtUsd(pace)}/yr — payroll HSA pace`)
  }
  if (isEmpty('educationNeeds')) {
    const g = (state.goals || []).find(g => /college|529|education|school|tuition/i.test(g.name || ''))
    const target = g ? num(g.target) : 0
    if (target > 0) add('educationNeeds', r0(target), `${fmtUsd(r0(target))} — “${g.name}” goal target`)
  }
  return out
}
