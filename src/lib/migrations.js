// One-time data migrations, applied when saved state loads. Each is guarded
// by a flag in state.migrations so it never re-runs (and never fights a user
// who has since changed the data by hand). Pure function — store.jsx calls it
// from the localStorage init path.

import { migrateAmazonCategory } from './categorize.js'
import { suggestAccountType } from './simplefin.js'
import { AMZN_SEED } from './rsu.js'

const looksLikeAmazonHousehold = s =>
  (s.accounts || []).some(a => /amazon/i.test(a.name || '')) ||
  (s.paystubs || []).some(p => /amazon/i.test(p.employer || ''))

export function applyDataMigrations(state) {
  let s = state

  if (!s.migrations?.amazonCategory) {
    const { transactions } = migrateAmazonCategory(s.transactions, s.rules)
    s = { ...s, transactions, migrations: { ...(s.migrations || {}), amazonCategory: true } }
  }

  // Accounts typed as cash whose names say "investment" (WROS, TOD, IRA,
  // 401(k)…) — usually synced before type-guessing understood those names.
  // Retype them once so Cash/Investments/Retirement buckets come out right;
  // afterwards the Accounts-page banner handles anything new.
  if (!s.migrations?.accountTypes1) {
    let changed = false
    const accounts = (s.accounts || []).map(a => {
      if (a.typeSuggestionDismissed) return a
      const to = suggestAccountType(a)
      if (!to) return a
      changed = true
      return { ...a, type: to }
    })
    s = { ...s, ...(changed ? { accounts } : {}), migrations: { ...s.migrations, accountTypes1: true } }
  }

  // Pre-load the household's Amazon vesting schedule (see AMZN_SEED). Only
  // when the state carries an Amazon marker, and only if no vests were ever
  // entered — a hand-entered schedule always wins.
  if (!s.migrations?.amznRsuSeed && looksLikeAmazonHousehold(s)) {
    const cur = s.rsu || {}
    const rsu = (cur.vests || []).length > 0
      ? cur
      : { ...cur, symbol: cur.symbol || AMZN_SEED.symbol, price: cur.price || AMZN_SEED.price, vests: AMZN_SEED.vests }
    s = { ...s, rsu, migrations: { ...s.migrations, amznRsuSeed: true } }
  }

  return s
}
