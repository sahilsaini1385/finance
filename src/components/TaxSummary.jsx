import React, { useMemo } from 'react'
import { useStore, fmt } from '../store.jsx'
import { buildTaxSummary, taxSummaryCSV } from '../lib/report.js'
import { LIMITS_2026 } from '../lib/advisor.js'
import Icon from './Icon.jsx'
import { useToast } from './Toaster.jsx'

export default function TaxSummary({ year }) {
  const { state } = useStore()
  const toast = useToast()
  const s = useMemo(
    () => buildTaxSummary(state, year, LIMITS_2026),
    [state.transactions, state.documents, state.home, state.profile, year],
  )

  const download = () => {
    const blob = new Blob([taxSummaryCSV(s)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tax-summary-${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast('Tax summary downloaded — hand it to your CPA', { kind: 'good' })
  }

  const D = s.deductions
  const rows = [
    ['Charitable giving', D.giving, 'Giving category — receipts in the Taxes vault help here'],
    ['Medical & health', D.medical, 'deductible only above an income threshold — worth listing'],
    ['Property tax', D.propertyTax, 'from your Home profile'],
    ['Mortgage interest (estimate)', D.mortgageInterestEst, 'balance × rate — your Form 1098 has the exact figure'],
    ['Education', D.education, 'possible credits (AOTC/LLC)'],
    ['Work expenses (net of reimbursement)', D.workExpenses, 'deductible for self-employed; not for W-2 federally'],
    ['Bank & service fees', D.fees, 'generally not deductible — listed for completeness'],
  ]

  return (
    <>
      <div className="card">
        <h2>
          <span className="icon-chip"><Icon name="file-text" /></span>
          Income received in {year}
          <span style={{ marginLeft: 'auto' }}>
            <button className="btn small" onClick={download}><Icon name="upload" size={13} /> Download CSV for your CPA</button>
          </span>
        </h2>
        <table className="table">
          <tbody>
            <tr><td>Total deposits categorized as Income</td><td className="num">{fmt(s.incomeTotal)}</td></tr>
            <tr><td>of which interest / dividends (matched by description)</td><td className="num">{fmt(s.intDiv)}</td></tr>
          </tbody>
        </table>
        {s.w2 ? (
          <>
            <h2 style={{ marginTop: 16 }}>W-2 figures you entered ({s.w2.count} form{s.w2.count > 1 ? 's' : ''})</h2>
            <table className="table">
              <tbody>
                <tr><td>Box 1 wages</td><td className="num">{fmt(s.w2.wages)}</td></tr>
                <tr><td>Box 2 federal withholding</td><td className="num">{fmt(s.w2.fedWithholding)}</td></tr>
                <tr><td>401(k) deferrals (Box 12)</td><td className="num">{fmt(s.w2.k401)}</td></tr>
                <tr><td>HSA via payroll (Box 12 W)</td><td className="num">{fmt(s.w2.hsa)}</td></tr>
              </tbody>
            </table>
          </>
        ) : (
          <p className="muted small" style={{ marginBottom: 0 }}>
            No W-2 figures entered for {year} — upload W-2s in the Taxes tab and fill in the key boxes to include them here.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Potential deductions & credits — {year}</h2>
        <table className="table">
          <thead><tr><th>Item</th><th className="num">Amount</th><th>Note</th></tr></thead>
          <tbody>
            {rows.map(([label, v, note]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="num">{v > 0 ? fmt(v) : '—'}</td>
                <td className="small muted">{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={`alert ${s.itemizeLikely ? 'warning' : 'info'}`} style={{ marginTop: 12 }}>
          <span className="alert-icon"><Icon name={s.itemizeLikely ? 'alert-triangle' : 'info'} size={15} /></span>
          <div>
            <strong>
              Itemizable estimate {fmt(s.itemizableEst)} vs. standard deduction {fmt(s.standardDeduction)} ({s.filingStatus.toUpperCase()})
            </strong>
            <div className="rec-detail">
              {s.itemizeLikely
                ? 'Itemizing looks worth a serious look — bring Schedule A up with your preparer, plus state income tax which isn\'t tracked here.'
                : 'The standard deduction likely wins, so most line items above won\'t change your federal bill — charitable bunching in alternating years is the classic play if you\'re close.'}
            </div>
          </div>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          {s.docsCount > 0 ? `${s.docsCount} tax document${s.docsCount > 1 ? 's' : ''} for ${year} stored in the Taxes vault. ` : ''}
          Figures come from your categorized transactions and profile — an organized starting point for filing, not tax advice.
        </p>
      </div>
    </>
  )
}
