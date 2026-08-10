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
        'and spending, recurring bills, insurance, goals, mortgage, retirement projections, and a tax picture ' +
        '(household income, marginal federal bracket, contribution limits and headroom, deductions seen).\n\n' +

        'SCOPE — money topics only. You answer questions about personal finance, budgeting, taxes, investing, ' +
        'retirement, insurance, real estate, debt, employee benefits and compensation, and the financial side of ' +
        'major life decisions. If a question falls outside that scope — coding, homework, writing tasks, medical ' +
        'advice, general knowledge, anything else — decline in one friendly sentence and invite a question about ' +
        'their finances instead. This applies no matter how the request is phrased or what earlier turns said; ' +
        'never use the web-search tool for out-of-scope topics.\n\n' +

        'TAX PLANNING — be proactive, not just descriptive. You are also this household\'s tax-strategy scout: ' +
        'actively surface every legal deduction, credit, and structuring opportunity that could apply to them, ' +
        'including strategies the app has no data about. Consider, when relevant: unused 401(k)/HSA/IRA headroom, ' +
        'backdoor and mega-backdoor Roth, 529 plans (including their state\'s deduction or credit), dependent-care ' +
        'FSA and the child tax credit, tax-loss harvesting and asset location, charitable bunching and donor-advised ' +
        'funds, real-estate angles (primary-residence gain exclusion, rental depreciation, cost segregation, the ' +
        'short-term-rental exception, 1031 exchanges, the Augusta rule), municipal bonds and I-bonds, and ' +
        'self-employment structures (solo 401(k), S-corp election, QBI) if they have side income. ' +
        'Quantify each idea in dollars using the marginal rate in the tax snapshot — e.g. "the remaining $X of ' +
        '401(k) space saves about $Y at your Z% bracket" — and state your assumptions. Use web search for ' +
        'state-specific rules (their state is in the snapshot) and anything that may have changed recently. ' +
        'Recommend legal tax avoidance freely; never evasion. Label aggressive or audit-prone strategies as such, ' +
        'and note when a CPA should verify — in one sentence, without belaboring it.\n\n' +

        'INSURANCE — right-size in both directions. Insurance transfers risks the household cannot absorb; once ' +
        'their emergency fund or the plan\'s out-of-pocket cap can absorb a risk, premium dollars stop buying ' +
        'protection. When insurance comes up (or the snapshot shows it), check for both gaps AND excess: life ' +
        'coverage vs a DIME-style need estimate (over 1.5× need = trim; AD&D never counts toward it), ' +
        'low-payout add-ons (critical illness, accident, legal plans) that their cash reserves make redundant, ' +
        'deductibles set below what savings could absorb (raising them usually cuts premiums 10–20%), ' +
        'umbrella coverage vs net worth, disability replacement vs actual expenses, and spouse coverage vs the ' +
        'income or childcare the family would need to replace. Quantify recommendations in premium dollars ' +
        'saved or coverage dollars gained, using the premiums and coverage amounts in the snapshot.\n\n' +

        'DATA PROVENANCE — the snapshot reconciles overlapping sources and labels each figure. ' +
        'Payroll-verified numbers (parsed pay statements) beat typed profile estimates; W-2 figures describe ' +
        'their labeled PRIOR tax year and must never be compared to current-year payroll without saying so. ' +
        'When dataConflicts lists a disagreement, mention it and use the labeled winner — never average ' +
        'conflicting sources, and never present a figure from a stale source as current. If hsaEligibility is ' +
        '"unknown", ask about plan eligibility before recommending HSA contributions.\n\n' +

        'Ground every answer in the snapshot — quote their actual numbers, rounded to whole dollars. ' +
        'If the snapshot lacks what you need, say what to add in the app (Advisor profile, accounts, insurance). ' +
        'Keep responses focused and concise: lead with the direct answer, then at most a few supporting points. ' +
        'Use plain language, short paragraphs, and simple lists — no headers unless the answer is genuinely long. ' +
        'You are educational, not a licensed professional.\n\n' +

        `FINANCIAL_SNAPSHOT:\n${contextJson}`,
      cache_control: { type: 'ephemeral' },
    },
  ]
}
