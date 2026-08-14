// Vercel serverless proxy for share-price lookups — deploys with the site.
//
// Exists because the keyless price sources don't send CORS headers, so a
// browser can't call them directly. Stateless: it takes a ticker symbol,
// fetches a quote, and returns it normalized. Nothing is logged or stored, and
// the ONLY thing that crosses this boundary is a ticker — never a holding, a
// vest schedule, or any other Budgie data.
//
// Two keyless upstreams are tried in order, because free endpoints block
// datacenter IPs, rate-limit, and disappear without notice. If both fail, the
// response says exactly what each one did so the failure is diagnosable rather
// than a bare 502.

const SYMBOL_RE = /^[A-Z][A-Z.\-]{0,6}$/

// Some free endpoints reject requests with no (or a non-browser) User-Agent.
const UA = 'Mozilla/5.0 (compatible; Budgie/1.0; +https://github.com/sahilsaini1385/finance)'

// Without this a hanging upstream burns the whole function budget and the
// second source never gets tried — the fallback would be decorative.
const TIMEOUT_MS = 6000
async function fetchWithTimeout(url, init) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `timed out after ${TIMEOUT_MS / 1000}s` : e.message)
  } finally {
    clearTimeout(timer)
  }
}

async function fromStooq(symbol) {
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&f=sd2t2ohlcv&h&e=csv`
  const res = await fetchWithTimeout(url, { headers: { Accept: 'text/csv,*/*', 'User-Agent': UA } })
  if (!res.ok) throw new Error(`stooq HTTP ${res.status}`)
  const text = await res.text()
  const lines = text.trim().split('\n')
  if (lines.length < 2) throw new Error('stooq returned no rows')
  const cols = lines[0].toLowerCase().split(',')
  const vals = lines[1].split(',')
  const at = name => vals[cols.indexOf(name)]
  const price = parseFloat(at('close'))
  // Unknown symbols come back as N/D rather than an error status.
  if (!Number.isFinite(price) || price <= 0) throw new Error(`stooq has no price for ${symbol}`)
  const date = at('date')
  const time = at('time')
  return {
    price,
    asOf: date && date !== 'N/D' ? `${date}T${time && time !== 'N/D' ? time : '00:00:00'}Z` : new Date().toISOString(),
    kind: 'previous close',
    source: 'stooq',
  }
}

async function fromYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json', 'User-Agent': UA } })
  if (!res.ok) throw new Error(`yahoo HTTP ${res.status}`)
  const data = await res.json()
  const meta = data?.chart?.result?.[0]?.meta
  const price = Number(meta?.regularMarketPrice)
  if (!Number.isFinite(price) || price <= 0) throw new Error(`yahoo has no price for ${symbol}`)
  return {
    price,
    asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
    kind: 'delayed quote',
    source: 'yahoo',
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.setHeader('X-Budgie-Quote-Proxy', '1')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const symbol = String(req.query.symbol || '').trim().toUpperCase()
  if (!SYMBOL_RE.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' })

  const tried = []
  for (const attempt of [fromStooq, fromYahoo]) {
    try {
      const quote = await attempt(symbol)
      return res.status(200).json(quote)
    } catch (e) {
      tried.push(e.message)
    }
  }
  // 502 with the actual reasons, so the UI can show something useful.
  return res.status(502).json({
    error: `No free source could price ${symbol}`,
    tried,
    hint: 'Free endpoints often block server IPs. Adding your own Finnhub key uses a browser-direct request instead.',
  })
}
