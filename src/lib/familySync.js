// Family sync — two phones, one household, end-to-end encrypted.
//
// The whole app state (the same single JSON document localStorage holds) is
// AES-GCM-encrypted CLIENT-SIDE with a key derived from a family passphrase,
// then stored as one row in the user's own Supabase project. Supabase only
// ever sees ciphertext; the passphrase never leaves the devices. Both phones
// enter the same three values (project URL, anon key, passphrase) — the
// household id is derived from the passphrase, so "joining" is just typing
// the same secret.
//
// Sync model: optimistic concurrency on a version column, with a 3-way merge
// against the last-synced snapshot when both devices changed. Entity arrays
// (accounts, transactions, goals, …) merge by id — edits beat deletes; for a
// scalar both sides changed, the local device wins (deterministic; its push
// then propagates). Local-first is preserved: the app works fully offline
// and syncs when it can.
//
// Excluded from the payload: connections.claude (the advisor credential is
// per-device — the bridge runs on one computer) and connections.familySync
// itself (each device keeps its own config). Uploaded document FILES live in
// IndexedDB and do not sync — same limitation as the JSON backup.

const enc = new TextEncoder()
const dec = new TextDecoder()

// Chunked: spreading a large Uint8Array into fromCharCode passes one argument
// per byte and overflows the call stack on real-sized states (a household
// with years of transactions encrypts to hundreds of KB).
const b64 = buf => {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}
const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0))

const subtle = () => globalThis.crypto.subtle

// ---------- key derivation ----------
// Salt is deterministic per Supabase project so both phones derive identical
// keys from the passphrase alone. PBKDF2-SHA256, 310k iterations.
export async function deriveKeys(passphrase, supabaseUrl) {
  const salt = enc.encode(`budgie-family-sync-v1|${new URL(supabaseUrl).host}`)
  const material = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle().deriveBits({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, material, 256)
  const idDigest = await subtle().digest('SHA-256', enc.encode(`budgie-household|${passphrase}|${new URL(supabaseUrl).host}`))
  const householdId = [...new Uint8Array(idDigest)].slice(0, 16).map(x => x.toString(16).padStart(2, '0')).join('')
  return { keyB64: b64(bits), householdId }
}

async function aesKey(keyB64, usages) {
  return subtle().importKey('raw', unb64(keyB64), { name: 'AES-GCM' }, false, usages)
}

export async function encryptState(obj, keyB64) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const key = await aesKey(keyB64, ['encrypt'])
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)))
  const out = new Uint8Array(iv.length + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), iv.length)
  return b64(out)
}

export async function decryptState(payloadB64, keyB64) {
  const raw = unb64(payloadB64)
  const key = await aesKey(keyB64, ['decrypt'])
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12))
  return JSON.parse(dec.decode(pt))
}

// ---------- Supabase REST (plain fetch, no SDK) ----------
const TABLE = 'budgie_sync'

// Safe to run any number of times — every statement is idempotent. Also the
// UPGRADE script for tables created by older builds: it replaces the original
// blanket read/write policy with select/insert/update only, so an anon-key
// holder can never DELETE households. (Rows hold only E2E-encrypted blobs;
// the anon key was never a confidentiality boundary — this narrows the
// vandalism surface to overwrite, which versioned pushes detect.)
export const SETUP_SQL = `create table if not exists ${TABLE} (
  household text primary key,
  version bigint not null,
  ciphertext text not null,
  updated_at timestamptz default now()
);
alter table ${TABLE} enable row level security;
drop policy if exists "budgie anon rw" on ${TABLE};
drop policy if exists "budgie anon select" on ${TABLE};
drop policy if exists "budgie anon insert" on ${TABLE};
drop policy if exists "budgie anon update" on ${TABLE};
create policy "budgie anon select" on ${TABLE}
  for select to anon using (true);
create policy "budgie anon insert" on ${TABLE}
  for insert to anon with check (true);
create policy "budgie anon update" on ${TABLE}
  for update to anon using (true) with check (true);
revoke delete on ${TABLE} from anon;
revoke delete on ${TABLE} from authenticated;`

