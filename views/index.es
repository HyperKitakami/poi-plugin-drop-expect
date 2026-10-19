import React, { useCallback, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Button, Callout, Card, Divider, HTMLSelect, Tag } from '@blueprintjs/core'

import { buildReport } from '../calc/aggregate'
import { DEFAULT_WEIGHTS, normalizeWeights } from '../calc/cost'
import { fetchDrop, matchShips } from '../services/kcwiki'
import { aggregateRecords, readRecords } from '../services/wmfg'
import {
  addPoint,
  addTarget,
  clearRate,
  linkRate,
  removePoint,
  removeTarget,
  setHave,
  setRate,
  setUi,
  updatePoint,
} from '../redux/actions'
import {
  admiralIdSelector,
  effectiveHaveSelector,
  fcdMapSelector,
  haveSelector,
  masterMapareasSelector,
  masterShipsSelector,
  pointsSelector,
  poiResourcesSelector,
  readySelector,
  targetsSelector,
  uiSelector,
} from './selectors'
import { CurvePanel } from './curve_panel'
import { RESOURCE_LABEL } from './format'
import { NumberInput } from './number_input'
import { PointCard } from './point_editor'
import { ResultTable } from './result_table'
import { TargetList } from './target_list'
import { ErrorBoundary } from './error_boundary'
import { t } from './i18n'

const HAVE_FIELDS = [
  { key: 'fuel', label: '油' },
  { key: 'ammo', label: '弹' },
  { key: 'steel', label: '钢' },
  { key: 'bauxite', label: '铝' },
  { key: 'bucket', label: '桶' },
]

const PROB_PRESETS = [0.5, 0.8, 0.9, 0.99]

const MODE_OPTIONS = [
  { value: 'single', label: '单舰达成' },
  { value: 'anyOf', label: '集合 · 至少一艘' },
  { value: 'all', label: '集合 · 全部收集' },
]

/*
  标签写成函数而不是常量：t() 要等 poi 注入 i18n 之后才拿得到译文，
  模块加载时求值会永久锁死在中文兜底上。
*/
const SORT_OPTIONS = [
  { value: 'n', label: () => t('Sort by sorties', '按次数') },
  { value: 'rate', label: () => t('Sort by rate', '按掉落率') },
  { value: 'fuel', label: () => t('Sort by fuel', '按总油') },
  { value: 'ammo', label: () => t('Sort by ammo', '按总弹') },
  { value: 'steel', label: () => t('Sort by steel', '按总钢') },
  { value: 'bauxite', label: () => t('Sort by bauxite', '按总铝') },
  { value: 'bucket', label: () => t('Sort by bucket', '按总桶') },
  { value: 'custom', label: () => t('Sort by custom', '按加权') },
]

// 自定义排序的权重项；标签复用资源名
const WEIGHT_KEYS = ['fuel', 'ammo', 'steel', 'bauxite', 'bucket']

const TABS = [
  { id: 'result', label: '计算结果' },
  { id: 'curve', label: '期望曲线' },
  { id: 'config', label: '点位与目标舰' },
]

const Panel = ({ active, children }) => (
  <div style={{ display: active ? 'block' : 'none' }}>{children}</div>
)

const Labeled = ({ label, children }) => (
  <div style={{ minWidth: 110 }}>
    <div className="bp6-text-muted" style={{ fontSize: 11, marginBottom: 2 }}>
      {label}
    </div>
    {children}
  </div>
)

