// Goal pacing from real money movement — net deposits into the linked
// accounts over the last 3 complete months, compared against what the
// target date requires. Balance growth from market moves isn't a deposit
// and doesn't show up in transactions, so this measures saving behavior,
// which is the part the user controls.
//
// Growth: each goal carries an expected annual return (goal.returnPct,
// default 0 = cash). The required monthly contribution treats the current
// balance as compounding to the target date and the contributions as an
// ordinary annuity; the ETA solves the same equation for time. 0% falls
// back to the plain linear split. The assumption is always surfaced in the
// UI — never silently baked in.

import { localToday } from './dates.js'

const num = v => {
  const n = parseFloat(v)
  return Number.isNaN(n) ? 0 : n
}

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthsUntil(dateStr, todayStr) {
  if (!dateStr) return null
  const now = todayStr ? new Date(todayStr + 'T00:00') : new Date()
  const d = new Date(dateStr + 'T00:00')
  return Math.max(0, (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth())
}

// → { saved, target, remaining, pace, neededMonthly, monthsLeft, etaMonths,
//     etaLabel, status: 'done'|'on-track'|'behind'|'pacing'|'stalled'|'no-data' }
export function goalPace(state, goal, todayStr) {
  const today = todayStr || localToday()
  const ids = new Set((goal.accountIds || []).filter(id => (state.accounts || []).some(a => a.id === id)))
  const saved = (state.accounts || []).filter(a => ids.has(a.id)).reduce((s, a) => s + num(a.balance), 0)
  const target = num(goal.target)

  const thisMonth = today.slice(0, 7)
  const window = [shiftMonth(thisMonth, -3), shiftMonth(thisMonth, -2), shiftMonth(thisMonth, -1)]
  const flows = Object.fromEntries(window.map(m => [m, 0]))
  let sawAny = false
  for (const t of state.transactions || []) {
    if (!ids.has(t.accountId)) continue
    sawAny = true
    const m = t.date?.slice(0, 7)
    if (m in flows) flows[m] += num(t.amount) // net: deposits − withdrawals
  }
  const pace = Math.round(window.reduce((s, m) => s + flows[m], 0) / window.length)

  const remaining = Math.max(0, target - saved)
  const done = target > 0 && saved >= target
  const monthsLeft = monthsUntil(goal.targetDate, today)

  const returnPct = Math.max(0, num(goal.returnPct))
  const i = returnPct > 0 ? Math.pow(1 + returnPct / 100, 1 / 12) - 1 : 0 // monthly rate

  // Required deposit so saved·(1+i)^n + PMT·((1+i)^n − 1)/i = target.
  let neededMonthly = null
  if (!done && monthsLeft !== null && monthsLeft > 0) {
    if (i > 0) {
      const x = Math.pow(1 + i, monthsLeft)
      neededMonthly = Math.max(0, ((target - saved * x) * i) / (x - 1))
    } else {
      neededMonthly = remaining / monthsLeft
    }
  }

  // ETA at the current pace: solve the same equation for n. With growth,
  // (1+i)^n = (target + pace/i) / (saved + pace/i) — also covers pace = 0
  // (growth alone) and yields no ETA when the ratio never reaches 1.
  let etaMonths = null
  if (!done) {
    if (i > 0) {
      const denom = saved + pace / i
      const numer = target + pace / i
      if (denom > 0 && numer / denom > 1) {
        etaMonths = Math.ceil(Math.log(numer / denom) / Math.log(1 + i))
      }
    } else if (pace > 0) {
      etaMonths = Math.ceil(remaining / pace)
    }
  }
  let etaLabel = null
  if (etaMonths !== null) {
    const d = new Date(today + 'T00:00')
    d.setMonth(d.getMonth() + etaMonths)
    etaLabel = d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  }

  let status
  if (done) status = 'done'
  else if (ids.size === 0 || !sawAny) status = 'no-data'
  else if (neededMonthly !== null) status = pace >= neededMonthly * 0.95 ? 'on-track' : 'behind'
  else if (goal.targetDate && monthsLeft === 0 && remaining > 0) status = 'behind'
  else status = pace > 0 ? 'pacing' : 'stalled'

  return { saved, target, remaining, pace, neededMonthly, monthsLeft, etaMonths, etaLabel, status, returnPct, months: window }
}
