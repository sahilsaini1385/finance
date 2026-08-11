// Provider registry for "Ask Budgie", the built-in advisor chat.
//
// The advisor UI is provider-agnostic: it renders whatever the active
// provider declares and calls its streamChat transport. Today only Claude is
// registered — by design; the plumbing exists so other AI accounts can slot
// in without touching AskAdvisor.
//
// Adding a provider later (ChatGPT, Gemini, …) means one new entry here:
//   id / label      branding shown in the setup card and badge
//   models          [{ id, label }] for the model picker, + defaultModel
//   credentialHint  setup copy for its key format
//   tokenKind(t)    classify a pasted credential ('apikey' | rejected kinds)
//   bridgeHealth()  probe the local bridge, if the provider supports one
//   streamChat({ token, model, system, messages, onText, signal }) → text
//
// Subscription plans (ChatGPT Plus, Gemini via Google One) have the same
// shape of restriction as Claude's: consumer-plan auth isn't accepted by the
// vendor's raw API, but each vendor ships a CLI that IS allowed to bill the
// subscription (codex, gemini). The local bridge protocol already carries a
// `provider` field so budgie-bridge.py can grow per-provider CLI drivers and
// serve them all from the same loopback port.
//
// Chat history (state.aiChat) is plain {role, content} — provider-neutral.

import { streamAdvice, bridgeHealth, tokenKind, DEFAULT_MODEL, MODELS } from './claude.js'

export const PROVIDERS = {
  claude: {
    id: 'claude',
    label: 'Claude',
    models: MODELS,
    defaultModel: DEFAULT_MODEL,
    credentialHint: 'sk-ant-api…',
    tokenKind,
    bridgeHealth,
    streamChat: streamAdvice,
  },
}

// Future: a per-user choice persisted in state; today Claude is the advisor.
export const ACTIVE_PROVIDER_ID = 'claude'

export function activeProvider() {
  return PROVIDERS[ACTIVE_PROVIDER_ID]
}
