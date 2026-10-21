import React, { useMemo, useState } from 'react'
import { Callout, Divider, HTMLSelect, Tag } from '@blueprintjs/core'

import { buildExpectCurves } from '../calc/curve'
import { singleN } from '../calc/probability'
import { ExpectCurveChart, PALETTE } from './expect_curve_chart'
import { fmtAmount, fmtBucket, fmtCount, fmtPercent } from './format'
import { resolveShipName } from './selectors'
import { t } from './i18n'

const Y_OPTIONS = [
  { key: 'n', label: '次数' },
  { key: 'fuel', label: '油' },
  { key: 'ammo', label: '弹' },
  { key: 'steel', label: '钢' },
  { key: 'bauxite', label: '铝' },
  { key: 'bucket', label: '桶' },
]

const formatFor = key => {
  if (key === 'n') {
    return value => fmtCount(Math.round(value))
  }
  if (key === 'bucket') {
    return value => fmtBucket(value)
  }
  return value => fmtAmount(value)
}

const valueAt = (item, yKey, probTarget) => {
  if (!item) {
    return null
  }
  const n = singleN(item.q, probTarget)
  if (!Number.isFinite(n)) {
    return null
  }
  return yKey === 'n' ? n : n * ((item.per && item.per[yKey]) || 0)
}

const formatValue = (yKey, value) => {
  if (value == null) {
    return '—'
  }
  if (yKey === 'n') {
    return `${fmtCount(value)} ${t('sorties', '次')}`
  }
  if (yKey === 'bucket') {
    return fmtBucket(value)
  }
  return fmtAmount(value)
}

const CurvePanel = ({ targets, points, masterShips, probTarget }) => {
  const [pickedShipId, setPickedShipId] = useState(null)
  const [yKey, setYKey] = useState('n')

  const activeShipId =
    pickedShipId != null && targets.some(item => item.shipId === pickedShipId)
      ? pickedShipId
      : (targets[0] && targets[0].shipId) || null

  const series = useMemo(
    () => (activeShipId == null ? [] : buildExpectCurves({ points, shipId: activeShipId, yKey })),
    [points, activeShipId, yKey],
  )

  if (targets.length === 0) {
    return (
      <Callout intent="none">
        {t('Curve no target', '先在「点位与目标舰」页添加目标舰，再回来看曲线。')}
      </Callout>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ minWidth: 150 }}>
          <div className="bp6-text-muted" style={{ fontSize: 11, marginBottom: 2 }}>
            {t('Target ship', '目标舰')}
          </div>
          <HTMLSelect
            value={activeShipId == null ? '' : String(activeShipId)}
            onChange={e => setPickedShipId(Number(e.target.value))}
            fill
          >
            {targets.map(item => (
              <option key={item.shipId} value={item.shipId}>
                {resolveShipName(masterShips, item.shipId)}
              </option>
            ))}
          </HTMLSelect>
        </div>

        <div style={{ minWidth: 110 }}>
          <div className="bp6-text-muted" style={{ fontSize: 11, marginBottom: 2 }}>
            {t('Y axis', '纵轴')}
          </div>
          <HTMLSelect value={yKey} onChange={e => setYKey(e.target.value)}>
            {Y_OPTIONS.map(option => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </HTMLSelect>
        </div>

        <Tag minimal style={{ marginBottom: 6 }}>
          {t('confidence', '把握')} {fmtPercent(probTarget, 0)}
        </Tag>
      </div>

      <Divider style={{ margin: '10px 0' }} />

      {series.length === 0 ? (
        <Callout intent="warning">
          {t('Curve no rate', '这艘船还没有任何点位填写掉落率，无法画曲线。')}
        </Callout>
      ) : (
        <>
          <ExpectCurveChart series={series} format={formatFor(yKey)} probTarget={probTarget} />

          <table className="bp6-html-table bp6-html-table-condensed" style={{ width: '100%', marginTop: 8 }}>
            <thead>
              <tr>
                <th>{t('Point', '点位')}</th>
                <th>{Y_OPTIONS.find(option => option.key === yKey).label}</th>
              </tr>
            </thead>
            <tbody>
              {series.map((item, index) => (
                <tr key={item.pointId}>
                  <td>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        marginRight: 6,
                        background: PALETTE[index % PALETTE.length],
                      }}
                    />
                    {item.label}
                  </td>
                  <td>{formatValue(yKey, valueAt(item, yKey, probTarget))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="bp6-text-muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.6 }}>
            {t(
              'Curve note',
              '横轴是目标把握，纵轴是达到该把握所需的量；竖虚线是当前把握。',
            )}
          </div>
        </>
      )}
    </div>
  )
}

export { CurvePanel, Y_OPTIONS }
