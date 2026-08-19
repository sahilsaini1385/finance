// Where a household income lands in the distribution — city, state, country.
//
// Baked-in reference data, like taxTables.js: this app makes no network
// calls, so the comparison tables ship with the build and say their vintage
// out loud. Sources are the Census Bureau's ACS/CPS household income
// distributions (2023 survey year, published 2024). Survey data measures
// HOUSEHOLDS — so the honest comparison is household income vs household
// incomes, never one earner vs households.
//
// Below $200k: piecewise-linear interpolation over cumulative bracket shares.
// Above $200k the survey stops resolving, so the tail is a Pareto fit
// anchored on two published-ish numbers per geography: the share of
// households above $200k and the top-1% threshold. That's an approximation
// and the UI must say so; it's also why results are clamped at "top 0.1%" —
// finer precision than that would be an invention.


// brackets: [upper bound, cumulative % of households below it]; monotonic.
// over200Pct: % of households above $200k.  top1: est. top-1% threshold ($).
import { num } from './num.js'

export const GEOGRAPHIES = {
  us: {
    id: 'us', label: 'United States', kind: 'country',
    source: 'Census CPS/ACS 2023', median: 80610,
    brackets: [[15000, 9], [25000, 15], [35000, 21.5], [50000, 31], [75000, 47], [100000, 59], [125000, 68.5], [150000, 76], [200000, 86]],
    over200Pct: 14, top1: 632000,
  },
  'state-WA': {
    id: 'state-WA', label: 'Washington', kind: 'state', state: 'WA',
    source: 'ACS 2023 (1-yr)', median: 94605,
    brackets: [[25000, 11], [50000, 25], [75000, 39], [100000, 52.5], [125000, 62], [150000, 70], [200000, 83]],
    over200Pct: 17, top1: 740000,
  },
  seattle: {
    id: 'seattle', label: 'Seattle', kind: 'city', state: 'WA',
    source: 'ACS 2023 (1-yr, city)', median: 120608,
    brackets: [[25000, 9], [50000, 19], [75000, 30], [100000, 41], [125000, 51.5], [150000, 60], [200000, 72]],
    over200Pct: 28, top1: 950000,
  },
}

// The geographies worth showing a given profile: country always, then the
// state and any city we have a table for. No table for their state → just
// say so in the UI rather than compare against the wrong place.
export function geographiesFor(state) {
  const st = String(state || '').trim().toUpperCase()
  const out = [GEOGRAPHIES.us]
  const stateGeo = GEOGRAPHIES[`state-${st}`]
  if (stateGeo) out.unshift(stateGeo)
  for (const g of Object.values(GEOGRAPHIES)) {
    if (g.kind === 'city' && g.state === st) out.unshift(g)
  }
  return out // most local first
}

// → { percentile, topPct, median, multiple, label, source, kind } or null.
export function incomePercentile(income, geoId) {
  const geo = GEOGRAPHIES[geoId]
  const inc = num(income)
  if (!geo || !(inc > 0)) return null

  let pctBelow
  const top = geo.brackets[geo.brackets.length - 1] // [200000, cumAt200k]
  if (inc <= top[0]) {
    // Piecewise-linear over the cumulative anchors, starting from [0, 0].
    let [loX, loP] = [0, 0]
    pctBelow = top[1]
    for (const [x, p] of geo.brackets) {
      if (inc <= x) { pctBelow = loP + ((inc - loX) / (x - loX)) * (p - loP); break }
      loX = x; loP = p
    }
  } else {
    // Pareto tail: P(above x) = s200 · (200k/x)^α, α fit to the top-1% anchor.
    const s200 = geo.over200Pct / 100
    const alpha = Math.log(s200 / 0.01) / Math.log(geo.top1 / top[0])
    pctBelow = 100 * (1 - s200 * Math.pow(top[0] / inc, alpha))
  }

  // Survey data can't honestly resolve finer than the top 0.1%.
  const topPct = Math.max(0.1, Math.round((100 - pctBelow) * 10) / 10)
  return {
    percentile: Math.min(99.9, Math.round(pctBelow * 10) / 10),
    topPct,
    median: geo.median,
    multiple: Math.round((inc / geo.median) * 10) / 10,
    label: geo.label,
    source: geo.source,
    kind: geo.kind,
  }
}