const PanelContent = () => {
  const dispatch = useDispatch()
  const ready = useSelector(readySelector)
  const points = useSelector(pointsSelector)
  const targets = useSelector(targetsSelector)
  const have = useSelector(effectiveHaveSelector)
  const storedHave = useSelector(haveSelector)
  const poiResources = useSelector(poiResourcesSelector)
  const masterShips = useSelector(masterShipsSelector)
  const mapareas = useSelector(masterMapareasSelector)
  const fcdMap = useSelector(fcdMapSelector)
  const ui = useSelector(uiSelector)
  const admiralId = useSelector(admiralIdSelector)

  const [tab, setTab] = useState('result')

  const mode = MODE_OPTIONS.some(option => option.value === ui.mode) ? ui.mode : 'single'
  const sortKey = SORT_OPTIONS.some(option => option.value === ui.sortKey) ? ui.sortKey : 'n'
  // normalizeWeights 每次都返回新对象；不 memo 会让 buildReport 每帧重算
  const weights = useMemo(() => normalizeWeights(ui.weights), [ui.weights])
  const probTarget =
    typeof ui.probTarget === 'number' && ui.probTarget > 0 && ui.probTarget < 1 ? ui.probTarget : 0.9

  /*
    报告是纯推导，只在输入变化时重算。
    effectiveHave 在「非手动」时指向 memo 过的 poi 资源对象，引用稳定，
    所以这里的依赖不会每帧变化——否则 all 口径的 DP 会被反复重算。
  */
  const report = useMemo(
    () =>
      buildReport({
        points,
        targets,
        mode,
        probTarget,
        have,
        sortKey,
        weights,
      }),
    [points, targets, mode, probTarget, have, sortKey, weights],
  )

  /*
    抓取掉落率。

    手填优先（D6）：source === 'manual' 的条目默认跳过，只有在用户
    明确选择「覆盖」时才写。抓取只更新「全局目标舰」在本点位上的率，
    不认识的舰名不猜、不落库。
  */
  const handleFetchRates = useCallback(
    async (point, { overwriteManual } = {}) => {
      const data = await fetchDrop(point)
      const { matched, unmatched } = matchShips(data.ships, masterShips)
      const meta = {
        source: 'kcwiki',
        sampleSize: data.totalCount,
        timeRange: data.timeRange || undefined,
        fetchedAt: data.fetchedAt,
      }

      // 只更新「已经加入本点位」的舰船；其余进候选列表让用户手选
      const members = point.rates || {}
      let applied = 0
      let skipped = 0
      let missingCount = 0

      for (const key of Object.keys(members)) {
        const rate = matched[key]
        if (rate == null) {
          missingCount += 1
          continue
        }
        const existing = members[key]
        if (existing && existing.source === 'manual' && !overwriteManual) {
          skipped += 1
          continue
        }
        dispatch(setRate(point.id, Number(key), rate, meta))
        applied += 1
      }

      const candidates = Object.entries(matched)
        .filter(([key]) => !members[key])
        .map(([key, rate]) => ({ shipId: Number(key), rate, meta }))
        .sort((a, b) => b.rate - a.rate)

      return {
        applied,
        skipped,
        missingCount,
        totalCount: data.totalCount,
        timeRange: data.timeRange,
        noDropRate: data.noDropRate,
        unmatchedCount: unmatched.length,
        candidateCount: candidates.length,
        candidates,
      }
    },
    [dispatch, masterShips],
  )

  /*
    反查点位：把「这艘船掉在哪些点」的结果直接建成配置。

    数据来自 /api/cache/drop_ship_{id}-{rank}，与点位抓取同一份统计，
    所以不需要再逐点重抓——候选里带的 rate 就是当前值，
    sampleSize 用该点位该舰的样本数。
  */
  const handleReverseAdd = useCallback(
    (shipId, shipName, candidates, timeRange) => {
      candidates.forEach(candidate => {
        const action = addPoint({
          mapId: candidate.mapId,
          cell: candidate.cell,
          level: candidate.level,
          note: `${shipName} 反查`,
        })
        dispatch(action)
        dispatch(linkRate(action.point.id, shipId))
        dispatch(
          setRate(action.point.id, shipId, candidate.rate, {
            source: 'kcwiki',
            sampleSize: candidate.count,
            timeRange: timeRange || undefined,
            fetchedAt: Date.now(),
          }),
        )
      })
      return { added: candidates.length }
    },
    [dispatch],
  )

  /*
    从 WMFG 的出击记录估算「某海域 + 某时间段」的平均消耗。

    记录里只有海域、没有格子，所以得到的是整个海域的均值：
    路线固定时够用，路线会变时误差就在样本里——所以结果一定要连
    样本数与时间区间一起显示，让用户自己判断能不能用。
  */
  const handleEstimateCost = useCallback(
    ({ mapId, from }) => {
      const loaded = readRecords(admiralId)
      if (!loaded.ok) {
        return Promise.resolve({ ok: false, reason: loaded.reason })
      }
      const result = aggregateRecords(loaded.records, { mapId, from })
      return Promise.resolve({ ok: true, ...result, total: loaded.records.length })
    },
    [admiralId],
  )

  if (!ready) {
    return (
      <div style={{ padding: 8 }}>
        <Callout intent="none">{t('Loading state', '正在读取配置…')}</Callout>
      </div>
    )
  }

  return (
    <div style={{ padding: 8, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <b>{t('Drop Expect', '掉落期望')}</b>
        <span className="bp6-text-muted" style={{ fontSize: 11 }}>
          {points.length} {t('points', '个点位')} · {targets.length} {t('targets', '艘目标舰')}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 2, marginTop: 6 }}>
        {TABS.map(item => (
          <Button
            key={item.id}
            minimal
            small
            active={tab === item.id}
            onClick={() => setTab(item.id)}
            text={item.label}
          />
        ))}
      </div>
      <Divider style={{ margin: '2px 0 8px' }} />

      <Panel active={tab === 'result'}>
        <Card>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Labeled label={t('Target expectation', '目标期望')}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <NumberInput
                  value={Number((probTarget * 100).toFixed(2))}
                  min={1}
                  max={99.9}
                  onChange={value =>
                    dispatch(setUi({ probTarget: value == null ? 0.9 : value / 100 }))
                  }
                  ariaLabel="target expectation"
                />
                {PROB_PRESETS.map(preset => (
                  <Button
                    key={preset}
                    small
                    minimal
                    active={Math.abs(probTarget - preset) < 1e-6}
                    onClick={() => dispatch(setUi({ probTarget: preset }))}
                  >
                    {preset * 100}
                  </Button>
                ))}
              </div>
            </Labeled>

            <Labeled label={t('Mode', '口径')}>
              <HTMLSelect value={mode} onChange={e => dispatch(setUi({ mode: e.target.value }))}>
                {MODE_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </HTMLSelect>
            </Labeled>

            <Labeled label={t('Sort', '排序')}>
              <HTMLSelect
                value={sortKey}
                onChange={e => dispatch(setUi({ sortKey: e.target.value }))}
              >
                {SORT_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label()}
                  </option>
                ))}
              </HTMLSelect>
            </Labeled>

            {/* 选「按加权」后才出现：权重改了排序就变，没必要一直占位 */}
            {sortKey === 'custom' ? (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
                <span className="bp6-text-muted" style={{ fontSize: 11, marginBottom: 6 }}>
                  {t('Weights', '权重')}
                </span>
                {WEIGHT_KEYS.map(key => (
                  <div key={key} style={{ width: 56 }}>
                    <div className="bp6-text-muted" style={{ fontSize: 11, marginBottom: 2 }}>
                      {RESOURCE_LABEL[key]}
                    </div>
                    <NumberInput
                      value={weights[key]}
                      width={56}
                      min={0}
                      ariaLabel={`${t('Weights', '权重')} ${RESOURCE_LABEL[key]}`}
                      onChange={next =>
                        dispatch(setUi({ weights: { ...weights, [key]: next == null ? 0 : next } }))
                      }
                    />
                  </div>
                ))}
                <Button
                  minimal
                  small
                  style={{ marginBottom: 2 }}
                  onClick={() => dispatch(setUi({ weights: DEFAULT_WEIGHTS }))}
                >
                  {t('Reset', '重置')}
                </Button>
              </div>
            ) : null}
          </div>
        </Card>

        <ResultTable report={report} masterShips={masterShips} />

        <Card style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <b>{t('Current resources', '现有资源')}</b>
            <span>
              <Tag minimal intent={storedHave.manual ? 'warning' : 'success'}>
                {storedHave.manual ? t('manual', '手动') : t('from poi', '来自 poi')}
              </Tag>
              {storedHave.manual && poiResources ? (
                <Button
                  small
                  minimal
                  style={{ marginLeft: 4 }}
                  onClick={() => dispatch(setHave(poiResources, false))}
                >
                  {t('Resync', '重新同步')}
                </Button>
              ) : null}
            </span>
          </div>
          <Divider style={{ margin: '8px 0' }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {HAVE_FIELDS.map(field => (
              <div key={field.key} style={{ minWidth: 100 }}>
                <div className="bp6-text-muted" style={{ fontSize: 11, marginBottom: 2 }}>
                  {field.label}
                </div>
                <NumberInput
                  value={typeof have[field.key] === 'number' ? have[field.key] : null}
                  min={0}
                  onChange={value =>
                    dispatch(setHave({ ...storedHave, [field.key]: value == null ? 0 : value }, true))
                  }
                  ariaLabel={field.label}
                />
              </div>
            ))}
          </div>
          {!poiResources ? (
            <div className="bp6-text-muted" style={{ fontSize: 11, marginTop: 6 }}>
              {t('Resources unavailable', '读不到 poi 的资源数据（未进入游戏？），可手动填写。')}
            </div>
          ) : null}
        </Card>
      </Panel>

      <Panel active={tab === 'curve'}>
        <Card>
          <CurvePanel
            targets={targets}
            points={points}
            masterShips={masterShips}
            probTarget={probTarget}
          />
        </Card>
      </Panel>

      <Panel active={tab === 'config'}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <b>{t('Target ships', '目标舰')}</b>
            <span className="bp6-text-muted" style={{ fontSize: 11 }}>
              {t('Shared across points', '全局清单，各点位分别填写掉落率')}
            </span>
          </div>
          <Divider style={{ margin: '8px 0' }} />
          <TargetList
            targets={targets}
            masterShips={masterShips}
            points={points}
            onAdd={shipId => dispatch(addTarget(shipId))}
            onRemove={shipId => dispatch(removeTarget(shipId))}
            onApplyReverse={handleReverseAdd}
          />
        </Card>

        <Card style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <b>{t('Points', '点位')}</b>
            <Button small intent="primary" icon="add" onClick={() => dispatch(addPoint())}>
              {t('Add point', '添加点位')}
            </Button>
          </div>
          {points.length === 0 ? (
            <div style={{ marginTop: 8 }}>
              <Callout intent="none">
                {t('No point yet', '还没有点位。点「添加点位」，选择海域与目标点即可。')}
              </Callout>
            </div>
          ) : null}
        </Card>

        {points.map(point => (
          <PointCard
            key={point.id}
            point={point}
            targets={targets}
            masterShips={masterShips}
            mapareas={mapareas}
            fcdMap={fcdMap}
            onChange={patch => dispatch(updatePoint(point.id, patch))}
            onRate={(shipId, rate) => dispatch(setRate(point.id, shipId, rate))}
            onRemoveMember={shipId => dispatch(clearRate(point.id, shipId))}
            onLinkTarget={shipId => dispatch(linkRate(point.id, shipId))}
            onAddShip={shipId => {
              dispatch(addTarget(shipId))
              dispatch(linkRate(point.id, shipId))
            }}
            onAddCandidate={(shipId, rate, meta) => {
              dispatch(addTarget(shipId))
              dispatch(linkRate(point.id, shipId))
              dispatch(setRate(point.id, shipId, rate, meta))
            }}
            onFetch={handleFetchRates}
            estimateCost={handleEstimateCost}
            onRemove={() => {
              if (window.confirm(t('Delete this point?', '删除这个点位？'))) {
                dispatch(removePoint(point.id))
              }
            }}
          />
        ))}
      </Panel>
    </div>
  )
}

const DropExpectMain = () => (
  <ErrorBoundary>
    <PanelContent />
  </ErrorBoundary>
)

export { DropExpectMain }
