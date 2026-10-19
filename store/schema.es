/*
  持久化格式校验。

  原则：宁可丢掉一条坏数据，也不让一条坏数据把整个面板算崩。
  读取时逐字段校验，脏字段回落到安全值；连 id 都没有的元素直接丢弃。
*/

import { normalizeCost } from '../calc/cost'

export const DATA_VERSION = '1.0.0'

export const RANK_OPTIONS = ['SAB', 'SA', 'S', 'A', 'B']
export const LEVEL_OPTIONS = [0, 1, 2, 3, 4]
export const RATE_SOURCES = ['manual', 'kcwiki', 'measured']

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const nonEmptyString = v => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
const clamp = (v, min, max) => (v < min ? min : v > max ? max : v)

/** 概率：0~1 之间的小数；非数值返回 null（表示「未设置」） */
export const sanitizeRate = v => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
    return null
  }
  return v
}

export const sanitizeShipId = v => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : null
}

const sanitizeRates = raw => {
  const out = {}
  if (!isObj(raw)) {
    return out
  }
  for (const [key, value] of Object.entries(raw)) {
    const shipId = sanitizeShipId(key)
    if (shipId == null || !isObj(value)) {
      continue
    }
    const rate = sanitizeRate(value.rate)
    if (rate == null) {
      continue
    }
    const entry = {
      rate,
      source: RATE_SOURCES.includes(value.source) ? value.source : 'manual',
    }
    if (typeof value.sampleSize === 'number' && Number.isFinite(value.sampleSize) && value.sampleSize >= 0) {
      entry.sampleSize = Math.floor(value.sampleSize)
    }
    if (Array.isArray(value.timeRange) && value.timeRange.length === 2) {
      entry.timeRange = value.timeRange.map(v => (typeof v === 'string' ? v : ''))
    }
    if (typeof value.fetchedAt === 'number' && Number.isFinite(value.fetchedAt)) {
      entry.fetchedAt = value.fetchedAt
    }
    out[shipId] = entry
  }
  return out
}

const sanitizePoint = raw => {
  if (!isObj(raw)) {
    return null
  }
  const id = nonEmptyString(raw.id)
  if (!id) {
    return null
  }
  const level = LEVEL_OPTIONS.includes(raw.level) ? raw.level : 0
  const rank = RANK_OPTIONS.includes(raw.rank) ? raw.rank : 'SAB'
  const reachRate =
    typeof raw.reachRate === 'number' && Number.isFinite(raw.reachRate)
      ? clamp(raw.reachRate, 0.01, 1)
      : 1

  return {
    id,
    mapId: nonEmptyString(raw.mapId),
    cell: nonEmptyString(raw.cell),
    level,
    rank,
    reachRate,
    cost: normalizeCost(raw.cost),
    rates: sanitizeRates(raw.rates),
  }
}

const sanitizeTargets = raw => {
  if (!Array.isArray(raw)) {
    return []
  }
  const seen = new Set()
  const out = []
  for (const item of raw) {
    if (!isObj(item)) {
      continue
    }
    const shipId = sanitizeShipId(item.shipId)
    if (shipId == null || seen.has(shipId)) {
      continue
    }
    seen.add(shipId)
    out.push({ shipId, note: typeof item.note === 'string' ? item.note : '' })
  }
  return out
}

const sanitizeHave = raw => {
  const base = { fuel: 0, ammo: 0, steel: 0, bauxite: 0, bucket: 0, manual: false }
  if (!isObj(raw)) {
    return base
  }
  const out = { manual: raw.manual === true }
  for (const key of ['fuel', 'ammo', 'steel', 'bauxite', 'bucket']) {
    const v = raw[key]
    out[key] = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
  }
  return out
}

const sanitizeUi = raw => {
  const base = { activeTargetId: null, probTarget: 0.9, mode: 'single', sortKey: 'n', sortDesc: false }
  if (!isObj(raw)) {
    return base
  }
  const modes = ['single', 'anyOf', 'all']
  const prob = typeof raw.probTarget === 'number' && raw.probTarget > 0 && raw.probTarget < 1
    ? raw.probTarget
    : base.probTarget
  return {
    activeTargetId: sanitizeShipId(raw.activeTargetId),
    probTarget: prob,
    mode: modes.includes(raw.mode) ? raw.mode : base.mode,
    sortKey: typeof raw.sortKey === 'string' ? raw.sortKey : base.sortKey,
    sortDesc: raw.sortDesc === true,
  }
}

/** 只保留白名单字段；也是「什么会被写进磁盘」的唯一出处 */
export const sanitizePState = raw => {
  const src = isObj(raw) ? raw : {}
  const points = Array.isArray(src.points)
    ? src.points.map(sanitizePoint).filter(Boolean)
    : []
  return {
    targets: sanitizeTargets(src.targets),
    points,
    have: sanitizeHave(src.have),
    ui: sanitizeUi(src.ui),
  }
}

export const toPState = state => ({ $dataVersion: DATA_VERSION, ...sanitizePState(state) })
