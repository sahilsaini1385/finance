// Optional share-price lookup for valuing unvested RSUs.
//
// Off by default. This is the only outbound call the app makes on its own
// behalf, so it is opt-in, it sends a ticker symbol and nothing else, and it
// never overwrites a price the user typed. A fetched price is a REFERENCE the
// user can accept — not an authority.
//
// Two sources, both free:
//   keyless — no signup. Public endpoints don't send CORS headers, so this
//             goes through the app's own /api/quote, which tries more than one
//             upstream and reports what each did. Free endpoints block server
//             IPs and vanish without notice, so this path can fail.
//   finnhub — the user's own free API key, fetched browser-direct with no
//             middleman. More reliable precisely because there is no shared
//             server IP to rate-limit or block.
//
// Whatever happens, a failed lookup never destroys anything: the typed price
// and the last cached quote both survive.

export const QUOTE_TTL_MS = 15 * 60 * 1000

const SYMBOL_RE = /^[A-Z][A-Z.\-]{0,6}$/

export function validSymbol(sym) {
  return SYMBOL_RE.test(String(sym || '').trim().toUpperCase())
}

async function tryFetch(url, { signal, headers } = {}) {
  const res = await fetch(url, { signal, headers })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res
}

// Stooq returns CSV: Symbol,Date,Time,Open,High,Low,Close,Volume
function parseStooqCsv(text) {
  const lines = String(text || '').trim().split('\n')
  if (lines.length < 2) throw new Error('empty response')
  const cols = lines[0].toLowerCase().split(',')
  const vals = lines[1].split(',')
  const at = name => vals[cols.indexOf(name)]
  const price = parseFloat(at('close'))
  if (!Number.isFinite(price) || price <= 0) throw new Error('no price in response')
  const date = at('date')
  const time = at('time')
  return {
    price,
    asOf: date && date !== 'N/D' ? `${date}T${time && time !== 'N/D' ? time : '00:00:00'}` : new Date().toISOString(),
    kind: 'previous close',
  }
}

export const QUOTE_SOURCES = {
  keyless: {
    id: 'keyless',
    label: 'Free — no signup',
    needsKey: false,
    note: 'Previous close from a public source, fetched through this app’s own endpoint. No account needed.',
    async fetchQuote({ symbol, signal, proxyUrl }) {
      // These sources don't send CORS headers, so the request goes through the
      // app's own /api/quote (or a user-configured proxy). It returns a
      // normalized quote, or a 502 explaining what each upstream did.
      const url = proxyUrl
        ? `${proxyUrl.replace(/\/$/, '')}/?url=${encodeURIComponent(`https://stooq.com/q/l/?s=${symbol.toLowerCase()}.us&f=sd2t2ohlcv&h&e=csv`)}`
        : `/api/quote?symbol=${encodeURIComponent(symbol)}`
      let res
      try {
        res = await fetch(url, { signal })
      } catch (e) {
        if (e.name === 'AbortError') throw e
        throw new Error('Couldn’t reach the price endpoint. If you’re offline, the last price is still shown.')
      }
      const body = await res.text()
      if (!res.ok) {
        let detail = ''
        try {
          const j = JSON.parse(body)
          detail = [j.error, (j.tried || []).join('; '), j.hint].filter(Boolean).join(' — ')
        } catch { detail = body.slice(0, 160) }
        throw new Error(detail || `Price lookup failed (HTTP ${res.status}).`)
      }
      // JSON from /api/quote; CSV when a custom proxy fetched Stooq directly.
      try {
        const j = JSON.parse(body)
        if (!(Number(j.price) > 0)) throw new Error('no price')
        return { price: Number(j.price), asOf: j.asOf || new Date().toISOString(), kind: j.kind || 'previous close' }
      } catch {
        return parseStooqCsv(body)
      }
    },
  },

  finnhub: {
    id: 'finnhub',
    label: 'Finnhub (your free key)',
    needsKey: true,
    keyHint: 'Sign up free at finnhub.io — personal use, 60 calls a minute.',
    note: 'Intraday quote, fetched straight from your browser with no middleman.',
    async fetchQuote({ symbol, token, signal }) {
      if (!token) throw new Error('Paste your Finnhub API key first.')
      let res
      try {
        res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`,
          { signal },
        )
      } catch (e) {
        if (e.name === 'AbortError') throw e
        throw new Error(`Couldn’t reach Finnhub (${e.message}).`)
      }
      if (res.status === 401 || res.status === 403) throw new Error('Finnhub rejected that API key.')
      if (res.status === 429) throw new Error('Finnhub rate limit hit — try again in a minute.')
      if (!res.ok) throw new Error(`Finnhub returned HTTP ${res.status}.`)
      const data = await res.json()
      const price = Number(data.c)
      if (!Number.isFinite(price) || price <= 0) throw new Error(`Finnhub has no price for ${symbol}.`)
      return {
        price,
        asOf: data.t ? new Date(data.t * 1000).toISOString() : new Date().toISOString(),
        kind: 'quote',
      }
    },
  },
}

export function quoteSource(id) {
  return QUOTE_SOURCES[id] || QUOTE_SOURCES.keyless
}

// → {price, asOf, kind, source, symbol}
export async function fetchQuote({ symbol, sourceId = 'keyless', token, proxyUrl, signal }) {
  const sym = String(symbol || '').trim().toUpperCase()
  if (!validSymbol(sym)) throw new Error('Enter a ticker symbol first (e.g. AMZN).')
  const source = quoteSource(sourceId)
  const q = await source.fetchQuote({ symbol: sym, token, proxyUrl, signal })
  return { ...q, source: source.id, symbol: sym }
}

export function quoteAge(quote, now = Date.now()) {
  if (!quote?.asOf) return Infinity
  const t = new Date(quote.asOf).getTime()
  return Number.isFinite(t) ? now - t : Infinity
}

// What the UI should say about a cached quote. Never the word "live" — free
// feeds are delayed or previous-close, and claiming otherwise would be false.
export function quoteStatus(quote, now = Date.now()) {
  if (!quote?.price) return { label: '', stale: false }
  const age = quoteAge(quote, now)
  const day = 86400000
  const when = new Date(quote.asOf)
  const time = Number.isFinite(when.getTime())
    ? when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'unknown'
  if (age > 7 * day) return { label: `last known price · ${time}`, stale: true }
  if (age > day) return { label: `as of ${time} · stale`, stale: true }
  return { label: `as of ${time}`, stale: false }
}
