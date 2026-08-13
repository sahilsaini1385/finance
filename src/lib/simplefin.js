// SimpleFIN Bridge client — automatic bank sync (https://www.simplefin.org/protocol.html)
//
// Flow:
//   1. User creates a SimpleFIN Bridge account, connects their banks there,
//      and generates a one-time SETUP TOKEN (a base64-encoded "claim URL").
//   2. claimAccessUrl() POSTs to the claim URL exactly once and receives the
//      permanent ACCESS URL (contains basic-auth credentials). We store it locally.
//   3. fetchAccounts() GETs {access}/accounts to pull balances + transactions.
//
// Browsers refuse fetch() on URLs with embedded credentials, so the access URL
// is split into base + Authorization header. If the bridge doesn't send CORS
// headers, requests are routed through the (self-hosted, free) proxy in
// proxy/cloudflare-worker.js — see ARCHITECTURE.md.

export function decodeSetupToken(token) {
  const cleaned = String(token || '').trim()
  if (!cleaned) throw new Error('Paste your SimpleFIN setup token first.')
  let claimUrl
  try {
    claimUrl = atob(cleaned).trim()
  } catch {
    throw new Error('That does not look like a SimpleFIN setup token (expected base64).')
  }
  if (!/^https:\/\//.test(claimUrl)) throw new Error('Decoded token is not an https URL.')
  return claimUrl
}

export function splitAccessUrl(accessUrl) {
  const u = new URL(accessUrl)
  const auth = u.username ? 'Basic ' + btoa(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`) : null
  u.username = ''
  u.password = ''
  let base = u.toString()
  if (base.endsWith('/')) base = base.slice(0, -1)
  return { base, auth }
}

function viaProxy(targetUrl, proxyUrl) {
  if (!proxyUrl) return targetUrl
  const p = proxyUrl.endsWith('/') ? proxyUrl.slice(0, -1) : proxyUrl
  return `${p}/?url=${encodeURIComponent(targetUrl)}`
}

// Attempt order: explicit proxy if configured; otherwise direct, then the
// same-origin serverless proxy (/api/simplefin — present on Vercel deploys).
async function request(targetUrl, { method = 'GET', headers = {}, proxyUrl } = {}) {
  const attempts = proxyUrl ? [proxyUrl] : [null, '/api/simplefin']
  let lastError
  for (const proxy of attempts) {
    let res
    try {
      res = await fetch(viaProxy(targetUrl, proxy), { method, headers })
    } catch (e) {
      lastError = e
      continue // network/CORS failure — try the next transport
    }
    // A 404 without our proxy marker means the fallback endpoint doesn't exist
    // on this host (e.g. GitHub Pages) — not a real SimpleFIN response.
    if (proxy === '/api/simplefin' && res.status === 404 && !res.headers.get('X-Simplefin-Proxy')) {
      lastError = new Error('no same-origin proxy available')
      continue
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`SimpleFIN returned HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`)
    }
    return res
  }
  throw new Error(
    'Could not reach SimpleFIN from the browser (CORS). On Vercel this is handled automatically by ' +
    '/api/simplefin — redeploy with the latest code. On GitHub Pages, deploy the included proxy ' +
    '(proxy/cloudflare-worker.js, free) and paste its URL under “Advanced”, then retry. ' +
    `Last error: ${lastError?.message || 'unknown'}`
  )
}

export async function claimAccessUrl(setupToken, { proxyUrl } = {}) {
  const claimUrl = decodeSetupToken(setupToken)
  const res = await request(claimUrl, { method: 'POST', headers: { 'Content-Length': '0' }, proxyUrl })
  const accessUrl = (await res.text()).trim()
  if (!/^https:\/\//.test(accessUrl)) throw new Error('Claim succeeded but the response was not an access URL.')
  return accessUrl
  // Note: a setup token is single-use. If this fails with 403, the token was
  // already claimed — generate a fresh one on the SimpleFIN Bridge site.
}

export async function fetchAccounts(accessUrl, { startDate, endDate, proxyUrl } = {}) {
  const { base, auth } = splitAccessUrl(accessUrl)
  const params = new URLSearchParams()
  if (startDate) params.set('start-date', String(Math.floor(startDate.getTime() / 1000)))
  if (endDate) params.set('end-date', String(Math.floor(endDate.getTime() / 1000)))
  const url = `${base}/accounts${params.toString() ? '?' + params.toString() : ''}`
  const res = await request(url, { headers: auth ? { Authorization: auth } : {}, proxyUrl })
  const data = await res.json()
  return data // { errors: [...], accounts: [...] }
}

// ---------- normalization to the app's data model ----------

const INSTITUTION_MAP = [
  [/chase|jpmorgan/i, 'Chase'],
  [/bank\s*of\s*america|bofa/i, 'Bank of America'],
  [/fidelity/i, 'Fidelity'],
]

export function institutionFromOrg(org = {}) {
  const hay = `${org.name || ''} ${org.domain || ''}`
  for (const [re, name] of INSTITUTION_MAP) if (re.test(hay)) return name
  return org.name || 'Other'
}

export function guessAccountType(sfAccount) {
  const n = (sfAccount.name || '').toLowerCase()
  const bal = parseFloat(sfAccount.balance)
  if (/credit|card|visa|mastercard|amex/.test(n)) return 'credit card'
  if (/401|403|ira|roth|retirement|pension/.test(n)) return 'retirement'
  if (/hsa/.test(n)) return 'hsa'
  if (/529/.test(n)) return '529'
  // Cash names win before the broader investment patterns ("Joint Checking").
  if (/check/.test(n)) return 'checking'
  if (/saving|money market|mma/.test(n)) return 'savings'
  if (/brokerage|invest|trading|individual|joint|wros|stock plan|mutual fund|etf|utma|wealth/.test(n)) return 'brokerage'
  if (/mortgage/.test(n)) return 'mortgage'
  if (/loan/.test(n)) return 'loan'
  if (!Number.isNaN(bal) && bal < 0) return 'credit card'
  return 'checking'
}

// Names that scream "investment" on an account typed as cash — the audit the
// Accounts page offers one-click reclassification for.
export function suggestAccountType(account) {
  if (!['checking', 'savings', 'other'].includes(account.type)) return null
  const n = (account.name || '').toLowerCase()
  // Specific tax-advantaged names win even over cash words ("401(k) Savings
  // Plan", "Health Savings Account", "529 College Savings").
  if (/401|403|ira\b|roth|retirement|pension/.test(n)) return 'retirement'
  if (/hsa|health savings/.test(n)) return 'hsa'
  if (/529/.test(n)) return '529'
  if (/check|saving|money market|mma|bill pay|spend/.test(n)) return null
  if (/brokerage|invest|trading|individual|joint|wros|stock plan|mutual fund|etf|utma|wealth|equity award/.test(n)) return 'brokerage'
  return null
}

export function epochToISODate(epochSeconds) {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10)
}
