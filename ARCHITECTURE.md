# Architecture

## Today: local-first, zero-cost

```
┌────────────────────────── Browser (the entire app) ──────────────────────────┐
│                                                                              │
│  React SPA (Vite build, static files on GitHub Pages — free)                 │
│                                                                              │
│  ┌────────────┐   ┌──────────────────┐   ┌───────────────────────────────┐   │
│  │  UI (tabs) │──▶│ store.jsx        │──▶│ localStorage (single JSON doc)│   │
│  └────────────┘   │ reducer+context  │   └───────────────────────────────┘   │
│        ▲          └──────────────────┘                                       │
│        │                   ▲                                                 │
│  ┌─────┴──────┐   ┌────────┴─────────┐                                       │
│  │ lib/csv.js │   │ lib/sync.js      │  pure functions — no I/O in either    │
│  │ CSV import │   │ SimpleFIN→state  │                                       │
│  └────────────┘   └──────────────────┘                                       │
│                            ▲                                                 │
│                   ┌────────┴─────────┐                                       │
│                   │ lib/simplefin.js │  fetch() — the ONLY network code      │
│                   └────────┬─────────┘                                       │
└────────────────────────────┼─────────────────────────────────────────────────┘
                             │ https (Basic auth)
                   ┌─────────▼──────────┐         ┌──────────────────────┐
                   │ Cloudflare Worker  │────────▶│  SimpleFIN Bridge    │
                   │ proxy (optional,   │         │  ($1.50/mo, holds    │
                   │ free tier, CORS)   │         │  bank credentials)   │
                   └────────────────────┘         └──────────┬───────────┘
                                                             │ OFX/aggregation
                                                  ┌──────────▼───────────┐
                                                  │ Fidelity / Chase /   │
                                                  │ Bank of America      │
                                                  └──────────────────────┘
```

Key properties:

- **No app server.** Static hosting only; all state in `localStorage` under one key (`finance-app-v1`).
- **Bank credentials never touch this codebase.** SimpleFIN Bridge holds them; the app stores only a
  read-only *access URL* (revocable at the bridge) in the user's browser.
- **The proxy is stateless.** It exists only because browsers need CORS headers the bridge may not send.
  It forwards to allow-listed SimpleFIN hosts only and stores nothing.
- **Pure cores.** `csv.js`, `sync.js`, `categorize.js`, `advisor.js` are pure functions with no I/O or
  DOM access — they can run unchanged in a server or worker.
- **AI advisor is provider-pluggable.** The "Ask Budgie" chat UI is provider-agnostic and reads
  everything (branding, models, credential rules, transports) from a registry in `providers.js`;
  `claude.js` is the one registered implementation. Subscription plans that vendors refuse to expose
  through their raw APIs ride a local bridge instead (`public/budgie-bridge.py`, run by the user,
  loopback-only) that drives the vendor's own CLI headlessly — the bridge protocol carries a
  `provider` field so ChatGPT (codex CLI) or Gemini (gemini CLI) can be added the same way without
  touching the UI. Chat history is stored provider-neutral (`{role, content}`).

## Data model (one JSON document)

```
accounts[]      {id, simplefinId?, name, institution, type, balance, updated}
transactions[]  {id, accountId, date, description, amount, category, source, hash}
benefits[]      {id, name, type, provider, annualValue, enrolled, notes}
insurance[]     {id, type, provider, policyName, coverageAmount, premium, premiumFreq, deductible, renewalDate, notes}
connections     {simplefin: {accessUrl, connectedAt, lastSync, proxyUrl} | null}
profile         {age, filingStatus, incomes, expenses, debts, contribution settings…}
documents[]     {id, section: 'tax'|'home', kind, year?, name, size, mime, uploadedAt, fields?}
homeBills[]     {id, month, type, amount, hasFile}
budgets         {category: monthlyAmount}
home            {purchasePrice, currentValue, mortgageBalance, mortgageRate, payments, tax, insurance}
```

Uploaded document **blobs** live in IndexedDB (`finance-files` DB), keyed by document id —
localStorage is too small for PDFs. Metadata stays in the main JSON document. Blobs are excluded
from the JSON backup; the UI says so wherever files are uploaded.

Idempotency: every transaction carries a `hash` (`sf|<sfAccountId>|<txId>` for SimpleFIN,
`<accountId>|date|amount|desc` for CSV). All ingest paths dedupe on it, so re-syncs and re-imports are safe.

## Scaling path to multi-user

The design rule that makes scaling cheap: **`store.jsx` is the single persistence seam and the
`lib/` cores are pure.** Nothing else knows where data lives.

**Phase 1 — invite friends (still ~$0/mo).** Ship as-is. Each user is their own tenant: their browser,
their SimpleFIN subscription, their data. One shared proxy worker (lock `ALLOWED_ORIGIN` to the app
origin). No accounts, no liability for user data.

**Phase 2 — family sync (SHIPPED, free tier).** Cross-device sync via `lib/familySync.js`, refined
from the original sketch to keep the privacy story intact:
- **End-to-end encrypted blob, not per-entity rows.** The whole state document is AES-GCM-encrypted
  client-side with a key derived (PBKDF2, 310k iters) from a family passphrase; the user's own
  Supabase project stores one ciphertext row per household (`budgie_sync`: household/version/
  ciphertext). Supabase never sees plaintext; there is no sign-in — the household id is derived from
  the passphrase, so a second device joins by entering the same project URL + anon key + passphrase.
- **Local-first preserved.** localStorage remains the source the app boots from; the engine
  (debounced push on change, pull on focus + 60s poll) syncs opportunistically. Optimistic
  concurrency on the version column; on conflict, a 3-way merge against the last-synced snapshot —
  entity arrays merge by id (edits beat deletes), scalars resolve local-wins — then retry.
- **Per-device vs shared:** `connections.claude` (advisor credential) and `connections.familySync`
  never cross the wire; the SimpleFIN access URL does (encrypted), so both phones can bank-sync.
  IndexedDB file blobs stay device-local, same as the JSON backup.
- Still open from the sketch: a scheduled worker for nightly bank sync (both cores remain pure).

**Phase 3 — product.** Stripe billing (bundle the SimpleFIN cost), token vault/KMS for access URLs,
per-institution sync health dashboards, audit logging, SOC2 posture. The advisor rules engine
(`advisor.js`) stays client-side — it's a differentiator that never needs to see server data.

## Security notes (current phase)

- The SimpleFIN access URL grants **read-only** access to linked accounts; it can be revoked any time
  from the bridge. It is stored in `localStorage` — same trust level as the rest of the user's data.
- The proxy forwards the `Authorization` header but never logs or stores it; deploy your own so you
  control it. Set `ALLOWED_ORIGIN` in production.
- XSS is the main local-first threat: the app renders no user HTML (React escapes by default) and
  loads zero third-party scripts at runtime.
