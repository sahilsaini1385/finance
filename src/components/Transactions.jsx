import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, uid, fmtCents, fmt } from '../store.jsx'
import { allCategories } from '../lib/budget.js'
import { isSplit } from '../lib/tx.js'
import { localToday } from '../lib/dates.js'
import {
  PERIODS, buildIndex, filterRows, sortRows, summarize, partAmount,
  groupByDay, periodLabel,
} from '../lib/txquery.js'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'
import { useAutoCategorize, mergeCount, merchantLabel, isExcludedCategory } from './useAutoCategorize.js'

const LIMIT_STEP = 150

// ---------- the expanded editor ----------

// Category first (the commonest job), then note, tags, and split last behind a
// summary — the split editor only mounts when someone asks for it.
function TxDetail({ t, cats, onClose }) {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const { applyOne, applyToMerchant } = useAutoCategorize()
  const [note, setNote] = useState(t.note || '')
  const [tags, setTags] = useState(t.tags || [])
  const [newTag, setNewTag] = useState('')
  const [pendingRule, setPendingRule] = useState(null)
  const [armedDelete, setArmedDelete] = useState(false)
  const firstRef = useRef(null)
  const openedWith = useRef(t.category) // for a truthful Undo after a rule sweep

  useEffect(() => { firstRef.current?.focus() }, [])

  const allTags = useMemo(() => {
    const s = new Set()
    for (const x of state.transactions) for (const tag of x.tags || []) s.add(tag)
    return [...s].sort()
  }, [state.transactions])

  const saveIfDirty = () => {
    const dirtyNote = note.trim() !== (t.note || '')
    const dirtyTags = tags.join() !== (t.tags || []).join()
    if (dirtyNote || dirtyTags) {
      dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: t.id, note: note.trim(), tags } })
    }
  }

  const pickCategory = category => {
    if (category === t.category) return
    applyOne(t, category)
    const n = mergeCount(state, t, category)
    setPendingRule(n > 0 ? { category, count: n } : null)
  }

  const toggleTag = tag => setTags(cur => (cur.includes(tag) ? cur.filter(x => x !== tag) : [...cur, tag]))

  const addTag = () => {
    const clean = newTag.trim().replace(/^#/, '')
    if (clean && !tags.includes(clean)) setTags(cur => [...cur, clean])
    setNewTag('')
  }

  const remove = () => {
    if (!armedDelete) { setArmedDelete(true); setTimeout(() => setArmedDelete(false), 3000); return }
    dispatch({ type: 'DELETE_TRANSACTION', payload: t.id })
    toast('Transaction deleted', {
      sticky: true,
      action: { label: 'Undo', onClick: () => dispatch({ type: 'ADD_TRANSACTIONS', payload: [t] }) },
    })
    onClose({ focusRow: false })
  }

  return (
    <li className="tx-detail" id={`d-${t.id}`}>
      <div className="tx-field">
        <span className="tx-field-label">Category</span>
        <div className="chip-grid">
          {cats.map((c, i) => (
            <button
              key={c}
              ref={c === t.category ? firstRef : (i === 0 && !cats.includes(t.category) ? firstRef : null)}
              className={c === t.category ? 'chip cat-chip on' : 'chip cat-chip'}
              aria-pressed={c === t.category}
              onClick={() => pickCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        {pendingRule && (
          <div className="rule-strip">
            {isExcludedCategory(pendingRule.category) && (
              <p className="rule-warn">
                {pendingRule.category} isn’t counted as spending — these charges drop out of every budget total, past and future.
              </p>
            )}
            <span>Also file {pendingRule.count} other {merchantLabel(t)} charge{pendingRule.count === 1 ? '' : 's'} as {pendingRule.category}?</span>
            <span className="rule-actions">
              <button className="btn ghost small" onClick={() => setPendingRule(null)}>Just this one</button>
              <button
                className="btn primary small"
                autoFocus
                onClick={() => { applyToMerchant(t, pendingRule.category, { revertTo: openedWith.current }); setPendingRule(null) }}
              >
                Change all {pendingRule.count}
              </button>
            </span>
          </div>
        )}
      </div>

      <div className="tx-field">
        <label className="tx-field-label" htmlFor={`note-${t.id}`}>Note</label>
        <input
          id={`note-${t.id}`}
          value={note}
          placeholder="e.g. Kate’s birthday dinner"
          onChange={e => setNote(e.target.value)}
          onBlur={saveIfDirty}
        />
      </div>

      <div className="tx-field">
        <span className="tx-field-label">Tags</span>
        <div className="chip-grid">
          {allTags.map(tag => (
            <button
              key={tag}
              className={tags.includes(tag) ? 'chip tag-toggle on' : 'chip tag-toggle'}
              aria-pressed={tags.includes(tag)}
              onClick={() => toggleTag(tag)}
            >
              #{tag}
            </button>
          ))}
          <input
            className="tag-input"
            value={newTag}
            placeholder="New tag…"
            aria-label="Add a tag"
            onChange={e => setNewTag(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
            onBlur={() => { addTag(); saveIfDirty() }}
          />
        </div>
      </div>

      <details className="tx-split" open={Array.isArray(t.splits) && t.splits.length > 0 && !isSplit(t)}>
        <summary>Split this charge</summary>
        <SplitEditor t={t} cats={cats.filter(c => c !== 'Income')} />
      </details>

      <div className="tx-detail-foot">
        <button className="btn primary small" onClick={() => { saveIfDirty(); onClose({ focusRow: true }) }}>Done</button>
        <button className={armedDelete ? 'btn danger small armed' : 'btn danger small'} onClick={remove}>
          {armedDelete ? 'Confirm delete?' : 'Delete transaction'}
        </button>
      </div>
    </li>
  )
}

// The split editor is kept close to the original — it was the best interaction
// on the page — with three fixes: one seed row so the remainder helper is
// visible, comma-tolerant parsing, and stable keys so removing a middle row
// doesn't move focus.
function SplitEditor({ t, cats }) {
  const { dispatch } = useStore()
  const toast = useToast()
  const abs = Math.abs(t.amount)
  const sign = t.amount < 0 ? -1 : 1
  const num = v => parseFloat(String(v).replace(/,/g, '')) || 0
  const [rows, setRows] = useState(() =>
    (t.splits || []).length
      ? t.splits.map(s => ({ key: uid(), category: s.category, amt: String(Math.abs(s.amount)) }))
      : [{ key: uid(), category: t.category, amt: abs.toFixed(2) }],
  )

  const sum = rows.reduce((s, r) => s + num(r.amt), 0)
  const remainder = Math.round((abs - sum) * 100) / 100
  const ready = rows.length >= 2 && Math.abs(remainder) < 0.005 && rows.every(r => num(r.amt) > 0)
  const setRow = (key, patch) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)))

  const save = () => {
    dispatch({
      type: 'UPDATE_TRANSACTION',
      payload: { id: t.id, splits: rows.map(r => ({ id: uid(), category: r.category, amount: sign * num(r.amt) })) },
    })
    toast(`Split across ${rows.length} categories`, { kind: 'good' })
  }

  const clear = () => {
    dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: t.id, splits: null } })
    toast('Split removed — back to a single category')
  }

  return (
    <div className="tx-editor">
      <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
        Split {fmtCents(abs)} across categories
      </div>
      {rows.map((r, i) => (
        <div className="row gap" key={r.key} style={{ marginTop: 6 }}>
          <select value={r.category} aria-label={`Split ${i + 1} category`} onChange={e => setRow(r.key, { category: e.target.value })}>
            {cats.map(c => <option key={c}>{c}</option>)}
          </select>
          <span className="input-money" style={{ width: 110 }}>
            <input type="text" inputMode="decimal" aria-label={`Split ${i + 1} amount`}
              value={r.amt} onChange={e => setRow(r.key, { amt: e.target.value })} />
          </span>
          {Math.abs(remainder) >= 0.005 && num(r.amt) + remainder > 0 && (
            <button className="chip" onClick={() => setRow(r.key, { amt: (Math.round((num(r.amt) + remainder) * 100) / 100).toFixed(2) })}>
              {remainder > 0 ? '+' : '−'}{fmtCents(Math.abs(remainder))} here
            </button>
          )}
          {rows.length > 1 && (
            <button className="btn ghost small" aria-label={`Remove split row ${i + 1}`} onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}>
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      ))}
      <div className="row gap wrap" style={{ marginTop: 10 }}>
        <button className="btn small" onClick={() => setRows(rs => [...rs, { key: uid(), category: 'Other', amt: '' }])}>
          <Icon name="plus" size={12} /> Add row
        </button>
        <button className="btn primary small" onClick={save} disabled={!ready}
          title={ready ? '' : 'Amounts must be positive and add up to the transaction total'}>
          {isSplit(t) ? 'Update split' : 'Split transaction'}
        </button>
        {isSplit(t) && <button className="btn small" onClick={clear}>Remove split</button>}
        <span className="small muted money">
          {Math.abs(remainder) < 0.005 ? 'Adds up ✓' : remainder > 0 ? `${fmtCents(remainder)} left to assign` : `${fmtCents(-remainder)} over`}
        </span>
      </div>
    </div>
  )
}

// ---------- one row ----------

function TxRow({ t, category, expanded, onToggle, rowRef }) {
  const { state } = useStore()
  const account = state.accounts.find(a => a.id === t.accountId)
  const amount = partAmount(t, category)
  const split = isSplit(t)
  const staleSplit = Array.isArray(t.splits) && t.splits.length > 0 && !split
  const meta = [
    split && category !== 'all' ? `${t.category === category ? category : category}` : t.category,
    account ? account.name : 'Unlinked',
    split ? `Split · ${t.splits.length}` : null,
    split && category !== 'all' ? `of ${fmtCents(Math.abs(t.amount))}` : null,
    t.note ? `✎ ${t.note}` : null,
  ].filter(Boolean)

  return (
    <li>
      <button
        ref={rowRef}
        className={`tx-row${t.pending ? ' pending' : ''}`}
        aria-expanded={expanded}
        aria-controls={`d-${t.id}`}
        onClick={onToggle}
      >
        <span className="tx-main">
          <span className="tx-desc">{t.description}</span>
          <span className={`tx-amt${amount > 0 ? ' pos' : ''}`}>
            {amount > 0 ? '+' : ''}{fmtCents(amount)}
          </span>
        </span>
        <span className="tx-meta">
          {meta.join(' · ')}
          {staleSplit && <span className="badge warn">Split needs fixing</span>}
          {(t.tags || []).map(tag => <span key={tag} className="tag-chip">#{tag}</span>)}
        </span>
      </button>
    </li>
  )
}

// ---------- the page ----------

export default function Transactions() {
  const { state } = useStore()
  const today = localToday()

  const [period, setPeriod] = useState('month')
  const [account, setAccount] = useState('all')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState('date')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(LIMIT_STEP)
  const [expandedId, setExpandedId] = useState(null)
  const [announced, setAnnounced] = useState('')
  const searchRef = useRef(null)
  const rowRefs = useRef(new Map())

  const cats = useMemo(() => allCategories(state), [state.customCategories]) // eslint-disable-line react-hooks/exhaustive-deps
  const deferredQuery = useDeferredValue(query)
  const view = { period, account, category, query: deferredQuery, sort }
  const signature = `${period}|${account}|${category}|${deferredQuery}|${sort}`

  const index = useMemo(() => buildIndex(state.transactions, state.accounts), [state.transactions, state.accounts])

  // filter → sort → total over EVERYTHING → then window. Nothing downstream of
  // the slice may ever produce a number the user reads as an answer.
  const { matches, totals } = useMemo(() => {
    const m = sortRows(filterRows(state.transactions, index, view, today), sort, category)
    return { matches: m, totals: summarize(m, { category }) }
  }, [state.transactions, index, signature]) // eslint-disable-line react-hooks/exhaustive-deps

  // A row being edited stays rendered even if the edit just made it stop
  // matching — otherwise it unmounts under its own focus and focus falls to
  // the body, on the single most frequent action on the page.
  const windowed = useMemo(() => {
    const w = matches.slice(0, limit)
    if (expandedId && !w.some(t => t.id === expandedId)) {
      const pinned = state.transactions.find(t => t.id === expandedId)
      if (pinned) return [...w, pinned]
    }
    return w
  }, [matches, limit, expandedId, state.transactions])

  const pending = useMemo(() => windowed.filter(t => t.pending), [windowed])
  const days = useMemo(
    () => groupByDay(sort === 'date' ? windowed.filter(t => !t.pending) : windowed, category, today),
    [windowed, category, sort, today],
  )

  useEffect(() => { setLimit(LIMIT_STEP) }, [signature]) // eslint-disable-line react-hooks/exhaustive-deps

  // Announce on settle, not on every keystroke.
  const answer = totals.spent >= 0
    ? `${fmt(Math.round(totals.spent))} spent`
    : `${fmt(Math.round(-totals.spent))} back — refunds beat spending`
  useEffect(() => {
    const id = setTimeout(() => setAnnounced(`${answer} · ${matches.length} charges`), 600)
    return () => clearTimeout(id)
  }, [answer, matches.length])

  // How many would match with no period limit — powers the "search all time" offer.
  const allTimeCount = useMemo(() => {
    if (matches.length > 0 || period === 'all') return matches.length
    return filterRows(state.transactions, index, { ...view, period: 'all' }, today).length
  }, [matches.length, period, state.transactions, index, signature]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasFilters = account !== 'all' || category !== 'all' || query.trim() !== ''
  const clearAll = () => { setAccount('all'); setCategory('all'); setQuery('') }

  const closeDetail = ({ focusRow } = {}) => {
    const id = expandedId
    setExpandedId(null)
    if (focusRow && id) requestAnimationFrame(() => rowRefs.current.get(id)?.focus())
  }

  useEffect(() => {
    const onKey = e => {
      const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus() }
      if (e.key === 'Escape') {
        if (expandedId) closeDetail({ focusRow: true })
        else if (query) setQuery('')
        else if (hasFilters) clearAll()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // re-bound each render so the handler sees current state

  if (state.transactions.length === 0) {
    return (
      <div className="page">
        <h1>Transactions</h1>
        <div className="card">
          <div className="empty">
            <Icon name="list" />
            <strong>No transactions yet</strong>
            <span className="small">Sync with SimpleFIN or import a bank CSV to get started.</span>
          </div>
        </div>
      </div>
    )
  }

  const renderRow = t => (
    <React.Fragment key={t.id}>
      <TxRow
        t={t}
        category={category}
        expanded={expandedId === t.id}
        rowRef={el => { if (el) rowRefs.current.set(t.id, el); else rowRefs.current.delete(t.id) }}
        onToggle={() => (expandedId === t.id ? closeDetail({ focusRow: true }) : setExpandedId(t.id))}
      />
      {expandedId === t.id && <TxDetail t={t} cats={cats} onClose={closeDetail} />}
    </React.Fragment>
  )

  return (
    <div className="page">
      <h1>Transactions</h1>

      <div className="chip-row period-strip">
        {PERIODS.map(p => (
          <button
            key={p.id}
            className={period === p.id ? 'chip period-chip on' : 'chip period-chip'}
            aria-pressed={period === p.id}
            onClick={() => setPeriod(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="filter-row ask-bar">
        <input
          ref={searchRef}
          className="ask-input"
          placeholder="Search — merchant, amount, note, #tag"
          value={query}
          aria-label="Search transactions"
          onChange={e => setQuery(e.target.value)}
        />
        <select value={account} onChange={e => setAccount(e.target.value)} aria-label="Filter by account">
          <option value="all">All accounts</option>
          {state.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="all">All categories</option>
          {cats.map(c => <option key={c}>{c}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort">
          <option value="date">Newest first</option>
          <option value="amount">Biggest first</option>
        </select>
      </div>

      <div className="tx-answer">
        <div className="tx-answer-main money">
          {answer}
          {totals.income > 0 && <> · {fmt(Math.round(totals.income))} in</>}
          {' '}· {matches.length.toLocaleString()} charge{matches.length === 1 ? '' : 's'}
        </div>
        <div className="tx-answer-sub money">
          {[
            totals.refunded > 0 ? `net of ${fmt(Math.round(totals.refunded))} refunded` : null,
            totals.moved > 0 ? `${fmt(Math.round(totals.moved))} in transfers not counted` : null,
            limit < matches.length ? `showing ${Math.min(limit, matches.length)}` : null,
          ].filter(Boolean).join(' · ')}
        </div>
        <span className="visually-hidden" role="status" aria-live="polite">{announced}</span>
      </div>

      {hasFilters && (
        <div className="chip-row">
          {account !== 'all' && (
            <button className="chip" onClick={() => setAccount('all')}>
              {state.accounts.find(a => a.id === account)?.name || 'Account'} <Icon name="x" size={11} />
            </button>
          )}
          {category !== 'all' && (
            <button className="chip" onClick={() => setCategory('all')}>{category} <Icon name="x" size={11} /></button>
          )}
          {query.trim() !== '' && (
            <button className="chip" onClick={() => setQuery('')}>“{query}” <Icon name="x" size={11} /></button>
          )}
          <button className="btn ghost small" onClick={clearAll}>Clear all</button>
        </div>
      )}

      <div className="card">
        {matches.length === 0 ? (
          allTimeCount > 0 ? (
            <div className="empty">
              <strong>Nothing matches in {periodLabel(period, today)}.</strong>
              <span className="small">{allTimeCount} match{allTimeCount === 1 ? '' : 'es'} in all time.</span>
              <button className="btn primary" onClick={() => setPeriod('all')}>Search all time</button>
            </div>
          ) : hasFilters ? (
            <div className="empty">
              <Icon name="list" />
              <strong>Nothing matches</strong>
              <button className="btn" onClick={clearAll}>Clear filters</button>
            </div>
          ) : (
            <div className="empty">
              <Icon name="list" />
              <strong>Nothing in {periodLabel(period, today)} yet</strong>
              <button className="btn" onClick={() => setPeriod('all')}>See all time</button>
            </div>
          )
        ) : (
          <ul className="tx-list">
            {sort === 'date' && pending.length > 0 && (
              <>
                <li className="tx-day">
                  <span>Pending — not final yet</span>
                  <span>{pending.length}</span>
                </li>
                {pending.map(renderRow)}
              </>
            )}
            {days.map(d => (
              <React.Fragment key={d.date}>
                <li className="tx-day">
                  <span>{d.label}</span>
                  <span className="money">{d.net < 0 ? '−' : '+'}{fmtCents(Math.abs(d.net))}</span>
                </li>
                {d.rows.map(renderRow)}
              </React.Fragment>
            ))}
          </ul>
        )}

        {limit < matches.length && (
          <div className="tx-more">
            <p className="muted small">
              Showing {Math.min(limit, matches.length).toLocaleString()} of {matches.length.toLocaleString()} — the totals above cover all {matches.length.toLocaleString()}.
            </p>
            <button className="btn" style={{ width: '100%' }} onClick={() => setLimit(l => l + LIMIT_STEP)}>
              Show {Math.min(LIMIT_STEP, matches.length - limit)} more
            </button>
          </div>
        )}
      </div>

      {state.rules.length > 0 && <RulesCard />}
    </div>
  )
}

function RulesCard() {
  const { state, dispatch } = useStore()
  return (
    <div className="card">
      <details className="advanced">
        <summary>Your categorization rules ({state.rules.length})</summary>
        <table className="table" style={{ marginTop: 8 }}>
          <thead><tr><th>When merchant is</th><th>Categorize as</th><th></th></tr></thead>
          <tbody>
            {state.rules.map(r => (
              <tr key={r.id}>
                <td className="small">{r.match.toLowerCase()}</td>
                <td className="small">{r.category}</td>
                <td className="row-actions">
                  <button className="btn ghost small" aria-label={`Delete rule for ${r.match.toLowerCase()}`}
                    onClick={() => dispatch({ type: 'DELETE_RULE', payload: r.id })}>
                    <Icon name="x" size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Created when you choose “Change all” after recategorizing. Deleting a rule stops it filing
          future transactions — transactions it already filed keep their category.
        </p>
      </details>
    </div>
  )
}
