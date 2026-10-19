import React, { useState } from 'react'
import { Button, Card, Callout, Divider, Tag } from '@blueprintjs/core'

import { RESOURCE_LABEL, costLine, fmtCount, fmtPercent } from './format'
import { ProbabilityChart } from './probability_chart'
import { resolveShipName } from './selectors'
import { t } from './i18n'

/*
  结果表。

  single 口径按目标舰分组（每艘船一组，组内是各点位对比，D8）；
  anyOf / all 是集合口径，以点位为单位一行。
*/

const BudgetCell = ({ budget }) => {
  if (!budget) {
    return <span className="bp6-text-muted">—</span>
  }
  if (budget.ok) {
    return (
      <Tag minimal intent="success">
        {t('affordable', '够')}
      </Tag>
    )
  }
  const worst = Object.entries(budget.shortfall).sort((a, b) => b[1] - a[1])[0]
  return (
    <Tag minimal intent="danger">
      {t('short', '缺')}
      {RESOURCE_LABEL[worst[0]]} {fmtShort(worst[1])}
    </Tag>
  )
}

/** 缺口只显示一个数，不和五项消耗挤在一起 */
const fmtShort = v => {
  if (!Number.isFinite(v)) {
    return ''
  }
  return v >= 10000 ? `${(v / 10000).toFixed(1)}万` : Math.round(v).toLocaleString('zh-CN')
}

const ReverseCell = ({ reverse }) => {
  if (!reverse) {
    return <span className="bp6-text-muted">—</span>
  }
  return (
    <span className="bp6-text-muted" style={{ fontSize: 11 }}>
      {t('at most', '最多')} {fmtCount(reverse.n)} {t('sorties', '次')} → {fmtPercent(reverse.prob, 1)}
      {reverse.bottleneck ? `（${RESOURCE_LABEL[reverse.bottleneck]}）` : ''}
    </span>
  )
}

const SortieCell = ({ row }) => (
  <span>
    <b>{fmtCount(row.n)}</b>
    {row.expected != null && Number.isFinite(row.expected) ? (
      <span className="bp6-text-muted" style={{ fontSize: 11, marginLeft: 4 }}>
        {t('avg', '平均')} {fmtCount(Math.round(row.expected))}
      </span>
    ) : null}
  </span>
)

const CostCell = ({ row }) => (
  <span>
    <span>{costLine(row.total, { zeroDash: true })}</span>
    {row.per ? (
      <span className="bp6-text-muted" style={{ fontSize: 11, marginLeft: 4 }}>
        ×{costLine(row.per)}
      </span>
    ) : null}
  </span>
)

const ShipGroup = ({ group, masterShips, probTarget }) => {
  const best = group.rows[0]
  const [showCurve, setShowCurve] = useState(false)
  const canDrawCurve = !!best && Number.isFinite(best.n) && best.q > 0

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
        {canDrawCurve ? (
          <Button
            small
            minimal
            rightIcon={showCurve ? 'chevron-up' : 'chevron-down'}
            style={{ marginLeft: 'auto' }}
            onClick={() => setShowCurve(v => !v)}
          >
            {t('Curve', '概率曲线')}
          </Button>
        ) : null}
      </div>
      <Divider style={{ margin: '8px 0' }} />
      <table className="bp6-html-table bp6-html-table-condensed" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>{t('Point', '点位')}</th>
            <th>{t('Drop rate', '掉落率')}</th>
            <th>{t('Sorties', '所需次数')}</th>
            <th>{t('Total cost', '总消耗')}</th>
            <th>{t('Budget', '资源')}</th>
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
                  <span className="bp6-text-muted" style={{ fontSize: 11, marginLeft: 4 }}>
                    {t('reach', '到达')} {fmtPercent(row.reachRate, 0)}
                  </span>
                ) : null}
              </td>
              <td>{fmtPercent(row.rate)}</td>
              <td>
                <SortieCell row={row} />
              </td>
              <td>
                <CostCell row={row} />
              </td>
              <td>
                <BudgetCell budget={row.budget} />
              </td>
              <td>
                <ReverseCell reverse={row.reverse} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showCurve && canDrawCurve ? (
        <div style={{ marginTop: 8 }}>
          <ProbabilityChart q={best.q} nTarget={best.n} target={probTarget} />
          <div className="bp6-text-muted" style={{ fontSize: 11, textAlign: 'center' }}>
            {t('Curve hint', '横轴为出击次数，纵轴为至少获得一艘的概率（按最优点位）')}
          </div>
        </div>
      ) : null}
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
          <th>{t('Total cost', '总消耗')}</th>
          <th>{t('Budget', '资源')}</th>
          <th>{t('Reverse', '反算')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row =>
          row.reason ? (
            <tr key={row.pointId}>
              <td>{row.label}</td>
              <td colSpan={4} className="bp6-text-muted">
                {row.reason === 'incomplete-set'
                  ? t('Incomplete set', `有 ${row.missing.length} 艘目标舰未填写掉落率，无法集齐`)
                  : row.reason === 'too-many-targets'
                    ? t('Too many targets', '目标超过 12 艘，无法精确计算')
                    : t('No rate', '该点位没有填写掉落率')}
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
                <CostCell row={row} />
              </td>
              <td>
                <BudgetCell budget={row.budget} />
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

const ResultTable = ({ report, masterShips, probTarget = 0.9 }) => {
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
          <ShipGroup key={group.shipId} group={group} masterShips={masterShips} probTarget={probTarget} />
        ))}
      </div>
    )
  }

  return <SetTable rows={report.rows} />
}

export { ResultTable }
