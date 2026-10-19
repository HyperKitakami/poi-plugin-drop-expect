import React, { useMemo } from 'react'

/*
  多条期望曲线叠在一张图上（每个点位一条）。

  尺寸按「看得清」定：viewBox 560×300，配合 width:100% / height:auto，
  在侧栏里会按容器宽度等比放大，而不是固定 360×176 那种缩略图。

  竖虚线标三个位置：50%、90%，以及当前设定的期望（设定值与前者重合时只画一条）。

  颜色：这是整个项目唯一硬编码的颜色。多序列必须有可区分的色相，
  而 Blueprint 没有导出可编程的配色 API；这里用的是它调色板里的中调色
  （blue3 / orange3 / green3 / violet3 / red3 / turquoise3），
  深色与浅色背景上都读得清。其余所有线条与文字仍走 currentColor。
*/
const PALETTE = ['#4C90F0', '#D9822B', '#29A634', '#9D6EE0', '#C23030', '#00A396']

const WIDTH = 560
const HEIGHT = 300
const PAD = { left: 60, right: 16, top: 16, bottom: 32 }
const BASE_GUIDES = [0.5, 0.9]
// 设定值与固定参考线离得太近时不再重复画
const SAME_GUIDE = 0.004

const ExpectCurveChart = ({ series, format, probTarget = 0.9 }) => {
  const geometry = useMemo(() => {
    if (!series || series.length === 0) {
      return null
    }
    const first = series[0].values
    const tMin = first[0].t
    const tMax = first[first.length - 1].t
    let yMax = 0
    for (const item of series) {
      for (const point of item.values) {
        if (point.value > yMax) {
          yMax = point.value
        }
      }
    }
    if (!(yMax > 0)) {
      yMax = 1
    }

    const plotW = WIDTH - PAD.left - PAD.right
    const plotH = HEIGHT - PAD.top - PAD.bottom
    const toX = t => PAD.left + ((t - tMin) / (tMax - tMin || 1)) * plotW
    const toY = v => HEIGHT - PAD.bottom - (v / yMax) * plotH

    const paths = series.map(item =>
      item.values
        .map(
          (point, index) =>
            `${index === 0 ? 'M' : 'L'}${toX(point.t).toFixed(1)},${toY(point.value).toFixed(1)}`,
        )
        .join(''),
    )

    const guides = BASE_GUIDES.filter(t => Math.abs(t - probTarget) > SAME_GUIDE).map(t => ({
      t,
      label: `${Math.round(t * 100)}%`,
      strong: false,
    }))
    if (probTarget > 0 && probTarget < 1) {
      guides.push({ t: probTarget, label: `期望 ${Math.round(probTarget * 100)}%`, strong: true })
    }

    return { tMin, tMax, yMax, toX, toY, paths, guides, plotW, plotH }
  }, [series, probTarget])

  if (!geometry) {
    return null
  }

  const axisY = HEIGHT - PAD.bottom
  const gridValues = [0, 0.5, 1].map(ratio => ({ ratio, value: geometry.yMax * ratio }))

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
        {series.map((item, index) => (
          <span key={item.pointId} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: 2,
                background: PALETTE[index % PALETTE.length],
              }}
            />
            <span style={{ fontSize: 12 }}>{item.label}</span>
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="expectation curves"
        style={{ display: 'block', width: '100%', height: 'auto', color: 'inherit' }}
      >
        {gridValues.map(({ ratio, value }) => {
          const y = geometry.toY(value)
          return (
            <g key={ratio}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity={ratio === 0 ? 0.35 : 0.12}
                strokeDasharray={ratio === 0 ? '' : '3 3'}
              />
              <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity="0.55">
                {format(value)}
              </text>
            </g>
          )
        })}

        {geometry.guides.map(guide => {
          const x = geometry.toX(guide.t)
          if (x < PAD.left || x > WIDTH - PAD.right) {
            return null
          }
          const anchor = x > WIDTH - 80 ? 'end' : 'start'
          return (
            <g key={guide.label}>
              <line
                x1={x}
                x2={x}
                y1={PAD.top}
                y2={axisY}
                stroke="currentColor"
                strokeOpacity={guide.strong ? 0.45 : 0.2}
                strokeDasharray={guide.strong ? '5 4' : '3 4'}
              />
              <text
                x={anchor === 'end' ? x - 4 : x + 4}
                y={axisY - 6}
                textAnchor={anchor}
                fontSize="9"
                fill="currentColor"
                fillOpacity={guide.strong ? 0.75 : 0.5}
              >
                {guide.label}
              </text>
            </g>
          )
        })}

        {series.map((item, index) => (
          <path
            key={item.pointId}
            d={geometry.paths[index]}
            fill="none"
            stroke={PALETTE[index % PALETTE.length]}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
        ))}

        <text x={PAD.left} y={axisY + 16} fontSize="10" fill="currentColor" fillOpacity="0.55">
          {Math.round(geometry.tMin * 100)}%
        </text>
        <text
          x={WIDTH - PAD.right}
          y={axisY + 16}
          textAnchor="end"
          fontSize="10"
          fill="currentColor"
          fillOpacity="0.55"
        >
          {Math.round(geometry.tMax * 100)}%
        </text>
      </svg>
    </div>
  )
}

export { ExpectCurveChart, PALETTE }