function sbHeaders(cfg) {
  return {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.anonKey}`,
    'Content-Type': 'application/json',
  }
}

// Deployment-baked Supabase config: set VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY in the hosting project's environment variables and
// every device only needs the family passphrase to join. The anon key is
// public by design (it ships to every browser regardless); the passphrase
// remains the only secret and never leaves the device.
export function bakedConfig() {
  try {
    const env = import.meta.env || {}
    const url = env.VITE_SUPABASE_URL
    const anonKey = env.VITE_SUPABASE_ANON_KEY
    return url && anonKey ? { url: String(url).trim().replace(/\/+$/, ''), anonKey: String(anonKey).trim() } : null
  } catch {
    return null
  }
}

// Normalize whatever the user pastes into the project API base URL.
// People copy the dashboard address (supabase.com/dashboard/project/<ref>/…)
// at least as often as the API one — derive the right URL from it.
export function normalizeSupabaseUrl(input) {
  const raw = String(input || '').trim().replace(/\/+$/, '')
  const dash = raw.match(/supabase\.com\/dashboard\/project\/([a-z0-9-]+)/i)
  if (dash) return `https://${dash[1]}.supabase.co`
  if (/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)/i.test(raw)) return raw.replace(/\/rest\b.*$/, '')
  if (/supabase\.com/i.test(raw)) return null // some other supabase.com page — can't derive the project
  return raw // self-hosted PostgREST etc.
}

export async function sbPull(cfg, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(
    `${cfg.url.replace(/\/$/, '')}/rest/v1/${TABLE}?household=eq.${cfg.householdId}&select=version,ciphertext`,
    { headers: sbHeaders(cfg) },
  )
  if (!res.ok) {
    const err = new Error(
      res.status === 404
        ? `The ${TABLE} table isn't there yet (404). In Supabase, open SQL Editor, run the setup snippet, then hit Sync now.`
        : res.status === 401 || res.status === 403
          ? `Supabase rejected the key (${res.status}). Re-copy the anon public key from the project's Settings → API.`
          : `Supabase pull failed (${res.status}).`,
    )
    err.status = res.status
    throw err
  }
  const rows = await res.json()
  return rows[0] || null
}

// Pre-connect check: is this URL + key + table actually reachable?
export async function probeConnection(cfg, fetchImpl = globalThis.fetch) {
  try {
    await sbPull(cfg, fetchImpl)
    return { ok: true }
  } catch (e) {
    const reason = e.status === 404 ? 'table-missing' : e.status === 401 || e.status === 403 ? 'bad-key' : 'network'
    return { ok: false, reason, message: e.message || String(e) }
  }
}

