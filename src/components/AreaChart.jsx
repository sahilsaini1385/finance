import React, { useRef, useState } from 'react'
import { fmt } from '../store.jsx'

// Minimal SVG area chart: one series, smooth Catmull-Rom curve, gradient fill,
// soft under-glow, animated draw-in, endpoint dot, hover crosshair + tooltip.
// points: [{x: label, value: number}]

// Catmull-Rom → cubic bezier. Control-point Ys are clamped to the plot area so
// the interpolation can't overshoot above/below the real data envelope.
function smoothPath(pts, yMin, yMax) {
  if (pts.length < 3) return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.X.toFixed(1)},${p.Y.toFixed(1)}`).join(' ')
  const cy = v => Math.max(yMin, Math.min(yMax, v))
  let d = `M${pts[0].X.toFixed(1)},${pts[0].Y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1x = p1.X + (p2.X - p0.X) / 6
    const c1y = cy(p1.Y + (p2.Y - p0.Y) / 6)
    const c2x = p2.X - (p3.X - p1.X) / 6
    const c2y = cy(p2.Y - (p3.Y - p1.Y) / 6)
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.X.toFixed(1)},${p2.Y.toFixed(1)}`
  }
  return d
}

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

  const pts = points.map((p, i) => ({ X: x(i), Y: y(p.value) }))
  const line = smoothPath(pts, 2, H - 2)
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
        <path className="area-fill" d={area} fill={`url(#${id}-fill)`} />
        <path d={line} fill="none" stroke="var(--series-1)" strokeWidth="6" opacity="0.12" vectorEffect="non-scaling-stroke" />
        <path className="area-line" d={line} pathLength="1" fill="none" stroke="var(--series-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
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
