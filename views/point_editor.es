import React, { useEffect, useMemo, useState } from 'react'
import { Button, Callout, Card, Divider, HTMLSelect, InputGroup, Tag } from '@blueprintjs/core'

import { findHiddenShipMatch, getMapOptions, getShipOptions, getSpotOptions, isEventArea, resolveShipName, shipMatchesQuery } from './selectors'
import { NumberInput } from './number_input'
import { SuggestInput } from './suggest_input'
import { ACCENT_COLOR } from './theme'
import { t } from './i18n'

/*
  点位卡片。

  一个点位 = 一张卡：表头（折叠 / 标题 / 艘数 / 备注 / 删除）+ 折叠区（海域与目标点、
  该点位的目标舰、掉落率抓取、单次消耗、消耗估算）。

  标题用与结果页舰名同一个强调色（views/theme.es），两页的「标题」是同一语义。

  「目标舰」的归属靠 point.rates 的键决定：有键 = 已加入本点位（rate 可能是 null，
  表示加入了但还没填率）。全局 targets 只是候选池，两处通过 linkRate 打通。
*/

const RANKS = ['SAB', 'SA', 'S', 'A', 'B']

const LEVELS = [
  { value: 0, label: '通常' },
  { value: 1, label: '丁' },
  { value: 2, label: '丙' },
  { value: 3, label: '乙' },
  { value: 4, label: '甲' },
]

// 补给 = 出击当下扣的；入渠 = 修船折算的，桶算在入渠行
const COST_ROWS = [
  {
    id: 'supply',
    title: '补给',
    hint: '出击时直接扣除',
    keys: [
      ['supplyFuel', '油'],
      ['ammo', '弹'],
      ['supplySteel', '钢'],
      ['bauxite', '铝'],
    ],
  },
  {
    id: 'dock',
    title: '入渠',
    hint: '按入渠价折算',
    keys: [
      ['dockFuel', '油'],
      ['dockSteel', '钢'],
      ['bucket', '桶'],
    ],
  },
]

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

const rangeLabel = key => {
  const range = RANGES.find(item => item.key === key)
  return range ? range.label : key
}

