import React, { useMemo } from 'react'

/*
  多条期望曲线叠在一张图上（每个点位一条）。

  颜色：这是整个项目唯一硬编码的颜色。多序列必须有可区分的色相，
  而 Blueprint 没有导出可编程的配色 API；这里用的是它调色板里的中调色
  （blue3 / orange3 / green3 / violet3 / red3 / turquoise3），
  深色与浅色背景上都读得清。其余所有线条与文字仍走 currentColor。
*/
const PALETTE = ['#4C90F0', '#D9822B', '#29A634', '#9D6EE0', '#C23030', '#00A396']

const WIDTH = 360
const HEIGHT = 176
const PAD = { left: 46, right: 10, top: 10, bottom: 22 }

const EXPECT_UPPER = 0.99

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

    const paths = series.map(item => {
      const d = item.values
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${toX(point.t).toFixed(1)},${toY(point.value).toFixed(1)}`)
        .join('')
      return d
    })

    return { tMin, tMax, yMax, toX, toY, paths, plotW, plotH }
  }, [series])

  if (!geometry) {
    return null
  }

  const gridValues = [0, 0.5, 1].map(ratio => ({ ratio, value: geometry.yMax * ratio }))

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>
        {series.map((item, index) => (
          <span key={item.pointId} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: 2,
                background: PALETTE[index % PALETTE.length],
              }}
            />
            <span style={{ fontSize: 11 }}>{item.label}</span>
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        role="img"
        aria-label="expectation curves"
        style={{ display: 'block', color: 'inherit' }}
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
                x={PAD.left - 4}
                y={y + 3}
                textAnchor="end"
                fontSize="8"
                fill="currentColor"
                fillOpacity="0.55"
              >
                {format(value)}
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
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        ))}

        {probTarget >= geometry.tMin && probTarget <= geometry.tMax ? (
          <line
            x1={geometry.toX(probTarget)}
            x2={geometry.toX(probTarget)}
            y1={PAD.top}
            y2={HEIGHT - PAD.bottom}
            stroke="currentColor"
            strokeOpacity="0.3"
            strokeDasharray="2 3"
          />
        ) : null}

        {[geometry.tMin, 0.5, EXPECT_UPPER].map((t, index) => {
          if (t < geometry.tMin || t > geometry.tMax) {
            return null
          }
          return (
            <text
              key={index}
              x={geometry.toX(t)}
              y={HEIGHT - 6}
              textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}
              fontSize="8"
              fill="currentColor"
              fillOpacity="0.55"
            >
              {Math.round(t * 100)}%
            </text>
          )
        })}
      </svg>
    </div>
  )
}

export { ExpectCurveChart, PALETTE }
