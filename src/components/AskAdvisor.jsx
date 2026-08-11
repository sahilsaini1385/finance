import React, { useMemo, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { buildFinancialContext } from '../lib/aiContext.js'
import { streamAdvice, advisorSystemPrompt, tokenKind, bridgeHealth, OAUTH_TOKEN_MSG, DEFAULT_MODEL, MODELS } from '../lib/claude.js'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

const SUGGESTIONS = [
  'Find every tax break we’re missing',
  'How is our budget looking this month?',
  'Where could we realistically cut spending?',
  'Are we on track for retirement?',
  'Should we pay extra on the mortgage or invest?',
]

// Minimal markdown: **bold**, bullet lines, paragraphs. Keeps answers readable
// without pulling in a renderer dependency.
function renderAnswer(text) {
  const bold = s =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
    )
  const blocks = []
  let list = null
  String(text).split('\n').forEach((line, i) => {
    const m = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)/)
    if (m) {
      if (!list) { list = []; blocks.push(list) }
      list.push(<li key={i}>{bold(m[2])}</li>)
    } else {
      list = null
      if (line.trim()) blocks.push(<p key={i}>{bold(line.replace(/^#{1,4}\s*/, ''))}</p>)
    }
  })
  return blocks.map((b, i) => (Array.isArray(b) ? <ul key={i}>{b}</ul> : b))
}

export default function AskAdvisor() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const conn = state.connections?.claude || null
  const [tokenInput, setTokenInput] = useState('')
  const [setupError, setSetupError] = useState('')
  const [setupOpen, setSetupOpen] = useState(false)
  const [probing, setProbing] = useState(false)
  const [model, setModel] = useState(conn?.model || DEFAULT_MODEL)
  const [question, setQuestion] = useState('')
  const [streaming, setStreaming] = useState(null) // partial assistant text while a turn runs
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef(null)
  const threadRef = useRef(null)

  const chat = state.aiChat || []

  const connect = () => {
    const token = tokenInput.trim()
    if (!token.startsWith('sk-ant-')) {
      setSetupError('That doesn’t look like an Anthropic key (should start with sk-ant-…)')
      return
    }
    if (tokenKind(token) === 'oauth') {
      // Claude Code tokens are rejected by Anthropic's API outside Claude Code
      // itself — refuse here, with the reason, rather than 401 on first question.
      setSetupError(OAUTH_TOKEN_MSG)
      return
    }
    setSetupError('')
    dispatch({ type: 'SET_CONNECTION', payload: { kind: 'claude', value: { token, model } } })
    setTokenInput('')
    toast('Connected — the advisor is ready', { kind: 'good' })
  }

  const connectBridge = async () => {
    setProbing(true)
    setSetupError('')
    const health = await bridgeHealth()
    setProbing(false)
    if (!health) {
      setSetupError(
        'No bridge found on this computer. Make sure `python3 budgie-bridge.py` is running ' +
        'in a terminal window, then try again. (Safari blocks localhost from web pages — ' +
        'use Chrome, Edge, Arc, or Firefox for the subscription option.)',
      )
      return
    }
    if (!health.ok) {
      setSetupError('The bridge is running but couldn’t find Claude Code. Install it from claude.com/claude-code, run `claude` once to log in, then restart the bridge.')
      return
    }
    dispatch({ type: 'SET_CONNECTION', payload: { kind: 'claude', value: { token: 'bridge', model } } })
    toast('Connected — the advisor runs on your Claude plan', { kind: 'good' })
  }

  const disconnect = () => {
    dispatch({ type: 'SET_CONNECTION', payload: { kind: 'claude', value: null } })
    toast('AI advisor disconnected — chat history kept')
  }

  const ask = async q => {
    const text = (q ?? question).trim()
    if (!text || busy || !conn) return
    setQuestion('')
    setError('')
    setBusy(true)
    setStreaming('')

    const history = chat.slice(-10).map(m => ({ role: m.role, content: m.content }))
    const messages = [...history, { role: 'user', content: text }]
    // Snapshot is built fresh per question — the advisor always sees current data.
    const ctx = buildFinancialContext(state)
    dispatch({ type: 'ADD_AI_MESSAGES', payload: [{ role: 'user', content: text, at: Date.now() }] })

    const controller = new AbortController()
    abortRef.current = controller
    try {
      const answer = await streamAdvice({
        token: conn.token,
        model: conn.model || DEFAULT_MODEL,
        system: advisorSystemPrompt(JSON.stringify(ctx)),
        messages,
        signal: controller.signal,
        onText: t => {
          setStreaming(t)
          threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
        },
      })
      dispatch({ type: 'ADD_AI_MESSAGES', payload: [{ role: 'assistant', content: answer, at: Date.now() }] })
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e.message || String(e))
        toast('The advisor couldn’t answer', { kind: 'error' })
      }
    }
    setStreaming(null)
    setBusy(false)
  }

  const stop = () => {
    abortRef.current?.abort()
    if (streaming) {
      dispatch({ type: 'ADD_AI_MESSAGES', payload: [{ role: 'assistant', content: streaming + ' …', at: Date.now() }] })
    }
    setStreaming(null)
    setBusy(false)
  }

  const shared = useMemo(
    () => `${state.accounts.length} account balances, this month's budget & spending, bills, insurance, goals, and the retirement outlook`,
    [state.accounts.length],
  )

  // A connection saved back when the app offered `claude setup-token` — those
  // tokens turned out to be unusable outside Claude Code, so send the user
  // back through setup with the real explanation instead of a dead chat box.
  const legacyOauth = Boolean(conn) && tokenKind(conn.token) === 'oauth'

  if (!conn && !setupOpen) {
    // Compact teaser — the full setup instructions only unfold on request,
    // so an unconnected AI card doesn't push real advice below the fold.
    return (
      <div className="card">
        <div className="row gap wrap" style={{ alignItems: 'center' }}>
          <h2 style={{ margin: 0, flex: '1 1 260px' }}>
            <span className="icon-chip"><Icon name="sparkle" /></span> Ask Claude about your finances
          </h2>
          <span className="small muted">Chat with an AI that sees your full picture — runs on your Claude subscription or an API key.</span>
          <button className="btn primary" onClick={() => setSetupOpen(true)}>Set up</button>
        </div>
      </div>
    )
  }

  if (!conn || legacyOauth) {
    return (
      <div className="card">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h2 style={{ margin: 0 }}><span className="icon-chip"><Icon name="sparkle" /></span> Ask Claude about your finances</h2>
          {legacyOauth
            ? <button className="btn ghost small" onClick={disconnect}>Disconnect</button>
            : <button className="btn ghost small" onClick={() => setSetupOpen(false)}>Hide</button>}
        </div>
        {legacyOauth && (
          <p className="error small">
            The saved token is a Claude Code token (<code>sk-ant-oat…</code>) — Anthropic’s API rejects those
            outside Claude Code itself, which is what the “rejected the token” error was. Good news: the new
            “Use my Claude subscription” option below gets you there without pasting any token.
          </p>
        )}
        <p className="muted small">
          Chat with a Claude model that can see your whole financial picture — budget, taxes, retirement outlook,
          insurance, goals — hunt down tax breaks you're missing, and research current rates and rules on the web.
          It sticks to money topics only. Your data is sent only when you ask a question.
        </p>
        <div className="row gap wrap" style={{ marginBottom: 8 }}>
          <select value={model} aria-label="Model" onChange={e => setModel(e.target.value)}>
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <ol className="how-to small">
          <li>
            <strong>Use your Claude subscription (Pro/Max) — no extra cost.</strong> Questions run through{' '}
            <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer">Claude Code</a> on your own
            computer via a small bridge script:{' '}
            <a href="/budgie-bridge.py" download>download budgie-bridge.py</a>, then in Terminal run{' '}
            <code>python3 ~/Downloads/budgie-bridge.py</code> and keep that window open.{' '}
            <button className="btn primary small" onClick={connectBridge} disabled={probing}>
              {probing ? 'Looking for bridge…' : 'Use my Claude subscription'}
            </button>
          </li>
          <li>
            <strong>Or use an API key</strong> from{' '}
            <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">platform.claude.com/settings/keys</a>{' '}
            (starts <code>sk-ant-api…</code>, pay-as-you-go — works anywhere, no bridge needed):
            <span className="row gap wrap" style={{ display: 'flex', marginTop: 6 }}>
              <input
                className="mono"
                style={{ flex: '1 1 220px' }}
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                placeholder="Paste sk-ant-api… key"
                aria-label="Anthropic API key"
              />
              <button className="btn small" onClick={connect} disabled={!tokenInput.trim()}>Connect key</button>
            </span>
          </li>
        </ol>
        {setupError && <p className="error small">{setupError}</p>}
        <div className="trust-note">
          <Icon name="lock" size={12} /> Stored only in this browser. When you ask a question, a compact summary
          of your finances goes to Anthropic to answer it — nothing is sent otherwise.
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="page-head" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>
          <span className="icon-chip"><Icon name="sparkle" /></span>
          Ask Claude
          <span className="badge">{conn.token === 'bridge' ? 'your Claude plan' : 'API credits'}</span>
        </h2>
        <div className="row gap">
          {chat.length > 0 && (
            <button className="btn ghost small" onClick={() => dispatch({ type: 'CLEAR_AI_CHAT' })}>Clear chat</button>
          )}
          <button className="btn ghost small" onClick={disconnect}>Disconnect</button>
        </div>
      </div>

      {chat.length === 0 && streaming === null && (
        <div className="chip-row" style={{ marginTop: 8 }}>
          {SUGGESTIONS.map(s => (
            <button key={s} className="chip" onClick={() => ask(s)} disabled={busy}>{s}</button>
          ))}
        </div>
      )}

      {(chat.length > 0 || streaming !== null) && (
        <div className="chat-thread" ref={threadRef}>
          {chat.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'chat-bubble user' : 'chat-bubble assistant'}>
              {m.role === 'user' ? m.content : renderAnswer(m.content)}
            </div>
          ))}
          {streaming !== null && (
            <div className="chat-bubble assistant">
              {streaming === '' ? <span className="muted">Thinking<span className="ellipsis" />…</span> : renderAnswer(streaming)}
            </div>
          )}
        </div>
      )}

      {error && <p className="error small">{error}</p>}

      <form
        className="row gap"
        style={{ marginTop: 10 }}
        onSubmit={e => { e.preventDefault(); ask() }}
      >
        <input
          style={{ flex: 1 }}
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Ask anything about your money…"
          aria-label="Ask the advisor"
          disabled={busy}
        />
        {busy ? (
          <button className="btn" type="button" onClick={stop}>Stop</button>
        ) : (
          <button className="btn primary" type="submit" disabled={!question.trim()}>Ask</button>
        )}
      </form>
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        <Icon name="lock" size={11} /> Each question sends {shared} to Anthropic. Educational, not professional advice.
      </p>
    </div>
  )
}
