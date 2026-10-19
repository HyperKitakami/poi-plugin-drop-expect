import React, { useEffect, useMemo, useState } from 'react'
import { Button, Callout, Divider, HTMLSelect, InputGroup, Tag } from '@blueprintjs/core'

import { getMapOptions, getSpotOptions, isEventArea, resolveShipName } from './selectors'
import { NumberInput } from './number_input'
import { t } from './i18n'

const RANKS = ['SAB', 'SA', 'S', 'A', 'B']
const LEVELS = [
  { value: 0, label: '通常' },
  { value: 1, label: '丁' },
  { value: 2, label: '丙' },
  { value: 3, label: '乙' },
  { value: 4, label: '甲' },
]

const COST_FIELDS = [
  { key: 'supplyFuel', label: '油（补给）' },
  { key: 'ammo', label: '弹' },
  { key: 'bauxite', label: '铝' },
  { key: 'dockFuel', label: '油（入渠）' },
  { key: 'dockSteel', label: '钢（入渠）' },
  { key: 'bucket', label: '桶' },
]

// 概率存 0~1，界面按百分比显示；保留 4 位小数，0.01191 → 1.191
const toPercent = rate => (typeof rate === 'number' ? Number((rate * 100).toFixed(4)) : null)

const fmtWindow = timeRange =>
  Array.isArray(timeRange) && timeRange.length === 2
    ? `${String(timeRange[0]).slice(0, 10)} ~ ${String(timeRange[1]).slice(0, 10)}`
    : ''

/** 抓取结果 → 一句人话，区分「更新了」「被手填挡住」「样本里没有」 */
const describeFetch = summary => {
  const window = fmtWindow(summary.timeRange)
  if (summary.applied === 0) {
    if (summary.missingCount > 0) {
      return {
        intent: 'warning',
        text: `样本 ${summary.totalCount} 条，但没有匹配到你的目标舰（${summary.unmatchedCount} 个舰名未能对上舰娘）。可手填，或确认舰名是否为改装后形态。`,
      }
    }
    return { intent: 'warning', text: '没有可写入的数据。' }
  }
  let text = `已更新 ${summary.applied} 艘（样本 ${summary.totalCount}${window ? `，窗口 ${window}` : ''}）`
  if (summary.skipped > 0) {
    text += `；${summary.skipped} 艘手填值已保留`
  }
  if (summary.missingCount > 0) {
    text += `；${summary.missingCount} 艘未在样本中出现`
  }
  return { intent: 'success', text }
}

const describeError = error => {
  switch (error && error.code) {
    case 'NOT_FOUND':
      return '该海域/难度暂无统计（404）。可能是普通图选了难度，或活动图未收录。'
    case 'EMPTY':
      return '该点位在统计期内没有样本。'
    case 'NETWORK':
      return `网络请求失败：${(error && error.message) || '未知原因'}`
    case 'PARSE':
      return '返回内容解析失败，可能是接口结构变了。'
    case 'BAD_POINT':
      return '点位信息不完整：需要海域、格子和合法评价。'
    default:
      return (error && error.message) || '抓取失败'
  }
}

/* ---- 消耗估算（来自 WMFG 的历史出击记录） ---- */

const RANGES = [
  { key: '1', label: '最近 1 天', days: 1 },
  { key: '7', label: '最近 7 天', days: 7 },
  { key: '30', label: '最近 30 天', days: 30 },
  { key: 'all', label: '全部', days: null },
]

const rangeFrom = key => {
  const range = RANGES.find(item => item.key === key)
  return range && range.days ? Date.now() - range.days * 86400000 : null
}

const fmtDay = ts => (typeof ts === 'number' ? new Date(ts).toLocaleDateString('zh-CN') : '—')

const round1 = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : 0)

const ESTIMATE_REASONS = {
  NO_ADMIRAL: '还没读到提督 ID，请先在 poi 里进入游戏。',
  MISSING: '找不到 Wheres My Fuel Gone 的出击记录（未安装或未启用？）。',
  NO_PATH: '读不到 poi 的数据目录。',
  BAD: '记录文件解析失败，可能正在被写入，稍后重试。',
}

