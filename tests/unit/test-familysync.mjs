// Family sync: crypto roundtrip, 3-way merge semantics, payload shaping,
// and a full two-phone convergence simulation against a fake Supabase.
import {
  deriveKeys, encryptState, decryptState, threeWayMerge,
  toSyncedPayload, fromSyncedPayload, createFamilySyncEngine, sbPull, sbPush,
} from '../../src/lib/familySync.js'

let pass = 0, fail = 0
const ok = (c, n) => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

console.log('Crypto')
{
  const a = await deriveKeys('grape jetty maple 42', 'https://xyz.supabase.co')
  const b = await deriveKeys('grape jetty maple 42', 'https://xyz.supabase.co')
  const c = await deriveKeys('other words', 'https://xyz.supabase.co')
  ok(a.keyB64 === b.keyB64 && a.householdId === b.householdId, 'same passphrase → same key + household on both phones')
  ok(a.householdId !== c.householdId && a.keyB64 !== c.keyB64, 'different passphrase → different household')
  const ct = await encryptState({ hello: 'world', n: [1, 2] }, a.keyB64)
  ok(!ct.includes('hello'), 'ciphertext is opaque')
  ok((await decryptState(ct, a.keyB64)).hello === 'world', 'roundtrip decrypts')
  let failed = false
  try { await decryptState(ct, c.keyB64) } catch { failed = true }
  ok(failed, 'wrong key cannot decrypt')
}

console.log('3-way merge')
{
  const base = { profile: { age: '38', state: '' }, accounts: [{ id: 'a', balance: 10 }, { id: 'b', balance: 5 }], budgets: { Groceries: 600 } }
  // local edits profile.age; remote edits budgets + account b balance
  const local = { ...base, profile: { age: '39', state: '' } }
  const remote = { ...base, budgets: { Groceries: 700 }, accounts: [{ id: 'a', balance: 10 }, { id: 'b', balance: 8 }] }
  const m = threeWayMerge(base, local, remote)
  ok(m.profile.age === '39' && m.budgets.Groceries === 700 && m.accounts[1].balance === 8, 'independent edits both survive')

  // both add different entities
  const l2 = { ...base, accounts: [...base.accounts, { id: 'c', balance: 1 }] }
  const r2 = { ...base, accounts: [...base.accounts, { id: 'd', balance: 2 }] }
  const m2 = threeWayMerge(base, l2, r2)
  ok(m2.accounts.map(a => a.id).sort().join('') === 'abcd', 'adds from both phones union')

  // remote deletes untouched entity; local deletes entity remote edited
  const l3 = { ...base, accounts: [base.accounts[0]] } // local deleted b
  const r3 = { ...base, accounts: [base.accounts[0], { id: 'b', balance: 99 }] } // remote edited b
  const m3 = threeWayMerge(base, l3, r3)
  ok(m3.accounts.find(a => a.id === 'b')?.balance === 99, 'edit beats delete')
  const r4 = { ...base, accounts: [base.accounts[0]] } // remote deleted b, local untouched
  ok(!threeWayMerge(base, base, r4).accounts.some(a => a.id === 'b'), 'clean delete propagates')

  // scalar conflict → local wins
  const m5 = threeWayMerge(base, { ...base, profile: { age: '40', state: '' } }, { ...base, profile: { age: '41', state: '' } })
  ok(m5.profile.age === '40', 'scalar conflict: local device wins deterministically')
}

console.log('Payload shaping')
{
  const state = {
    accounts: [], connections: { claude: { token: 'sk-ant-api-SECRET' }, familySync: { url: 'x' }, simplefin: { accessUrl: 'https://u:p@sf' } },
  }
  const p = toSyncedPayload(state)
  ok(!p.connections.claude && !p.connections.familySync, 'per-device credentials never cross the wire')
  ok(p.connections.simplefin.accessUrl.includes('sf'), 'simplefin connection is shared (both phones can bank-sync)')
  const back = fromSyncedPayload(p, state)
  ok(back.connections.claude.token === 'sk-ant-api-SECRET' && back.connections.familySync.url === 'x', 'local credentials restored on receive')
}

