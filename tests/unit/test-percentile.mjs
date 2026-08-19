// Income percentile against baked-in Census distributions.
//
// The invariants that keep this honest: each geography's own median lands at
// its own 50th percentile; the curve is monotonic (more income never ranks
// lower); the tail is clamped at top 0.1% because survey data resolves no
// finer; and a state we have no table for falls back to national rather than
// comparing against the wrong place.
import { incomePercentile, geographiesFor, GEOGRAPHIES } from '../../src/lib/percentile.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + name) } }

console.log('Medians anchor the curve')
{
  for (const g of Object.values(GEOGRAPHIES)) {
    const r = incomePercentile(g.median, g.id)
    ok(Math.abs(r.percentile - 50) < 2, `${g.label}: its own median sits at ~50th (${r.percentile})`)
    ok(r.multiple === 1, `${g.label}: median income is 1.0× the median`)
  }
}

console.log('The ordering a Seattle tech household expects')
{
  const income = 622427 // his projection + spouse
  const sea = incomePercentile(income, 'seattle')
  const wa = incomePercentile(income, 'state-WA')
  const us = incomePercentile(income, 'us')
  ok(sea.topPct > wa.topPct && wa.topPct > us.topPct,
    `higher-income geographies rank you lower: Seattle top ${sea.topPct}% > WA top ${wa.topPct}% > US top ${us.topPct}%`)
  ok(us.topPct <= 1.2 && us.topPct >= 0.8, `~$622k household is ~top 1% nationally (${us.topPct}%)`)
  ok(sea.topPct >= 2 && sea.topPct <= 3.5, `and only ~top 2-3% in Seattle (${sea.topPct}%)`)
}

console.log('Monotonic, clamped, and finite')
{
  for (const id of Object.keys(GEOGRAPHIES)) {
    let prev = -1, mono = true
    for (let x = 500; x < 5_000_000; x += 4993) {
      const p = incomePercentile(x, id).percentile
      if (!Number.isFinite(p)) mono = false
      if (p < prev - 1e-9) mono = false
      prev = p
    }
    ok(mono, `${id}: monotonic and finite across the whole range`)
  }
  ok(incomePercentile(50_000_000, 'us').topPct === 0.1, 'the tail clamps at top 0.1% — finer precision would be invented')
  ok(incomePercentile(50_000_000, 'us').percentile <= 99.9, 'and percentile caps at 99.9')
}

console.log('Degenerate inputs')
{
  ok(incomePercentile(0, 'us') === null, 'zero income → null, not 0th percentile')
  ok(incomePercentile(-5, 'us') === null, 'negative → null')
  ok(incomePercentile('abc', 'us') === null, 'garbage → null')
  ok(incomePercentile(100000, 'nowhere') === null, 'unknown geography → null')
  ok(incomePercentile('$120,000', 'us').percentile > 60, 'formatted strings parse')
}

console.log('Geography selection')
{
  const wa = geographiesFor('WA')
  ok(wa.map(g => g.id).join(',') === 'seattle,state-WA,us', `WA gets city, state, country in local-first order (${wa.map(g => g.id).join(',')})`)
  const tx = geographiesFor('TX')
  ok(tx.length === 1 && tx[0].id === 'us', 'a state with no table falls back to national only — never the wrong comparison')
  ok(geographiesFor('').length === 1 && geographiesFor(undefined).length === 1, 'blank state handled')
  ok(geographiesFor('wa').map(g => g.id).includes('seattle'), 'state matching is case-insensitive')
}

console.log('Every geography states its source')
{
  for (const g of Object.values(GEOGRAPHIES)) {
    ok(Boolean(g.source && g.median > 0 && g.top1 > 200000 && g.over200Pct > 0), `${g.label} carries source + anchors`)
    const cums = g.brackets.map(b => b[1])
    ok(cums.every((c, i) => i === 0 || c > cums[i - 1]), `${g.label} brackets are strictly increasing`)
    ok(g.brackets[g.brackets.length - 1][0] === 200000, `${g.label} bracket table ends at the survey's $200k ceiling`)
    ok(Math.abs(g.brackets[g.brackets.length - 1][1] + g.over200Pct - 100) < 0.01, `${g.label} shares sum to 100%`)
  }
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
