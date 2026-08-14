import { useStore, uid } from '../store.jsx'
import { useToast } from './Toaster.jsx'
import { normalizeMerchant } from '../lib/savings.js'
import { EXCLUDED } from '../lib/budget.js'

// Two verbs, never one. Changing a category used to also write a merchant rule
// and rewrite every matching transaction ever recorded — retroactively altering
// closed months — with a 4-second toast as the only signal or way back.
//
//   applyOne(t, category)        one row, no rule, ephemeral toast
//   applyToMerchant(t, category) the rule + the sweep, sticky toast with undo
//
// Callers show the blast radius (mergeCount) before firing the second one.

export function mergeCount(state, t, category) {
  const merchant = normalizeMerchant(t.description)
  if (!merchant || merchant.length < 3) return 0
  return state.transactions.filter(
    x => x.id !== t.id && normalizeMerchant(x.description) === merchant && x.category !== category,
  ).length
}

export function merchantLabel(t) {
  return (normalizeMerchant(t.description) || t.description || '').toLowerCase()
}

// True when a category silently removes the merchant from all budget math.
export function isExcludedCategory(category) {
  return EXCLUDED.includes(category)
}

export function useAutoCategorize() {
  const { state, dispatch } = useStore()
  const toast = useToast()

  const applyOne = (t, category) => {
    dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: t.id, category } })
    toast(`Moved to ${category}`)
  }

  // revertTo: the clicked row's category BEFORE applyOne moved it — without it
  // Undo restores the siblings and silently leaves the row you clicked on the
  // new category, which is not what the word means.
  const applyToMerchant = (t, category, { revertTo } = {}) => {
    const merchant = normalizeMerchant(t.description)
    if (!merchant || merchant.length < 3) return applyOne(t, category)

    const prevRule = (state.rules || []).find(r => r.match === merchant)
    const siblings = state.transactions
      .filter(x => x.id !== t.id && normalizeMerchant(x.description) === merchant && x.category !== category)
      .map(x => ({ id: x.id, category: x.category }))

    const ruleId = uid()
    dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: t.id, category } })
    dispatch({ type: 'ADD_RULE', payload: { id: ruleId, match: merchant, category } })
    dispatch({ type: 'APPLY_RULE', payload: { match: merchant, category, matcher: normalizeMerchant } })

    toast(
      `${siblings.length + 1} ${merchant.toLowerCase()} charges → ${category}${
        isExcludedCategory(category) ? ` · ${category} isn't counted as spending` : ''}`,
      {
        kind: 'good',
        sticky: true, // the only path back from an all-time rewrite
        action: {
          label: 'Undo',
          onClick: () => {
            if (prevRule) dispatch({ type: 'ADD_RULE', payload: prevRule })
            else dispatch({ type: 'DELETE_RULE', payload: ruleId })
            for (const s of siblings) dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: s.id, category: s.category } })
            if (revertTo) dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: t.id, category: revertTo } })
            toast('Reverted')
          },
        },
      },
    )
  }

  return { applyOne, applyToMerchant }
}
