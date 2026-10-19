import React, { useMemo } from 'react'

import { singleP } from '../calc/probability'

/*
  概率曲线。

  回答的是「刷 n 次时成功多少」，与表里的分位数互补。
  刻意用 currentColor 画线和文字：poi 有深/浅两套主题，
  硬编码颜色一定有一套看不清（旧实现就是这个毛病）。
*/

const WIDTH = 300
const HEIGHT = 96
const PAD = { left: 30, right: 8, top: 8, bottom: 16 }
const STEPS = 120

const fmtAxis = v => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(Math.round(v)))

const ProbabilityChart = ({ q, nTarget, target, width = WIDTH, height = HEIGHT }) => {
  const geometry = useMemo(() => {
    const finite = Number.isFinite(nTarget) && nTarget > 0
    const nMax = finite ? Math.max(20, Math.ceil(nTarget * 1.5)) : 100
    const plotW = width - PAD.left - PAD.right
    const plotH = height - PAD.top - PAD.bottom

    const toX = n => PAD.left + (n / nMax) * plotW
    const toY = p => height - PAD.bottom - p * plotH

    let path = ''
    for (let i = 0; i <= STEPS; i++) {
      const n = (i / STEPS) * nMax
      const x = toX(n)
      const y = toY(singleP(q, n))
      path += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    }

    return {
      path,
      nMax,
      toX,
      toY,
      marker: finite ? { x: toX(nTarget), y: toY(singleP(q, nTarget)) } : null,
      gridY: [0, 0.5, 1].map(p => ({ p, y: toY(p) })),
    }
  }, [q, nTarget, width, height])

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label="probability curve"
      style={{ color: 'inherit', display: 'block' }}
    >
      {geometry.gridY.map(({ p, y }) => (
        <g key={p}>
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={y}
            y2={y}
            stroke="currentColor"
            strokeOpacity={p === 0 ? 0.35 : 0.12}
            strokeDasharray={p === 0 ? '' : '3 3'}
          />
          <text x={PAD.left - 4} y={y + 3} textAnchor="end" fontSize="8" fill="currentColor" fillOpacity="0.55">
            {Math.round(p * 100)}%
          </text>
        </g>
      ))}

      <path d={geometry.path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeOpacity="0.9" />

      {geometry.marker ? (
        <g>
          <line
            x1={geometry.marker.x}
            x2={geometry.marker.x}
            y1={PAD.top}
            y2={height - PAD.bottom}
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeDasharray="2 3"
          />
          <circle cx={geometry.marker.x} cy={geometry.marker.y} r="2.6" fill="currentColor" />
        </g>
      ) : null}

      <text x={PAD.left} y={height - 4} fontSize="8" fill="currentColor" fillOpacity="0.55">
        0
      </text>
      <text
        x={width - PAD.right}
        y={height - 4}
        textAnchor="end"
        fontSize="8"
        fill="currentColor"
        fillOpacity="0.55"
      >
        {fmtAxis(geometry.nMax)} 次
      </text>
      {geometry.marker && Number.isFinite(target) ? (
        <text
          x={Math.min(width - PAD.right, geometry.marker.x + 4)}
          y={Math.max(PAD.top + 6, geometry.marker.y - 4)}
          fontSize="8"
          fill="currentColor"
          fillOpacity="0.75"
        >
          {Math.round(target * 100)}%
        </text>
      ) : null}
    </svg>
  )
}

export { ProbabilityChart }
