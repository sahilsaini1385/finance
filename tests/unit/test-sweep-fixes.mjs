// Bug-sweep regressions.
import { buildSyncPatch } from '../../src/lib/sync.js'
import { groupByDay, dayLabel, summarize } from '../../src/lib/txquery.js'
import { vestWithholding } from '../../src/lib/vestTax.js'
import { limitsFor } from '../../src/lib/taxTables.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + name) } }

// ---- a deleted synced transaction must not come back on the next sync ----
{
  const payload = {
    accounts: [{
      id: 'sf1', name: 'Checking', balance: '100', 'balance-date': 1750000000,
      org: { name: 'Chase' },
      transactions: [
        { id: 'tx1', posted: 1750000000, amount: '-25.00', description: 'COFFEE' },
        { id: 'tx2', posted: 1750000000, amount: '-40.00', description: 'LUNCH' },
      ],
    }],
  }
  const account = { id: 'a1', simplefinId: 'sf1', name: 'Checking', institution: 'Chase', type: 'checking', balance: 100 }
  const first = buildSyncPatch(payload, { accounts: [account], transactions: [], ignoredSimplefinIds: [] }).patch
  ok(first.transactions.length === 2, 'first sync brings both rows in')

  const deletedHash = first.transactions[0].hash
  const afterDelete = {
    accounts: [account],
    transactions: [first.transactions[1]],
    ignoredSimplefinIds: [],
    deletedTxHashes: [deletedHash],
  }
  const second = buildSyncPatch(payload, afterDelete).patch
  ok(!second.transactions.some(t => t.hash === deletedHash), 'a deleted row is NOT resurrected by the next sync')
  ok(second.transactions.every(t => t.hash !== deletedHash), 'and never sneaks back as an update either')

  // without the tombstone it would come straight back — proves the guard is load-bearing
  const noTombstone = buildSyncPatch(payload, { ...afterDelete, deletedTxHashes: [] }).patch
  ok(noTombstone.transactions.some(t => t.hash === deletedHash), 'control: with no tombstone it does come back')
}

// ---- day grouping must survive a row with no date ----
{
  let threw = false
  try { groupByDay([{ id: '1', amount: -5, category: 'Dining' }], 'all', '2026-08-14') } catch { threw = true }
  ok(!threw, 'groupByDay does not crash on a dateless row')
  ok(dayLabel(undefined, '2026-08-14') === '' && dayLabel('', '2026-08-14') === '', 'dayLabel is blank, not a crash, without a date')
  ok(summarize([{ id: '1', category: 'Dining', amount: NaN }]).spent === 0, 'a NaN amount contributes nothing')
}

// ---- year-keyed Social Security wage base ----
{
  ok(limitsFor(2025).ssWageBase === 176100 && limitsFor(2026).ssWageBase === 184500, 'wage base is year-keyed')
  ok(limitsFor(2026).medicareSurtaxAt.mfj === 250000, 'surtax thresholds are year-keyed too')
  // same wages, different year: the older, lower base leaves less room
  const a = vestWithholding({ amount: 20000, wagesYtd: 180000, year: 2025 })
  const b = vestWithholding({ amount: 20000, wagesYtd: 180000, year: 2026 })
  ok(a.socialSecurity === 0, '2025 base already passed at $180k of wages')
  ok(b.socialSecurity > 0, '2026 base is higher, so some SS is still due')
}

// ---- a nonsense state rate cannot manufacture a negative paycheck ----
{
  ok(vestWithholding({ amount: 1000, statePct: 500 }).net >= 0, 'state rate is clamped at 100%')
  ok(vestWithholding({ amount: 1000, statePct: -5 }).state === 0, 'a negative rate is treated as zero')
}

console.log(`\ntest-sweep-fixes: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
