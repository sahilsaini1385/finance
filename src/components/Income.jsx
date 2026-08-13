import React, { useState } from 'react'
import { useStore, uid, fmt } from '../store.jsx'
import { parsePaystub, paystubYearSummary, K401_TRAD_RE, K401_AFTER_RE, K401_ROTH_RE } from '../lib/income.js'
import { parseVestSchedule, rsuSummary, vestValue } from '../lib/rsu.js'
import { resolveFacts, getDataConflicts } from '../lib/facts.js'
import { extractPdfTextLayout } from '../lib/extract.js'
import { LIMITS_2026 } from '../lib/advisor.js'
import FileDrop from './FileDrop.jsx'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

const thisYear = String(new Date().getFullYear())

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
      <p className="small muted" style={{ marginTop: -4 }}>
        Used only for vests without their own dollar amount. Grant-portal estimates already baked into the
        pasted schedule win over this price.
      </p>

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
                <td className="num">{fmt(vestValue(v, rsu.price))}</td>
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
