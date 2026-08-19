// Regressions from the fifth bug sweep — the num() consolidation and the
// frozen-tax-year cleanup.
//
// The sweep found that the num() helper pasted into sixteen modules let
// Infinity straight through (parseFloat + isNaN), that propertyMetrics passed
// negative rent into cash flow, that normalizeForeignPensions threw on a
// non-string currency, and that "current year" tax limits were hardcoded to
// 2026 in five places — including comparing a 2025 W-2 against 2026's limit.
import { num } from '../../src/lib/num.js'
import { propertyMetrics } from '../../src/lib/property.js'
import { normalizeForeignPensions } from '../../src/lib/retirement.js'
import { incomePercentile } from '../../src/lib/percentile.js'
import { CURRENT_TAX_YEAR, limitsFor } from '../../src/lib/taxTables.js'
import { CURRENT_LIMITS } from '../../src/lib/advisor.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + name) } }
const fin = n => typeof n === 'number' && Number.isFinite(n)

console.log('The one shared num()')
{
  ok(num('$5,000') === 5000, 'strips dollar signs and commas')
  ok(num('5%') === 5 && num(' 42 ') === 42, 'strips percent and whitespace')
  ok(num(3.14) === 3.14 && num('-2.5') === -2.5, 'plain numbers and negatives pass through')
  for (const bad of [Infinity, -Infinity, NaN, 'abc', '', null, undefined, {}, []]) {
    ok(num(bad) === 0, `num(${String(bad)}) is 0 — the old copies let Infinity through`)
  }
}

console.log('propertyMetrics survives what num() used to let in')
{
  const inf = propertyMetrics({ currentValue: Infinity, mortgageBalance: Infinity, monthlyRent: Infinity, monthlyPayment: Infinity, propertyTaxAnnual: Infinity })
  for (const [k, v] of Object.entries(inf)) {
    if (typeof v === 'number') ok(fin(v), `Infinity input keeps ${k} finite (${v})`)
  }
  const neg = propertyMetrics({ currentValue: '500000', mortgageBalance: '100000', monthlyRent: '-2000', monthlyPayment: '-99' })
  ok(neg.rentAnnual === 0 && neg.mortgageAnnual === 0, 'negative money fields clamp to zero')
  ok(neg.cashFlowAnnual <= 0 || fin(neg.cashFlowAnnual), 'and cash flow stays real')
  const negValue = propertyMetrics({ currentValue: '-500000', mortgageBalance: '-100000' })
  ok(negValue.value === 0 && negValue.balance === 0 && negValue.equity === 0, 'negative value/balance clamp too')
}

console.log('normalizeForeignPensions takes hostile shapes without throwing')
{
  for (const v of [null, 42, [], {}, true]) {
    let threw = false
    try { normalizeForeignPensions([{ id: 'x', monthlyAmount: '100', currency: v, label: v }]) } catch { threw = true }
    ok(!threw, `currency/label = ${JSON.stringify(v)} does not throw`)
  }
  const [row] = normalizeForeignPensions([{ id: 'x', monthlyAmount: '100', currency: 42, label: {} }])
  ok(typeof row.currency === 'string' && typeof row.label === 'string', 'and both come out as strings')
}

console.log('incomePercentile rejects infinities')
{
  ok(incomePercentile(Infinity, 'us') === null, 'Infinity income → null, not an Infinity multiple')
  ok(incomePercentile(-Infinity, 'seattle') === null, '-Infinity too')
}

console.log('The tax year follows the calendar')
{
  ok(CURRENT_TAX_YEAR === new Date().getFullYear(),
    `CURRENT_TAX_YEAR is the actual year (${CURRENT_TAX_YEAR}) — it was hardcoded to 2026`)
  ok(CURRENT_LIMITS.year === limitsFor(CURRENT_TAX_YEAR).year,
    'CURRENT_LIMITS (né LIMITS_2026) resolves through the year-clamping table')
  ok(limitsFor(2025).k401 === 23500 && limitsFor(2026).k401 === 24500,
    'per-year lookups still exact — a 2025 W-2 compares against 2025 limits')
  ok(limitsFor(2099).year === Math.max(2025, 2026), 'a far-future year clamps to the newest table')
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
