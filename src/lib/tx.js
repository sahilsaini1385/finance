// Split transactions — one bank row divided across several categories
// (the Costco run that's half Groceries, half Household).
//
// A split lives on the transaction as t.splits = [{id, category, amount, note?}]
// with the amounts summing to t.amount (same sign). The original row keeps its
// hash/id so sync dedupe and pending→posted updates keep working; every piece
// of category math must go through txParts() so splits count per-category.

export function txParts(t) {
  if (Array.isArray(t.splits) && t.splits.length > 0) return t.splits
  return [t]
}

export function isSplit(t) {
  return Array.isArray(t.splits) && t.splits.length > 0
}
