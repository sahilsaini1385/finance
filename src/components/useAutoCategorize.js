import { useStore, uid } from '../store.jsx'
import { useToast } from './Toaster.jsx'
import { normalizeMerchant } from '../lib/savings.js'

// Category changes are remembered by default: recategorizing a transaction
// creates/updates a merchant rule and fixes every matching transaction, with
// a "Just this once" undo for genuine one-offs. Setting something to Other is
// treated as unclassifying, not a preference — no rule is created.
export function useAutoCategorize() {
  const { state, dispatch } = useStore()
  const toast = useToast()

  return (t, category) => {
    dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: t.id, category } })

    const merchant = normalizeMerchant(t.description)
    if (!merchant || merchant.length < 3 || category === 'Other') {
      toast(`Moved to ${category}`)
      return
    }

    const prevRule = (state.rules || []).find(r => r.match === merchant)
    const siblings = state.transactions
      .filter(x => x.id !== t.id && normalizeMerchant(x.description) === merchant && x.category !== category)
      .map(x => ({ id: x.id, category: x.category }))

    const ruleId = uid()
    dispatch({ type: 'ADD_RULE', payload: { id: ruleId, match: merchant, category } })
    dispatch({ type: 'APPLY_RULE', payload: { match: merchant, category, matcher: normalizeMerchant } })

    toast(
      `${merchant.toLowerCase()} → ${category} from now on${siblings.length > 0 ? ` · ${siblings.length + 1} transactions updated` : ''}`,
      {
        kind: 'good',
        action: {
          label: 'Just this once',
          onClick: () => {
            if (prevRule) dispatch({ type: 'ADD_RULE', payload: prevRule })
            else dispatch({ type: 'DELETE_RULE', payload: ruleId })
            for (const s of siblings) dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: s.id, category: s.category } })
            toast('Kept for this transaction only')
          },
        },
      },
    )
  }
}
