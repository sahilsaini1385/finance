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

const ISSUERS =
  'bank of america|bofa|chase|citi|amex|american express|capital one|discover|barclay|us bank|wells fargo|apple ?card|gs ?bank|goldman|synchrony'

export const TRANSFER_RE = new RegExp(
  [
    'credit c(ar)?d',
    `(payment|pymt|epay|e-pay)[^a-z]{0,15}(to )?(${ISSUERS})`,
    `(${ISSUERS})[^a-z]{0,15}(payment|pymt|epay|e-pay|autopay|directpay)`,
    'cardmember serv',
    'payment thank you',
    'payment received',
    'crd (pmt|payment)',
    'internet payment',
    'directpay',
  ].join('|'),
  'i',
)

import { isSplit } from './tx.js'

const DAY = 86400000
const WINDOW_DAYS = 7

// Bump when TRANSFER_RE gains patterns: previously-scanned transactions get a
// keyword-only re-sweep (never pair re-matching, so a category the user chose
// after the first scan is never overridden).
export const SCAN_VERSION = 2

// Returns { transferIds: string[], checkedIds: string[] }
// - transferIds: transactions to recategorize as Transfers
// - checkedIds: every transaction examined this pass (stamp pairChecked)
export function scanForTransfers(transactions) {
  const fresh = transactions.filter(t => !t.pairChecked)
  const stale = transactions.filter(t => t.pairChecked && t.pairChecked !== SCAN_VERSION)
  if (fresh.length === 0 && stale.length === 0) return { transferIds: [], checkedIds: [] }

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
    // A split transaction is a deliberate user categorization of its pieces —
    // flipping it to Transfers would leave the parts counting as spending.
    if (paired.has(t.id) || Math.abs(t.amount) < 5 || isSplit(t)) continue
    const candidates = (byAmount.get(Math.abs(t.amount).toFixed(2)) || []).filter(
      c =>
        c.id !== t.id &&
        !paired.has(c.id) &&
        !isSplit(c) &&
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
    // Only flip an already-scanned counterpart while it's still uncategorized —
    // a category the user set on an old transaction is never overridden.
    if (match.category !== 'Transfers' && (!match.pairChecked || match.category === 'Other')) {
      transferIds.add(match.id)
    }
  }

  // Keyword fallback — only for still-uncategorized rows, so a deliberate
  // user categorization is never overridden. Stale rows (scanned under an
  // older pattern set) get this layer too.
  for (const t of [...fresh, ...stale]) {
    if (paired.has(t.id) || t.category !== 'Other' || isSplit(t)) continue
    if (TRANSFER_RE.test(t.description)) transferIds.add(t.id)
  }

  return { transferIds: [...transferIds], checkedIds: [...fresh, ...stale].map(t => t.id) }
}