// Returns true on success, false on version conflict (someone else pushed).
export async function sbPush(cfg, baseVersion, ciphertext, fetchImpl = globalThis.fetch) {
  const base = cfg.url.replace(/\/$/, '')
  if (baseVersion === 0) {
    const res = await fetchImpl(`${base}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: { ...sbHeaders(cfg), Prefer: 'return=minimal' },
      body: JSON.stringify({ household: cfg.householdId, version: 1, ciphertext }),
    })
    if (res.status === 409) return false // row appeared since our pull
    if (!res.ok) throw new Error(`Supabase insert failed (${res.status})`)
    return true
  }
  const res = await fetchImpl(
    `${base}/rest/v1/${TABLE}?household=eq.${cfg.householdId}&version=eq.${baseVersion}`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders(cfg), Prefer: 'return=representation' },
      body: JSON.stringify({ version: baseVersion + 1, ciphertext, updated_at: new Date().toISOString() }),
    },
  )
  if (!res.ok) throw new Error(`Supabase update failed (${res.status})`)
  const rows = await res.json()
  return rows.length > 0 // zero rows matched → our base version is stale
}

// ---------- 3-way merge ----------
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isEntityArray = v => Array.isArray(v) && v.length > 0 && v.every(x => isObj(x) && x.id !== undefined)
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Entity arrays merge by id. Edits beat deletes; remote order wins, local-only
// entities append in local order.
function mergeEntities(base = [], local, remote) {
  const byId = arr => new Map(arr.map(x => [x.id, x]))
  const b = byId(base), l = byId(local), r = byId(remote)
  const out = []
  const seen = new Set()
  for (const [id, rv] of r) {
    seen.add(id)
    if (l.has(id)) {
      out.push(threeWayMerge(b.get(id), l.get(id), rv))
    } else if (b.has(id)) {
      // deleted locally; keep only if remote changed it since base (edit beats delete)
      if (!eq(b.get(id), rv)) out.push(rv)
    } else {
      out.push(rv) // added remotely
    }
  }
  for (const [id, lv] of l) {
    if (seen.has(id)) continue
    if (b.has(id)) {
      if (!eq(b.get(id), lv)) out.push(lv) // deleted remotely, edited locally
    } else {
      out.push(lv) // added locally
    }
  }
  return out
}

export function threeWayMerge(base, local, remote) {
  if (eq(local, remote)) return local
  if (eq(local, base)) return remote
  if (eq(remote, base)) return local
  if (isEntityArray(local) || isEntityArray(remote)) {
    if (Array.isArray(local) && Array.isArray(remote)) {
      return mergeEntities(Array.isArray(base) ? base : [], local, remote)
    }
  }
  if (isObj(local) && isObj(remote)) {
    const keys = new Set([...Object.keys(local), ...Object.keys(remote)])
    const out = {}
    for (const k of keys) {
      const merged = threeWayMerge(isObj(base) ? base?.[k] : undefined, local[k], remote[k])
      if (merged !== undefined) out[k] = merged
    }
    return out
  }
  return local // both changed a scalar differently: this device wins, then propagates
}

// ---------- payload shaping ----------
// What crosses the wire: everything except per-device connections.
export function toSyncedPayload(state) {
  const { claude, familySync, ...sharedConns } = state.connections || {}
  return { ...state, connections: sharedConns }
}

export function fromSyncedPayload(payload, localState) {
  return {
    ...payload,
    connections: {
      ...(payload.connections || {}),
      claude: localState.connections?.claude ?? null,
      familySync: localState.connections?.familySync ?? null,
    },
  }
}

// ---------- the engine ----------
const BASE_KEY = 'finance-sync-base-v1' // {version, snapshot} — last synced payload

export function createFamilySyncEngine({
  getState,
  apply, // (fullMergedState) => void  — dispatches HYDRATE
  onStatus = () => {},
  emptyState, // initialState: the 3-way base when no snapshot exists yet
  fetchImpl = (...a) => globalThis.fetch(...a),
  storage = globalThis.localStorage,
  debounceMs = 2500,
  intervalMs = 60000,
} = {}) {
  let cfg = null
  let timer = null
  let poll = null
  let running = false
  let syncing = false
  let queued = false
  const status = { state: 'idle', lastSync: null, version: 0, error: null }

  const emit = () => onStatus({ ...status })
  const loadBase = () => {
    try {
      const raw = storage.getItem(BASE_KEY)
      if (raw) return JSON.parse(raw)
    } catch { /* fresh */ }
    return { version: 0, snapshot: null }
  }
  const saveBase = b => storage.setItem(BASE_KEY, JSON.stringify(b))

  async function syncNow() {
    if (!cfg || syncing) { queued = syncing; return }
    syncing = true
    status.state = 'syncing'
    status.error = null
    emit()
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const basum = loadBase()
        const localPayload = toSyncedPayload(getState())
        const remoteRow = await sbPull(cfg, fetchImpl)

        if (!remoteRow) {
          // First device: publish the household.
          const ok = await sbPush(cfg, 0, await encryptState(localPayload, cfg.keyB64), fetchImpl)
          if (ok) { saveBase({ version: 1, snapshot: localPayload }); status.version = 1; break }
          continue // raced another device creating the row — re-pull
        }

        let merged = localPayload
        if (remoteRow.version !== basum.version) {
          const remotePayload = await decryptState(remoteRow.ciphertext, cfg.keyB64)
          const baseSnap = basum.snapshot ?? toSyncedPayload(emptyState)
          merged = threeWayMerge(baseSnap, localPayload, remotePayload)
          if (!eq(merged, localPayload)) apply(fromSyncedPayload(merged, getState()))
          if (eq(merged, remotePayload)) {
            // Nothing of ours to add — adopt remote as the new base and stop.
            saveBase({ version: remoteRow.version, snapshot: remotePayload })
            status.version = remoteRow.version
            break
          }
        } else if (eq(localPayload, basum.snapshot)) {
          status.version = basum.version
          break // nothing changed anywhere
        }

        const ok = await sbPush(cfg, remoteRow.version, await encryptState(merged, cfg.keyB64), fetchImpl)
        if (ok) {
          saveBase({ version: remoteRow.version + 1, snapshot: merged })
          status.version = remoteRow.version + 1
          break
        }
        // conflict — loop pulls again and re-merges
      }
      status.state = 'idle'
      status.lastSync = new Date().toISOString()
    } catch (e) {
      status.state = 'error'
      status.error = e.message || String(e)
    }
    syncing = false
    emit()
    if (queued) { queued = false; syncNow() }
  }

  return {
    configure(nextCfg) {
      const was = Boolean(cfg)
      cfg = nextCfg || null
      if (cfg && !running) {
        running = true
        poll = setInterval(() => syncNow(), intervalMs)
        syncNow()
      } else if (!cfg && running) {
        running = false
        clearInterval(poll)
        clearTimeout(timer)
        try { storage.removeItem(BASE_KEY) } catch { /* noop */ }
      } else if (cfg && was) {
        syncNow() // config changed (e.g. re-keyed) — resync
      }
    },
    notifyLocalChange() {
      if (!cfg) return
      const base = loadBase()
      // Skip the echo of our own apply(): payload identical to the base snapshot.
      if (base.snapshot && eq(toSyncedPayload(getState()), base.snapshot)) return
      clearTimeout(timer)
      timer = setTimeout(() => syncNow(), debounceMs)
    },
    syncNow,
    get status() { return { ...status } },
  }
}
