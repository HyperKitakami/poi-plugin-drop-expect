import React from 'react'
import { Callout, Card, Classes, Divider, Tag } from '@blueprintjs/core'

import { RESOURCE_LABEL, costLine, fmtBucket, fmtCount, fmtPercent } from './format'
import { resolveShipName } from './selectors'
import { t } from './i18n'

/*
  结果表。

  single 口径按目标舰分组（每艘船一组，组内是各点位对比，D8）；
  anyOf / all 是集合口径，以点位为单位一行。

  资源列展示的是「刷到目标次数后还剩多少」，负数标红——
  比「总共要花多少」更直接：一眼能看出哪项会先见底。
*/

const DANGER = Classes.TEXT_DANGER || 'bp6-text-danger'
const MUTED = 'bp6-text-muted'
const ORDER = ['fuel', 'ammo', 'steel', 'bauxite', 'bucket']

const fmtSigned = (value, key) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—'
  }
  const abs = Math.abs(value)
  const text =
    key === 'bucket'
      ? fmtBucket(abs)
      : abs >= 10000
        ? `${(abs / 10000).toFixed(1)}万`
        : Math.round(abs).toLocaleString('zh-CN')
  return value < 0 ? `-${text}` : text
}

const RemainingCell = ({ remaining, total }) => {
  if (!remaining) {
    return <span className={MUTED}>—</span>
  }
  return (
    <div>
      <div>
        {ORDER.map((key, index) => (
          <span key={key} className={remaining[key] < 0 ? DANGER : undefined}>
            {index > 0 ? <span className={MUTED}> / </span> : null}
            {RESOURCE_LABEL[key]} {fmtSigned(remaining[key], key)}
          </span>
        ))}
      </div>
      {total ? (
        <div className={MUTED} style={{ fontSize: 11 }}>
          {t('Total spent', '共消耗')} {costLine(total)}
        </div>
      ) : null}
    </div>
  )
}

const SortieCell = ({ row }) => (
  <span>
    <b>{fmtCount(row.n)}</b>
    {row.expected != null && Number.isFinite(row.expected) ? (
      <span className={MUTED} style={{ fontSize: 11, marginLeft: 4 }}>
        {t('avg', '平均')} {fmtCount(Math.round(row.expected))}
      </span>
    ) : null}
  </span>
)

const ReverseCell = ({ reverse }) => {
  if (!reverse) {
    return <span className={MUTED}>—</span>
  }
  return (
    <span className={MUTED} style={{ fontSize: 11 }}>
      {t('at most', '最多')} {fmtCount(reverse.n)} {t('sorties', '次')} → {fmtPercent(reverse.prob, 1)}
      {reverse.bottleneck ? `（${RESOURCE_LABEL[reverse.bottleneck]}）` : ''}
    </span>
  )
}

const ReasonText = ({ row }) =>
  row.reason === 'incomplete-set'
    ? t('Incomplete set', `有 ${row.missing.length} 艘目标舰未填写掉落率，无法集齐`)
    : row.reason === 'too-many-targets'
      ? t('Too many targets', '目标超过 12 艘，无法精确计算')
      : t('No rate', '该点位没有填写掉落率')

const ShipGroup = ({ group, masterShips }) => {
  const best = group.rows[0]
  return (
    <Card style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b>{resolveShipName(masterShips, group.shipId)}</b>
        <Tag minimal>
          {group.rows.length} {t('points', '个点位')}
        </Tag>
        {best && Number.isFinite(best.n) ? (
          <Tag minimal intent="primary">
            {t('best', '最优')} {best.label} · {fmtCount(best.n)} {t('sorties', '次')}
          </Tag>
        ) : null}
      </div>
      <Divider style={{ margin: '8px 0' }} />
      <table className="bp6-html-table bp6-html-table-condensed" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>{t('Point', '点位')}</th>
            <th>{t('Drop rate', '掉落率')}</th>
            <th>{t('Sorties', '所需次数')}</th>
            <th>{t('Remaining', '剩余资源')}</th>
            <th>{t('Reverse', '反算')}</th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map(row => (
            <tr key={row.pointId}>
              <td>
                {row.label}
                {row.rank !== 'SAB' ? (
                  <Tag minimal style={{ marginLeft: 4 }}>
                    {row.rank}
                  </Tag>
                ) : null}
                {row.reachRate < 1 ? (
                  <span className={MUTED} style={{ fontSize: 11, marginLeft: 4 }}>
                    {t('reach', '到达')} {fmtPercent(row.reachRate, 0)}
                  </span>
                ) : null}
              </td>
              <td>{fmtPercent(row.rate)}</td>
              <td>
                <SortieCell row={row} />
              </td>
              <td>
                <RemainingCell remaining={row.remaining} total={row.total} />
              </td>
              <td>
                <ReverseCell reverse={row.reverse} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

const SetTable = ({ rows }) => (
  <Card style={{ marginTop: 8 }}>
    <table className="bp6-html-table bp6-html-table-condensed" style={{ width: '100%' }}>
      <thead>
        <tr>
          <th>{t('Point', '点位')}</th>
          <th>{t('Sorties', '所需次数')}</th>
          <th>{t('Remaining', '剩余资源')}</th>
          <th>{t('Reverse', '反算')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row =>
          row.reason ? (
            <tr key={row.pointId}>
              <td>{row.label}</td>
              <td colSpan={3} className={MUTED}>
                <ReasonText row={row} />
              </td>
            </tr>
          ) : (
            <tr key={row.pointId}>
              <td>
                {row.label}
                {row.rank !== 'SAB' ? (
                  <Tag minimal style={{ marginLeft: 4 }}>
                    {row.rank}
                  </Tag>
                ) : null}
                {row.missing && row.missing.length > 0 ? (
                  <Tag minimal intent="warning" style={{ marginLeft: 4 }}>
                    {row.missing.length} {t('ships without rate', '艘未填率')}
                  </Tag>
                ) : null}
              </td>
              <td>
                <SortieCell row={row} />
              </td>
              <td>
                <RemainingCell remaining={row.remaining} total={row.total} />
              </td>
              <td>
                <ReverseCell reverse={row.reverse} />
              </td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  </Card>
)

const ResultTable = ({ report, masterShips }) => {
  const empty = report.mode === 'single' ? report.groups.length === 0 : report.rows.length === 0

  if (empty) {
    return (
      <Callout intent="none" style={{ marginTop: 8 }}>
        {t(
          'Nothing to compute',
          '还没有可计算的数据：需要至少一个填好海域/格子的点位、一艘目标舰，以及该点位上的掉落率。',
        )}
      </Callout>
    )
  }

  if (report.mode === 'single') {
    return (
      <div>
        {report.groups.map(group => (
          <ShipGroup key={group.shipId} group={group} masterShips={masterShips} />
        ))}
      </div>
    )
  }

  return <SetTable rows={report.rows} />
}

export { ResultTable }
