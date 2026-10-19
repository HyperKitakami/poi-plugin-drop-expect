/*
  插件状态。

  ⚠️ 状态在 store.ext[包名]._ 下（poi 用 combineReducers({_: func}) 包了一层）。
  读的时候漏掉 `_` 会一直拿到 undefined，而症状与「还没有数据」完全一样。

  这里不 import 任何 poi 模块，因此可以被 node --test 直接覆盖。
*/

import { DEFAULT_WEIGHTS, normalizeWeights } from '../calc/cost'
import { sanitizePState } from '../store/schema'
import {
  HAVE_SET,
  P_STATE_READY,
  POINT_ADD,
  POINT_REMOVE,
  POINT_UPDATE,
  RATE_CLEAR,
  RATE_LINK,
  RATE_LOCK,
  RATE_SET,
  TARGET_ADD,
  TARGET_REMOVE,
  UI_SET,
} from './actions'

export const PACKAGE_NAME = 'poi-plugin-drop-expect'

export const initState = {
  // 持久化读取是否完成；不落盘
  ready: false,
  // 全局关注舰，结果表按它分组
  targets: [],
  // 点位：掉落率与单次消耗都挂在这里
  points: [],
  // 现有资源（默认从 poi 同步，manual=true 后不再被覆盖）
  have: { fuel: 0, ammo: 0, steel: 0, bauxite: 0, bucket: 0, manual: false },
  // 界面选项
  ui: {
    activeTargetId: null,
    probTarget: 0.9,
    mode: 'single',
    sortKey: 'n',
    sortDesc: false,
    // 自定义排序的权重（默认按稀缺度给，见 calc/cost.es）
    weights: DEFAULT_WEIGHTS,
  },
}

/*
  poi 可能先塞一个 {} 进来，此时 reducer 的默认参数不会触发，
  字段全是 undefined。所有分支都必须先经过这里补形。

  ⚠️ 新增字段时记得同步这里，否则旧存档会缺字段。
*/
const normalize = state => ({
  ...initState,
  ...(state || {}),
  ready: (state && state.ready) === true,
  targets: Array.isArray(state && state.targets) ? state.targets : [],
  points: Array.isArray(state && state.points) ? state.points : [],
  have: { ...initState.have, ...((state && state.have) || {}) },
  ui: {
    ...initState.ui,
    ...((state && state.ui) || {}),
    weights: normalizeWeights(state && state.ui && state.ui.weights),
  },
})

// 已经是完整形状就原样返回，避免每次 dispatch 都产生新引用导致无谓重渲染
const isShaped = state =>
  !!state && typeof state === 'object' && Array.isArray(state.points) && Array.isArray(state.targets)

const PATCHABLE = ['tags', 'mapId', 'cell', 'level', 'rank', 'reachRate', 'cost', 'rates']

const patchPoint = (point, patch) => {
  const next = { ...point }
  for (const key of PATCHABLE) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, key)) {
      next[key] = patch[key]
    }
  }
  return next
}

/** 手填概率：0~1，超界截断；非法值忽略。rate 传 null 表示「加入了这个点位但还没填」 */
const applyRate = (point, shipId, rate, meta) => {
  if (rate === null || rate === undefined) {
    const prev = (point.rates && point.rates[shipId]) || {}
    return {
      ...point,
      rates: { ...point.rates, [shipId]: { ...prev, rate: null, source: 'unset' } },
    }
  }
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    return point
  }
  const clamped = rate < 0 ? 0 : rate > 1 ? 1 : rate
  const prev = point.rates[shipId] || {}
  return {
    ...point,
    rates: {
      ...point.rates,
      [shipId]: { ...prev, ...(meta || {}), rate: clamped, source: (meta && meta.source) || 'manual' },
    },
  }
}

const dropRate = (point, shipId) => {
  if (!point.rates || !Object.prototype.hasOwnProperty.call(point.rates, shipId)) {
    return point
  }
  const rates = { ...point.rates }
  delete rates[shipId]
  return { ...point, rates }
}

/** 锁定的条目受保护：不能改、不能删，只有 RATE_LOCK 能解开 */
const isRateLocked = (point, shipId) => {
  const entry = point.rates && point.rates[shipId]
  return !!(entry && entry.locked === true)
}

