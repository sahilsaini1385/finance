// Vercel serverless proxy for SimpleFIN — deploys automatically with the site.
// The browser calls /api/simplefin?url=<simplefin-url> (same origin, so no CORS
// problem), and this function forwards the request to the allow-listed
// SimpleFIN host. Stateless: nothing is logged or stored.
//
// CORS headers are also emitted so a GitHub Pages copy of the app can point its
// "Advanced → CORS proxy" setting at this endpoint.

const ALLOWED_HOSTS = ['simplefin.org']

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Content-Length')
  res.setHeader('X-Simplefin-Proxy', '1')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const target = req.query.url
  if (!target) return res.status(400).send('Missing ?url= parameter')

  let upstream
  try {
    upstream = new URL(target)
  } catch {
    return res.status(400).send('Invalid url parameter')
  }
  if (upstream.protocol !== 'https:') return res.status(400).send('https only')
  const hostOk = ALLOWED_HOSTS.some(
    h => upstream.hostname === h || upstream.hostname.endsWith('.' + h),
  )
  if (!hostOk) return res.status(403).send('Upstream host not allowed')

  const headers = {}
  if (req.headers.authorization) headers.Authorization = req.headers.authorization

  const resp = await fetch(upstream.toString(), {
    method: req.method,
    headers,
  })
  const body = Buffer.from(await resp.arrayBuffer())
  res.status(resp.status)
  res.setHeader('Content-Type', resp.headers.get('content-type') || 'text/plain')
  return res.send(body)
}
