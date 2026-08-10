// Claude client for the AI advisor. Uses the official @anthropic-ai/sdk
// (lazy-loaded so it never weighs down the initial bundle) directly from the
// browser, with the same-origin /api/claude proxy as a CORS fallback — the
// same transport-chain pattern the SimpleFIN integration uses.
//
// Two credential kinds, auto-detected by prefix:
//   sk-ant-oat...  OAuth token (from `claude setup-token`) — billed to the
//                  user's Claude subscription plan. Sent as Authorization:
//                  Bearer + the `anthropic-beta: oauth-2025-04-20` header.
//   sk-ant-api...  Console API key — pay-as-you-go credits. Sent as x-api-key.
//
// The token lives only in this browser's localStorage and is sent only to
// Anthropic (or the stateless same-origin proxy that forwards to Anthropic).

export const DEFAULT_MODEL = 'claude-opus-5'
export const MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5 — most capable (recommended)' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — fast and sharp' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — fastest, cheapest' },
]

export function tokenKind(token) {
  return String(token || '').startsWith('sk-ant-oat') ? 'oauth' : 'apikey'
}

async function makeClient(token, { viaProxy = false } = {}) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const opts = {
    dangerouslyAllowBrowser: true, // key stays user-side by design: local-first app
    maxRetries: 1,
  }
  if (viaProxy) opts.baseURL = `${window.location.origin}/api/claude`
  if (tokenKind(token) === 'oauth') {
    opts.apiKey = null
    opts.authToken = token
    opts.defaultHeaders = { 'anthropic-beta': 'oauth-2025-04-20' }
  } else {
    opts.apiKey = token
  }
  return new Anthropic(opts)
}

const WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: 3 }

// Streams one advisor turn. Tries the direct browser connection first, then
// the same-origin proxy; tries with the web-search tool first, then without
// (some credential types don't allow server tools). onText receives text
// deltas; resolves with the final assistant text.
export async function streamAdvice({ token, model, system, messages, onText, signal }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const attempts = [
    { viaProxy: false, tools: true },
    { viaProxy: false, tools: false },
    { viaProxy: true, tools: true },
    { viaProxy: true, tools: false },
  ]

  let lastErr = null
  for (const attempt of attempts) {
    try {
      const client = await makeClient(token, { viaProxy: attempt.viaProxy })
      const stream = client.messages.stream(
        {
          model: model || DEFAULT_MODEL,
          max_tokens: 8192,
          system,
          messages,
          ...(attempt.tools ? { tools: [WEB_SEARCH_TOOL] } : {}),
        },
        { signal },
      )
      let text = ''
      stream.on('text', delta => {
        text += delta
        onText?.(text)
      })
      const final = await stream.finalMessage()
      if (final.stop_reason === 'refusal') {
        return text || 'I can’t help with that particular question, but I’m happy to help with your finances.'
      }
      return text
    } catch (err) {
      if (signal?.aborted) throw err
      lastErr = err
      // Auth problems won't be fixed by another transport — surface them now.
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new Error(
          tokenKind(token) === 'oauth'
            ? 'Anthropic rejected the token. OAuth tokens expire — run `claude setup-token` again and paste the fresh one.'
            : 'Anthropic rejected the API key. Check it in the Anthropic Console.',
        )
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new Error('Rate limited by your Anthropic plan — wait a minute and try again.')
      }
      // 400 with tools on → likely the credential doesn't allow server tools;
      // fall through to the no-tools attempt. 400 with tools already off is
      // a real request problem.
      if (err instanceof Anthropic.BadRequestError && !attempt.tools && !attempt.viaProxy) {
        throw new Error(`Anthropic rejected the request: ${err.message}`)
      }
      // Connection/CORS errors fall through to the proxy attempts.
    }
  }
  throw new Error(
    `Couldn't reach Anthropic (${lastErr?.message || 'network error'}). ` +
    'If this persists, your network may block api.anthropic.com.',
  )
}

export function advisorSystemPrompt(contextJson) {
  return [
    {
      type: 'text',
      text:
        'You are the built-in financial advisor of a private, local-first personal finance app. ' +
        'The user is a real person asking about their own household finances. ' +
        'You are given a JSON snapshot of everything the app knows: net worth, accounts, this month\'s budget ' +
        'and spending, recurring bills, insurance, goals, mortgage, and retirement projections.\n\n' +
        'Ground every answer in the snapshot — quote their actual numbers, rounded to whole dollars. ' +
        'If the snapshot lacks what you need, say what to add in the app (Advisor profile, accounts, insurance). ' +
        'Use web search only when current external facts matter (rates, limits, market context), not for their own data.\n\n' +
        'Keep responses focused and concise: lead with the direct answer, then at most a few supporting points. ' +
        'Use plain language, short paragraphs, and simple lists — no headers unless the answer is genuinely long. ' +
        'You are educational, not a licensed professional: for tax filings, legal questions, or large irreversible ' +
        'decisions, recommend the appropriate professional in one sentence without belaboring it.\n\n' +
        `FINANCIAL_SNAPSHOT:\n${contextJson}`,
      cache_control: { type: 'ephemeral' },
    },
  ]
}
