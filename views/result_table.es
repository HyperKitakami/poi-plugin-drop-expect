import React, { useState } from 'react'
import { Button, Callout, Card, Classes, Divider, Tag, Tooltip } from '@blueprintjs/core'

import { RESOURCE_LABEL, fmtBucket, fmtCount, fmtPercent, fmtWeighted } from './format'
import { resolveShipName } from './selectors'
import { ACCENT_COLOR } from './theme'
import { t } from './i18n'

/*
  结果表。

  single 口径按目标舰分组（每艘船一组，组内是各点位对比，D8）；
  anyOf / all 是集合口径，以点位为单位一行。

  资源列五行列出「消耗 → 剩余」，负数标红——
  比「总共要花多少」更直接：一眼能看出哪项会先见底。

  目标舰标头用 ACCENT_COLOR（#6CF），与设定页的点位标题同色；
  最优标记用 success 绿，和「来自 poi」同一套语义色。
*/

const DANGER = Classes.TEXT_DANGER || 'bp6-text-danger'
const MUTED = 'bp6-text-muted'
const ORDER = ['fuel', 'ammo', 'steel', 'bauxite', 'bucket']

const fmtValue = (value, key) => {
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

const ResourceCell = ({ remaining, total, weighted }) => {
  if (!remaining || !total) {
    return <span className={MUTED}>—</span>
  }
  return (
    <div>
      {ORDER.map(key => {
        const left = remaining[key]
        return (
          <div key={key} style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
            <span style={{ display: 'inline-block', width: 14 }}>{RESOURCE_LABEL[key]}</span>
            <span className={MUTED}>{t('Spent', '消耗')}：</span>
            {fmtValue(total[key], key)}
            <span className={MUTED}> → {t('Left', '剩余')}：</span>
            <span className={left < 0 ? DANGER : undefined}>{fmtValue(left, key)}</span>
          </div>
        )
      })}
      {typeof weighted === 'number' && Number.isFinite(weighted) ? (
        <div className={MUTED} style={{ fontSize: 11 }}>
          {t('Weighted', '加权')}：{fmtWeighted(weighted)}
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

/*
  表头「反算」后缀一个小问号，悬浮给出这一列的口径。

  列里是「次数 + 把握 + 瓶颈」三件事，表头放不下，也不该为它撑高行高，
  所以只留一个可悬浮的问号。问号用纯 CSS 圆形而不是 Icon 组件：
  Blueprint 的图标尺寸属性在 4/5/6 之间改过名（iconSize → size），
  这里没必要为了一个字形去猜版本。
*/
const ReverseHeader = () => {
  const hint = t(
    'Reverse hint',
    '现有资源最多还能刷多少次，以及这些次数能达到的把握；括号里是卡住的那项资源。',
  )
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
      {t('Reverse', '反算')}
      <Tooltip content={hint} placement="top" hoverOpenDelay={120}>
        <span
          tabIndex={0}
          role="img"
          aria-label={hint}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 13,
            height: 13,
            borderRadius: '50%',
            border: '1px solid currentColor',
            fontSize: 10,
            lineHeight: 1,
            opacity: 0.5,
            cursor: 'help',
          }}
        >
          ?
        </span>
      </Tooltip>
    </span>
  )
}

const ReasonText = ({ row }) =>
  row.reason === 'incomplete-set'
    ? t('Incomplete set', '该点位有 {0} 艘目标舰未填写掉落率，无法集齐').replace(
        '{0}',
        String(row.missing.length),
      )
    : row.reason === 'too-many-targets'
      ? t('Too many targets', '目标超过 12 艘，无法精确计算')
      : t('No rate', '该点位没有填写掉落率')

/*
  点位下面挂标签：只显示前两个。
  更多的用「+N」表示，避免一行点位被标签撑开——要看全可以回设定页。
*/
const PointTags = ({ tags }) => {
  if (!Array.isArray(tags) || tags.length === 0) {
    return null
  }
  const shown = tags.slice(0, 2)
  return (
    <div style={{ marginTop: 2 }}>
      {shown.map(tag => (
        <Tag key={tag} minimal style={{ marginRight: 4 }}>
          {tag}
        </Tag>
      ))}
      {tags.length > shown.length ? (
        <span className={MUTED} style={{ fontSize: 11 }}>
          +{tags.length - shown.length}
        </span>
      ) : null}
    </div>
  )
}

const ShipGroup = ({ group, masterShips }) => {
  const best = group.rows[0]
  // 默认折叠：一艘船一个点位对比表，目标一多整页会很长
  const [open, setOpen] = useState(false)

  return (
    <Card style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Button
          minimal
          small
          icon={open ? 'chevron-down' : 'chevron-right'}
          aria-label={open ? t('Collapse', '折叠') : t('Expand', '展开')}
          onClick={() => setOpen(value => !value)}
        />
        <b style={{ color: ACCENT_COLOR, fontSize: 13 }}>
          {resolveShipName(masterShips, group.shipId)}
        </b>
        <Tag minimal>
          {group.rows.length} {t('points', '个点位')}
        </Tag>
        {best && Number.isFinite(best.n) ? (
          <Tag minimal intent="success">
            {t('best', '最优')} {best.label} · {fmtCount(best.n)} {t('sorties', '次')}
          </Tag>
        ) : null}
      </div>

      {open ? (
        <>
          <Divider style={{ margin: '8px 0' }} />
          <table className="bp6-html-table bp6-html-table-condensed" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>{t('Point', '点位')}</th>
                <th>{t('Drop rate', '掉落率')}</th>
                <th>{t('Sorties', '所需次数')}</th>
                <th>{t('Resources', '资源')}</th>
                <th><ReverseHeader /></th>
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
                    <PointTags tags={row.tags} />
                  </td>
                  <td>{fmtPercent(row.rate)}</td>
                  <td>
                    <SortieCell row={row} />
                  </td>
                  <td>
                    <ResourceCell remaining={row.remaining} total={row.total} weighted={row.weighted} />
                  </td>
                  <td>
                    <ReverseCell reverse={row.reverse} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </Card>
  )
}

const SetTable = ({ rows, masterShips }) => (
  <Card style={{ marginTop: 8 }}>
    <table className="bp6-html-table bp6-html-table-condensed" style={{ width: '100%' }}>
      <thead>
        <tr>
          <th>{t('Point', '点位')}</th>
          <th>{t('Sorties', '所需次数')}</th>
          <th>{t('Resources', '资源')}</th>
          <th><ReverseHeader /></th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row =>
          row.reason ? (
            <tr key={row.pointId}>
              <td>
                {row.label}
                <PointTags tags={row.tags} />
              </td>
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
                {row.shipIds && row.shipIds.length > 0 ? (
                  <Tag
                    minimal
                    style={{ marginLeft: 4 }}
                    title={row.shipIds.map(id => resolveShipName(masterShips, id)).join(' / ')}
                  >
                    {row.shipIds.length} {t('ships', '艘')}
                  </Tag>
                ) : null}
                {row.missing && row.missing.length > 0 ? (
                  <Tag minimal intent="warning" style={{ marginLeft: 4 }}>
                    {row.missing.length} {t('ships without rate', '艘未填率')}
                  </Tag>
                ) : null}
                <PointTags tags={row.tags} />
              </td>
              <td>
                <SortieCell row={row} />
              </td>
              <td>
                <ResourceCell remaining={row.remaining} total={row.total} weighted={row.weighted} />
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

  return <SetTable rows={report.rows} masterShips={masterShips} />
}

export { ResultTable }