// 样本太少时均值波动很大（实测 2-2 全部 410 次均值 38.8，最近 30 天 4 次均值 75.5）
const FEW_SAMPLES = 10

const Field = ({ label, children, hint }) => (
  <div style={{ minWidth: 120 }}>
    <div className="bp6-text-muted" style={{ fontSize: 11, marginBottom: 2 }}>
      {label}
    </div>
    {children}
    {hint ? (
      <div className="bp6-text-muted" style={{ fontSize: 11, marginTop: 2 }}>
        {hint}
      </div>
    ) : null}
  </div>
)

const PointEditor = ({
  point,
  targets,
  masterShips,
  mapareas,
  fcdMap,
  onChange,
  onRate,
  onFetch,
  estimateCost,
  onRemove,
}) => {
  const event = isEventArea(mapareas, point.mapId)
  const mapOptions = useMemo(() => getMapOptions(fcdMap), [fcdMap])
  const spotOptions = useMemo(() => getSpotOptions(fcdMap, point.mapId), [fcdMap, point.mapId])
  const mapListId = `de-maps-${point.id}`
  const spotListId = `de-spots-${point.id}`
  const estListId = `de-est-maps-${point.id}`
  const [fetching, setFetching] = useState(false)
  const [fetchStatus, setFetchStatus] = useState(null)

  const [estMapId, setEstMapId] = useState(point.mapId || '')
  // 默认最近 7 天：全部太容易被旧阵容的数据拖偏
  const [estRange, setEstRange] = useState('7')
  const [estimating, setEstimating] = useState(false)
  const [estimate, setEstimate] = useState(null)

  // 点位的海域一变，统计目标也跟着回到该海域
  useEffect(() => {
    setEstMapId(point.mapId || '')
  }, [point.mapId])

  const runEstimate = async () => {
    if (estimating || !estimateCost || !estMapId.trim()) {
      return
    }
    setEstimating(true)
    setEstimate(null)
    try {
      const result = await estimateCost({ mapId: estMapId.trim(), from: rangeFrom(estRange) })
      setEstimate(result)
    } catch (error) {
      setEstimate({ ok: false, reason: 'ERROR', message: error && error.message })
    } finally {
      setEstimating(false)
    }
  }

  const applyEstimate = () => {
    if (!estimate || !estimate.ok || !estimate.avg) {
      return
    }
    const avg = estimate.avg
    onChange({
      cost: {
        supplyFuel: round1(avg.supplyFuel),
        ammo: round1(avg.ammo),
        bauxite: round1(avg.bauxite),
        dockFuel: round1(avg.dockFuel),
        dockSteel: round1(avg.dockSteel),
        bucket: round1(avg.bucket),
      },
    })
  }

  const handleFetch = async () => {
    if (fetching || !onFetch) {
      return
    }
    // 手填值优先（D6）：有手填就先问，取消则保留
    const manualCount = targets.filter(
      target => point.rates && point.rates[target.shipId] && point.rates[target.shipId].source === 'manual',
    ).length
    const overwriteManual =
      manualCount > 0
        ? window.confirm(
            `该点位有 ${manualCount} 艘是手填的掉落率。\n\n确定 = 用抓取值覆盖\n取消 = 保留手填值，只补未填的`,
          )
        : false

    setFetching(true)
    setFetchStatus(null)
    try {
      const summary = await onFetch(point, { overwriteManual })
      setFetchStatus(describeFetch(summary))
    } catch (error) {
      setFetchStatus({ intent: 'danger', text: describeError(error) })
    } finally {
      setFetching(false)
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label={t('Map', '海域')} hint={t('Type or pick', '可选择或直接输入')}>
          <InputGroup
            value={point.mapId || ''}
            list={mapListId}
            placeholder="2-2"
            style={{ width: 110 }}
            onChange={e =>
              onChange({
                mapId: e.target.value === '' ? null : e.target.value,
                // 换海域后旧的格子一定不再成立，顺手清掉
                cell: null,
              })
            }
          />
          <datalist id={mapListId}>
            {mapOptions.map(id => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </Field>

        <Field label={t('Cell', '格子')}>
          <InputGroup
            value={point.cell || ''}
            list={spotListId}
            placeholder="B"
            disabled={!point.mapId}
            style={{ width: 90 }}
            onChange={e => onChange({ cell: e.target.value === '' ? null : e.target.value.toUpperCase() })}
          />
          <datalist id={spotListId}>
            {spotOptions.map(cell => (
              <option key={cell} value={cell} />
            ))}
          </datalist>
        </Field>

        {event ? (
          <Field label={t('Difficulty', '难度')}>
            <HTMLSelect
              value={String(point.level)}
              onChange={e => onChange({ level: Number(e.target.value) })}
            >
              {LEVELS.map(item => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </HTMLSelect>
          </Field>
        ) : null}

        <Field label={t('Rank', '评价')} hint={t('Drop data is filtered by rank', '按评价筛选统计样本')}>
          <HTMLSelect value={point.rank} onChange={e => onChange({ rank: e.target.value })}>
            {RANKS.map(rank => (
              <option key={rank} value={rank}>
                {rank}
              </option>
            ))}
          </HTMLSelect>
        </Field>

        <Field label={t('Reach rate', '到达率')} hint={t('Default 100%', '默认 100%')}>
          <NumberInput
            value={toPercent(point.reachRate)}
            min={1}
            max={100}
            onChange={value => onChange({ reachRate: value == null ? 1 : value / 100 })}
            ariaLabel="reach rate"
          />
        </Field>

        <div style={{ marginLeft: 'auto' }}>
          <Button minimal intent="danger" icon="trash" onClick={onRemove}>
            {t('Delete point', '删除点位')}
          </Button>
        </div>
      </div>

      <Divider style={{ margin: '10px 0' }} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {COST_FIELDS.map(field => (
          <Field key={field.key} label={field.label}>
            <NumberInput
              value={point.cost && typeof point.cost[field.key] === 'number' ? point.cost[field.key] : null}
              min={0}
              onChange={value =>
                onChange({ cost: { ...(point.cost || {}), [field.key]: value == null ? 0 : value } })
              }
              ariaLabel={field.label}
            />
          </Field>
        ))}
      </div>

      <div className="bp6-text-muted" style={{ fontSize: 11, marginTop: 4 }}>
        {t('Per sortie', '单次出击消耗；入渠部分按入渠价折算，可与补给分开填')}
      </div>

      <Divider style={{ margin: '10px 0' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 12 }}>{t('Estimate cost', '按出击记录估算')}</b>
        <span className="bp6-text-muted" style={{ fontSize: 11 }}>
          {t('Estimate note', '来自 Wheres My Fuel Gone 的历史记录，按海域统计，不含支援/陆航')}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 4, flexWrap: 'wrap' }}>
        <Field label={t('Map for stats', '统计海域')}>
          <InputGroup
            value={estMapId}
            list={estListId}
            placeholder="2-2"
            style={{ width: 110 }}
            onChange={e => setEstMapId(e.target.value)}
          />
          <datalist id={estListId}>
            {mapOptions.map(id => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </Field>
        <Field label={t('Range', '时间段')}>
          <HTMLSelect value={estRange} onChange={e => setEstRange(e.target.value)}>
            {RANGES.map(range => (
              <option key={range.key} value={range.key}>
                {range.label}
              </option>
            ))}
          </HTMLSelect>
        </Field>
        <Button
          small
          icon="calculator"
          loading={estimating}
          disabled={!estimateCost || !estMapId.trim()}
          onClick={runEstimate}
        >
          {t('Compute', '统计')}
        </Button>
      </div>

      {estimate ? (
        !estimate.ok ? (
          <Callout intent="danger" style={{ marginTop: 6 }}>
            <span style={{ fontSize: 12 }}>
              {ESTIMATE_REASONS[estimate.reason] || estimate.message || '统计失败'}
            </span>
          </Callout>
        ) : estimate.count === 0 ? (
          <Callout intent="warning" style={{ marginTop: 6 }}>
            <span style={{ fontSize: 12 }}>
              {t('No records in range', '该海域在所选时间段内没有出击记录。可把时间段放宽到「全部」再试。')}
            </span>
          </Callout>
        ) : (
          <div style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Tag minimal intent="primary">
                {estimate.count} {t('sorties', '次')}
              </Tag>
              <span className="bp6-text-muted" style={{ fontSize: 11 }}>
                {fmtDay(estimate.firstAt)} ~ {fmtDay(estimate.lastAt)}
              </span>
              {estimate.count < FEW_SAMPLES ? (
                <Tag minimal intent="warning">
                  {t('few samples', '样本较少')}
                </Tag>
              ) : null}
            </div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {t('Supply', '补给')}：{t('fuel', '油')} {round1(estimate.avg.supplyFuel)} /{' '}
              {t('ammo', '弹')} {round1(estimate.avg.ammo)} / {t('bauxite', '铝')}{' '}
              {round1(estimate.avg.bauxite)}
            </div>
            <div style={{ fontSize: 12 }}>
              {t('Repair', '入渠')}：{t('fuel', '油')} {round1(estimate.avg.dockFuel)} /{' '}
              {t('steel', '钢')} {round1(estimate.avg.dockSteel)}
              {'　'}
              {t('bucket', '桶')} {round1(estimate.avg.bucket)}
            </div>
            {estimate.extraAvg &&
            (estimate.extraAvg.fuel > 0 || estimate.extraAvg.ammo > 0 || estimate.extraAvg.bauxite > 0) ? (
              <div className="bp6-text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                {t('Extra cost', '另有支援/陆航（未计入）')}：{t('fuel', '油')}{' '}
                {round1(estimate.extraAvg.fuel)} / {t('ammo', '弹')} {round1(estimate.extraAvg.ammo)} /{' '}
                {t('bauxite', '铝')} {round1(estimate.extraAvg.bauxite)}
              </div>
            ) : null}
            <Button small intent="primary" icon="tick" style={{ marginTop: 6 }} onClick={applyEstimate}>
              {t('Fill cost', '填入本点位消耗')}
            </Button>
          </div>
        )
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <Button
          small
          icon="download"
          loading={fetching}
          disabled={!point.mapId || !point.cell}
          onClick={handleFetch}
        >
          {t('Fetch from kcwiki', '抓取掉落率')}
        </Button>
        <span className="bp6-text-muted" style={{ fontSize: 11 }}>
          {t('Source note', '来源：kcwiki 掉落统计 · 30 天滚动窗口 · 缓存可能滞后')}
        </span>
      </div>

      {fetchStatus ? (
        <Callout intent={fetchStatus.intent} style={{ marginTop: 6 }}>
          <span style={{ fontSize: 12 }}>{fetchStatus.text}</span>
        </Callout>
      ) : null}

      <Divider style={{ margin: '10px 0' }} />

      {targets.length === 0 ? (
        <Callout intent="none">{t('Add target ships first', '先在上方添加目标舰。')}</Callout>
      ) : (
        <table className="bp6-html-table bp6-html-table-condensed" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>{t('Target ship', '目标舰')}</th>
              <th style={{ width: 150 }}>{t('Drop rate', '掉落率')} (%)</th>
              <th>{t('Source', '来源')}</th>
            </tr>
          </thead>
          <tbody>
            {targets.map(target => {
              const entry = point.rates ? point.rates[target.shipId] : null
              return (
                <tr key={target.shipId}>
                  <td>{resolveShipName(masterShips, target.shipId)}</td>
                  <td>
                    <NumberInput
                      value={toPercent(entry && entry.rate)}
                      min={0}
                      max={100}
                      onChange={value => onRate(target.shipId, value == null ? null : value / 100)}
                      placeholder={t('not set', '未设置')}
                      ariaLabel={`rate-${target.shipId}`}
                    />
                  </td>
                  <td>
                    {entry ? (
                      <span>
                        <Tag minimal>{entry.source === 'kcwiki' ? 'kcwiki' : t('manual', '手填')}</Tag>
                        {typeof entry.sampleSize === 'number' ? (
                          <span className="bp6-text-muted" style={{ fontSize: 11, marginLeft: 6 }}>
                            n={entry.sampleSize}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="bp6-text-muted" style={{ fontSize: 11 }}>
                        {t('Pending', '待填写')}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

export { PointEditor }
