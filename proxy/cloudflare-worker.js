// CORS proxy for SimpleFIN — deploy free on Cloudflare Workers (100k req/day free tier).
//
//   1. https://dash.cloudflare.com → Workers & Pages → Create Worker
//   2. Paste this file, Deploy. Your proxy URL is https://<name>.<account>.workers.dev
//   3. Optional env vars (Settings → Variables):
//        ALLOWED_ORIGIN — lock CORS to your app origin, e.g. https://you.github.io
//        ALLOWED_HOSTS  — comma-separated upstream hosts (default: simplefin.org)
//   4. Paste the proxy URL under Connect → Advanced in the app.
//
// The worker is a stateless pass-through: it stores nothing and only forwards
// to allow-listed SimpleFIN hosts, so it never becomes an open proxy.

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Content-Length',
      'Access-Control-Max-Age': '86400',
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const target = new URL(request.url).searchParams.get('url')
    if (!target) return new Response('Missing ?url= parameter', { status: 400, headers: cors })

    let upstream
    try {
      upstream = new URL(target)
    } catch {
      return new Response('Invalid url parameter', { status: 400, headers: cors })
    }
    if (upstream.protocol !== 'https:') return new Response('https only', { status: 400, headers: cors })

    const allowed = (env.ALLOWED_HOSTS || 'simplefin.org').split(',').map(h => h.trim())
    const hostOk = allowed.some(h => upstream.hostname === h || upstream.hostname.endsWith('.' + h))
    if (!hostOk) return new Response('Upstream host not allowed', { status: 403, headers: cors })

    // Forward only the headers the SimpleFIN protocol needs.
    const headers = new Headers()
    const auth = request.headers.get('Authorization')
    if (auth) headers.set('Authorization', auth)

    const resp = await fetch(upstream.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    })

    const out = new Response(resp.body, { status: resp.status, statusText: resp.statusText })
    out.headers.set('Content-Type', resp.headers.get('Content-Type') || 'text/plain')
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v)
    return out
  },
}
