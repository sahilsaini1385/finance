// Split transactions — one bank row divided across several categories
// (the Costco run that's half Groceries, half Household).
//
// A split lives on the transaction as t.splits = [{id, category, amount, note?}]
// with the amounts summing to t.amount (same sign). The original row keeps its
// hash/id so sync dedupe and pending→posted updates keep working; every piece
// of category math must go through txParts() so splits count per-category.

// A split is only honored while its parts still sum to the transaction's
// amount (within a cent). If a pending transaction posts with a different
// amount, the stale split is ignored — the row falls back to its single
// category instead of silently double-counting old numbers.
function splitsValid(t) {
  if (!Array.isArray(t.splits) || t.splits.length === 0) return false
  const sum = t.splits.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  return Math.abs(sum - t.amount) < 0.011
}

export function txParts(t) {
  return splitsValid(t) ? t.splits : [t]
}

export function isSplit(t) {
  return splitsValid(t)
}
