// RSU vest withholding. The critique flagged this as the easiest number on the
// page to get wrong, so every rule gets a test: the $1M supplemental cliff,
// the Social Security wage base, the Medicare surtax threshold, and the fact
// that this is WITHHOLDING and not a tax bill.
import { vestWithholding, supplementalFederal } from '../../src/lib/vestTax.js'
import { fetchQuote, quoteStatus, validSymbol, QUOTE_SOURCES } from '../../src/lib/quotes.js'
import { vestValue, vestBasisDiffers, effectivePrice, rsuSummary } from '../../src/lib/rsu.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + name) } }
const near = (a, b, eps = 0.5) => Math.abs(a - b) < eps

// ---- supplemental federal: the $1M cliff ----
{
  ok(near(supplementalFederal(100000).tax, 22000), 'under $1M is a flat 22%')
  const split = supplementalFederal(400000, 800000) // 200k at 22%, 200k at 37%
  ok(near(split.low, 200000) && near(split.high, 200000), 'a vest straddling $1M splits across both rates')
  ok(near(split.tax, 200000 * 0.22 + 200000 * 0.37), `straddling vest taxed at both rates (${Math.round(split.tax)})`)
  ok(near(supplementalFederal(100000, 1500000).tax, 37000), 'entirely above $1M is 37%')
  ok(supplementalFederal(0).tax === 0, 'zero vest, zero tax')
}

// ---- Social Security stops at the wage base ----
{
  const early = vestWithholding({ amount: 50000, wagesYtd: 0 })
  ok(near(early.socialSecurity, 50000 * 0.062), 'SS withheld early in the year')
  const late = vestWithholding({ amount: 50000, wagesYtd: 400000 })
  ok(late.socialSecurity === 0, 'no SS once past the wage base — pretending otherwise understates take-home')
  const straddle = vestWithholding({ amount: 50000, wagesYtd: 160000 })
  ok(straddle.socialSecurity > 0 && straddle.socialSecurity < 50000 * 0.062, 'a vest straddling the base is partial')
}

// ---- Medicare and its surtax ----
{
  const low = vestWithholding({ amount: 10000, wagesYtd: 0, filingStatus: 'single' })
  ok(near(low.medicare, 145), 'plain Medicare is 1.45%')
  const high = vestWithholding({ amount: 10000, wagesYtd: 300000, filingStatus: 'single' })
  ok(near(high.medicare, 10000 * 0.0235), 'above the threshold Medicare carries the 0.9% surtax')
  const mfj = vestWithholding({ amount: 10000, wagesYtd: 210000, filingStatus: 'mfj' })
  ok(near(mfj.medicare, 145), 'the mfj threshold is higher, so no surtax yet at $210k')
}

// ---- state, net, and the shape of the result ----
{
  const wa = vestWithholding({ amount: 30000, wagesYtd: 400000, statePct: 0 })
  ok(wa.state === 0, 'no state withholding in a no-income-tax state')
  const ca = vestWithholding({ amount: 30000, wagesYtd: 400000, statePct: 10.23 })
  ok(near(ca.state, 3069), 'state withholding applies the given rate')
  ok(near(ca.net, ca.gross - ca.withheld), 'net = gross − everything withheld')
  ok(ca.withheld > wa.withheld, 'a state rate reduces take-home')
  ok(near(wa.rates.federalPct, 22, 0.1), 'federal rate reported for the disclosure line')
  const big = vestWithholding({ amount: 200000, priorSupplementalYtd: 950000 })
  ok(big.rates.hitHighBracket === true, 'crossing $1M is flagged so the UI can explain it')
}

// ---- real shape: his next vest, no state tax, past the SS base ----
{
  const v = vestWithholding({ amount: 30469.92, priorSupplementalYtd: 105327, wagesYtd: 241247, filingStatus: 'mfj', statePct: 0 })
  ok(near(v.federal, 30469.92 * 0.22), 'federal at the supplemental rate')
  ok(v.socialSecurity === 0, 'no SS — already past the wage base')
  // wagesYtd 241,247 + 30,470 crosses the $250k mfj threshold partway through
  // the vest, so only the portion above it carries the 0.9% surtax
  const overThreshold = 241247 + 30469.92 - 250000
  ok(near(v.medicare, 30469.92 * 0.0145 + overThreshold * 0.009),
    `Medicare surtax applies only to the part above the threshold (${v.medicare.toFixed(2)})`)
  ok(v.net > 22000 && v.net < 24000, `take-home lands in the right neighbourhood (${Math.round(v.net)})`)
}

// ---- valuation basis: the thing that makes a live price matter ----
{
  const portalVest = { date: '2027-01-01', units: 100, amount: 26728 } // frozen at $267.28
  ok(vestValue(portalVest, 300, 'portal') === 26728, 'portal basis keeps the exported dollars')
  ok(vestValue(portalVest, 300, 'price') === 30000, 'price basis revalues at the current price')
  ok(vestValue(portalVest, 300) === 26728, 'default basis is portal — nothing changes silently')
  ok(vestBasisDiffers(portalVest, 300) === true, 'a row whose value would move is flagged')
  ok(vestBasisDiffers({ date: '2027-01-01', units: 100, amount: 0 }, 300) === false, 'units-only rows are basis-independent')

  const st = { rsu: { price: '', quote: { price: 300 }, basis: 'price', vests: [portalVest] } }
  ok(rsuSummary(st, '2026-08-14').totalUnvestedValue === 30000, 'summary honours the basis')
  ok(effectivePrice(st.rsu) === 300, 'a fetched quote is used when no price is typed')
  ok(effectivePrice({ price: '250', quote: { price: 300 } }) === 250, 'a typed price always beats a fetched quote')
  ok(effectivePrice({}) === 0, 'no price at all is zero, not NaN')
}

// ---- quote helpers ----
{
  ok(validSymbol('AMZN') && validSymbol('BRK.B') && !validSymbol('') && !validSymbol('not a ticker'),
    'symbol validation gates what can reach the proxy')
  ok(Object.keys(QUOTE_SOURCES).length === 2 && QUOTE_SOURCES.stooq.needsKey === false,
    'a no-signup source exists')
  const now = Date.parse('2026-08-14T12:00:00Z')
  ok(!quoteStatus({ price: 1, asOf: '2026-08-14T11:50:00Z' }, now).stale, 'a fresh quote is not stale')
  ok(quoteStatus({ price: 1, asOf: '2026-08-12T11:50:00Z' }, now).stale, 'over a day old is stale')
  ok(/last known price/.test(quoteStatus({ price: 1, asOf: '2026-07-01T00:00:00Z' }, now).label),
    'over a week old stops being called a quote')
  ok(quoteStatus(null).label === '', 'no quote, no claim')
  ok(!/live/i.test(quoteStatus({ price: 1, asOf: '2026-08-14T11:59:00Z' }, now).label),
    'never claims "live" — free feeds are delayed or previous close')
}

// ---- the fetch ladder rejects bad input before any network call ----
{
  let threw = ''
  await fetchQuote({ symbol: 'nonsense ticker' }).catch(e => { threw = e.message })
  ok(/ticker symbol/i.test(threw), 'an invalid symbol fails fast without a request')
  threw = ''
  await fetchQuote({ symbol: 'AMZN', sourceId: 'finnhub', token: '' }).catch(e => { threw = e.message })
  ok(/key/i.test(threw), 'finnhub without a key explains itself instead of calling out')
}

console.log(`\ntest-vesttax: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
