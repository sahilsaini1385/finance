// Turns a SimpleFIN /accounts payload into an APPLY_SYNC action for the store.
// Pure function of (payload, currentState) so it is trivially portable to a
// future server-side sync worker (see ARCHITECTURE.md).
//
// Pending transactions are included (marked pending) so recent card activity —
// which Chase in particular reports as pending for days — shows up immediately.
// When the same transaction id later arrives as posted, the stored row is
// updated in place (same hash), so amounts/dates correct themselves.

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
  const accountReports = []
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

    let added = 0
    let updated = 0
    const received = (sf.transactions || []).length
    for (const tx of sf.transactions || []) {
      const posted = tx.posted || tx.transacted_at
      if (!posted) continue
      const hash = `sf|${sf.id}|${tx.id}`
      const amount = parseFloat(tx.amount)
      if (Number.isNaN(amount)) continue
      const description = (tx.payee || tx.description || '(no description)').trim()
      const row = {
        accountId: localId,
        date: epochToISODate(posted),
        description,
        amount,
        pending: Boolean(tx.pending),
        source: 'SimpleFIN',
        hash,
      }
      if (existingHashes.has(hash)) {
        // Re-send of a known transaction: only meaningful when a pending item
        // posts (date/amount can shift). APPLY_SYNC updates it in place.
        transactions.push(row)
        updated++
        txSkipped++
        continue
      }
      existingHashes.add(hash)
      transactions.push({ ...row, id: uid(), category: categorize(description, '', amount, state.rules || []) })
      added++
    }

    accountReports.push({
      simplefinId: sf.id,
      name: sf.name || 'Account',
      org: institutionFromOrg(sf.org),
      balance: Number.isNaN(balance) ? null : balance,
      received,
      added,
      isNew: !existing,
    })
  }

  return {
    patch: { newAccounts, updatedAccounts, transactions },
    summary: {
      accountsCreated: newAccounts.length,
      accountsUpdated: updatedAccounts.length,
      txAdded: transactions.filter(t => t.id).length,
      txSkipped,
      accounts: accountReports,
      errors: payload.errors || [],
    },
  }
}
