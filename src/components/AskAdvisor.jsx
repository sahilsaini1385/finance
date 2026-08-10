import React, { useMemo, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { buildFinancialContext } from '../lib/aiContext.js'
import { streamAdvice, advisorSystemPrompt, tokenKind, DEFAULT_MODEL, MODELS } from '../lib/claude.js'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

const SUGGESTIONS = [
  'How is our budget looking this month?',
  'Where could we realistically cut spending?',
  'Are we on track for retirement?',
  'Do we have the right amount of insurance?',
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
      toast('That doesn’t look like an Anthropic token (should start with sk-ant-…)', { kind: 'error' })
      return
    }
    dispatch({ type: 'SET_CONNECTION', payload: { kind: 'claude', value: { token, model } } })
    setTokenInput('')
    toast(tokenKind(token) === 'oauth' ? 'Connected — using your Claude plan' : 'Connected — using API credits', { kind: 'good' })
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

  if (!conn) {
    return (
      <div className="card">
        <h2><span className="icon-chip"><Icon name="sparkle" /></span> Ask Claude about your finances</h2>
        <p className="muted small">
          Chat with a Claude model that can see your whole financial picture — budget, retirement outlook,
          insurance, goals — and research current rates and rules on the web. Connect with your own Anthropic
          credential; questions run on <strong>your</strong> plan, and your data is sent only when you ask.
        </p>
        <ol className="how-to small">
          <li>
            <strong>Use your Claude subscription (Pro/Max):</strong> in a terminal with Claude Code installed, run{' '}
            <code>claude setup-token</code> and paste the token (starts <code>sk-ant-oat…</code>). Usage counts
            against your existing plan — no separate credits.
          </li>
          <li>
            <strong>Or use an API key</strong> from{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>{' '}
            (starts <code>sk-ant-api…</code>, pay-as-you-go).
          </li>
        </ol>
        <div className="row gap wrap">
          <input
            className="mono"
            style={{ flex: '1 1 260px' }}
            value={tokenInput}
            onChange={e => setTokenInput(e.target.value)}
            placeholder="Paste sk-ant-… token"
            aria-label="Anthropic token"
          />
          <select value={model} aria-label="Model" onChange={e => setModel(e.target.value)}>
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <button className="btn primary" onClick={connect} disabled={!tokenInput.trim()}>Connect</button>
        </div>
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
          <span className="badge">{tokenKind(conn.token) === 'oauth' ? 'your Claude plan' : 'API credits'}</span>
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
