// YTD reconciliation. Two bugs this guards, both of which produced confidently
// wrong advice: a benefit row that STOPS accruing (maxed-out 401(k), Social
// Security past the wage cap) disappears from later stubs, and a mid-year job
// change resets the latest stub's YTD columns to near zero.
import { parsePaystub, paystubYearSummary, reconciledYtd } from '../../src/lib/income.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + name) } }
const near = (a, b, eps = 0.02) => Math.abs(a - b) < eps

// A stub is just data; build them directly so the test states the situation
// plainly rather than depending on a private PDF fixture.
const stub = (payDate, over = {}) => ({
  employer: 'ACME', payDate, periodStart: payDate, periodEnd: payDate,
  gross: 10000, grossYtd: 0, net: 6000, fedTaxable: 9000,
  taxes: [{ label: 'Federal Income Tax', amount: 2000, ytd: 0 }],
  deductions: [], earnings: [], totalTaxes: 2000, totalDeductions: 2000, balanced: true,
  ...over,
})

// ---- the reported failure: contributions stop appearing once maxed ----
{
  const ded = (ytd, cur = 2000) => [{ label: '401K Pretax', amount: cur, ytd, pretax: true }]
  const state = { paystubs: [
    stub('2026-05-15', { grossYtd: 100000, deductions: ded(20500) }),
    stub('2026-05-31', { grossYtd: 110000, deductions: ded(22500) }),
    stub('2026-06-15', { grossYtd: 120000, deductions: ded(24500) }), // hits the limit
    // maxed out: ADP stops printing a current amount, so the row is YTD-only
    // and older builds dropped it entirely
    stub('2026-06-30', { grossYtd: 130000, deductions: [{ label: '401K Pretax', amount: 0, ytd: 24500, pretax: true }] }),
    // and on the next stub the row is gone from the statement altogether
    stub('2026-07-15', { grossYtd: 140000, deductions: [] }),
  ] }
  const s = paystubYearSummary(state, 2026)
  ok(near(s.ytd.k401Trad, 24500), `401(k) YTD survives the row disappearing (${s.ytd.k401Trad})`)
  ok(near(s.ytd.gross, 140000), `gross YTD takes the latest/max (${s.ytd.gross})`)
  ok(s.latest.payDate === '2026-07-15', 'latest stub still identified for pace math')
}

// ---- the parser half: a YTD-only benefit line must be kept ----
{
  const text = [
    'ACME CORP Period Beginning: 06/16/2026',
    'Period Ending: 06/30/2026',
    'Pay Date: 06/30/2026',
    'Regular 10 000 00 130 000 00',
    'Gross Pay $10 000 00 130 000 00',
    'Federal Income Tax -2 000 00 26 000 00',
    '401K Pretax 24 500 00',
    'Social Security Tax 10 918 20',
    'Net Pay $8 000 00',
  ].join('\n')
  const p = parsePaystub(text)
  const k401 = (p.deductions || []).find(d => /401/i.test(d.label))
  ok(k401 && near(k401.ytd, 24500) && k401.amount === 0, 'YTD-only 401(k) row is parsed as a deduction')
  ok((p.taxes || []).some(t => /social security/i.test(t.label)), 'YTD-only tax rows still work')
  // a bare "Label 1234.56" that is NOT a known benefit stays ignored
  const noise = parsePaystub(text.replace('401K Pretax 24 500 00', 'Vacation Balance 42 00'))
  ok(!(noise.deductions || []).some(d => /vacation/i.test(d.label)), 'ambiguous YTD-only lines are still ignored')
}

// ---- mid-year job change: limits are per person, across employers ----
{
  const state = { paystubs: [
    { ...stub('2026-04-30', { grossYtd: 80000, deductions: [{ label: '401K Pretax', amount: 2000, ytd: 14000, pretax: true }] }), employer: 'OLD CO' },
    { ...stub('2026-07-31', { grossYtd: 30000, deductions: [{ label: '401K Pretax', amount: 2000, ytd: 6000, pretax: true }] }), employer: 'NEW CO' },
  ] }
  const r = reconciledYtd(state, 2026)
  ok(near(r.ytd.k401Trad, 20000), `deferrals sum across employers (${r.ytd.k401Trad}) — the limit is per person`)
  ok(near(r.ytd.gross, 110000), `gross sums across employers (${r.ytd.gross})`)
  ok(r.multiEmployer === true && r.employers.length === 2, 'multi-employer is detectable so the UI can say so')
}

// ---- single employer, ordinary year: unchanged behaviour ----
{
  const state = { paystubs: [
    stub('2026-01-15', { grossYtd: 10000, deductions: [{ label: '401K Pretax', amount: 1000, ytd: 1000, pretax: true }] }),
    stub('2026-01-31', { grossYtd: 20000, deductions: [{ label: '401K Pretax', amount: 1000, ytd: 2000, pretax: true }] }),
  ] }
  const s = paystubYearSummary(state, 2026)
  ok(near(s.ytd.k401Trad, 2000) && near(s.ytd.gross, 20000), 'normal case reads the newest YTD')
  ok(s.multiEmployer === false, 'single employer flagged as such')
  ok(paystubYearSummary({ paystubs: [] }, 2026) === null, 'no stubs → null, as before')
}

// ---- out-of-order uploads must not matter ----
{
  const rows = [
    stub('2026-03-31', { grossYtd: 60000, deductions: [{ label: '401K Pretax', amount: 2000, ytd: 12000, pretax: true }] }),
    stub('2026-01-31', { grossYtd: 20000, deductions: [{ label: '401K Pretax', amount: 2000, ytd: 4000, pretax: true }] }),
  ]
  const a = reconciledYtd({ paystubs: rows }, 2026).ytd.k401Trad
  const b = reconciledYtd({ paystubs: [...rows].reverse() }, 2026).ytd.k401Trad
  ok(near(a, 12000) && a === b, 'upload order does not change the answer')
}

console.log(`\ntest-income-ytd: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
