// The Transactions page's engine: filtering, searching, and — the part that
// matters — totals computed over the FULL match set, not over the truncated
// window that gets painted. Pure functions, no React, so the math that has to
// agree with the Budget page can be tested without mounting anything.

import { txParts, isSplit } from './tx.js'
import { EXCLUDED } from './budget.js'
import { normalizeMerchant } from './savings.js'
import { localToday, localMonth } from './dates.js'

// ---------- search index ----------

// normalizeMerchant is a multi-regex chain; calling it inside a filter
// predicate over thousands of rows on every keystroke is the difference
// between instant and janky. Index once, keyed on the fields that feed it, so
// editing one row's category recomputes that row and nothing else.
const cache = new Map()

// Banks print card-network shorthand, people type the name they say out loud.
// Without this, searching "amazon" returns nothing for a wallet full of
// "AMZN MKTP US*2X4B1" and the app looks broken. Only entries where the
// statement string genuinely differs from the spoken name earn a slot.
const ALIASES = [
  [/\bamzn\b|amazon/i, 'amazon'],
  [/\bsbux\b|starbucks/i, 'starbucks'],
  [/\btgt\b|target/i, 'target'],
  [/\bwm supe?r?c?e?n?t?e?r?\b|\bwal-?mart\b/i, 'walmart'],
  [/\bnflx\b|netflix/i, 'netflix'],
  [/\btst\*/i, 'toast restaurant'],
  [/\bsq ?\*/i, 'square'],
  [/\bdd ?\*|doordash/i, 'doordash'],
  [/\bwf\b|whole ?foods/i, 'whole foods'],
  [/\bchevron|\bshell oil|\bexxonmobil/i, 'gas station'],
]

function aliasesFor(text) {
  const out = []
  for (const [re, name] of ALIASES) if (re.test(text)) out.push(name)
  return out
}

function entryFor(t, accountName) {
  const key = `${t.id}|${t.description}|${t.category}|${t.note || ''}|${(t.tags || []).join(',')}|${accountName}`
  const hit = cache.get(t.id)
  if (hit && hit.key === key) return hit
  const merchant = normalizeMerchant(t.description || '')
  const entry = {
    key,
    merchant,
    abs: Math.abs(Number(t.amount) || 0),
    hay: [t.description, merchant, ...aliasesFor(t.description || ''), t.details, t.note,
      (t.tags || []).join(' '), accountName, t.category]
      .filter(Boolean).join('   ').toLowerCase(),
    tags: (t.tags || []).map(s => s.toLowerCase()),
  }
  cache.set(t.id, entry)
  return entry
}

export function buildIndex(transactions, accounts = []) {
  const names = new Map(accounts.map(a => [a.id, `${a.institution || ''} ${a.name || ''}`.trim()]))
  const index = new Map()
  for (const t of transactions) index.set(t.id, entryFor(t, names.get(t.accountId) || ''))
  return index
}

// ---------- query parsing ----------

// One box, several meanings: bare words are substring matches, #foo matches a
// tag, a number matches the amount, and >100 / <20 compare it.
export function parseQuery(q) {
  const terms = [], tags = [], nums = [], cmps = []
  for (const raw of String(q || '').trim().split(/\s+/).filter(Boolean)) {
    const tok = raw.toLowerCase()
    if (tok.startsWith('#') && tok.length > 1) { tags.push(tok.slice(1)); continue }
    const cmp = tok.match(/^([<>])=?\$?([\d,]+(?:\.\d+)?)$/)
    if (cmp) { cmps.push({ op: cmp[1], value: parseFloat(cmp[2].replace(/,/g, '')) }); continue }
    const num = tok.match(/^\$?([\d,]+(?:\.\d{1,2})?)$/)
    if (num) {
      const value = parseFloat(num[1].replace(/,/g, ''))
      if (!Number.isNaN(value)) { nums.push({ value, cents: /\.\d{1,2}$/.test(num[1]) }); continue }
    }
    terms.push(tok)
  }
  return { terms, tags, nums, cmps }
}

export function matchRow(entry, parsed) {
  for (const term of parsed.terms) if (!entry.hay.includes(term)) return false
  for (const tag of parsed.tags) if (!entry.tags.some(x => x.includes(tag))) return false
  for (const c of parsed.cmps) {
    if (c.op === '>' && !(entry.abs > c.value)) return false
    if (c.op === '<' && !(entry.abs < c.value)) return false
  }
  for (const n of parsed.nums) {
    // "47.32" means that cent exactly; "47" means anything that rounds down to $47.
    const ok = n.cents ? Math.abs(entry.abs - n.value) < 0.005 : entry.abs >= n.value && entry.abs < n.value + 1
    if (!ok) return false
  }
  return true
}

