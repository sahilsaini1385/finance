// Savings detection — finds recurring charges and money leaks in transaction
// history. Pure functions, no I/O; runs entirely in the browser.

import { localToday } from './dates.js'

const num = v => {
  const n = parseFloat(v)
  return Number.isNaN(n) ? 0 : n
}

// Normalize a raw bank descriptor to a stable merchant key:
// "SQ *BLUE BOTTLE 0042 OAKLAND CA" and "SQ *BLUE BOTTLE 0087 SF CA" → "BLUE BOTTLE"
export function normalizeMerchant(desc) {
  let s = String(desc || '').toUpperCase()
  s = s.replace(/^(SQ|TST|PY|PP|PAYPAL|SP|CKE|IC|DD|GOOGLE|APL|APPLE\.COM\/BILL)\s*\*\s*/i, '')
  s = s.replace(/\b(POS|DEBIT|CREDIT|PURCHASE|RECURRING|PAYMENT|WEB|ONLINE|ACH)\b/g, ' ')
  s = s.replace(/[#*]?\d[\d-]*/g, ' ')           // store numbers, dates, refs
  s = s.replace(/\.(COM|NET|ORG|IO|TV)\b/g, ' ') // domains
  s = s.replace(/[^A-Z& ]/g, ' ').replace(/\s+/g, ' ').trim()
  let words = s.split(' ').filter(w => w.length > 1 || w === '&')
  // Drop a trailing US state code ("HULU CA" → "HULU") unless it's the only word.
  if (words.length > 1 && /^(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)$/.test(words[words.length - 1])) {
    words = words.slice(0, -1)
  }
  return words.slice(0, 3).join(' ')
}

function daysBetween(a, b) {
  return Math.abs(new Date(b) - new Date(a)) / 86400000
}

function median(arr) {
  const s = [...arr].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Detect recurring charges: same merchant, steady cadence, similar amounts.
// Returns [{merchant, cadence, monthlyCost, medianAmount, lastAmount, firstAmount,
//           count, lastDate, increased}] sorted by monthlyCost desc.
export function detectRecurring(transactions) {
  const groups = new Map()
  const NOT_BILLS = ['Transfers', 'Groceries', 'Dining'] // steady habits aren't subscriptions
  for (const t of transactions) {
    if (t.amount >= 0 || NOT_BILLS.includes(t.category)) continue
    const key = normalizeMerchant(t.description)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }

  const out = []
  for (const [merchant, txs] of groups) {
    if (txs.length < 2) continue
    txs.sort((a, b) => (a.date < b.date ? -1 : 1))
    const amounts = txs.map(t => -t.amount)
    const med = median(amounts)
    // Amount steadiness: recurring bills cluster near their median.
    const steady = amounts.filter(a => Math.abs(a - med) <= Math.max(2, med * 0.25)).length
    if (steady < Math.ceil(txs.length * 0.6)) continue

    const intervals = []
    for (let i = 1; i < txs.length; i++) intervals.push(daysBetween(txs[i - 1].date, txs[i].date))
    const medInterval = median(intervals)

    let cadence = null
    let monthlyCost = 0
    if (medInterval >= 5 && medInterval <= 9) {
      cadence = 'weekly'
      monthlyCost = med * 4.33
    } else if (medInterval >= 12 && medInterval <= 17) {
      cadence = 'biweekly'
      monthlyCost = med * 2.17
    } else if (medInterval >= 25 && medInterval <= 36) {
      cadence = 'monthly'
      monthlyCost = med
    } else if (medInterval >= 350 && medInterval <= 380) {
      cadence = 'annual'
      monthlyCost = med / 12
    } else {
      continue
    }
    // Weekly patterns need more evidence than two points.
    if ((cadence === 'weekly' || cadence === 'biweekly') && txs.length < 4) continue

    const firstAmount = amounts[0]
    const lastAmount = amounts[amounts.length - 1]
    out.push({
      merchant,
      cadence,
      monthlyCost,
      medianAmount: med,
      firstAmount,
      lastAmount,
      count: txs.length,
      lastDate: txs[txs.length - 1].date,
      increased: lastAmount > firstAmount * 1.08 && lastAmount - firstAmount >= 1,
    })
  }
  return out.sort((a, b) => b.monthlyCost - a.monthlyCost)
}

const CADENCE_DAYS = { weekly: 7, biweekly: 14, monthly: 30.44, annual: 365.25 }

// Project detected recurring charges (and insurance renewals) forward.
// Returns { bills: [{date, label, amount, kind}], total } within `days` from today.
export function upcomingBills(recurring, insurance = [], days = 30) {
  // Anchor "today" to the LOCAL calendar date at UTC midnight so it compares
  // cleanly with 'YYYY-MM-DD' strings parsed by new Date() (which are UTC).
  const todayStr = localToday()
  const today = new Date(todayStr + 'T00:00:00Z')
  const horizon = new Date(today)
  horizon.setUTCDate(horizon.getUTCDate() + days)
  const horizonStr = horizon.toISOString().slice(0, 10)
  const bills = []

  for (const r of recurring) {
    const step = CADENCE_DAYS[r.cadence]
    if (!step) continue
    let next = new Date(r.lastDate)
    // Walk forward from the last observed charge to the first due date >= today.
    let guard = 0
    while (next < today && guard++ < 400) next = new Date(next.getTime() + step * 86400000)
    while (next <= horizon) {
      bills.push({ date: next.toISOString().slice(0, 10), label: r.merchant.toLowerCase(), amount: r.medianAmount, kind: r.cadence })
      next = new Date(next.getTime() + step * 86400000)
    }
  }

  for (const p of insurance) {
    if (!p.renewalDate) continue
    if (p.renewalDate >= todayStr && p.renewalDate <= horizonStr) {
      bills.push({
        date: p.renewalDate,
        label: `${p.provider || p.policyName || 'policy'} ${p.type} renewal`.toLowerCase(),
        amount: p.premiumFreq === 'year' ? num(p.premium) : num(p.premium),
        kind: 'renewal',
      })
    }
  }

  bills.sort((a, b) => (a.date < b.date ? -1 : 1))
  return { bills, total: bills.reduce((s, b) => s + b.amount, 0) }
}

const SERVICE_FAMILIES = [
  ['streaming video', /netflix|hulu|disney|hbo|max\b|paramount|peacock|apple tv|appletv|youtube tv|sling|fubo/i],
  ['music', /spotify|apple music|youtube premium|youtube music|tidal|pandora|amazon music/i],
  ['cloud storage', /icloud|google one|dropbox|onedrive/i],
  ['fitness', /planet fitness|equinox|crunch|la fitness|peloton|classpass|gym/i],
  ['news & reading', /nyt|nytimes|wsj|washington post|the atlantic|medium|substack|audible|kindle unlimited/i],
]

const DELIVERY_RE = /doordash|grubhub|ubereats|uber eats|postmates|instacart|caviar|seamless/i
const FEE_RE = /fee|overdraft|service charge|atm /i

// Rough national market ranges for common recurring services — deliberately
// conservative and clearly labeled as benchmarks, updated ~annually like the
// IRS limits. A bill has to clear the high end with margin before we say
// anything, so regional/tier differences don't produce nagging.
export const BILL_BENCHMARKS = [
  { key: 'internet', label: 'home internet', re: /comcast|xfinity|spectrum|cox comm|centurylink|frontier comm|fios|att u-?verse|att internet|quantum fiber/i,
    low: 50, high: 85, tip: 'Fiber and 5G home internet (T-Mobile/Verizon, ~$50 flat) have made this the easiest bill to re-shop. If you stay, call retention and ask for the current promo rate — "I\'m considering switching" routinely knocks $20–40/mo off.' },
  { key: 'wireless', label: 'wireless phone service', re: /t-mobile|tmobile|verizon wr?ls|verizon wireless|at&t mobil|att mobil|sprint/i,
    low: 30, high: 90, tip: 'MVNOs on the same towers (Mint, Visible, US Mobile) run $15–30/line. Family plans above ~$45/line are paying for the brand, not the coverage.' },
  { key: 'autoInsurance', label: 'auto insurance', re: /geico|progressive|state farm|allstate|liberty mutual|farmers ins|usaa/i,
    low: 80, high: 170, tip: 'Per-vehicle full coverage varies hugely by state and record, but loyalty pricing is real — two quotes at renewal typically beat a 3-year-old policy by 10–25%.' },
  { key: 'homeSecurity', label: 'home security monitoring', re: /\badt\b|vivint|brinks home|simplisafe|ring protect/i,
    low: 20, high: 45, tip: 'Self-install systems (SimpliSafe, Ring) monitor for $20–30/mo with no contract — legacy contracts at $50–60/mo are mostly paying for the truck that installed it years ago.' },
  { key: 'gym', label: 'gym membership', re: /planet fitness|la fitness|24 hour fitness|equinox|lifetime fitness|crunch fitness|ymca/i,
    low: 15, high: 80, tip: 'Worth it if you go. If attendance has slipped, most chains have a cheaper tier — or your health plan/employer may reimburse part of it.' },
]

export function benchmarkBill(bill) {
  const b = BILL_BENCHMARKS.find(x => x.re.test(bill.merchant))
  if (!b) return null
  // Only speak up when clearly above the range (5% grace over the high end).
  const over = bill.monthlyCost > b.high * 1.05
  return { ...b, over, overBy: over ? Math.round(bill.monthlyCost - (b.low + b.high) / 2) : 0 }
}

// Returns advisor-style recs (area: 'savings') plus the recurring table data.
export function getSavingsInsights(state) {
  const txs = state.transactions || []
  const recs = []
  const push = (severity, title, detail) =>
    recs.push({ id: `savings-${recs.length}`, area: 'savings', severity, title, detail })

  const recurring = detectRecurring(txs)
  const monthlyTotal = recurring.reduce((s, r) => s + r.monthlyCost, 0)

  if (recurring.length > 0) {
    push('info', `${recurring.length} recurring charges cost you ~$${Math.round(monthlyTotal).toLocaleString()}/mo (~$${Math.round(monthlyTotal * 12).toLocaleString()}/yr)`,
      'The full list is in the table below. The average household pays for at least one subscription it forgot about — scan the list for anything you haven\'t used in the last month and cancel it; that\'s pure savings with zero lifestyle cost.')
  }

  // Market-rate check: recurring bills clearly above typical national ranges.
  for (const bill of recurring) {
    const b = benchmarkBill(bill)
    if (!b || !b.over) continue
    push('warning', `${bill.merchant.toLowerCase()} at $${Math.round(bill.monthlyCost)}/mo — above typical ${b.label} pricing`,
      `Typical ${b.label} runs $${b.low}–$${b.high}/mo (rough national range — your speed tier, coverage, or region may justify more). Getting to the middle of that range would save ~$${b.overBy.toLocaleString()}/mo (~$${(b.overBy * 12).toLocaleString()}/yr). ${b.tip} Ask the AI advisor to research current rates in your area for specifics.`)
  }

  // Overlapping services within a family
  for (const [family, re] of SERVICE_FAMILIES) {
    const members = recurring.filter(r => re.test(r.merchant))
    if (members.length >= 2) {
      const cheapest = Math.min(...members.map(m => m.monthlyCost))
      const savings = members.reduce((s, m) => s + m.monthlyCost, 0) - cheapest
      push('warning', `${members.length} overlapping ${family} subscriptions`,
        `${members.map(m => `${m.merchant} ($${m.monthlyCost.toFixed(0)}/mo)`).join(' + ')}. Rotating one at a time instead of stacking them saves ~$${Math.round(savings)}/mo (~$${Math.round(savings * 12)}/yr) — most content isn't going anywhere.`)
    }
  }

  // Price creep
  const increased = recurring.filter(r => r.increased).slice(0, 3)
  for (const r of increased) {
    push('info', `${r.merchant} raised its price ($${r.firstAmount.toFixed(2)} → $${r.lastAmount.toFixed(2)})`,
      'Price increases on autopay go unnoticed by design. Worth a look: downgrade the tier, switch to an annual plan, or use the cancellation flow — retention offers frequently appear at the last step.')
  }

  // Small "gray" charges — forgotten-trial territory
  const gray = recurring.filter(r => r.cadence === 'monthly' && r.medianAmount <= 15)
  if (gray.length >= 2) {
    const total = gray.reduce((s, r) => s + r.monthlyCost, 0)
    push('info', `${gray.length} small monthly charges add up to $${total.toFixed(0)}/mo`,
      `${gray.map(r => r.merchant).join(', ')} — small enough to slip by, $${Math.round(total * 12)}/yr together. These are the classic forgotten-free-trial suspects.`)
  }

  // Bank/ATM/overdraft fees
  const feeTotal = txs.filter(t => t.amount < 0 && (t.category === 'Fees' || FEE_RE.test(t.description)))
    .reduce((s, t) => s + -t.amount, 0)
  if (feeTotal >= 20) {
    push('warning', `$${Math.round(feeTotal)} in bank/service fees in your history`,
      'Fees are the easiest expense to eliminate entirely: overdraft protection via a linked savings account, in-network ATMs (or a bank that refunds ATM fees), and no-annual-fee cards unless the rewards demonstrably exceed the fee.')
  }

  // Food delivery
  const months = new Set(txs.map(t => t.date?.slice(0, 7))).size || 1
  const deliveryTotal = txs.filter(t => t.amount < 0 && DELIVERY_RE.test(t.description))
    .reduce((s, t) => s + -t.amount, 0)
  const deliveryMonthly = deliveryTotal / Math.min(months, 3)
  if (deliveryMonthly >= 100) {
    push('info', `Food delivery runs ~$${Math.round(deliveryMonthly)}/mo`,
      `Delivery apps add 30–90% over menu prices after fees, markups, and tips. Even switching half of it to pickup saves roughly $${Math.round(deliveryMonthly * 0.2)}–$${Math.round(deliveryMonthly * 0.45)}/mo without giving up the food you actually want.`)
  }

  return { recs, recurring, monthlyTotal }
}
