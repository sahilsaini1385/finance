// Vercel serverless proxy for the Anthropic API — the CORS fallback transport
// for the AI advisor (the browser tries api.anthropic.com directly first).
// Stateless: credentials pass through in headers, nothing is logged or stored.
// Only /v1/messages is forwarded, only to api.anthropic.com, and SSE responses
// are streamed through chunk by chunk.

export const config = { supportsResponseStreaming: true }

// The SDK posts to {baseURL}/v1/messages — this catch-all accepts the subpath
// but only ever forwards the messages endpoint.
const UPSTREAM = 'https://api.anthropic.com/v1/messages'
const FORWARD_HEADERS = [
  'authorization',
  'x-api-key',
  'anthropic-version',
  'anthropic-beta',
  'anthropic-dangerous-direct-browser-access',
  'content-type',
]

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, x-api-key, anthropic-version, anthropic-beta, anthropic-dangerous-direct-browser-access',
  )
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).send('POST only')
  const path = [].concat(req.query.path || []).join('/')
  if (path !== 'v1/messages') return res.status(404).send('Only /v1/messages is proxied')

  const headers = {}
  for (const h of FORWARD_HEADERS) {
    if (req.headers[h]) headers[h] = req.headers[h]
  }
  if (!headers['anthropic-version']) headers['anthropic-version'] = '2023-06-01'

  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
  const upstream = await fetch(UPSTREAM, { method: 'POST', headers, body })

  res.status(upstream.status)
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
  res.setHeader('Cache-Control', 'no-cache')

  if (!upstream.body) return res.end()
  const reader = upstream.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
  } finally {
    res.end()
  }
}
