# 🐶 Budgie — private personal finance manager

> Named after the world's cheapest bird. Mascot is a beagle. We know.

[![Tests](https://github.com/sahilsaini1385/finance/actions/workflows/test.yml/badge.svg)](https://github.com/sahilsaini1385/finance/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A free, private, in-browser personal finance tool. Track accounts across **Fidelity, Chase, and Bank of America**, import transactions from their CSV exports, log employer **benefits** and **insurance** policies, and get rules-based guidance on **tax management** and **how much insurance you actually need**.

**Your data lives in your browser.** Everything is stored in `localStorage` — no server, no signup, no cost. To be precise about the optional integrations: bank sync talks to SimpleFIN (directly when possible, else via a stateless CORS proxy on your own deployment), the AI advisor talks to Anthropic with **your** key (directly, via your deployment's stateless proxy, or via a loopback bridge on your machine), and family sync stores an **end-to-end-encrypted** blob in **your own** Supabase project. No proxy stores anything, and nothing readable ever reaches infrastructure the app's author controls.

## Features

- **Automatic bank sync (optional)** — connect Fidelity, Chase, and Bank of America through [SimpleFIN Bridge](https://beta-bridge.simplefin.org/) (~$1.50/mo): paste a setup token once, then one click pulls balances and transactions. Bank credentials stay with the bridge, never in this app. A free one-file Cloudflare Worker proxy (`proxy/cloudflare-worker.js`) handles CORS. See `ARCHITECTURE.md` for the full design and the multi-user scaling path.
- **Dashboard** — comprehensive net worth (cash / investments / retirement / home equity / debt, with unvested RSUs shown outside it); tap any bucket tile to assign each account to Cash, Investments, or Retirement — or omit it from net worth entirely; 6-month cash-flow chart; spending by category; alerts.
- **Accounts** — checking, savings, credit cards, brokerage, retirement, HSA, 529, loans, mortgages, grouped by institution.
- **Transaction import** — drop in CSV activity files; the format is auto-detected for:
  - Chase credit cards and Chase checking
  - Bank of America (handles the summary preamble)
  - Fidelity brokerage history and Fidelity credit card
  - Any generic `Date, Description, Amount` CSV

  Transactions are auto-categorized (editable), and duplicates are skipped on re-import.
- **Monthly budget tracker** — set a monthly amount per category; actuals fill in from synced/imported transactions with progress bars, over-budget alerts, and a month-by-month view.
- **Taxes section** — store W-2s, 1099s, 1098s and returns (in-browser IndexedDB, never uploaded). Enter key W-2 boxes and the Advisor estimates your refund/balance due and reviews 401(k)/HSA deferrals against IRS limits.
- **Home section** — property & mortgage details (equity, LTV, monthly carrying cost), a vault for mortgage paperwork, and a monthly home-bills log (electric, gas, water…) with trend chart; the Advisor uses mortgage figures for itemizing checks and flags unusual bill jumps.
- **Benefits tracker** — 401(k)/match, HSA/FSA, ESPP, RSUs, health/dental/vision, and more, with estimated annual value and enrollment status.
- **Insurance tracker** — every policy with coverage, premium, deductible, and renewal date (renewals within 45 days trigger a re-shop reminder).
- **Advisor** — a rules engine using current-year IRS limits that checks, from *your* data:
  - Are you capturing the full employer 401(k) match?
  - How much 401(k)/IRA/HSA space is left this year; backdoor-Roth and mega-backdoor pointers
  - Standard deduction vs. itemizing, bunching charitable gifts, tax-loss harvesting, asset location
  - Life insurance need via the **DIME method** vs. your actual coverage
  - Disability coverage, umbrella-policy threshold, emergency-fund months, credit-card debt
- **Backup/restore** — one-click JSON export/import (recommended, since data lives in the browser).

## Free hosting

Since all data is client-side, any static host works. Two supported paths:

**Vercel (recommended)** — builds on Vercel's own infrastructure (no GitHub Actions involved), free Hobby tier for non-commercial use, and room to grow into serverless functions for the multi-user roadmap in `ARCHITECTURE.md`:

1. Go to [vercel.com/new](https://vercel.com/new), sign in with GitHub, and import this repository.
2. Vercel auto-detects Vite (build `npm run build`, output `dist`) — just click **Deploy**.
3. Live at `https://<project>.vercel.app` in ~1 minute; every push to `main` redeploys, and every PR gets a preview URL.

**GitHub Pages** — the included workflow (`.github/workflows/deploy.yml`) deploys on push to `main`:

1. In this repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Your app goes live at `https://<your-username>.github.io/finance/`.

(Netlify and Cloudflare Pages free tiers work too: build command `npm run build`, output `dist`.)

## Local development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Connecting your banks (how & why CSV)

Fidelity, Chase, and Bank of America do not offer free personal APIs, and aggregators (Plaid, Yodlee, MX) charge for live connections — so a genuinely free tool uses the CSV activity export every one of these banks provides:

- **Chase**: account → download icon above activity → *Spreadsheet (Excel, CSV)*.
- **Bank of America**: account → *Download* above transactions → CSV/Excel format.
- **Fidelity**: *Accounts & Trade → Portfolio → Activity & Orders → Download*.

Import takes about a minute per account per month; duplicate rows are detected and skipped, so overlapping date ranges are harmless.

**Prefer automatic sync?** The Connect tab wires up [SimpleFIN Bridge](https://beta-bridge.simplefin.org/) (~$1.50/mo): connect your banks once on their site, generate a setup token, paste it into the app, and sync with one click. Duplicates are skipped using SimpleFIN's stable transaction IDs, so CSV and sync can coexist.

## Contributing

Issues and pull requests are welcome — read [CONTRIBUTING.md](CONTRIBUTING.md) first. It covers the rules that shape this codebase (local-first, never guess at a number, label every estimate) and the one hard rule: **never put real financial data in an issue, a fixture, or a screenshot.** Use the synthetic household in `tests/ui/seed.html`.

Security issues go through [private vulnerability reporting](SECURITY.md), not public issues.

## License

[MIT](LICENSE). Use it, fork it, run it for your own household — the tool is only useful if the data stays yours, and that stays true in your copy too.

## Disclaimer

The Advisor provides educational, rules-based guidance using announced IRS limits (update `src/lib/taxTables.js` annually; verify at [irs.gov](https://www.irs.gov)). It is **not tax, legal, or investment advice** — confirm decisions with a CPA or fee-only fiduciary advisor. Every projection in the app is an estimate built from the data you enter, and states its assumptions on screen; none of it is a substitute for your actual tax return, plan documents, or account statements.

## Testing

`npm test` runs 25 unit suites (~570 checks) over the pure-function cores in `src/lib` — the facts reconciliation layer, paystub/W-2 parsing, tax tables and IRA phase-outs, retirement Monte Carlo, scenario math, mortgage/prepay amortization, net-worth bucketing, data migrations, RSU schedules, and the end-to-end-encrypted family-sync merge.

Suites driven by real financial documents self-skip unless you place your own fixtures in `tests/fixtures/private/` (git-ignored — see `tests/fixtures/README.md`). Browser-level Playwright suites live in `tests/ui/` and run against a built copy of the app (`tests/ui/README.md`), including a Content-Security-Policy smoke test that proves injected scripts are blocked while the PDF parser still works.
