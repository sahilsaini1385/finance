// Savings detection — finds recurring charges and money leaks in transaction
// history. Pure functions, no I/O; runs entirely in the browser.

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
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const horizon = new Date(today)
  horizon.setDate(horizon.getDate() + days)
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
    const d = new Date(p.renewalDate)
    if (d >= today && d <= horizon) {
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
