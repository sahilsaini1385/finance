// Regressions from the fourth bug sweep.
//
// Every one of these came from throwing hostile input at a pure module and
// finding NaN, Infinity, or a negative figure coming back out. The shapes
// aren't hypothetical: a corrupted backup, a sync from a build with a
// different date format, and a half-parsed PDF all produce them, and one NaN
// poisons every number downstream of it.
import { supplementalFederal, vestWithholding, nextVestOutlook } from '../../src/lib/vestTax.js'
import { yearFrac, annualizeYtd } from '../../src/lib/income.js'
import { monthsUntil, goalPace } from '../../src/lib/goals.js'
import { estimateFederalTax } from '../../src/lib/taxTables.js'
import { vestValue, rsuSummary } from '../../src/lib/rsu.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + name) } }
const fin = n => typeof n === 'number' && Number.isFinite(n)
const YEAR = 2026

// ---- supplementalFederal: Math.max(0, 'abc') is NaN ----
{
  for (const bad of [undefined, null, '', 'abc', NaN, {}, [], Infinity, -Infinity]) {
    const r = supplementalFederal(bad, 0)
    ok(fin(r.tax) && fin(r.low) && fin(r.high), `supplementalFederal(${JSON.stringify(bad)}) stays finite`)
    const r2 = supplementalFederal(50000, bad)
    ok(fin(r2.tax), `a garbage prior-YTD (${JSON.stringify(bad)}) doesn't poison the tax`)
  }
  ok(supplementalFederal('50000').tax === 11000, 'a numeric string still works')
  ok(supplementalFederal(-100).tax === 0, 'a negative amount withholds nothing rather than a negative')
}

// ---- vestWithholding: rates must always be readable ----
{
  for (const bad of [undefined, null, '', 'abc', NaN, 0, Infinity, -1, {}]) {
    const r = vestWithholding({ amount: bad, wagesYtd: 200000, filingStatus: 'mfj', statePct: 13, year: YEAR })
    ok(fin(r.rates.effectivePct) && fin(r.rates.federalPct),
      `vestWithholding(${JSON.stringify(bad)}) returns finite rates`)
    ok(typeof r.rates.hitHighBracket === 'boolean', 'and a real boolean for the high bracket')
    ok(r.net >= 0 && r.withheld <= r.gross + 0.01, 'and never a negative paycheck')
  }
  // The specific crash: a zero vest used to return rates:{}, and the card did
  // Math.round(undefined) → "NaN%".
  ok(vestWithholding({ amount: 0 }).rates.effectivePct === 0, 'a zero vest reports 0%, not undefined')
  for (const bad of [NaN, 'x', Infinity]) {
    const r = vestWithholding({ amount: 50000, priorSupplementalYtd: bad, wagesYtd: bad, year: YEAR })
    ok(fin(r.withheld) && r.withheld > 0, `garbage YTD context (${String(bad)}) still yields a real figure`)
  }
}

// ---- a vest we can't value shouldn't claim "$0 lands in 92 days" ----
{
  const summary = v => ({ nextVest: { date: `${YEAR}-11-15`, units: 100, value: v } })
  for (const v of [0, NaN, undefined, null, -5, 'x']) {
    ok(nextVestOutlook({}, summary(v)) === null, `no vest card for an unvaluable vest (${String(v)})`)
  }
  ok(nextVestOutlook({}, summary(50000)) !== null, 'a real vest still produces one')
}

// ---- yearFrac: an unparseable pay date divided every projection by NaN ----
{
  for (const bad of ['', 'x', 'not-a-date', `${YEAR}-99-99`, undefined]) {
    const f = yearFrac(bad)
    ok(fin(f) && f > 0 && f <= 1, `yearFrac(${String(bad)}) → ${f}, finite and in range`)
    ok(fin(annualizeYtd(1000, bad)), `annualizeYtd survives it too (${annualizeYtd(1000, bad)})`)
  }
  ok(annualizeYtd(1000, 'x') === 1000, 'an unknown date annualizes to the YTD itself — no invented multiple')
  ok(Math.abs(yearFrac(`${YEAR}-07-01`) - 0.5) < 0.02, 'a real date still paces correctly')
}

// ---- monthsUntil: "NaN months to <garbage>" on the goal card ----
{
  for (const bad of ['garbage', `${YEAR}-99-99`, 'x']) {
    ok(monthsUntil(bad, `${YEAR}-08-15`) === null, `monthsUntil(${bad}) is null, not NaN`)
  }
  ok(monthsUntil('', `${YEAR}-08-15`) === null, 'no date is still null')
  ok(monthsUntil(`${YEAR + 1}-08-15`, `${YEAR}-08-15`) === 12, 'a real date still counts')
  const base = { accounts: [{ id: 'a', type: 'savings', name: 'S', institution: 'X', balance: 1000 }], transactions: [], profile: {}, paystubs: [] }
  const p = goalPace(base, { id: 'g', name: 'G', target: 5000, accountIds: ['a'], targetDate: 'garbage' }, `${YEAR}-08-15`)
  ok(p.monthsLeft === null, 'and a goal with a garbage target date reports no months left')
}

// ---- estimateFederalTax: an Infinity in produced "$Infinity" out ----
{
  for (const bad of [Infinity, -Infinity, NaN, 'abc', undefined, null, {}]) {
    const r = estimateFederalTax(bad, 'mfj', YEAR)
    ok(fin(r.tax) && fin(r.taxable), `estimateFederalTax(${String(bad)}) stays finite`)
  }
  ok(estimateFederalTax(500000, 'mfj', YEAR).tax > 0, 'a real income still taxes')
}

// ---- vestValue: a negative unit count rendered as "-$0" ----
{
  ok(vestValue({ units: -5, amount: NaN }, 100, 'price') === 0, 'negative units are worth zero, not negative')
  ok(!Object.is(vestValue({ units: -5 }, 0, 'price'), -0), 'and never negative zero')
  for (const bad of [{ units: 'x', amount: 'y' }, { units: NaN, amount: NaN }, {}]) {
    const v = vestValue(bad, 100, 'price')
    ok(fin(v) && v >= 0, `vestValue(${JSON.stringify(bad)}) → ${v}`)
  }
  const s = rsuSummary({ rsu: { price: '100', basis: 'price', vests: [
    { id: '1', date: `${YEAR}-11-15`, units: -5, amount: NaN },
    { id: '2', date: `${YEAR}-11-15`, units: 10, amount: 0 },
  ] } }, `${YEAR}-08-15`)
  ok(fin(s.totalUnvestedValue) && s.totalUnvestedValue >= 0,
    `a bad row can't drag the unvested total negative (${s.totalUnvestedValue})`)
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
