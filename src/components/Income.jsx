import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, uid, fmt } from '../store.jsx'
import { parsePaystub, paystubYearSummary, K401_TRAD_RE, K401_AFTER_RE, K401_ROTH_RE } from '../lib/income.js'
import { parseVestSchedule, rsuSummary, vestValue, vestBasisDiffers, effectivePrice } from '../lib/rsu.js'
import { nextVestOutlook } from '../lib/vestTax.js'
import { taxOutlook, megaBackdoorOutlook } from '../lib/yearOutlook.js'
import { fetchQuote, quoteStatus, quoteAge, QUOTE_SOURCES, QUOTE_TTL_MS, validSymbol } from '../lib/quotes.js'
import { resolveFacts, getDataConflicts } from '../lib/facts.js'
import { extractPdfTextLayout } from '../lib/extract.js'
import { LIMITS_2026 } from '../lib/advisor.js'
import FileDrop from './FileDrop.jsx'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

const thisYear = String(new Date().getFullYear())

// States with no wage income tax — saying "state withholding not included"
// there implies something is missing when nothing is.
const NO_INCOME_TAX_STATES = ['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY']

// "2026-07-31" reads like a database field; "Jul 31" reads like a date.
const payDateLabel = iso =>
  iso ? new Date(iso + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''

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
        const canSuggestFinnhub = lookup.source === 'keyless'
        toast(e.message, {
          kind: 'error',
          sticky: true,
          ...(canSuggestFinnhub
            ? { action: { label: 'Use a Finnhub key', onClick: () => dispatch({ type: 'SET_RSU', payload: { lookup: { ...lookup, source: 'finnhub' } } }) } }
            : {}),
        })
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
        <button className="btn small" onClick={() => dispatch({ type: 'SET_RSU', payload: { lookup: { source: 'keyless', token: '' } } })}>
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

  const source = QUOTE_SOURCES[lookup.source] || QUOTE_SOURCES.keyless
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

// Where the whole year lands. The near-term vest card answers "what arrives
// next week"; this answers "what does April look like", which for an
// equity-heavy household is the question with the expensive wrong answer.
function YearTaxCard({ state, year }) {
  const outlook = useMemo(() => taxOutlook(state, { year: Number(year) }), [state.paystubs, state.rsu, state.profile])
  if (!outlook) return null
  const o = outlook
  const owes = o.owed > 0
  const noStateTax = NO_INCOME_TAX_STATES.includes((state.profile?.state || '').toUpperCase())
  // Withheld against tax owed — how full the tank is, capped so a refund
  // doesn't overflow the bar.
  const pctCovered = o.projectedTax > 0 ? Math.min(100, (o.projectedWithheld / o.projectedTax) * 100) : 0

  return (
    <div className="card">
      <h2><span className="icon-chip"><Icon name="pie-chart" /></span> Your {o.year} tax picture</h2>

      {o.withholdingKnown ? (
        <div className={owes ? 'income-projection warn' : 'income-projection good'}>
          <div className="stat-label">{owes ? `Estimated shortfall at filing` : 'Estimated refund at filing'}</div>
          <div className="income-projection-value money">~{fmt(owes ? o.owed : o.refund)}</div>
          <div className="income-projection-bar" aria-hidden>
            <div className="income-projection-fill" style={{ width: `${pctCovered}%` }} />
          </div>
          <p className="small muted money" style={{ margin: '6px 0 0' }}>
            <strong>{fmt(o.projectedWithheld)} withheld</strong> by year end against <strong>{fmt(o.projectedTax)}</strong> of
            projected federal tax ({Math.round(pctCovered)}% covered) — {fmt(o.withheldYtd)} of it already taken,
            through {payDateLabel(o.asOf)}.
          </p>
        </div>
      ) : (
        <div className="income-projection">
          <div className="stat-label">Projected {o.year} federal tax</div>
          <div className="income-projection-value money">~{fmt(o.projectedTax)}</div>
          <p className="small muted money" style={{ margin: '6px 0 0' }}>
            No federal withholding row parsed from your statements, so Budgie can’t say whether you’re ahead or
            behind — only what the year’s tax looks like.
          </p>
        </div>
      )}

      <div className="stat-row cols-4">
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Projected gross</div>
          <div className="stat-value money">{fmt(o.gross)}</div>
          <div className="stat-sub">{fmt(o.cashProjected)} cash + {fmt(o.rsuIncome)} equity</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Taxable income</div>
          <div className="stat-value money">{fmt(o.taxableIncome)}</div>
          <div className="stat-sub">after {fmt(o.tradProjected + o.pretaxProjected)} pre-tax and the {fmt(o.standardDeduction)} standard deduction</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Projected federal tax</div>
          <div className="stat-value money">{fmt(o.projectedTax)}</div>
          <div className="stat-sub">{o.effectiveRate.toFixed(1)}% of gross · {Math.round(o.marginalRate)}% on the next dollar</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Withheld by year end</div>
          <div className="stat-value money">{fmt(o.projectedWithheld)}</div>
          <div className="stat-sub">{fmt(o.withheldYtd)} so far, at your paycheck’s current rate</div>
        </div>
      </div>

      {o.rsuIncome > 0 && o.rsuUnderWithheldPts > 0 && (
        <p className="small money" style={{ marginTop: 12, marginBottom: 6 }}>
          <strong>Why:</strong> {fmt(o.rsuIncome)} of your income is RSU vesting, withheld at a flat 22% while your
          income lands in the {Math.round(o.marginalRate)}% bracket. That’s roughly {fmt(o.rsuShortfall)} of tax
          the vests don’t cover — {owes
            ? 'more than your paycheck withholding makes up, which is why the year ends short.'
            : 'which your paycheck withholding is currently more than covering.'}
        </p>
      )}
      {owes && o.perPaycheck > 0 && (
        <p className="small money" style={{ marginBottom: 6 }}>
          <strong>One fix:</strong> ~{fmt(o.perPaycheck)} extra per paycheck across your {o.periodsLeft} remaining
          checks closes it — either as additional withholding on your W-4, or set aside for April.
        </p>
      )}

      <p className="small muted" style={{ marginBottom: 0 }}>
        An estimate, not a return. Federal only{noStateTax ? ` (${(state.profile?.state || '').toUpperCase()} has no income tax)` : ', state not included'} —
        it assumes the standard deduction, uses your income pace through {payDateLabel(o.asOf)}, and knows nothing
        about investment income, credits, or itemized deductions.
        {o.includesSpouse
          ? ` Your spouse’s ${fmt(o.spouseIncome)} from the Advisor profile is included, with no withholding assumed on it.`
          : ' No spouse income is on file, so a second earner would raise this.'}
      </p>
    </div>
  )
}

// The 415(c) lane. The employee deferral limit is the famous number; the
// annual-additions cap is the one with room left in it, and it expires
// December 31 — unused space cannot be carried forward.
function AfterTaxLaneCard({ state, year, employerMatch }) {
  const lane = useMemo(
    () => megaBackdoorOutlook(state, { year: Number(year), employerMatch }),
    [state.paystubs, state.profile, employerMatch],
  )
  if (!lane) return null
  const l = lane
  const full = l.room === 0

  return (
    <div className="card">
      <h2><span className="icon-chip"><Icon name="target" /></span> After-tax 401(k) room</h2>
      <div className={full ? 'income-projection good' : 'income-projection'}>
        <div className="stat-label">{full ? `${l.year} 401(k) ceiling reached` : `Room left under the ${fmt(l.limit)} ceiling`}</div>
        <div className="income-projection-value money">{fmt(l.room)}</div>
        <div className="income-projection-bar" aria-hidden>
          <div className="income-projection-fill" style={{ width: `${l.pctUsed}%` }} />
        </div>
        <p className="small muted money" style={{ margin: '6px 0 0' }}>
          <strong>{fmt(l.used)} of {fmt(l.limit)}</strong> used ({Math.round(l.pctUsed)}%) — everything that goes into
          your 401(k) counts: your deferrals, your employer’s money, and after-tax dollars. Room not used by
          December 31 is gone; it doesn’t carry forward.
        </p>
      </div>

      <div className="stat-row cols-4">
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Your deferrals</div>
          <div className="stat-value money">{fmt(l.employeeAgainstCap)}</div>
          <div className="stat-sub">projected for {l.year}{l.catchUpEligible ? ' · catch-up sits outside this cap' : ''}</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Employer money</div>
          <div className="stat-value money">{l.matchKnown ? fmt(l.employerMatch) : '—'}</div>
          <div className="stat-sub">{l.matchKnown ? 'match, from your benefits' : 'no match on file'}</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">After-tax · YTD</div>
          <div className="stat-value money">{fmt(l.afterTaxYtd)}</div>
          <div className="stat-sub">on pace for {fmt(l.afterTaxPace)} by year end</div>
        </div>
        <div className="stat-tile" style={{ cursor: 'default' }}>
          <div className="stat-label">Room left</div>
          <div className="stat-value money">{fmt(l.room)}</div>
          <div className="stat-sub">{l.periodsLeft > 0 ? `${fmt(l.perPaycheck)} per remaining paycheck` : 'no paychecks left this year'}</div>
        </div>
      </div>

      {!full && (
        <p className="small money" style={{ marginTop: 12, marginBottom: 6 }}>
          {l.unusedAtPace > 0
            ? <>At your current after-tax rate you’ll finish about <strong>{fmt(l.unusedAtPace)}</strong> short of the ceiling.
                Raising it to ~{fmt(l.perPaycheck)} per check for your {l.periodsLeft} remaining paychecks uses all of it.</>
            : <>Your current after-tax rate is on track to use the full ceiling by year end.</>}
        </p>
      )}
      <p className="small muted" style={{ marginBottom: 0 }}>
        {l.planSupports
          ? 'Your statements already show after-tax 401(k) dollars, so your plan allows this lane. Converting them to Roth (in-plan conversion or an in-service rollover) is what makes it a “mega-backdoor” — check that your plan does it automatically, or earnings accrue as taxable.'
          : 'This lane only exists if your plan allows after-tax contributions and in-plan Roth conversions — nothing on your statements shows after-tax dollars yet, so check your plan documents before counting on it.'}
        {!l.matchKnown && ' No employer match is on file; add it under Benefits and this room will shrink by that amount.'}
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
                {/* truthy-but-unparseable ("x" from a bad paste) rendered as
                    "NaN" — require an actual number. */}
                <td className="num">{Number(v.units) > 0 ? Math.round(v.units).toLocaleString() : '—'}</td>
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
  const { facts } = resolveFacts(state)
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
          <h2>{thisYear} income · {summary.employer || 'your employer'}</h2>

          {(() => {
            const gi = facts.grossIncome
            if (!gi || gi.source?.origin !== 'payroll') return null
            const pctOfYear = summary.ytd.gross > 0 && gi.value > 0 ? Math.round((summary.ytd.gross / gi.value) * 100) : 0
            return (
              <div className="income-projection">
                <div className="stat-label">Projected {thisYear} gross income</div>
                <div className="income-projection-value money">~{fmt(gi.value)}</div>
                <div className="income-projection-bar" aria-hidden>
                  <div className="income-projection-fill" style={{ width: `${Math.min(100, pctOfYear)}%` }} />
                </div>
                <p className="small muted money" style={{ margin: '6px 0 0' }}>
                  <strong>{fmt(summary.ytd.gross)} earned so far</strong> ({pctOfYear}% of the projection),
                  through {payDateLabel(summary.latest.payDate)} · {gi.source.detail}. RSU income comes from
                  actual vests plus your entered schedule, never extrapolated.
                </p>
              </div>
            )
          })()}

          <div className="stat-row cols-4">
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">Gross pay · YTD</div>
              <div className="stat-value money">{fmt(summary.ytd.gross)}</div>
              <div className="stat-sub">Jan 1 – {payDateLabel(summary.latest.payDate)}</div>
            </div>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">Taxes withheld · YTD</div>
              <div className="stat-value money">{fmt(summary.ytd.allTaxes)}</div>
              <div className="stat-sub">{summary.ytd.gross > 0 ? `${Math.round((summary.ytd.allTaxes / summary.ytd.gross) * 100)}% of gross so far` : ''}</div>
            </div>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">401(k) employee · YTD</div>
              <div className="stat-value money">{fmt(k401Employee)}</div>
              <div className="stat-sub">of {fmt(k401Limit)} limit</div>
            </div>
            <div className="stat-tile" style={{ cursor: 'default' }}>
              <div className="stat-label">After-tax 401(k) · YTD</div>
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
          {getDataConflicts(state).filter(c => (c.surfaces || []).includes('income')).map(c => (
            <p key={c.message} className="small money" style={{ color: 'var(--warning-text)', marginBottom: 0 }}>{c.message}</p>
          ))}
        </div>
      )}

      <NextVestCard state={state} />
      <YearTaxCard state={state} year={thisYear} />
      <AfterTaxLaneCard state={state} year={thisYear} employerMatch={facts.employerMatch?.value || 0} />
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
