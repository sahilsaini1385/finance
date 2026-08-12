// Claude client for the AI advisor. Uses the official @anthropic-ai/sdk
// (lazy-loaded so it never weighs down the initial bundle) directly from the
// browser, with the same-origin /api/claude proxy as a CORS fallback — the
// same transport-chain pattern the SimpleFIN integration uses.
//
// Two ways to power the advisor:
//
//   'bridge'       Claude subscription (Pro/Max) via the Budgie bridge — a
//                  small script (public/budgie-bridge.py) the user runs on
//                  their own computer. It drives their installed, logged-in
//                  Claude Code headlessly, so usage is covered by their plan.
//                  This is the sanctioned subscription route: Anthropic
//                  supports headless Claude Code for scripts, while the raw
//                  Messages API rejects subscription OAuth tokens
//                  (sk-ant-oat..., from `claude setup-token`) everywhere
//                  outside Claude Code (anthropics/claude-code#37205, closed
//                  not-planned). Pasted sk-ant-oat tokens are therefore
//                  detected only to be refused with guidance.
//   sk-ant-api...  Console API key, pay-as-you-go, sent as x-api-key.
//
// The credential lives only in this browser's localStorage. Questions go
// from the browser to Anthropic directly (or via the stateless same-origin
// proxy), or to the loopback bridge — never anywhere else.

export const DEFAULT_MODEL = 'claude-opus-5'
export const MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5 — most capable (recommended)' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — fast and sharp' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — fastest, cheapest' },
]

export function tokenKind(token) {
  const t = String(token || '')
  return t === 'bridge' ? 'bridge' : t.startsWith('sk-ant-oat') ? 'oauth' : 'apikey'
}

export const OAUTH_TOKEN_MSG =
  'That’s a Claude Code token (sk-ant-oat…). Anthropic’s API only accepts those ' +
  'inside Claude Code itself, so pasting one here can’t work. To use your Claude ' +
  'subscription, pick “Use my Claude subscription” above and run the bridge instead.'

export const BRIDGE_URL = 'http://127.0.0.1:8765'
const BRIDGE_DOWN_MSG =
  'Couldn’t reach the Budgie bridge on this computer. Is `python3 budgie-bridge.py` ' +
  'still running in a terminal window? Start it and try again.'

// Probes the local bridge. Returns its health JSON, or null when unreachable.
// The timeout is generous on purpose: on first use Chrome shows a "wants to
// access devices on your local network" permission prompt and holds the fetch
// until the user answers — aborting early turns an Allow click into a failure.
export async function bridgeHealth() {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    const res = await fetch(`${BRIDGE_URL}/health`, {
      signal: ctrl.signal,
      cache: 'no-store',
      targetAddressSpace: 'loopback', // Chromium opt-in for https-page → http-loopback fetches
    })
    clearTimeout(t)
    const j = await res.json()
    return j && j.bridge === 'budgie' ? j : null
  } catch {
    return null
  }
}

