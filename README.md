# 💰 Finance — private personal finance manager

A free, private, in-browser personal finance tool. Track accounts across **Fidelity, Chase, and Bank of America**, import transactions from their CSV exports, log employer **benefits** and **insurance** policies, and get rules-based guidance on **tax management** and **how much insurance you actually need**.

**Your data never leaves your browser.** Everything is stored in `localStorage` — no server, no signup, no cost.

## Features

- **Dashboard** — net worth, cash, investments, debt; 6-month cash-flow chart; spending by category; alerts.
- **Accounts** — checking, savings, credit cards, brokerage, retirement, HSA, 529, loans, mortgages, grouped by institution.
- **Transaction import** — drop in CSV activity files; the format is auto-detected for:
  - Chase credit cards and Chase checking
  - Bank of America (handles the summary preamble)
  - Fidelity brokerage history and Fidelity credit card
  - Any generic `Date, Description, Amount` CSV

  Transactions are auto-categorized (editable), and duplicates are skipped on re-import.
- **Benefits tracker** — 401(k)/match, HSA/FSA, ESPP, RSUs, health/dental/vision, and more, with estimated annual value and enrollment status.
- **Insurance tracker** — every policy with coverage, premium, deductible, and renewal date (renewals within 45 days trigger a re-shop reminder).
- **Advisor** — a rules engine using current-year IRS limits that checks, from *your* data:
  - Are you capturing the full employer 401(k) match?
  - How much 401(k)/IRA/HSA space is left this year; backdoor-Roth and mega-backdoor pointers
  - Standard deduction vs. itemizing, bunching charitable gifts, tax-loss harvesting, asset location
  - Life insurance need via the **DIME method** vs. your actual coverage
  - Disability coverage, umbrella-policy threshold, emergency-fund months, credit-card debt
- **Backup/restore** — one-click JSON export/import (recommended, since data lives in the browser).

## Free hosting on GitHub Pages

The included GitHub Action deploys automatically:

1. In this repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Merge/push this code to the `main` branch.
3. Your app goes live at `https://<your-username>.github.io/finance/` — free, with HTTPS.

Since all data is client-side, static hosting is all it needs. (Netlify/Vercel/Cloudflare Pages free tiers work too: build command `npm run build`, output `dist`.)

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

Import takes about a minute per account per month; duplicate rows are detected and skipped, so overlapping date ranges are harmless. If you later want live syncing, [SimpleFIN Bridge](https://beta-bridge.simplefin.org/) (~$1.50/mo) is the cheapest reputable option and could feed the same import pipeline.

## Disclaimer

The Advisor provides educational, rules-based guidance using announced IRS limits (update `src/lib/advisor.js` annually; verify at [irs.gov](https://www.irs.gov)). It is not tax, legal, or investment advice — confirm decisions with a CPA or fee-only fiduciary advisor.
