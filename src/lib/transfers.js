// Transfer detection — keeps money moving BETWEEN your own accounts (credit
// card payments, checking→savings moves) out of income and spending, where it
// double-counts every dollar.
//
// Two layers:
//  1. Pair matching: equal-and-opposite amounts in different accounts within
//     a 7-day window → both sides are Transfers. Works regardless of wording.
//  2. Keyword fallback: card-payment phrasing for when only one side of the
//     pair is synced (e.g. the card account isn't connected).
//
// Every examined transaction is stamped pairChecked so the scan is one-shot
// per transaction and never fights a category the user set afterwards.

export const TRANSFER_RE = new RegExp(
  [
    'credit c(ar)?d',
    '(payment|pymt|epay|e-pay)[^a-z]{0,15}(to )?(bank of america|bofa|chase|citi|amex|american express|capital one|discover|barclay|us bank|wells fargo)',
    '(bank of america|bofa|chase|citi|amex|american express|capital one|discover|barclay|us bank|wells fargo)[^a-z]{0,15}(payment|pymt|epay|e-pay|autopay|directpay)',
    'cardmember serv',
    'payment thank you',
    'payment received',
    'crd (pmt|payment)',
    'internet payment',
    'directpay',
  ].join('|'),
  'i',
)

const DAY = 86400000
const WINDOW_DAYS = 7

// Returns { transferIds: string[], checkedIds: string[] }
// - transferIds: transactions to recategorize as Transfers
// - checkedIds: every transaction examined this pass (stamp pairChecked)
export function scanForTransfers(transactions) {
  const fresh = transactions.filter(t => !t.pairChecked)
  if (fresh.length === 0) return { transferIds: [], checkedIds: [] }

  const transferIds = new Set()
  const paired = new Set()

  // Index ALL transactions by absolute amount — a new transaction may pair
  // with an old, already-checked counterpart.
  const byAmount = new Map()
  for (const t of transactions) {
    const key = Math.abs(t.amount).toFixed(2)
    if (!byAmount.has(key)) byAmount.set(key, [])
    byAmount.get(key).push(t)
  }

  for (const t of fresh) {
    if (paired.has(t.id) || Math.abs(t.amount) < 5) continue
    const candidates = (byAmount.get(Math.abs(t.amount).toFixed(2)) || []).filter(
      c =>
        c.id !== t.id &&
        !paired.has(c.id) &&
        c.accountId !== t.accountId &&
        Math.sign(c.amount) === -Math.sign(t.amount) &&
        Math.abs(new Date(c.date) - new Date(t.date)) <= WINDOW_DAYS * DAY,
    )
    if (candidates.length === 0) continue
    candidates.sort(
      (a, b) => Math.abs(new Date(a.date) - new Date(t.date)) - Math.abs(new Date(b.date) - new Date(t.date)),
    )
    const match = candidates[0]
    paired.add(t.id)
    paired.add(match.id)
    if (t.category !== 'Transfers') transferIds.add(t.id)
    if (match.category !== 'Transfers') transferIds.add(match.id)
  }

  // Keyword fallback — only for still-uncategorized rows, so a deliberate
  // user categorization is never overridden.
  for (const t of fresh) {
    if (paired.has(t.id) || t.category !== 'Other') continue
    if (TRANSFER_RE.test(t.description)) transferIds.add(t.id)
  }

  return { transferIds: [...transferIds], checkedIds: fresh.map(t => t.id) }
}