// Streams one advisor turn through the local bridge (NDJSON over loopback).
async function streamBridge({ model, system, messages, onText, signal }) {
  const systemText = Array.isArray(system)
    ? system.map(b => b?.text || '').join('\n')
    : String(system || '')
  let res
  try {
    res = await fetch(`${BRIDGE_URL}/advice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'claude', system: systemText, messages, model: model || DEFAULT_MODEL }),
      signal,
      cache: 'no-store',
      targetAddressSpace: 'loopback',
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new Error(BRIDGE_DOWN_MSG)
  }
  if (!res.ok || !res.body) throw new Error(BRIDGE_DOWN_MSG)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      let ev
      try { ev = JSON.parse(line) } catch { continue }
      if (ev.text) { text += ev.text; onText?.(text) }
      if (ev.error) throw new Error(`Your Claude Code reported: ${ev.error}`)
    }
  }
  return text
}

async function makeClient(token, { viaProxy = false } = {}) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const opts = {
    apiKey: token,
    dangerouslyAllowBrowser: true, // key stays user-side by design: local-first app
    maxRetries: 1,
  }
  if (viaProxy) opts.baseURL = `${window.location.origin}/api/claude`
  return new Anthropic(opts)
}

const WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: 3 }

// Streams one advisor turn. Tries the direct browser connection first, then
// the same-origin proxy; tries with the web-search tool first, then without
// (some credential types don't allow server tools). onText receives text
// deltas; resolves with the final assistant text.
export async function streamAdvice({ token, model, system, messages, onText, signal }) {
  if (tokenKind(token) === 'bridge') return streamBridge({ model, system, messages, onText, signal })
  // Guard for connections stored before the app learned these can't work —
  // fail with the real explanation instead of a misleading 401 from Anthropic.
  if (tokenKind(token) === 'oauth') throw new Error(OAUTH_TOKEN_MSG)
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
        throw new Error('Anthropic rejected the API key. Check it (and your credit balance) at platform.claude.com/settings/keys.')
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

        'BILL BENCHMARKING — hunt overpayment. recurringBills entries may carry typicalMarketRange and an ' +
        'aboveTypical flag from rough national benchmarks. When one is flagged, or the user asks about any bill, ' +
        'use web search to find CURRENT market rates for their area (their state is in the tax snapshot) and ' +
        'named competitor prices — e.g. fiber/5G-home-internet offers vs their cable bill, MVNO plans vs their ' +
        'carrier — then quantify the annual saving and give the exact negotiation or switching play. ' +
        'Bills are one of the few costs that fall with a single phone call; treat every flagged one as money ' +
        'on the table.\n\n' +

        'INSURANCE — right-size in both directions. Insurance transfers risks the household cannot absorb; once ' +
        'their emergency fund or the plan\'s out-of-pocket cap can absorb a risk, premium dollars stop buying ' +
        'protection. When insurance comes up (or the snapshot shows it), check for both gaps AND excess: life ' +
        'coverage vs a DIME-style need estimate (over 1.5× need = trim; AD&D never counts toward it), ' +
        'low-payout add-ons (critical illness, accident, legal plans) that their cash reserves make redundant, ' +
        'deductibles set below what savings could absorb (raising them usually cuts premiums 10–20%), ' +
        'umbrella coverage vs net worth, disability replacement vs actual expenses, and spouse coverage vs the ' +
        'income or childcare the family would need to replace. Quantify recommendations in premium dollars ' +
        'saved or coverage dollars gained, using the premiums and coverage amounts in the snapshot.\n\n' +

        'MORTGAGE PREPAY VS INVEST — treat prepayment as a bond, not a virtue. Every extra dollar of principal ' +
        'earns the note rate, guaranteed, until payoff — home.prepayVsInvest carries the pre-tax and after-tax ' +
        'return, the taxable-account breakeven, and a per-$100/month table for 5- and 10-year horizons; scale it ' +
        'linearly to whatever amount the user asks about and answer in dollars of net worth at the horizon, not ' +
        'percentages alone (home.payoff.outlook5y/outlook10y hold the interest actually incurred in those windows). ' +
        'Frame the comparison honestly: prepayment is risk-free, so it competes with the BOND side of a portfolio, ' +
        'which it beats outright at today\'s yields; against stocks it is a guaranteed return versus a risky ' +
        'median — use web search for current 10-year capital-market forecasts (Vanguard, Morningstar, JPMorgan) ' +
        'and current Treasury/HYSA yields rather than quoting the historical 10% for stocks, and say plainly that ' +
        'forecasts are medians with wide ranges, not promises; 5-year windows are wider still, which is what the ' +
        'guaranteed return insures against. Respect the priority ladder before recommending either: full employer ' +
        '401(k) match first, then debt above ~8%, then a 3-6 month emergency fund from monthlyExpenses and cash ' +
        'on hand, then unused 401(k)/HSA/IRA space (the deduction at their marginal rate usually beats the prepay ' +
        'edge) — only cash with no better rung is a prepay-vs-taxable-investing question. Always name the two ' +
        'costs of prepaying: liquidity (locked in the house until a sale, refi, or HELOC — never prepay the ' +
        'emergency fund) and cash-flow rigidity (the required payment does not drop until the loan is gone; a ' +
        'partially prepaid mortgage does not help in a job loss). For lump sums, mention recasting: after a large ' +
        'principal payment most servicers will re-amortize for a small fee, lowering the required payment at the ' +
        'same rate and term. Use afterTaxBasis from the snapshot for the tax interplay (itemizers lose part of ' +
        'the interest deduction when they prepay; standard-deduction households keep the full rate) and state ' +
        'your assumptions in one line. A rate this close to expected equity returns has no objectively right ' +
        'answer — give the numbers, name the risk difference, and let a split (some extra principal, some ' +
        'invested) be a first-class recommendation.\n\n' +

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
