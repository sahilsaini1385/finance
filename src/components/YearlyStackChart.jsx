import React, { useState } from 'react'
import { fmt } from '../store.jsx'

// Yearly principal-vs-interest stacked bars for the mortgage payoff card.
// Plain SVG, fixed viewBox with uniform ("meet") scaling so axis text never
// distorts. In scenario mode, dashed ghost outlines mark the base-plan years
// the extra payments delete. All colors are CSS tokens (theme-safe); the
// yearly table below the chart is the accessible data twin.
//
// years:      [{ year, principal, interest, endBalance, monthsCount }]
// ghostYears: [{ year, totalPaid }] — base-plan years after scenario payoff
// crossoverYear: number | null — first year principal ≥ interest

const W = 640
const H = 240
const PAD_L = 46
const PAD_R = 8
const PAD_T = 30
const PAD_B = 22

function niceCeil(v) {
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const step = mag / 2
  return Math.ceil(v / step) * step
}

const kfmt = v => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`)

export default function YearlyStackChart({ years, ghostYears = [], crossoverYear = null, scenarioActive = false }) {
  const [hover, setHover] = useState(null) // slot index across years+ghosts
  if (!years || years.length === 0) return null

  const slots = [
    ...years.map(y => ({ kind: 'solid', ...y })),
    ...ghostYears.map(y => ({ kind: 'ghost', ...y })),
  ]
  const n = slots.length
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const slotW = plotW / n
  const barW = Math.min(26, slotW - 6)

  const maxTotal = Math.max(
    ...years.map(y => y.principal + y.interest),
    ...ghostYears.map(y => y.totalPaid),
  )
  const yMax = niceCeil(maxTotal)
  const yTo = v => PAD_T + plotH - (v / yMax) * plotH
  const xTo = i => PAD_L + i * slotW + slotW / 2

  const ticks = []
  const tickStep = yMax > 20000 ? 10000 : yMax > 8000 ? 5000 : 2000
  for (let t = tickStep; t <= yMax; t += tickStep) ticks.push(t)

  // Label every year if it fits, else every 2nd — but always first, last, crossover.
  const labelEvery = slotW >= 26 ? 1 : 2
  const showLabel = i =>
    i % labelEvery === 0 || i === 0 || i === n - 1 || slots[i].year === crossoverYear

  const crossIdx = crossoverYear !== null ? slots.findIndex(s => s.kind === 'solid' && s.year === crossoverYear) : -1
  const GAP = 2 // surface gap between stacked segments

  const firstYear = years[0].year
  const lastYear = years[years.length - 1].year

  return (
    <div className="area-chart" style={{ marginTop: 4 }}>
      <div className="row gap small" style={{ alignItems: 'center', marginBottom: 4, color: 'var(--text-2)', flexWrap: 'wrap' }}>
        <span className="row" style={{ alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--series-1)', display: 'inline-block' }} /> Principal
        </span>
        <span className="row" style={{ alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--series-2)', display: 'inline-block' }} /> Interest
        </span>
        {scenarioActive && (
          <span className="row" style={{ alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, border: '1px dashed var(--text-3)', display: 'inline-block' }} /> Avoided vs current plan
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label={`Yearly mortgage payments split into principal and interest, ${firstYear} to payoff in ${lastYear}${crossoverYear ? `; principal overtakes interest in ${crossoverYear}` : ''}`}
      >
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={yTo(t)} y2={yTo(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={PAD_L - 6} y={yTo(t) + 3} fontSize="10" fill="var(--text-3)" textAnchor="end" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {kfmt(t)}
            </text>
          </g>
        ))}
        <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="var(--border-strong)" strokeWidth="1" />

        {crossIdx >= 0 && (
          <g>
            <line
              x1={xTo(crossIdx)} x2={xTo(crossIdx)} y1={PAD_T - 6} y2={PAD_T + plotH}
              stroke="var(--text-3)" strokeWidth="1" strokeDasharray="4 4"
            />
            <text
              x={xTo(crossIdx) + (crossIdx > n / 2 ? -5 : 5)} y={PAD_T - 10}
              fontSize="10" fill="var(--text-2)" textAnchor={crossIdx > n / 2 ? 'end' : 'start'}
            >
              principal overtakes interest
            </text>
          </g>
        )}

        {slots.map((s, i) => {
          const cx = xTo(i)
          const x0 = cx - barW / 2
          const base = PAD_T + plotH
          if (s.kind === 'ghost') {
            const top = yTo(s.totalPaid)
            const h = base - top
            return (
              <path
                key={`g${s.year}`}
                d={`M${x0},${base} L${x0},${top + 4} Q${x0},${top} ${x0 + 4},${top} L${x0 + barW - 4},${top} Q${x0 + barW},${top} ${x0 + barW},${top + 4} L${x0 + barW},${base} Z`}
                fill="var(--text-3)" fillOpacity="0.06"
                stroke="var(--text-3)" strokeWidth="1" strokeDasharray="3 3"
              />
            )
          }
          const pTop = yTo(s.principal)
          const iH = Math.max(0, yTo(0) - yTo(s.interest) - GAP)
          const iTop = pTop - GAP - iH
          return (
            <g key={s.year}>
              <rect x={x0} y={pTop} width={barW} height={base - pTop} fill="var(--series-1)" />
              {iH > 0 && (
                <path
                  d={`M${x0},${iTop + iH} L${x0},${iTop + 4} Q${x0},${iTop} ${x0 + 4},${iTop} L${x0 + barW - 4},${iTop} Q${x0 + barW},${iTop} ${x0 + barW},${iTop + 4} L${x0 + barW},${iTop + iH} Z`}
                  fill="var(--series-2)"
                />
              )}
              {hover === i && (
                <rect x={x0 - 1} y={iTop - 1} width={barW + 2} height={base - iTop + 1} fill="none" stroke="var(--text)" strokeWidth="1" />
              )}
            </g>
          )
        })}

        {slots.map((s, i) =>
          showLabel(i) ? (
            <text key={`x${s.year}`} x={xTo(i)} y={H - 8} fontSize="10" fill="var(--text-3)" textAnchor="middle">
              {i === 0 ? s.year : `'${String(s.year).slice(2)}`}
            </text>
          ) : null,
        )}

        {slots.map((s, i) => (
          <rect
            key={`h${i}`}
            x={PAD_L + i * slotW} y={0} width={slotW} height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onPointerDown={() => setHover(i)}
          />
        ))}
      </svg>
      {hover !== null && slots[hover] && (
        <div className="chart-tip" style={{ left: `${((hover + 0.5) / n) * 100}%` }}>
          {slots[hover].kind === 'ghost' ? (
            <>
              <strong>{fmt(slots[hover].totalPaid)} avoided</strong>
              <span>{slots[hover].year} — payments you skip</span>
            </>
          ) : (
            <>
              <strong>{fmt(slots[hover].principal)} principal · {fmt(slots[hover].interest)} interest</strong>
              <span>{slots[hover].year} · balance after: {fmt(slots[hover].endBalance)}</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
