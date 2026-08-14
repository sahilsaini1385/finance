import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, uid, fmt } from '../store.jsx'
import { parsePaystub, paystubYearSummary, K401_TRAD_RE, K401_AFTER_RE, K401_ROTH_RE } from '../lib/income.js'
import { parseVestSchedule, rsuSummary, vestValue, vestBasisDiffers, effectivePrice } from '../lib/rsu.js'
import { nextVestOutlook } from '../lib/vestTax.js'
import { fetchQuote, quoteStatus, quoteAge, QUOTE_SOURCES, QUOTE_TTL_MS, validSymbol } from '../lib/quotes.js'
import { resolveFacts, getDataConflicts } from '../lib/facts.js'
import { extractPdfTextLayout } from '../lib/extract.js'
import { LIMITS_2026 } from '../lib/advisor.js'
import FileDrop from './FileDrop.jsx'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

const thisYear = String(new Date().getFullYear())

// Optional share-price lookup. Off until switched on, and a fetched price is
// only ever a suggestion — it lands in rsu.quote, never in the price field the
// user typed, and never changes a number without being applied.
function PriceLookup({ state, dispatch, toast }) {
  const rsu = state.rsu || {}
  const lookup = rsu.lookup
  const quote = rsu.quote
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState(lookup?.token || '')
  const abortRef = useRef(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const symbol = (rsu.symbol || '').trim().toUpperCase()
  const status = quoteStatus(quote)

  const run = async ({ silent } = {}) => {
    if (!lookup || !validSymbol(symbol)) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy(true)
    try {
      const q = await fetchQuote({
        symbol,
        sourceId: lookup.source,
        token: lookup.token,
        proxyUrl: state.connections?.simplefin?.proxyUrl,
        signal: ctrl.signal,
      })
      dispatch({ type: 'SET_RSU', payload: { quote: q } })
      if (!silent) toast(`${q.symbol} ${fmt(q.price, { maximumFractionDigits: 2 })}`, { kind: 'good' })
    } catch (e) {
      if (e.name !== 'AbortError' && !silent) {
        toast(e.message, { kind: 'error', sticky: true })
      }
    }
    setBusy(false)
  }

  // One quiet refresh per app load when the cached quote has aged out. Never
  // on every render — request frequency is itself a signal about when this
  // household opens its finances.
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current || !lookup || !validSymbol(symbol)) return
    autoRan.current = true
    if (quoteAge(quote) > QUOTE_TTL_MS) run({ silent: true })
  }) // eslint-disable-line react-hooks/exhaustive-deps

  if (!lookup) {
    return (
      <div className="lookup-off">
        <button className="btn small" onClick={() => dispatch({ type: 'SET_RSU', payload: { lookup: { source: 'stooq', token: '' } } })}>
          <Icon name="trending-up" size={12} /> Look up {symbol || 'the'} share price
        </button>
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          Off by default. Turning it on lets this browser contact a price service directly and send
          <strong> only the ticker symbol</strong> — never your holdings, vest schedule, or anything else in Budgie.
          It stays on this device and is never shared by family sync.
        </p>
      </div>
    )
  }

  const source = QUOTE_SOURCES[lookup.source] || QUOTE_SOURCES.stooq
  return (
    <div className="lookup-on">
      <div className="row gap wrap" style={{ alignItems: 'center' }}>
        {quote?.price > 0 ? (
          <>
            <span className="chip" title={`${quote.kind} from ${quote.source}`}>
              {quote.symbol} {fmt(quote.price, { maximumFractionDigits: 2 })}
            </span>
            <span className={status.stale ? 'small' : 'small muted'} style={status.stale ? { color: 'var(--warning-text)' } : undefined}>
              {status.label} · {quote.kind}
            </span>
            {Math.abs(Number(rsu.price || 0) - quote.price) > 0.005 && (
              <button className="btn small" onClick={() => dispatch({ type: 'SET_RSU', payload: { price: String(quote.price) } })}>
                Use this price
              </button>
            )}
          </>
        ) : (
          <span className="small muted">No price fetched yet.</span>
        )}
        <button className="btn ghost small" onClick={() => run({})} disabled={busy || !validSymbol(symbol)}>
          {busy ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      <details className="advanced" style={{ marginTop: 8 }}>
        <summary>Price source</summary>
        <div className="row gap wrap" style={{ marginTop: 8, alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '1 1 200px' }}>
            <span>Source</span>
            <select value={lookup.source} onChange={e => dispatch({ type: 'SET_RSU', payload: { lookup: { ...lookup, source: e.target.value } } })}>
              {Object.values(QUOTE_SOURCES).map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
            </select>
          </label>
          {source.needsKey && (
            <label className="field" style={{ flex: '1 1 240px' }}>
              <span>API key</span>
              <input type="password" value={token} placeholder="paste your key"
                onChange={e => setToken(e.target.value)}
                onBlur={() => dispatch({ type: 'SET_RSU', payload: { lookup: { ...lookup, token: token.trim() } } })} />
            </label>
          )}
          <button className="btn danger small" onClick={() => {
            dispatch({ type: 'SET_RSU', payload: { lookup: null, quote: null } })
            toast('Price lookup off — key and cached price forgotten')
          }}>Turn off</button>
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          {source.note}{source.keyHint ? ` ${source.keyHint}` : ''} Prices are delayed or previous-close;
          Budgie never calls a free feed “live”.
        </p>
      </details>
    </div>
  )
}

// The one thing worth reading first: what actually lands from the next vest.
// Withholding on equity follows the supplemental schedule, not your W-4, which
// is exactly why equity-heavy households are surprised in April.
function NextVestCard({ state }) {
  const summary = useMemo(() => rsuSummary(state), [state.rsu])
  const payroll = useMemo(() => paystubYearSummary(state, thisYear), [state.paystubs])
  const outlook = useMemo(
    () => nextVestOutlook({ ...state, __payrollYtd: payroll?.ytd || {} }, summary),
    [state.rsu, state.profile, payroll],
  )
  if (!outlook) return null

  const when = new Date(outlook.date + 'T00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
  const away = outlook.daysAway
  const pctWithheld = Math.round(outlook.rates.effectivePct)

  return (
    <div className="card">
      <h2><span className="icon-chip"><Icon name="calendar" /></span> Your next vest</h2>
      <div className="tx-answer-main money" style={{ fontSize: 20 }}>
        ~{fmt(Math.round(outlook.net))} lands {away <= 0 ? 'today' : away === 1 ? 'tomorrow' : `in ${away} days`}
      </div>
      <p className="small muted money" style={{ margin: '4px 0 12px' }}>
        {when} · {Math.round(outlook.units).toLocaleString()} shares · {fmt(Math.round(outlook.gross))} before withholding
      </p>
      <div className="stat-row cols-4">
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Federal</div>
          <div className="stat-value money">{fmt(Math.round(outlook.federal))}</div>
          <div className="stat-sub">{outlook.rates.hitHighBracket ? '22% then 37% past $1M' : '22% supplemental rate'}</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Social Security</div>
          <div className="stat-value money">{fmt(Math.round(outlook.socialSecurity))}</div>
          <div className="stat-sub">{outlook.socialSecurity === 0 ? 'past the wage base' : '6.2% to the wage base'}</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Medicare</div>
          <div className="stat-value money">{fmt(Math.round(outlook.medicare))}</div>
          <div className="stat-sub">1.45%{outlook.medicare > outlook.gross * 0.0146 ? ' + 0.9% surtax' : ''}</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Withheld</div>
          <div className="stat-value money">{pctWithheld}%</div>
          <div className="stat-sub">{fmt(Math.round(outlook.withheld))} of {fmt(Math.round(outlook.gross))}</div>
        </div>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        A withholding estimate, not a tax bill — companies withhold equity at a flat supplemental rate, so if
        your marginal rate is higher you may still owe the difference in April. State withholding is not
        included{state.profile?.state ? ` (${state.profile.state} rate not set)` : ''}.
      </p>
    </div>
  )
}

// Unvested equity — future income, deliberately outside net worth. The
// schedule feeds the reconciled gross-income estimate so taxes and the
// advisor see true expected income, not just what has already vested.
function RsuCard({ state, dispatch, toast }) {
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [manual, setManual] = useState({ date: '', units: '', amount: '' })
  const [armedVest, setArmedVest] = useState(null)
  const [readingFile, setReadingFile] = useState(false)

  const rsu = state.rsu || { symbol: '', price: '', vests: [] }
  const vests = rsu.vests || []
  const summary = rsuSummary(state)
  const price = effectivePrice(rsu)
  const basis = rsu.basis === 'price' ? 'price' : 'portal'
  const today = new Date().toISOString().slice(0, 10)

  const importPaste = () => {
    const parsed = parseVestSchedule(pasteText)
    if (!parsed.length) {
      toast('No vest rows found — expected lines like “Aug-15-2026 $30,469.92 USD 114 units”.', { kind: 'error' })
      return
    }
    dispatch({ type: 'ADD_RSU_VESTS', payload: parsed.map(v => ({ ...v, id: uid() })) })
    toast(`Imported ${parsed.length} vest${parsed.length === 1 ? '' : 's'} (duplicates skipped)`, { kind: 'good' })
    setPasteText('')
    setPasteOpen(false)
  }

  const uploadSchedule = async file => {
    if (!file) return
    setReadingFile(true)
    try {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
      const text = isPdf ? await extractPdfTextLayout(file) : await file.text()
      const parsed = parseVestSchedule(text)
      if (!parsed.length) {
        toast('No vest rows found in that file — expected dates alongside units or dollar amounts.', { kind: 'error' })
      } else {
        dispatch({ type: 'ADD_RSU_VESTS', payload: parsed.map(v => ({ ...v, id: uid() })) })
        toast(`Imported ${parsed.length} vest${parsed.length === 1 ? '' : 's'} from the file (duplicates skipped)`, { kind: 'good' })
      }
    } catch (e) {
      toast(`Couldn’t read that file: ${e.message}`, { kind: 'error' })
    }
    setReadingFile(false)
  }

  const addManual = () => {
    const units = parseFloat(manual.units) || 0
    const amount = parseFloat(manual.amount) || 0
    if (!manual.date || (units <= 0 && amount <= 0)) {
      toast('A vest needs a date plus units or a dollar amount.', { kind: 'error' })
      return
    }
    dispatch({ type: 'ADD_RSU_VESTS', payload: [{ id: uid(), date: manual.date, units, amount }] })
    setManual({ date: '', units: '', amount: '' })
  }

  const removeVest = v => {
    if (armedVest !== v.id) {
      setArmedVest(v.id)
      setTimeout(() => setArmedVest(cur => (cur === v.id ? null : cur)), 3000)
      return
    }
    dispatch({ type: 'DELETE_RSU_VEST', payload: v.id })
    setArmedVest(null)
  }

  return (
    <div className="card">
      <h2><span className="icon-chip"><Icon name="trending-up" /></span> RSU vesting schedule</h2>
      <p className="muted small">
        Unvested shares are future income, not an asset — they show on the Overview but never count toward
        net worth. Vests still ahead this year do feed your income estimate, so tax math sees your true gross.
      </p>

      <div className="grid-2-forms" style={{ marginBottom: 10 }}>
        <label className="field">
          <span>Ticker (optional)</span>
          <input value={rsu.symbol || ''} placeholder="AMZN" onChange={e => dispatch({ type: 'SET_RSU', payload: { symbol: e.target.value.toUpperCase() } })} />
        </label>
        <label className="field">
          <span>Assumed price per share ($)</span>
          <input type="number" inputMode="decimal" value={rsu.price || ''} placeholder="267"
            onChange={e => dispatch({ type: 'SET_RSU', payload: { price: e.target.value } })} />
        </label>
      </div>
      <PriceLookup state={state} dispatch={dispatch} toast={toast} />

      <div className="basis-row">
        <span className="tx-field-label">Value unvested shares at</span>
        <div className="chip-grid">
          <button
            className={rsu.basis !== 'price' ? 'chip cat-chip on' : 'chip cat-chip'}
            aria-pressed={rsu.basis !== 'price'}
            onClick={() => dispatch({ type: 'SET_RSU', payload: { basis: 'portal' } })}
          >
            The amounts from my schedule
          </button>
          <button
            className={rsu.basis === 'price' ? 'chip cat-chip on' : 'chip cat-chip'}
            aria-pressed={rsu.basis === 'price'}
            onClick={() => dispatch({ type: 'SET_RSU', payload: { basis: 'price' } })}
            disabled={!(price > 0)}
            title={price > 0 ? '' : 'Set a price first'}
          >
            {price > 0 ? `Today’s price (${fmt(price, { maximumFractionDigits: 2 })})` : 'Today’s price'}
          </button>
        </div>
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          {rsu.basis === 'price'
            ? 'Every vest with a unit count is valued at the price above, so the total moves with the market.'
            : 'Pasted schedules carry dollar amounts frozen when you exported them — the price only fills in rows that have none.'}
          {' '}This changes the Overview tile and the income used for tax estimates.
        </p>
      </div>

      {vests.length > 0 && (
        <div className="stat-row cols-4" style={{ marginBottom: 10 }}>
          <div className="stat-tile" style={{ cursor: 'default' }}>
            <div className="stat-label">Unvested value</div>
            <div className="stat-value money">~{fmt(summary.totalUnvestedValue)}</div>
            <div className="stat-sub">{Math.round(summary.totalUnvestedUnits).toLocaleString()} units · not in net worth</div>
          </div>
          <div className="stat-tile" style={{ cursor: 'default' }}>
            <div className="stat-label">Still vesting {thisYear}</div>
            <div className="stat-value money">{fmt(summary.remainingThisYear)}</div>
            <div className="stat-sub">counts toward this year’s income</div>
          </div>
          <div className="stat-tile" style={{ cursor: 'default' }}>
            <div className="stat-label">Next vest</div>
            <div className="stat-value money">{summary.nextVest ? fmt(summary.nextVest.value) : '—'}</div>
            <div className="stat-sub">{summary.nextVest ? summary.nextVest.date : 'all vested'}</div>
          </div>
          <div className="stat-tile" style={{ cursor: 'default' }}>
            <div className="stat-label">Schedule runs through</div>
            <div className="stat-value">{summary.lastVestYear || '—'}</div>
            <div className="stat-sub">{vests.length} vest dates</div>
          </div>
        </div>
      )}

      <div className="row-actions" style={{ marginBottom: 10 }}>
        <button className="btn small" onClick={() => setPasteOpen(o => !o)}>
          {pasteOpen ? 'Cancel paste' : 'Paste schedule'}
        </button>
      </div>
      {pasteOpen && (
        <div style={{ marginBottom: 10 }}>
          <textarea
            rows={6}
            style={{ width: '100%' }}
            placeholder={'One vest per line, straight from your equity portal:\nAug-15-2026  $30,469.92 USD  114 units\nNov-21-2026  $32,608.16 USD  122 units'}
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
          />
          <div className="row-actions" style={{ marginTop: 6 }}>
            <button className="btn primary small" onClick={importPaste}>Import vests</button>
          </div>
          <div style={{ marginTop: 8 }}>
            <FileDrop
              onFile={uploadSchedule}
              accept=".pdf,.txt,.csv"
              title={readingFile ? 'Reading…' : '…or drop the schedule as a PDF'}
              subtitle="Exports from equity portals parse automatically — read locally, the file isn't kept"
            />
          </div>
        </div>
      )}

      <div className="grid-2-forms" style={{ marginBottom: 10, alignItems: 'end' }}>
        <label className="field">
          <span>Vest date</span>
          <input type="date" value={manual.date} onChange={e => setManual(m => ({ ...m, date: e.target.value }))} />
        </label>
        <label className="field">
          <span>Units</span>
          <input type="number" inputMode="numeric" value={manual.units} onChange={e => setManual(m => ({ ...m, units: e.target.value }))} />
        </label>
        <label className="field">
          <span>Value $ (optional)</span>
          <input type="number" inputMode="decimal" value={manual.amount} onChange={e => setManual(m => ({ ...m, amount: e.target.value }))} />
        </label>
        <button className="btn small" onClick={addManual} style={{ marginBottom: 2 }}>Add vest</button>
      </div>

      {vests.length > 0 && (
        <table className="table">
          <thead>
            <tr><th>Vest date</th><th className="num">Units</th><th className="num">Est. value</th><th></th><th></th></tr>
          </thead>
          <tbody>
            {vests.map(v => (
              <tr key={v.id} style={v.date <= today ? { opacity: 0.55 } : undefined}>
                <td>{v.date}</td>
                <td className="num">{v.units ? Math.round(v.units).toLocaleString() : '—'}</td>
                <td className="num">
                  {fmt(vestValue(v, price, basis))}
                  {vestBasisDiffers(v, price) && (
                    <div className="small muted">{basis === 'price' ? `at ${fmt(price, { maximumFractionDigits: 2 })}` : 'from schedule'}</div>
                  )}
                </td>
                <td className="small">{v.date <= today ? <span className="badge" style={{ color: 'var(--text-2)', background: 'var(--surface-2)' }}>vested</span> : <span className="badge">upcoming</span>}</td>
                <td className="row-actions">
                  <button className={armedVest === v.id ? 'btn danger small armed' : 'btn danger small'} onClick={() => removeVest(v)}>
                    {armedVest === v.id ? 'Confirm?' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="trust-note">
        <Icon name="lock" size={12} /> Stays in this browser (and your encrypted family sync, if on).
      </div>
    </div>
  )
}

export default function Income() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [reading, setReading] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [armedId, setArmedId] = useState(null)

  const upload = async file => {
    if (!file) return
    setReading(true)
    try {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
      const text = isPdf ? await extractPdfTextLayout(file) : await file.text()
      const stub = parsePaystub(text)
      if (!stub) {
        toast('Couldn’t find pay figures in that file — is it an earnings statement?', { kind: 'error' })
      } else {
        dispatch({ type: 'ADD_PAYSTUB', payload: { ...stub, id: uid() } })
        toast(
          stub.balanced
            ? `Parsed: ${fmt(stub.gross)} gross → ${fmt(stub.net)} net (reconciles to the penny)`
            : `Parsed: ${fmt(stub.gross)} gross → ${fmt(stub.net)} net — some rows may be missing, open the row to verify`,
          { kind: stub.balanced ? 'good' : undefined },
        )
      }
    } catch (e) {
      toast(`Couldn’t read that file: ${e.message}`, { kind: 'error' })
    }
    setReading(false)
  }

  const remove = s => {
    if (armedId !== s.id) {
      setArmedId(s.id)
      setTimeout(() => setArmedId(cur => (cur === s.id ? null : cur)), 3000)
      return
    }
    dispatch({ type: 'DELETE_PAYSTUB', payload: s.id })
    setArmedId(null)
    toast('Statement removed')
  }

  const stubs = [...(state.paystubs || [])].sort((a, b) => (a.payDate < b.payDate ? 1 : -1))
  const summary = paystubYearSummary(state, thisYear)
  const k401Limit = LIMITS_2026.k401
  const k401Employee = summary ? summary.ytd.k401Trad + summary.ytd.k401Roth : 0
  // Pace: fraction of the year elapsed at the latest stub's pay date.
  const paceInfo = (() => {
    if (!summary) return null
    const d = new Date(summary.latest.payDate + 'T00:00')
    const start = new Date(`${thisYear}-01-01T00:00`)
    const frac = Math.min(1, Math.max(0.02, (d - start + 86400000) / (365 * 86400000)))
    return { projected: k401Employee / frac, frac }
  })()

  const dedGroup = (stub, re) => stub.deductions.filter(d => re.test(d.label)).reduce((s, d) => s + d.amount, 0)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Income</h1>
          <p className="muted small">
            Drop in pay statements (PDF) and Budgie reads gross, taxes, deductions, and year-to-date figures —
            entirely in this browser. The file itself isn't stored, only the parsed numbers.
          </p>
        </div>
      </div>

      <div className="card">
        <h2><span className="icon-chip"><Icon name="wallet" /></span> Add a pay statement</h2>
        <FileDrop
          onFile={upload}
          accept=".pdf,.txt"
          title={reading ? 'Reading…' : 'Drop a pay statement PDF, or browse'}
          subtitle="ADP earnings statements (Amazon and many others) parse automatically"
        />
        <div className="trust-note">
          <Icon name="lock" size={12} /> Parsed locally — nothing is uploaded, and the PDF isn't kept.
        </div>
      </div>

      {summary && (
        <div className="card">
          <h2>{thisYear} year to date · {summary.employer || 'your employer'}</h2>
          <div className="stat-row cols-4">
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">Gross pay</div>
              <div className="stat-value money">{fmt(summary.ytd.gross)}</div>
              <div className="stat-sub">through {summary.latest.payDate}</div>
            </div>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">Taxes withheld</div>
              <div className="stat-value money">{fmt(summary.ytd.allTaxes)}</div>
              <div className="stat-sub">{summary.ytd.gross > 0 ? `${Math.round((summary.ytd.allTaxes / summary.ytd.gross) * 100)}% of gross` : ''}</div>
            </div>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">401(k) employee</div>
              <div className="stat-value money">{fmt(k401Employee)}</div>
              <div className="stat-sub">of {fmt(k401Limit)} limit</div>
            </div>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">After-tax 401(k)</div>
              <div className="stat-value money">{fmt(summary.ytd.k401AfterTax)}</div>
              <div className="stat-sub">mega-backdoor lane</div>
            </div>
          </div>
          <div className="meter" style={{ marginTop: 10 }}>
            <div className="meter-fill" style={{ width: `${Math.min(100, (k401Employee / k401Limit) * 100)}%`, background: k401Employee >= k401Limit ? 'var(--good)' : 'var(--accent)' }} />
          </div>
          <p className="small muted money" style={{ marginBottom: 0 }}>
            {k401Employee >= k401Limit
              ? `401(k) employee limit reached for ${thisYear}.`
              : paceInfo && paceInfo.projected >= k401Limit
                ? `On pace to hit the ${fmt(k401Limit)} employee limit by year end.`
                : paceInfo
                  ? `Current pace projects ~${fmt(Math.round(paceInfo.projected))} by year end — ${fmt(Math.round(k401Limit - paceInfo.projected))} of tax-advantaged space would go unused.`
                  : ''}
          </p>
          {(() => {
            const { facts } = resolveFacts(state)
            const gi = facts.grossIncome
            const lines = []
            if (gi?.source?.origin === 'payroll') {
              lines.push(
                <p key="ann" className="small muted money" style={{ marginBottom: 0 }}>
                  Annualized income: <strong>~{fmt(gi.value)}/yr</strong> ({gi.source.detail}) — RSU income comes
                  from actual vests plus your entered schedule, never extrapolated.
                </p>,
              )
            }
            for (const c of getDataConflicts(state).filter(c => (c.surfaces || []).includes('income'))) {
              lines.push(<p key={c.message} className="small money" style={{ color: 'var(--warning)', marginBottom: 0 }}>{c.message}</p>)
            }
            return lines
          })()}
        </div>
      )}

      <NextVestCard state={state} />
      <RsuCard state={state} dispatch={dispatch} toast={toast} />

      {stubs.length === 0 ? (
        <div className="card">
          <div className="empty">
            <Icon name="wallet" />
            <strong>No pay statements yet</strong>
            <span className="small">Drop in a paycheck PDF — Budgie tracks your gross, withholding, and 401(k) progress from the real numbers.</span>
          </div>
        </div>
      ) : (
        <div className="card">
          <h2>Statements ({stubs.length})</h2>
          <table className="table">
            <thead>
              <tr><th>Pay date</th><th>Employer</th><th className="num">Gross</th><th className="num">Taxes</th><th className="num">401(k)</th><th className="num">Net</th><th></th></tr>
            </thead>
            <tbody>
              {stubs.map(s => (
                <React.Fragment key={s.id}>
                  <tr>
                    <td>{s.payDate}</td>
                    <td className="small">{s.employer || '—'}</td>
                    <td className="num">{fmt(s.gross)}</td>
                    <td className="num">{fmt(s.totalTaxes)}</td>
                    <td className="num">{fmt(dedGroup(s, K401_TRAD_RE) + dedGroup(s, K401_ROTH_RE) + dedGroup(s, K401_AFTER_RE))}</td>
                    <td className="num">{fmt(s.net)}</td>
                    <td className="row-actions">
                      <button className="btn ghost small" onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                        {expandedId === s.id ? 'Hide' : 'Detail'}
                      </button>
                      <button className={armedId === s.id ? 'btn danger small armed' : 'btn danger small'} onClick={() => remove(s)}>
                        {armedId === s.id ? 'Confirm?' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === s.id && (
                    <tr>
                      <td colSpan={7}>
                        <div className="grid-2-forms" style={{ padding: '8px 0' }}>
                          <div>
                            <strong className="small">Taxes this period</strong>
                            <table className="table">
                              <tbody>
                                {s.taxes.map((t, i) => (
                                  <tr key={i}><td className="small">{t.label}</td><td className="num small">{fmt(t.amount)}</td><td className="num small muted">{fmt(t.ytd)} ytd</td></tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div>
                            <strong className="small">Deductions this period</strong>
                            <table className="table">
                              <tbody>
                                {s.deductions.map((d, i) => (
                                  <tr key={i}><td className="small">{d.label}{d.pretax ? ' (pre-tax)' : ''}</td><td className="num small">{fmt(d.amount)}</td><td className="num small muted">{fmt(d.ytd)} ytd</td></tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        {!s.balanced && (
                          <p className="small muted">Heads-up: gross − taxes − deductions doesn’t equal net for this statement, so a row may not have parsed. The figures above are what was found.</p>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