const fmtDay = ts => (typeof ts === 'number' ? new Date(ts).toLocaleDateString('zh-CN') : '—')
const fmtDateTime = ts =>
  typeof ts === 'number'
    ? `${new Date(ts).toLocaleDateString('zh-CN')} ${new Date(ts).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : '—'

const round1 = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : 0)

const toPercent = rate => (typeof rate === 'number' ? Number((rate * 100).toFixed(4)) : null)

// 概率存 0~1，界面按百分比显示；保留 4 位小数，0.01191 → 1.191
const fmtWindow = timeRange =>
  Array.isArray(timeRange) && timeRange.length === 2
    ? `${String(timeRange[0]).slice(0, 10)} ~ ${String(timeRange[1]).slice(0, 10)}`
    : ''

const ESTIMATE_REASONS = {
  NO_ADMIRAL: '还没读到提督 ID，请先在 poi 里进入游戏。',
  MISSING: '找不到 Wheres My Fuel Gone 的出击记录（未安装或未启用？）。',
  NO_PATH: '读不到 poi 的数据目录。',
  BAD: '记录文件解析失败，可能正在被写入，稍后重试。',
}

const FEW_SAMPLES = 10

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
      return '点位信息不完整：需要海域、目标点和合法评价。'
    default:
      return (error && error.message) || '抓取失败'
  }
}

const describeFetch = summary => {
  const window = fmtWindow(summary.timeRange)
  if (summary.applied === 0) {
    if (summary.candidateCount > 0) {
      return {
        intent: 'primary',
        text: `已取回 ${summary.totalCount} 条样本、${summary.candidateCount} 艘可选舰船，见下方列表。`,
      }
    }
    if (summary.missingCount > 0) {
      return {
        intent: 'warning',
        text: `样本 ${summary.totalCount} 条，但没有匹配到你的目标舰（${summary.unmatchedCount} 个舰名未能对上舰娘）。`,
      }
    }
    return { intent: 'warning', text: '没有可写入的数据。' }
  }
  let text = `已更新 ${summary.applied} 艘（样本 ${summary.totalCount}${window ? `，窗口 ${window}` : ''}）`
  if (summary.skipped > 0) {
    text += `；${summary.skipped} 艘手填值已保留`
  }
  if (summary.candidateCount > 0) {
    text += `；另有 ${summary.candidateCount} 艘可在下方手选加入`
  }
  return { intent: 'success', text }
}

/*
  固定三行（标签 / 控件 / 说明）的字段容器。

  这样同一行里有没有 hint 都不会让控件高低不齐——
  之前「目标点」比「海域」低一截，就是因为海域多了说明行。
*/
const Field = ({ label, hint, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 96 }}>
    <div className="bp6-text-muted" style={{ fontSize: 11, lineHeight: '16px', height: 16 }}>
      {label}
    </div>
    {children}
    <div className="bp6-text-muted" style={{ fontSize: 11, lineHeight: '16px', height: 16 }}>
      {hint || ''}
    </div>
  </div>
)

const pointTitle = point => {
  const map = point.mapId || t('map unset', '未设置海域')
  const cell = point.cell || t('node unset', '未设置目标点')
  return `${map} · ${cell}`
}

const PointCard = ({
  point,
  targets,
  masterShips,
  mapareas,
  fcdMap,
  onChange,
  onRate,
  onRemoveMember,
  onLinkTarget,
  onAddShip,
  onAddCandidate,
  onFetch,
  estimateCost,
  onRemove,
}) => {
  /*
    默认折叠：点位多了以后，全部展开会让这一页变成一堵墙。
    例外是「草稿点位」（海域或目标点还没选）——它是刚点「添加点位」建出来的，
    收起后用户会以为什么都没发生，所以让它保持展开，选完位置后自然归入折叠。
  */
  const [open, setOpen] = useState(() => !point.mapId || !point.cell)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')

  const [fetching, setFetching] = useState(false)
  const [fetchStatus, setFetchStatus] = useState(null)
  const [candidates, setCandidates] = useState([])

  const [estMapId, setEstMapId] = useState(point.mapId || '')
  const [estRange, setEstRange] = useState('7')
  const [estimating, setEstimating] = useState(false)
  const [estimate, setEstimate] = useState(null)

  // 点位的海域一变，统计目标也跟着回到该海域
  useEffect(() => {
    setEstMapId(point.mapId || '')
  }, [point.mapId])

  const event = isEventArea(mapareas, point.mapId)
  const mapOptions = useMemo(() => getMapOptions(fcdMap), [fcdMap])
  const spotOptions = useMemo(() => getSpotOptions(fcdMap, point.mapId), [fcdMap, point.mapId])
  const shipOptions = useMemo(() => getShipOptions(masterShips), [masterShips])

  const spotListId = `de-spots-${point.id}`

  // 已加入本点位的舰船（rate 为 null 表示占位、还没填率）
  const members = useMemo(() => {
    const raw = point.rates || {}
    return Object.entries(raw)
      .map(([key, entry]) => ({ shipId: Number(key), entry }))
      .filter(item => Number.isInteger(item.shipId) && item.shipId > 0)
      .sort((a, b) => {
        const av = typeof a.entry.rate === 'number' ? a.entry.rate : -1
        const bv = typeof b.entry.rate === 'number' ? b.entry.rate : -1
        return bv - av || a.shipId - b.shipId
      })
  }, [point.rates])

  const memberIds = useMemo(() => new Set(members.map(item => item.shipId)), [members])

  const availableGlobals = useMemo(
    () => targets.filter(item => !memberIds.has(item.shipId)),
    [targets, memberIds],
  )

  const searchResults = useMemo(() => {
    if (!query.trim()) {
      return []
    }
    return shipOptions
      .filter(ship => !memberIds.has(ship.id) && shipMatchesQuery(query, ship))
      .slice(0, 8)
  }, [query, shipOptions, memberIds])

  // 查不到时的具体原因：多半是查到了改装形态（掉落表按未改装舰记录）
  const hiddenMatch = useMemo(
    () => (query.trim() && searchResults.length === 0 ? findHiddenShipMatch(masterShips, query) : null),
    [masterShips, query, searchResults.length],
  )
  const hiddenHint =
    hiddenMatch && hiddenMatch.baseId && hiddenMatch.baseId !== hiddenMatch.shipId
      ? t('Remodeled hint', '「{0}」为改装形态，掉落统计按「{1}」记录')
          .replace('{0}', hiddenMatch.name)
          .replace('{1}', hiddenMatch.baseName)
      : null

  const cost = point.cost || {}

  const handleFetch = async () => {
    if (fetching || !onFetch) {
      return
    }
    const manualCount = members.filter(item => item.entry.source === 'manual').length
    const overwriteManual =
      manualCount > 0
        ? window.confirm(
            `该点位有 ${manualCount} 艘是手填的掉落率。\n\n确定 = 用抓取值覆盖\n取消 = 保留手填值，只补未填的`,
          )
        : false

    setFetching(true)
    setFetchStatus(null)
    setCandidates([])
    try {
      const summary = await onFetch(point, { overwriteManual })
      setFetchStatus(describeFetch(summary))
      setCandidates((summary.candidates || []).slice(0, 40))
    } catch (error) {
      setFetchStatus({ intent: 'danger', text: describeError(error) })
    } finally {
      setFetching(false)
    }
  }

  const runEstimate = async () => {
    if (estimating || !estimateCost || !estMapId.trim()) {
      return
    }
    setEstimating(true)
    setEstimate(null)
    try {
      const result = await estimateCost({ mapId: estMapId.trim(), from: rangeFrom(estRange) })
      setEstimate({ ...result, computedAt: Date.now(), rangeKey: estRange })
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
        ...cost,
        supplyFuel: round1(avg.supplyFuel),
        ammo: round1(avg.ammo),
        supplySteel: round1(avg.supplySteel || 0),
        bauxite: round1(avg.bauxite),
        dockFuel: round1(avg.dockFuel),
        dockSteel: round1(avg.dockSteel),
        bucket: round1(avg.bucket),
      },
    })
  }

  const sourceTag = entry => {
    if (entry.source === 'kcwiki') {
      return (
        <span>
          <Tag minimal>kcwiki</Tag>
          {typeof entry.sampleSize === 'number' ? (
            <span className="bp6-text-muted" style={{ fontSize: 11, marginLeft: 6 }}>
              n={entry.sampleSize}
            </span>
          ) : null}
        </span>
      )
    }
    if (entry.source === 'unset') {
      return (
        <span className="bp6-text-muted" style={{ fontSize: 11 }}>
          {t('Pending', '待填写')}
        </span>
      )
    }
    return <Tag minimal>{t('manual', '手填')}</Tag>
  }

  return (
    <Card style={{ marginTop: 8 }}>
      {/* 表头分左右两块：左＝识别信息（可压缩），右＝备注+删除（不压缩）。
          右块用 marginLeft:auto 顶到右端；不用 flexWrap，避免窄面板时
          换行后两块都落到行首、看起来「挤在左边」。 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <Button
            minimal
            small
            icon={open ? 'chevron-down' : 'chevron-right'}
            aria-label={open ? t('Collapse', '折叠') : t('Expand', '展开')}
            onClick={() => setOpen(value => !value)}
          />
          <b
            style={{
              color: ACCENT_COLOR,
              fontSize: 13,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {pointTitle(point)}
          </b>
          <Tag minimal style={{ flexShrink: 0 }}>
            {members.length} {t('ships', '艘')}
          </Tag>
        </div>

        {/* 备注是对整张卡的补充说明，靠右紧挨删除按钮，不插在识别信息中间 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginLeft: 'auto',
            flexShrink: 0,
          }}
        >
          {/* 注意：Blueprint 的 InputGroup 只把 style 传给内部的 <input>，
              不会传给外层 .bp6-input-group（实测 bp6 的实现如此）。
              所以宽度写在这里是「输入框宽度」，位置必须由外层 div 控制。 */}
          <InputGroup
            value={point.note || ''}
            placeholder={t('Note', '备注（便于区分）')}
            style={{ width: 156 }}
            onChange={e => onChange({ note: e.target.value })}
          />
          <Button
            minimal
            intent="danger"
            icon="trash"
            onClick={onRemove}
            aria-label={t('Delete point', '删除点位')}
          />
        </div>
      </div>

      {open ? (
        <>
          <Divider style={{ margin: '8px 0' }} />

          {/* 位置 */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <Field label={t('Map', '海域')} hint={t('Type or pick', '可选择或直接输入')}>
              {/* 输入后才给候选：海域有 200 多个，空值铺开就是一大片 */}
              <SuggestInput
                value={point.mapId || ''}
                options={mapOptions}
                placeholder="2-2"
                width={110}
                ariaLabel={t('Map', '海域')}
                onChange={next =>
                  onChange({
                    mapId: next === '' ? null : next,
                    // 换海域后旧的目标点一定不再成立
                    cell: null,
                  })
                }
              />
            </Field>

            <Field label={t('Target node', '目标点')} hint={t('Cell letter', '如 B / K')}>
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
                <HTMLSelect value={String(point.level)} onChange={e => onChange({ level: Number(e.target.value) })}>
                  {LEVELS.map(item => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </HTMLSelect>
              </Field>
            ) : null}

            <Field label={t('Rank', '评价')} hint={t('Sample filter', '按评价筛选样本')}>
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
          </div>

          {/* 该点位的目标舰 */}
          <Divider style={{ margin: '10px 0' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 12 }}>{t('Targets of this point', '本点位的目标舰')}</b>
            <Button small minimal icon={pickerOpen ? 'minus' : 'add'} onClick={() => setPickerOpen(v => !v)}>
              {t('Add target', '添加目标舰')}
            </Button>
          </div>

          {members.length === 0 ? (
            <div className="bp6-text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              {t('No target in point', '还没有目标舰。点「添加目标舰」从全局清单挑选，或直接在下方搜索。')}
            </div>
          ) : (
            <table className="bp6-html-table bp6-html-table-condensed" style={{ width: '100%', marginTop: 4 }}>
              <thead>
                <tr>
                  <th>{t('Target ship', '目标舰')}</th>
                  <th style={{ width: 140 }}>{t('Drop rate', '掉落率')} (%)</th>
                  <th>{t('Source', '来源')}</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {members.map(({ shipId, entry }) => (
                  <tr key={shipId}>
                    <td>{resolveShipName(masterShips, shipId)}</td>
                    <td>
                      <NumberInput
                        value={toPercent(entry.rate)}
                        min={0}
                        max={100}
                        onChange={value => onRate(shipId, value == null ? null : value / 100)}
                        placeholder={t('not set', '未设置')}
                        ariaLabel={`rate-${shipId}`}
                      />
                    </td>
                    <td>{sourceTag(entry)}</td>
                    <td>
                      <Button
                        minimal
                        small
                        icon="cross"
                        aria-label={t('Remove', '移除')}
                        onClick={() => onRemoveMember(shipId)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {pickerOpen ? (
            <div
              style={{
                marginTop: 6,
                padding: 8,
                border: '1px solid rgba(128,128,128,0.35)',
                borderRadius: 4,
              }}
            >
              {availableGlobals.length > 0 ? (
                <div style={{ marginBottom: 8 }}>
                  <div className="bp6-text-muted" style={{ fontSize: 11, marginBottom: 4 }}>
                    {t('From global list', '全局清单中尚未加入本点位')}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {availableGlobals.map(item => (
                      <Button key={item.shipId} small onClick={() => onLinkTarget(item.shipId)}>
                        {resolveShipName(masterShips, item.shipId)}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}

              <InputGroup
                leftIcon="search"
                value={query}
                placeholder={t('Search to add', '搜索舰名、假名或 ID 加入（同时加入全局清单）')}
                onChange={e => setQuery(e.target.value)}
              />
              {searchResults.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                  {searchResults.map(ship => (
                    <Button
                      key={ship.id}
                      small
                      minimal
                      onClick={() => {
                        onAddShip(ship.id)
                        setQuery('')
                      }}
                    >
                      {ship.name}
                      <span className="bp6-text-muted" style={{ marginLeft: 4 }}>
                        {ship.yomi}
                      </span>
                      <span className="bp6-text-muted" style={{ marginLeft: 4, fontSize: 11 }}>
                        #{ship.id}
                      </span>
                    </Button>
                  ))}
                </div>
              ) : query.trim() ? (
                <div style={{ marginTop: 6 }}>
                  <div className="bp6-text-muted" style={{ fontSize: 11 }}>
                    {t('No match', '没有匹配的舰船。')}
                  </div>
                  {hiddenHint ? (
                    <div style={{ marginTop: 4 }}>
                      <div className="bp6-text-muted" style={{ fontSize: 11 }}>
                        {hiddenHint}
                      </div>
                      <Button
                        small
                        intent="primary"
                        style={{ marginTop: 4 }}
                        onClick={() => {
                          onAddShip(hiddenMatch.baseId)
                          setQuery('')
                        }}
                      >
                        {t('Add base ship', '改为加入')} {hiddenMatch.baseName}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 掉落率抓取 */}
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

          {candidates.length > 0 ? (
            <div style={{ marginTop: 6 }}>
              <div className="bp6-text-muted" style={{ fontSize: 11, marginBottom: 4 }}>
                {t('Candidate ships', '样本中的其他舰船（点击加入，会同时进入全局清单与本点位）')}
              </div>
              <div style={{ maxHeight: 190, overflowY: 'auto', paddingRight: 4 }}>
                {candidates.map(item => (
                  <button
                    key={item.shipId}
                    type="button"
                    className="bp6-button bp6-minimal bp6-small"
                    style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 8 }}
                    onClick={() => onAddCandidate(item.shipId, item.rate, item.meta)}
                  >
                    <span>{resolveShipName(masterShips, item.shipId)}</span>
                    <span className="bp6-text-muted">{(item.rate * 100).toFixed(3)}%</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* 单次消耗 */}
          <Divider style={{ margin: '10px 0' }} />
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {COST_ROWS.map(row => (
              <Field
                key={row.id}
                label={t(row.id === 'supply' ? 'Supply' : 'Repair', row.title)}
                hint={row.hint}
              >
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {row.keys.map(([key, label]) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 3, width: 76 }}>
                      <span className="bp6-text-muted" style={{ fontSize: 11, width: 12 }}>
                        {label}
                      </span>
                      <NumberInput
                        value={typeof cost[key] === 'number' ? cost[key] : null}
                        min={0}
                        onChange={value => onChange({ cost: { ...cost, [key]: value == null ? 0 : value } })}
                        ariaLabel={key}
                      />
                    </div>
                  ))}
                </div>
              </Field>
            ))}
          </div>

          {/* 消耗估算 */}
          <Divider style={{ margin: '10px 0' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 12 }}>{t('Estimate cost', '按出击记录估算')}</b>
            <span className="bp6-text-muted" style={{ fontSize: 11 }}>
              {t('Estimate note', '来自 Wheres My Fuel Gone 的历史记录，按海域统计，不含支援/陆航')}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 4, flexWrap: 'wrap' }}>
            <Field label={t('Map for stats', '统计海域')}>
              <SuggestInput
                value={estMapId}
                options={mapOptions}
                placeholder="2-2"
                width={110}
                ariaLabel={t('Map for stats', '统计海域')}
                onChange={setEstMapId}
              />
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
            <Field label=" " hint=" ">
              <Button
                small
                icon="calculator"
                loading={estimating}
                disabled={!estimateCost || !estMapId.trim()}
                onClick={runEstimate}
              >
                {t('Compute', '统计')}
              </Button>
            </Field>
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
                <div className="bp6-text-muted" style={{ fontSize: 11 }}>
                  {t('Last stats', '上次统计')} {fmtDateTime(estimate.computedAt)} ·{' '}
                  {rangeLabel(estimate.rangeKey)} · {fmtDay(estimate.firstAt)} ~ {fmtDay(estimate.lastAt)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                  <Tag minimal intent="primary">
                    {estimate.count} {t('sorties', '次')}
                  </Tag>
                  {estimate.count < FEW_SAMPLES ? (
                    <Tag minimal intent="warning">
                      {t('few samples', '样本较少')}
                    </Tag>
                  ) : null}
                </div>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  {t('Supply', '补给')}：{t('fuel', '油')} {round1(estimate.avg.supplyFuel)} /{' '}
                  {t('ammo', '弹')} {round1(estimate.avg.ammo)} / {t('steel', '钢')}{' '}
                  {round1(estimate.avg.supplySteel || 0)} / {t('bauxite', '铝')}{' '}
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
        </>
      ) : null}
    </Card>
  )
}

export { PointCard }
