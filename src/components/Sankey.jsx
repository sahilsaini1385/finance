import React from 'react'
import { fmt } from '../store.jsx'

// Cash-flow Sankey (the Monarch-style "where did the money go" picture).
// Ribbon width encodes dollars; identity is carried by a direct label on
// every node (name + amount in text tokens), so color stays decorative:
// income/saved use series-1/good, spending uses series-2.

const W = 760
const NODE_W = 20
const LEFT_X = 8
const RIGHT_X = 508
const LABEL_X = RIGHT_X + NODE_W + 10
const GAP = 4
const PAD_TOP = 26

function ribbonPath(x1, y1, x2, y2, h) {
  const mx = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2} L ${x2} ${y2 + h} C ${mx} ${y2 + h}, ${mx} ${y1 + h}, ${x1} ${y1 + h} Z`
}

export default function Sankey({ income, byCat }) {
  const spendEntries = Object.entries(byCat || {}).sort((a, b) => b[1] - a[1])
  const spend = spendEntries.reduce((s, [, v]) => s + v, 0)
  if (income <= 0 || spend <= 0) return null

  const top = spendEntries.slice(0, 7)
  const rest = spendEntries.slice(7)
  const restTotal = rest.reduce((s, [, v]) => s + v, 0)
  const right = top.map(([c, v]) => ({ label: c, value: v, kind: 'spend' }))
  if (restTotal > 0.5) right.push({ label: `${rest.length} other categories`, value: restTotal, kind: 'spend' })
  const saved = income - spend
  if (saved > 0.5) right.push({ label: 'Saved', value: saved, kind: 'saved' })

  const left = [{ label: 'Income', value: income, kind: 'income' }]
  if (spend > income + 0.5) left.push({ label: 'From savings', value: spend - income, kind: 'draw' })

  const total = Math.max(income, spend)
  const innerH = Math.min(380, Math.max(200, right.length * 40))
  const H = PAD_TOP + innerH + 8
  const usableR = innerH - GAP * (right.length - 1)
  const usableL = innerH - GAP * (left.length - 1)
  const scaleR = usableR / total
  const scaleL = usableL / total

  let y = PAD_TOP
  for (const n of left) {
    n.h = Math.max(3, n.value * scaleL)
    n.y = y
    n.flowY = y // running offset for ribbons leaving this node
    y += n.h + GAP
  }
  y = PAD_TOP
  for (const n of right) {
    n.h = Math.max(3, n.value * scaleR)
    n.y = y
    y += n.h + GAP
  }

  // Stagger right-side labels so small adjacent nodes never overlap: each
  // label sits at its node's center unless the previous label is too close.
  let lastLabelY = PAD_TOP - 12
  for (const n of right) {
    const want = n.y + Math.min(n.h / 2 + 4, 14)
    n.labelY = Math.max(want, lastLabelY + 17)
    lastLabelY = n.labelY
  }
  const H2 = Math.max(H, lastLabelY + 12)

  // Ribbons: fill each right node from the left column top-down, splitting
  // across Income / From savings as one runs out.
  const ribbons = []
  let li = 0
  for (const n of right) {
    let remaining = n.h
    let ty = n.y
    while (remaining > 0.01 && li < left.length) {
      const src = left[li]
      const avail = src.y + src.h - src.flowY
      const h = Math.min(remaining, avail)
      if (h > 0.01) {
        ribbons.push({ y1: src.flowY, y2: ty, h, kind: n.kind, label: n.label, value: n.value })
        src.flowY += h
        ty += h
        remaining -= h
      }
      if (src.y + src.h - src.flowY < 0.02) li++
    }
  }

  const fill = kind => (kind === 'saved' ? 'var(--good)' : kind === 'spend' ? 'var(--series-2)' : 'var(--series-1)')

  return (
    <div className="sankey-wrap">
      <svg viewBox={`0 0 ${W} ${H2}`} style={{ width: '100%', minWidth: 620, display: 'block' }} role="img"
        aria-label="Cash flow: income on the left flowing to spending categories and savings on the right">
        {ribbons.map((r, i) => (
          <path key={i} d={ribbonPath(LEFT_X + NODE_W, r.y1, RIGHT_X, r.y2, r.h)} fill={fill(r.kind)} opacity="0.28">
            <title>{r.label} — {fmt(r.value)}</title>
          </path>
        ))}
        {left.map(n => (
          <g key={n.label}>
            <rect x={LEFT_X} y={n.y} width={NODE_W} height={n.h} rx="3" fill={fill(n.kind)}>
              <title>{n.label} — {fmt(n.value)}</title>
            </rect>
            <text x={LEFT_X} y={n.y - 8} fontSize="12.5" fill="var(--text)" fontWeight="600">
              {n.label} <tspan fill="var(--text-2)" fontWeight="400">{fmt(n.value)}</tspan>
            </text>
          </g>
        ))}
        {right.map(n => (
          <g key={n.label}>
            <rect x={RIGHT_X} y={n.y} width={NODE_W} height={n.h} rx="3" fill={fill(n.kind)}>
              <title>{n.label} — {fmt(n.value)}</title>
            </rect>
            {n.labelY - (n.y + n.h / 2) > 9 && (
              <line x1={RIGHT_X + NODE_W + 2} y1={n.y + n.h / 2} x2={LABEL_X - 3} y2={n.labelY - 4}
                stroke="var(--grid)" strokeWidth="1" />
            )}
            <text x={LABEL_X} y={n.labelY} fontSize="12.5" fill="var(--text)" fontWeight="600">
              {n.label} <tspan fill="var(--text-2)" fontWeight="400">{fmt(n.value)}</tspan>
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
