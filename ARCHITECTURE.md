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

## Data model (one JSON document)

```
accounts[]      {id, simplefinId?, name, institution, type, balance, updated}
transactions[]  {id, accountId, date, description, amount, category, source, hash}
benefits[]      {id, name, type, provider, annualValue, enrolled, notes}
insurance[]     {id, type, provider, policyName, coverageAmount, premium, premiumFreq, deductible, renewalDate, notes}
connections     {simplefin: {accessUrl, connectedAt, lastSync, proxyUrl} | null}
profile         {age, filingStatus, incomes, expenses, debts, contribution settings…}
```

Idempotency: every transaction carries a `hash` (`sf|<sfAccountId>|<txId>` for SimpleFIN,
`<accountId>|date|amount|desc` for CSV). All ingest paths dedupe on it, so re-syncs and re-imports are safe.

## Scaling path to multi-user

The design rule that makes scaling cheap: **`store.jsx` is the single persistence seam and the
`lib/` cores are pure.** Nothing else knows where data lives.

**Phase 1 — invite friends (still ~$0/mo).** Ship as-is. Each user is their own tenant: their browser,
their SimpleFIN subscription, their data. One shared proxy worker (lock `ALLOWED_ORIGIN` to the app
origin). No accounts, no liability for user data.

**Phase 2 — hosted sync (free tiers).** Add sign-in and cross-device sync:
- Auth + Postgres via Supabase (free tier) — tables mirror the data model above, one row per entity,
  `user_id` + row-level security.
- Replace the `localStorage` read/write in `store.jsx` with an API adapter (load on boot, debounced
  writes). Keep localStorage as offline cache.
- Move SimpleFIN access URLs server-side, encrypted at rest; a scheduled worker (Cloudflare Cron
  trigger) runs `fetchAccounts` + `buildSyncPatch` per user nightly — both already pure/portable.

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
