// Optional share-price lookup for valuing unvested RSUs.
//
// Off by default. This is the only outbound call the app makes on its own
// behalf, so it is opt-in, it sends a ticker symbol and nothing else, and it
// never overwrites a price the user typed. A fetched price is a REFERENCE the
// user can accept — not an authority.
//
// Two sources, both free:
//   stooq   — no signup, no key, previous close. Blocked by CORS in the
//             browser, so it goes through the app's own stateless proxy.
//   finnhub — the user's own free API key, intraday quote, 60 calls/min, and
//             a free tier that explicitly covers personal non-commercial use.
//
// Transport is a ladder (same shape as simplefin.js): try direct, then the
// same-origin proxy. That way the feature works whether or not a provider
// sends CORS headers, and on a static copy with no proxy it degrades to the
// cached or typed price instead of breaking.

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
  stooq: {
    id: 'stooq',
    label: 'Stooq (no signup)',
    needsKey: false,
    note: 'Previous close, updated daily. No account needed.',
    async fetchQuote({ symbol, signal, proxyUrl }) {
      const target = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol.toLowerCase())}.us&f=sd2t2ohlcv&h&e=csv`
      const attempts = proxyUrl
        ? [`${proxyUrl.replace(/\/$/, '')}/?url=${encodeURIComponent(target)}`]
        : [target, `/api/quote?symbol=${encodeURIComponent(symbol)}`]
      let lastError
      for (const url of attempts) {
        try {
          const res = await tryFetch(url, { signal })
          return parseStooqCsv(await res.text())
        } catch (e) {
          if (e.name === 'AbortError') throw e
          lastError = e
        }
      }
      throw new Error(`Couldn’t reach Stooq (${lastError?.message || 'unknown'})`)
    },
  },

  finnhub: {
    id: 'finnhub',
    label: 'Finnhub (free key)',
    needsKey: true,
    keyHint: 'Free at finnhub.io — personal use, 60 calls a minute.',
    note: 'Intraday quote. Needs a free API key you paste below.',
    async fetchQuote({ symbol, token, signal }) {
      if (!token) throw new Error('Add your Finnhub API key first.')
      const res = await tryFetch(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`,
        { signal },
      ).catch(e => {
        if (e.name === 'AbortError') throw e
        throw new Error(`Couldn’t reach Finnhub (${e.message}). Check the key, or switch to Stooq.`)
      })
      const data = await res.json()
      const price = Number(data.c)
      if (!Number.isFinite(price) || price <= 0) throw new Error('Finnhub returned no price for that symbol.')
      return {
        price,
        asOf: data.t ? new Date(data.t * 1000).toISOString() : new Date().toISOString(),
        kind: 'quote',
      }
    },
  },
}

export function quoteSource(id) {
  return QUOTE_SOURCES[id] || QUOTE_SOURCES.stooq
}

// → {price, asOf, kind, source, symbol}
export async function fetchQuote({ symbol, sourceId = 'stooq', token, proxyUrl, signal }) {
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
