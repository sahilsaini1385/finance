// Health-plan deductible / out-of-pocket tracking — pure functions over state.
//
// A health policy may carry plan-design fields (all optional strings from the
// form): deductible (in-network), oopMax (in-network OOP max for the enrolled
// tier), oopMaxIndividual (embedded per-person max), oonDeductible, oonOopMax,
// planYearStartMonth (1–12, default January), and oopSpentManual — the exact
// accumulator from the insurer's member portal, which beats our estimate when
// present. Without it, progress is estimated from Health-category spending in
// the current plan year (split-aware, refunds net out).

import { txParts } from './tx.js'
import { localToday } from './dates.js'

const num = v => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

// First day of the plan year containing `todayStr` (YYYY-MM-DD).
export function planYearStart(policy, todayStr = localToday()) {
  const startMonth = Math.min(12, Math.max(1, Math.round(num(policy?.planYearStartMonth)) || 1))
  const [y, m] = todayStr.split('-').map(Number)
  const year = m >= startMonth ? y : y - 1
  return `${year}-${String(startMonth).padStart(2, '0')}-01`
}

// Health-category spending since the plan year started, through today.
// Split-aware; positive Health amounts (reimbursements) net against spend.
export function healthSpendThisPlanYear(state, policy, todayStr = localToday()) {
  const start = planYearStart(policy, todayStr)
  let sum = 0
  for (const t of state.transactions || []) {
    if (!t.date || t.date < start || t.date > todayStr) continue
    for (const p of txParts(t)) {
      if (p.category === 'Health') sum += -p.amount
    }
  }
  return Math.max(0, sum)
}

// Progress toward the in-network OOP max (and deductible when the plan has
// one). Returns null unless the policy defines an OOP max — that's the signal
// the user opted into tracking. `spent` prefers the manual portal figure.
export function oopStatus(state, policy, todayStr = localToday()) {
  const oopMax = num(policy?.oopMax)
  if (!(oopMax > 0)) return null
  const start = planYearStart(policy, todayStr)
  const auto = healthSpendThisPlanYear(state, policy, todayStr)
  const manualRaw = policy?.oopSpentManual
  const manual = manualRaw !== '' && manualRaw != null && Number.isFinite(parseFloat(manualRaw))
  const spent = manual ? Math.max(0, num(manualRaw)) : auto
  const deductible = num(policy?.deductible)
  return {
    planYearStart: start,
    oopMax,
    spent,
    manual,
    remaining: Math.max(0, oopMax - spent),
    pct: Math.min(1, spent / oopMax),
    metOopMax: spent >= oopMax,
    deductible,
    deductibleMet: deductible > 0 ? spent >= deductible : true,
  }
}
