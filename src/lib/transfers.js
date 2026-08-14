// Transfer detection — keeps money moving BETWEEN your own accounts (credit
// card payments, checking→savings moves) out of income and spending, where it
// double-counts every dollar.
//
// Two layers:
//  1. Pair matching: equal-and-opposite amounts in different accounts within
//     a 7-day window → both sides are Transfers. Works regardless of wording.
//  2. Keyword fallback: card-payment phrasing for when only one side of the
//     pair is synced (e.g. the card account isn't connected).
//  3. Large-credit heuristic: a big positive amount on a credit-card account
//     with no matching charge on the same card is a payment or statement
//     credit, not a category refund — even when auto-categorization filed it
//     under a spending category (a $10k "Dining refund" is a card payment).
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
    // Statements punctuate these freely: "PAYMENT - THANK YOU", "Payment/Thank You".
    'payment[^a-z]{0,5}thank ?you',
    'payment[^a-z]{0,5}received',
    'crd (pmt|payment)',
    'internet payment',
    'directpay',
  ].join('|'),
  'i',
)

import { isSplit } from './tx.js'
import { normalizeMerchant } from './savings.js'

const DAY = 86400000
const WINDOW_DAYS = 7

// Bump when TRANSFER_RE gains patterns or a new layer lands: previously-
// scanned transactions get a re-sweep of the stateless layers (never pair
// re-matching, so a category the user chose after the first scan is never
// overridden). v3: large-credit heuristic on credit-card accounts.
// v4: card accounts recognized by name too (so a mistyped account still gets
// its payments caught), and payment-phrased rows corrected even when
// auto-categorization already filed them under a spending category.
export const SCAN_VERSION = 4

// How big a lone credit-card credit must be before it's presumed a payment.
// Real merchant refunds this large match an earlier charge on the same card;
// rewards/statement credits run far smaller.
const CC_PAYMENT_MIN = 500

// Returns { transferIds: string[], checkedIds: string[] }
// - transferIds: transactions to recategorize as Transfers
// - checkedIds: every transaction examined this pass (stamp pairChecked)
export function scanForTransfers(transactions, accounts = [], rules = []) {
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

  // Keyword fallback for when only one side of the pair is synced. Applies to
  // uncategorized rows AND to rows auto-categorization mis-filed under a
  // spending category — "PAYMENT - THANK YOU" is never a restaurant, and left
  // in Dining it silently cancels the month's real spending. A merchant the
  // user has categorized by hand (which writes a rule) is never touched.
  const ruledMerchants = new Set((rules || []).map(r => r.match).filter(Boolean))
  const userChose = t => ruledMerchants.has(normalizeMerchant(t.description || ''))
  for (const t of [...fresh, ...stale]) {
    if (paired.has(t.id) || t.category === 'Transfers' || isSplit(t)) continue
    if (t.category !== 'Other' && userChose(t)) continue
    if (TRANSFER_RE.test(t.description)) transferIds.add(t.id)
  }

  // Large-credit heuristic. On a credit-card account a positive amount is a
  // payment, statement credit, or merchant refund. A genuine refund reverses
  // an earlier charge on the SAME card, so it has an equal-and-opposite match
  // there; a payment doesn't. This layer may override an auto-assigned
  // spending category — no real refund of this size lacks its charge — and
  // runs one-shot, so re-choosing a category afterwards sticks.
  // Card accounts by declared type OR by an unmistakably card-ish name, so a
  // card that synced in under the wrong type still gets its payments caught.
  const ccIds = new Set(
    accounts
      .filter(a => {
        const n = a.name || ''
        if (/debit/i.test(n)) return false // a "Visa Debit" is a checking account
        return a.type === 'credit card' || /visa|mastercard|amex|american express|discover|credit card/i.test(n)
      })
      .map(a => a.id),
  )
  if (ccIds.size > 0) {
    for (const t of [...fresh, ...stale]) {
      if (paired.has(t.id) || transferIds.has(t.id) || isSplit(t)) continue
      if (!ccIds.has(t.accountId) || t.amount < CC_PAYMENT_MIN || t.category === 'Transfers') continue
      if (userChose(t)) continue // the user has an opinion about this merchant
      const hasChargeMatch = (byAmount.get(Math.abs(t.amount).toFixed(2)) || []).some(
        c =>
          c.id !== t.id &&
          c.accountId === t.accountId &&
          c.amount < 0 &&
          Math.abs(new Date(c.date) - new Date(t.date)) <= 90 * DAY,
      )
      if (!hasChargeMatch) transferIds.add(t.id)
    }
  }

  return { transferIds: [...transferIds], checkedIds: [...fresh, ...stale].map(t => t.id) }
}