// ---------- period ----------

export function shiftMonthKey(month, delta) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function daysAgo(n, today = localToday()) {
  const [y, m, d] = today.split('-').map(Number)
  const dt = new Date(y, m - 1, d - n)
  return localToday(dt)
}

export const PERIODS = [
  { id: 'month', label: 'This month' },
  { id: 'last', label: 'Last month' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
]

// Date strings are 'YYYY-MM-DD', so plain string comparison is correct and
// avoids the UTC drift that Date objects reintroduce.
export function inPeriod(date, period, today = localToday()) {
  if (!date) return false
  switch (period) {
    case 'month': return date.startsWith(localMonth(new Date(today + 'T00:00')))
    case 'last': return date.startsWith(shiftMonthKey(today.slice(0, 7), -1))
    case '90d': return date >= daysAgo(90, today)
    case 'year': return date.startsWith(today.slice(0, 4))
    default: return true
  }
}

export function periodLabel(period, today = localToday()) {
  const monthName = key => new Date(key + '-02T00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  switch (period) {
    case 'month': return monthName(today.slice(0, 7))
    case 'last': return monthName(shiftMonthKey(today.slice(0, 7), -1))
    case '90d': return 'the last 90 days'
    case 'year': return today.slice(0, 4)
    default: return 'all time'
  }
}

// ---------- filtering ----------

export function filterRows(transactions, index, view, today = localToday()) {
  const parsed = parseQuery(view.query)
  const out = []
  for (const t of transactions) {
    if (!inPeriod(t.date, view.period, today)) continue
    if (view.account !== 'all' && t.accountId !== view.account) continue
    if (view.category !== 'all'
      && t.category !== view.category
      && !(t.splits || []).some(s => s.category === view.category)) continue
    const entry = index.get(t.id)
    if (entry && !matchRow(entry, parsed)) continue
    out.push(t)
  }
  return out
}

// When a category filter is on and the row is split, the row's relevant amount
// is its matching piece — showing the $220 parent under a Groceries filter is
// why hand-totalling never agreed with the Budget page.
export function partAmount(t, category) {
  if (category === 'all' || !isSplit(t)) return Number(t.amount) || 0
  return t.splits.filter(s => s.category === category).reduce((s, p) => s + (Number(p.amount) || 0), 0)
}

export function sortRows(rows, sort, category = 'all') {
  const copy = [...rows]
  if (sort === 'amount') {
    // Ties broken by id so the order is stable across re-renders.
    copy.sort((a, b) => Math.abs(partAmount(b, category)) - Math.abs(partAmount(a, category)) || (a.id < b.id ? 1 : -1))
  } else {
    copy.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1))
  }
  return copy
}

// ---------- totals ----------

// MUST mirror budget.js monthActivity part-for-part, or the page ships a
// second number that contradicts the Budget page. Same Income guard, same
// EXCLUDED skip, same split-part iteration. The one deliberate difference: no
// per-envelope zero clamp, because a filtered view that clamped would hide a
// net-positive result — we say "back" instead.
export function summarize(rows, { category = 'all' } = {}) {
  let spent = 0, income = 0, moved = 0, refunded = 0, count = 0
  for (const t of rows) {
    let counted = false
    for (const p of txParts(t)) {
      if (category !== 'all' && p.category !== category) continue
      counted = true
      const amt = Number(p.amount) || 0
      if (p.category === 'Income' && amt > 0) { income += amt; continue }
      if (EXCLUDED.includes(p.category)) { moved += Math.abs(amt); continue }
      spent += -amt
      if (amt > 0) refunded += amt
    }
    if (counted) count++
  }
  const r2 = n => Math.round(n * 100) / 100
  return { spent: r2(spent), income: r2(income), moved: r2(moved), refunded: r2(refunded), count }
}

// ---------- day grouping ----------

export function dayLabel(date, today = localToday()) {
  if (date === today) return 'Today'
  if (date === daysAgo(1, today)) return 'Yesterday'
  const d = new Date(date + 'T00:00')
  const opts = { weekday: 'short', month: 'short', day: 'numeric' }
  if (date.slice(0, 4) !== today.slice(0, 4)) opts.year = 'numeric'
  return d.toLocaleDateString('en-US', opts)
}

// Group AFTER windowing, never before, or "Show more" renders a day header twice.
export function groupByDay(rows, category = 'all', today = localToday()) {
  const days = []
  let cur = null
  for (const t of rows) {
    if (!cur || cur.date !== t.date) {
      cur = { date: t.date, label: dayLabel(t.date, today), rows: [], net: 0 }
      days.push(cur)
    }
    cur.rows.push(t)
    cur.net += partAmount(t, category)
  }
  return days
}
