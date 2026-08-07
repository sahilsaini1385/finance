import React, { useRef, useState } from 'react'
import { fmt } from '../store.jsx'

// Minimal SVG area chart: one series, gradient fill, endpoint dot, hover
// crosshair + tooltip. points: [{x: label, value: number}]
export default function AreaChart({ points, height = 140, id = 'ac', marker = null }) {
  const wrapRef = useRef(null)
  const [hover, setHover] = useState(null)
  if (!points || points.length < 2) return null

  const W = 600
  const H = height
  const PAD_Y = 12
  const values = points.map(p => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = i => (i / (points.length - 1)) * W
  const y = v => H - PAD_Y - ((v - min) / span) * (H - PAD_Y * 2)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const last = points[points.length - 1]

  const onMove = e => {
    const rect = wrapRef.current.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    setHover(Math.round(frac * (points.length - 1)))
  }

  return (
    <div
      ref={wrapRef}
      className="area-chart"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      role="img"
      aria-label={`Chart from ${points[0].x} (${fmt(points[0].value)}) to ${last.x} (${fmt(last.value)})`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${id}-fill)`} />
        <path d={line} fill="none" stroke="var(--series-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {marker !== null && marker >= 0 && marker < points.length && (
          <line
            x1={x(marker)} x2={x(marker)} y1={PAD_Y / 2} y2={H}
            stroke="var(--good)" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke"
          />
        )}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--border-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
        <circle
          cx={x(hover !== null ? hover : points.length - 1)}
          cy={y(points[hover !== null ? hover : points.length - 1].value)}
          r="4"
          fill="var(--series-1)"
          stroke="var(--surface)"
          strokeWidth="2"
        />
      </svg>
      {hover !== null && (
        <div
          className="chart-tip"
          style={{ left: `${(hover / (points.length - 1)) * 100}%` }}
        >
          <strong>{fmt(points[hover].value)}</strong>
          <span>{points[hover].x}</span>
        </div>
      )}
    </div>
  )
}