console.log('Two-phone convergence (fake Supabase)')
{
  // in-memory server implementing the two REST shapes the engine uses
  let row = null
  const fakeFetch = async (url, opts = {}) => {
    const u = String(url)
    if (opts.method === 'POST') {
      const body = JSON.parse(opts.body)
      if (row) return { ok: false, status: 409, json: async () => ({}) }
      row = body
      return { ok: true, status: 201, json: async () => ({}) }
    }
    if (opts.method === 'PATCH') {
      const vMatch = Number(u.match(/version=eq\.(\d+)/)[1])
      if (!row || row.version !== vMatch) return { ok: true, status: 200, json: async () => [] }
      const body = JSON.parse(opts.body)
      row = { ...row, ...body }
      return { ok: true, status: 200, json: async () => [row] }
    }
    return { ok: true, status: 200, json: async () => (row ? [{ version: row.version, ciphertext: row.ciphertext }] : []) }
  }

  const memStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) } }
  const empty = { accounts: [], goals: [], profile: { age: '', grossIncome: '' }, budgets: {}, connections: {} }
  const keys = await deriveKeys('family words here', 'https://xyz.supabase.co')
  const cfg = { url: 'https://xyz.supabase.co', anonKey: 'anon', ...keys }

  const mkPhone = init => {
    let state = init
    const eng = createFamilySyncEngine({
      getState: () => state,
      apply: merged => { state = merged },
      emptyState: empty,
      fetchImpl: fakeFetch,
      storage: memStorage(),
      debounceMs: 1,
      intervalMs: 10 ** 9,
    })
    return { get state() { return state }, set state(s) { state = s }, eng }
  }

  // Phone A has the family data; phone B is fresh
  const A = mkPhone({ ...empty, accounts: [{ id: 'a1', name: 'Checking', balance: 100 }], profile: { age: '38', grossIncome: '340000' }, connections: { claude: { token: 'A-SECRET' } } })
  A.eng.configure(cfg)
  await sleep(50)
  ok(row !== null && row.version === 1, 'phone A publishes the household')
  ok(!row.ciphertext.includes('Checking') && !row.ciphertext.includes('340000'), 'server stores only ciphertext')

  const B = mkPhone({ ...empty, connections: { claude: { token: 'B-SECRET' } } })
  B.eng.configure(cfg)
  await sleep(50)
  ok(B.state.accounts.length === 1 && B.state.profile.grossIncome === '340000', 'phone B joins and receives the data')
  ok(B.state.connections.claude?.token === 'B-SECRET', 'phone B keeps its own advisor credential')

  // Divergent edits: A renames the account; B adds a goal and edits age
  A.state = { ...A.state, accounts: [{ id: 'a1', name: 'Joint Checking', balance: 100 }] }
  A.eng.notifyLocalChange()
  await sleep(60)
  B.state = { ...B.state, goals: [{ id: 'g1', name: 'College', target: 500 }], profile: { ...B.state.profile, age: '39' } }
  B.eng.notifyLocalChange()
  await sleep(60)
  await A.eng.syncNow()
  await sleep(20)
  ok(A.state.goals.length === 1 && A.state.accounts[0].name === 'Joint Checking' && A.state.profile.age === '39', 'phone A converges with both edits')
  await B.eng.syncNow()
  await sleep(20)
  ok(B.state.accounts[0].name === 'Joint Checking' && B.state.goals.length === 1, 'phone B converges too')
  ok(JSON.stringify(toSyncedPayload(A.state)) === JSON.stringify(toSyncedPayload(B.state)), 'shared payloads identical on both phones')
}

console.log('Large-state encryption (the stack-overflow regression)')
{
  const { encryptState, decryptState, deriveKeys } = await import('../../src/lib/familySync.js')
  const { keyB64 } = await deriveKeys('grape jetty maple 42', 'https://xyz.supabase.co')
  // ~2MB of realistic state: thousands of transactions
  const big = { transactions: Array.from({ length: 8000 }, (_, i) => ({
    id: `t${i}`, accountId: 'a1', date: '2026-08-01', amount: -42.42,
    description: `WHOLEFDS SEA 10245 PURCHASE CARD 1234 REF ${i}`, category: 'Groceries', hash: `h${i}`,
  })) }
  const ct = await encryptState(big, keyB64)
  ok(ct.length > 500000, `large state encrypts without stack overflow (${Math.round(ct.length / 1024)}KB)`)
  const back = await decryptState(ct, keyB64)
  ok(back.transactions.length === 8000 && back.transactions[7999].description.endsWith('7999'), 'large roundtrip intact')
}

console.log('URL normalization & probe')
{
  const { normalizeSupabaseUrl, probeConnection } = await import('../../src/lib/familySync.js')
  ok(normalizeSupabaseUrl('https://supabase.com/dashboard/project/abcd1234/settings/api') === 'https://abcd1234.supabase.co', 'dashboard URL converts to project API URL')
  ok(normalizeSupabaseUrl('https://xyz.supabase.co/') === 'https://xyz.supabase.co', 'trailing slash trimmed')
  ok(normalizeSupabaseUrl('https://xyz.supabase.co/rest/v1') === 'https://xyz.supabase.co', 'rest path stripped')
  ok(normalizeSupabaseUrl('https://supabase.com/pricing') === null, 'non-project supabase.com page rejected')
  ok(normalizeSupabaseUrl('https://my-selfhosted.example.com') === 'https://my-selfhosted.example.com', 'self-hosted passthrough')
  const mk = status => async () => ({ ok: status === 200, status, json: async () => [] })
  const cfg = { url: 'https://x.supabase.co', anonKey: 'k', householdId: 'h' }
  ok((await probeConnection(cfg, mk(404))).reason === 'table-missing', '404 → table-missing')
  ok((await probeConnection(cfg, mk(401))).reason === 'bad-key', '401 → bad-key')
  ok((await probeConnection(cfg, mk(200))).ok === true, '200 → ok')
}
console.log(`FINAL: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
