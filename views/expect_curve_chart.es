import React, { useMemo } from 'react'

/*
  多条期望曲线叠在一张图上（每个点位一条）。

  尺寸按「看得清」定：viewBox 560×300，配合 width:100% / height:auto，
  在侧栏里会按容器宽度等比放大，而不是固定 360×176 那种缩略图。

  竖虚线画三条：50%、90%、当前期望（设定值与前两者重合时只画一条）。
  标签**只标在横轴刻度上**，不跟在虚线旁边——
  跟在旁边时，自定义值（比如 93%）的标签会和 90% 的标签挤在一起。
  自定义值本身在页面顶部的标签里已经有了，图上不必重复。

  颜色：这是整个项目唯一硬编码的颜色。多序列必须有可区分的色相，
  而 Blueprint 没有导出可编程的配色 API；这里用的是它调色板里的中调色
  （blue3 / orange3 / green3 / violet3 / red3 / turquoise3），
  深色与浅色背景上都读得清。其余所有线条与文字仍走 currentColor。
*/
const PALETTE = ['#4C90F0', '#D9822B', '#29A634', '#9D6EE0', '#C23030', '#00A396']

const WIDTH = 560
const HEIGHT = 300
const PAD = { left: 60, right: 16, top: 16, bottom: 34 }
const BASE_GUIDES = [0.5, 0.9]

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

    // 虚线：50%、90% 是参考，当前期望加粗；同一位置只留一条（加粗优先）
    const guideMap = new Map()
    for (const guide of [...BASE_GUIDES.map(t => ({ t, strong: false })), { t: probTarget, strong: true }]) {
      if (!(guide.t > tMin && guide.t < tMax)) {
        continue
      }
      const key = guide.t.toFixed(4)
      const previous = guideMap.get(key)
      if (!previous || guide.strong) {
        guideMap.set(key, { t: guide.t, strong: !!guide.strong })
      }
    }

    // 横轴刻度：两端 + 50% / 90%。标签放这里，远离虚线
    const tickMap = new Map()
    for (const t of [tMin, ...BASE_GUIDES, tMax]) {
      if (t < tMin - 1e-9 || t > tMax + 1e-9) {
        continue
      }
      tickMap.set(t.toFixed(4), t)
    }
    const ticks = [...tickMap.values()].sort((a, b) => a - b)

    return { tMin, tMax, yMax, toX, toY, paths, guides: [...guideMap.values()], ticks }
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
              <text
                x={PAD.left - 6}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="currentColor"
                fillOpacity="0.55"
              >
                {format(value)}
              </text>
            </g>
          )
        })}

        {geometry.guides.map(guide => {
          const x = geometry.toX(guide.t)
          return (
            <line
              key={guide.t}
              x1={x}
              x2={x}
              y1={PAD.top}
              y2={axisY}
              stroke="currentColor"
              strokeOpacity={guide.strong ? 0.45 : 0.18}
              strokeDasharray={guide.strong ? '5 4' : '3 4'}
            />
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

        {geometry.ticks.map(t => {
          const x = geometry.toX(t)
          const anchor = Math.abs(t - geometry.tMin) < 1e-9 ? 'start' : Math.abs(t - geometry.tMax) < 1e-9 ? 'end' : 'middle'
          return (
            <g key={t}>
              <line x1={x} x2={x} y1={axisY} y2={axisY + 4} stroke="currentColor" strokeOpacity="0.35" />
              <text
                x={x}
                y={axisY + 16}
                textAnchor={anchor}
                fontSize="10"
                fill="currentColor"
                fillOpacity="0.55"
              >
                {Math.round(t * 100)}%
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export { ExpectCurveChart, PALETTE }