export function reducer(state = initState, action, rootState) {
  const current = isShaped(state) ? state : normalize(state)
  const type = action && action.type

  switch (type) {
    case P_STATE_READY:
      return { ...initState, ...sanitizePState(action.pState), ready: true }

    case POINT_ADD: {
      const point = action.point
      if (!point || typeof point.id !== 'string') {
        return current
      }
      if (current.points.some(p => p.id === point.id)) {
        return current
      }
      return { ...current, points: [...current.points, point] }
    }

    case POINT_UPDATE: {
      const { id, patch } = action
      if (!current.points.some(p => p.id === id)) {
        return current
      }
      return {
        ...current,
        points: current.points.map(p => (p.id === id ? patchPoint(p, patch) : p)),
      }
    }

    case POINT_REMOVE: {
      const points = current.points.filter(p => p.id !== action.id)
      return points.length === current.points.length ? current : { ...current, points }
    }

    case TARGET_ADD: {
      const shipId = action.shipId
      if (!Number.isInteger(shipId) || shipId <= 0) {
        return current
      }
      if (current.targets.some(t => t.shipId === shipId)) {
        return current
      }
      return { ...current, targets: [...current.targets, { shipId, note: '' }] }
    }

    case TARGET_REMOVE: {
      const { shipId } = action
      if (!current.targets.some(t => t.shipId === shipId)) {
        return current
      }
      return {
        ...current,
        targets: current.targets.filter(t => t.shipId !== shipId),
        // 目标舰删掉了，各点位上的掉落率也一并清掉，避免留下孤儿数据
        points: current.points.map(p => dropRate(p, shipId)),
        ui:
          current.ui.activeTargetId === shipId
            ? { ...current.ui, activeTargetId: null }
            : current.ui,
      }
    }

    case RATE_SET: {
      const { pointId, shipId, rate, meta } = action
      if (!Number.isInteger(shipId) || shipId <= 0) {
        return current
      }
      const point = current.points.find(p => p.id === pointId)
      if (!point) {
        return current
      }
      // 手填、抓取回写、候选加入都走 RATE_SET，锁在这个口子上就不用各处去拦
      if (isRateLocked(point, shipId)) {
        return current
      }
      return {
        ...current,
        points: current.points.map(p => (p.id === pointId ? applyRate(p, shipId, rate, meta) : p)),
      }
    }

    case RATE_LINK: {
      const { pointId, shipId } = action
      if (!Number.isInteger(shipId) || shipId <= 0) {
        return current
      }
      if (!current.points.some(p => p.id === pointId)) {
        return current
      }
      return {
        ...current,
        points: current.points.map(p => {
          if (p.id !== pointId || (p.rates && p.rates[shipId])) {
            return p
          }
          return { ...p, rates: { ...(p.rates || {}), [shipId]: { rate: null, source: 'unset' } } }
        }),
      }
    }

    case RATE_CLEAR: {
      const { pointId, shipId } = action
      const point = current.points.find(p => p.id === pointId)
      if (!point || isRateLocked(point, shipId)) {
        return current
      }
      return {
        ...current,
        points: current.points.map(p => (p.id === pointId ? dropRate(p, shipId) : p)),
      }
    }

    case RATE_LOCK: {
      const { pointId, shipId, locked } = action
      if (!Number.isInteger(shipId) || shipId <= 0) {
        return current
      }
      const exists = current.points.some(p => p.id === pointId && p.rates && p.rates[shipId])
      if (!exists) {
        return current
      }
      return {
        ...current,
        points: current.points.map(p => {
          if (p.id !== pointId || !p.rates || !p.rates[shipId]) {
            return p
          }
          const entry = { ...p.rates[shipId] }
          if (locked) {
            entry.locked = true
          } else {
            delete entry.locked
          }
          return { ...p, rates: { ...p.rates, [shipId]: entry } }
        }),
      }
    }

    case HAVE_SET:
      return {
        ...current,
        have: { ...current.have, ...(action.patch || {}), manual: action.manual === true },
      }

    case UI_SET:
      return { ...current, ui: { ...current.ui, ...(action.patch || {}) } }

    default:
      return current
  }
}
