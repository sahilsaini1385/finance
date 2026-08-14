// Vercel serverless proxy for share-price lookups — deploys with the site.
//
// Exists only because Stooq (the no-signup, no-API-key source) doesn't send
// CORS headers, so a browser can't call it directly. Stateless: it takes a
// ticker symbol, fetches a quote, and returns it. Nothing is logged or stored,
// and the ONLY thing that crosses this boundary is a ticker — never a holding,
// a vest schedule, or any other Budgie data.
//
// The symbol is validated against a strict pattern before it is interpolated,
// and the upstream host is fixed here rather than taken from the request, so
// this endpoint can't be used as an open relay.

const SYMBOL_RE = /^[A-Z][A-Z.\-]{0,6}$/

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.setHeader('X-Budgie-Quote-Proxy', '1')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const symbol = String(req.query.symbol || '').trim().toUpperCase()
  if (!SYMBOL_RE.test(symbol)) return res.status(400).send('Invalid symbol')

  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&f=sd2t2ohlcv&h&e=csv`

  try {
    const upstream = await fetch(url, { headers: { Accept: 'text/csv' } })
    if (!upstream.ok) return res.status(502).send(`Upstream returned ${upstream.status}`)
    const text = await upstream.text()
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    return res.status(200).send(text)
  } catch (e) {
    return res.status(502).send(`Quote lookup failed: ${e.message}`)
  }
}
