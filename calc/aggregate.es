/*
  结果汇总。

  纯粹的「点位 × 目标 → 次数 / 消耗」推导，UI 只负责画。
  mode:
    single  单舰达成：每艘目标舰一组，组内是各点位的对比行（D8）
    anyOf   集合「至少一艘」：以点位为单位，集合 = 该点位已添加的目标舰
    all     集合「全部收集」：同上，用精确 DP
*/

import { RESOURCE_KEYS, afford, maxSorties, perSortie, totalCost } from './cost'
import {
  ALL_DP_MAX_K,
  allN,
  allP,
  anyOfN,
  anyOfP,
  expectedAll,
  expectedAnyOf,
  singleN,
  singleP,
} from './probability'

export const MODES = ['single', 'anyOf', 'all']

export const rateOf = (point, shipId) => {
  const entry = point && point.rates && point.rates[shipId]
  return entry && typeof entry.rate === 'number' && Number.isFinite(entry.rate) ? entry.rate : null
}

/*
  点位自己的目标舰 = point.rates 的键。

  集合口径（至少一艘 / 全部收集）必须按这个来算，而不是全局清单：
  一个点位只掉其中两艘时，「这三艘里出一艘」这句对它是没意义的，
  「全部收集」更是永远不成立。全局清单只是候选池。
*/
export const pointShipIds = point =>
  Object.keys((point && point.rates) || {})
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0)
    .sort((a, b) => a - b)

/** 没选海域/格子的点位是草稿，不参与计算 */
export const isPointUsable = point => !!(point && point.mapId && point.cell)

export const pointLabel = point => {
  const level = point.level > 0 ? ['', '丁', '丙', '乙', '甲'][point.level] : ''
  return `${point.mapId} ${point.cell}${level ? ` ${level}` : ''}`
}

/** 单次出击获得该舰的概率 = 到达率 × 单次到达掉落率 */
export const qOf = (point, rate) => (rate == null ? null : point.reachRate * rate)

const summarizePointCost = (point, n) => ({
  perSortie: perSortie(point.cost),
  total: Number.isFinite(n) ? totalCost(point.cost, n) : null,
})

/**
 * 刷到目标次数后还剩多少。
 * 负数表示不够——第一页要按项标红，所以保留符号而不是截断成 0。
 */
const remainingOf = (have, total) => {
  // 五项全 0 说明消耗没填，此时「剩余 = 现有」会误导，直接不给值
  if (!total || RESOURCE_KEYS.every(key => !total[key])) {
    return null
  }
  const out = {}
  for (const key of RESOURCE_KEYS) {
    const pool = have && typeof have[key] === 'number' && Number.isFinite(have[key]) ? have[key] : 0
    out[key] = pool - (total[key] || 0)
  }
  return out
}

const reverseFor = ({ point, probAt, have }) => {
  const { n, bottleneck } = maxSorties(point.cost, have)
  if (!Number.isFinite(n)) {
    return null
  }
  return { n, bottleneck, prob: probAt(n) }
}

const byKey = (dir = 1) => (a, b) => (a === b ? 0 : a < b ? -dir : dir)

const sortRows = (rows, sortKey) => {
  const key = sortKey === 'rate' ? 'rate' : sortKey === 'fuel' ? 'totalFuel' : 'n'
  const dir = sortKey === 'rate' ? -1 : 1 // 掉落率越高越靠前
  return rows.slice().sort((a, b) => {
    const av = a[key] == null ? Infinity : a[key]
    const bv = b[key] == null ? Infinity : b[key]
    if (av === bv) {
      return byKey(1)(a.order, b.order)
    }
    return byKey(dir)(av, bv)
  })
}

/** 单舰：一艘船在各点位上的对比行 */
export const buildShipRows = ({ points, shipId, probTarget, have }) => {
  const rows = []
  points.filter(isPointUsable).forEach((point, index) => {
    const rate = rateOf(point, shipId)
    if (rate == null) {
      return
    }
    const q = qOf(point, rate)
    const n = singleN(q, probTarget)
    const { perSortie: per, total } = summarizePointCost(point, n)
    const budget = total ? afford(have, total) : null
    rows.push({
      order: index,
      pointId: point.id,
      label: pointLabel(point),
      mapId: point.mapId,
      cell: point.cell,
      level: point.level,
      rank: point.rank,
      reachRate: point.reachRate,
      rate,
      q,
      n,
      expected: q > 0 ? 1 / q : Infinity,
      per,
      total,
      remaining: remainingOf(have, total),
      totalFuel: total ? total.fuel : null,
      budget,
      reverse: reverseFor({ point, probAt: k => singleP(q, k), have }),
    })
  })
  return rows
}

/** 集合口径：一个点位一条结论 */
export const buildSetRow = ({ point, shipIds, mode, probTarget, have, index = 0 }) => {
  const qs = []
  const missing = []
  for (const shipId of shipIds) {
    const rate = rateOf(point, shipId)
    if (rate == null) {
      missing.push(shipId)
      continue
    }
    qs.push(qOf(point, rate))
  }

  const base = {
    order: index,
    pointId: point.id,
    label: pointLabel(point),
    mapId: point.mapId,
    cell: point.cell,
    level: point.level,
    rank: point.rank,
    reachRate: point.reachRate,
    rate: null,
    q: null,
    shipIds,
    qs,
    missing,
    expected: null,
    total: null,
    remaining: null,
    totalFuel: null,
    budget: null,
    reverse: null,
    reason: null,
  }

  if (qs.length === 0) {
    return { ...base, n: Infinity, reason: 'no-rate' }
  }

  if (mode === 'all') {
    if (missing.length > 0) {
      // 有一艘没填率，就永远集不齐
      return { ...base, n: Infinity, reason: 'incomplete-set' }
    }
    if (qs.length > ALL_DP_MAX_K) {
      return { ...base, n: null, reason: 'too-many-targets' }
    }
  }

  const n = mode === 'all' ? allN(qs, probTarget) : anyOfN(qs, probTarget)
  const probAt = k => (mode === 'all' ? allP(qs, k) : anyOfP(qs, k))
  const expected = mode === 'all' ? expectedAll(qs) : expectedAnyOf(qs)
  const { perSortie: per, total } = summarizePointCost(point, n)

  return {
    ...base,
    n,
    expected,
    per,
    total,
    remaining: remainingOf(have, total),
    totalFuel: total ? total.fuel : null,
    budget: total ? afford(have, total) : null,
    reverse: reverseFor({ point, probAt, have }),
  }
}

/**
 * 生成整个报告。
 * 返回结构：
 *   single → { mode, groups: [{ shipId, rows }] }   targets 决定有哪些分组
 *   其他   → { mode, rows }                          集合成员取自各点位的 rates，targets 不参与
 */
export const buildReport = ({ points, targets, mode, probTarget, have, sortKey = 'n' }) => {
  const shipIds = (targets || []).map(t => t.shipId)
  const usable = (points || []).filter(isPointUsable)

  if (mode === 'single') {
    const groups = []
    for (const shipId of shipIds) {
      const rows = sortRows(buildShipRows({ points: usable, shipId, probTarget, have }), sortKey)
      if (rows.length > 0) {
        groups.push({ shipId, rows })
      }
    }
    return { mode, groups, rows: [] }
  }

  // 集合口径只看「这个点位自己收的目标舰」，全局清单不参与（否则会有永远集不齐的点）
  const rows = usable.map((point, index) =>
    buildSetRow({ point, shipIds: pointShipIds(point), mode, probTarget, have, index }),
  )
  return { mode, groups: [], rows: sortRows(rows, sortKey) }
}
