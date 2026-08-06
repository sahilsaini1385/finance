// Turns a SimpleFIN /accounts payload into an APPLY_SYNC action for the store.
// Pure function of (payload, currentState) so it is trivially portable to a
// future server-side sync worker (see ARCHITECTURE.md).

import { institutionFromOrg, guessAccountType, epochToISODate } from './simplefin.js'
import { categorize } from './categorize.js'
import { uid } from '../store.jsx'

export function buildSyncPatch(payload, state) {
  const today = new Date().toISOString().slice(0, 10)
  const bySimplefinId = new Map(state.accounts.filter(a => a.simplefinId).map(a => [a.simplefinId, a]))
  const existingHashes = new Set(state.transactions.map(t => t.hash))

  const newAccounts = []
  const updatedAccounts = []
  const transactions = []
  let txSkipped = 0

  for (const sf of payload.accounts || []) {
    const existing = bySimplefinId.get(sf.id)
    const balance = parseFloat(sf.balance)
    let localId
    if (existing) {
      localId = existing.id
      // Balance and freshness come from the bank; keep any name/type/institution
      // edits the user made locally.
      updatedAccounts.push({ id: existing.id, balance: Number.isNaN(balance) ? existing.balance : balance, updated: today })
    } else {
      localId = uid()
      newAccounts.push({
        id: localId,
        simplefinId: sf.id,
        name: sf.name || 'Account',
        institution: institutionFromOrg(sf.org),
        type: guessAccountType(sf),
        balance: Number.isNaN(balance) ? 0 : balance,
        updated: today,
      })
    }

    for (const tx of sf.transactions || []) {
      if (tx.pending) continue
      const hash = `sf|${sf.id}|${tx.id}`
      if (existingHashes.has(hash)) {
        txSkipped++
        continue
      }
      existingHashes.add(hash)
      const amount = parseFloat(tx.amount)
      if (Number.isNaN(amount)) continue
      const description = (tx.payee || tx.description || '(no description)').trim()
      transactions.push({
        id: uid(),
        accountId: localId,
        date: epochToISODate(tx.posted || tx.transacted_at || 0),
        description,
        amount,
        category: categorize(description, '', amount),
        source: 'SimpleFIN',
        hash,
      })
    }
  }

  return {
    patch: { newAccounts, updatedAccounts, transactions },
    summary: {
      accountsCreated: newAccounts.length,
      accountsUpdated: updatedAccounts.length,
      txAdded: transactions.length,
      txSkipped,
      errors: payload.errors || [],
    },
  }
}
