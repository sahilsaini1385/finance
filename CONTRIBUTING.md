# Contributing

Thanks for looking. A few things about this codebase are unusual, and knowing
them up front will save you a rejected PR.

## Never send real financial data

Not in an issue, not in a test fixture, not in a screenshot. Bug reports should
use the synthetic household in `tests/ui/seed.html`, or made-up numbers with
the same shape. If a bug only reproduces with your own statement, describe the
*shape* of the input (column names, date format, an amount like `-1,234.56`)
rather than attaching the file.

`tests/fixtures/private/` is git-ignored for exactly this reason: the suites
that need real documents self-skip when it's empty.

## The rules that shape this codebase

Most review comments come back to one of these.

**Local-first is the product, not a preference.** The app makes no network
calls except the four opt-in integrations listed in `SECURITY.md`. A feature
that needs a server, an account, or a background fetch is almost certainly the
wrong shape for this project — raise it as an issue before building it.

**Never guess at a number.** Where a figure is unknown, the app says so
instead of substituting a default. A foreign balance with no exchange rate
counts as $0 and shows "needs rate" — it never counts pounds as dollars. An
employer match nobody entered shows `—`, not `$0`. An ambiguous `04/03/2026`
prompts instead of silently picking a month. If your change makes something
*look* more complete by inventing a value, it will be sent back.

**Say where a number came from.** Payroll-verified beats synced beats typed
beats modeled (`src/lib/facts.js`), and the UI names its source. Conflicts get
surfaced, never auto-resolved.

**Estimates are labelled.** Every projection on screen states its assumptions
and its vintage. "An estimate, not a return" is load-bearing copy.

**`localStorage` key `finance-app-v1` is forever.** Renaming it destroys every
existing user's data. Schema changes go through `src/lib/migrations.js` with a
flag so they run exactly once.

## Layout

- `src/lib/` — pure functions, no React, no state. All the math lives here and
  this is where tests are cheapest to write.
- `src/components/` — React. `store.jsx` is the single persistence seam.
- `tests/unit/` — Node, no browser. `npm test`.
- `tests/ui/` — Playwright against a built copy. See `tests/ui/README.md`.

## Tests

```sh
npm test          # unit suites — required, must be green
npm run build     # must succeed
```

For UI suites, build first and serve `dist/` plus `tests/ui/seed.html`, then
run individual files with `node tests/ui/<suite>.mjs`.

**A displayed figure needs a test.** The convention here is that any number a
user might plan around is pinned by an assertion, and the assertion name says
what would be wrong if it failed — `'no exchange rate → contributes $0 and
says so — never CAD counted as USD'`, not `'test currency'`. Tests are how the
honesty rules above stay true a year from now.

## Style

- Comments explain *why*, especially why an obvious-looking simpler version is
  wrong. Several bugs here were reintroduced twice before someone wrote the
  reason down.
- Match the surrounding code. No new dependencies without a good argument —
  the whole app is React + Vite + pdf.js.
- Small PRs. One behaviour change per PR, with its tests.

## Not accepted

- Analytics, telemetry, crash reporting, or "anonymous" usage stats.
- Ads, affiliate links, or referral codes in financial guidance.
- Anything presenting itself as tax, legal, or investment advice. The Advisor
  is rules-based and educational, and says so.
