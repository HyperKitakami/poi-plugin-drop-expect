/*
  从 wheres-my-fuel-gone 的出击记录里统计「某海域、某时间段」的平均消耗。

  为什么读 WMFG 而不是自己采集：
  - WMFG 的 records 是逐船状态差（api_fuel/bull/onslot/ndock_item），
    这是目前唯一被证实可用的消耗口径；全局资源差不可用（见 docs/01 §4.3）
  - 它已经积累了大量历史，接入即刻可用；自采要从零开始攒
  代价：它是另一个插件，路径与字段属于外部约定，读坏了不能让本插件崩。

  记录格式（实测）：
    [{ map: {id:'2-2', name, hp?}, time, fleet: [{id, shipId, consumption:[6], bucket?}],
       fleet1Size, supports?: [{consumption:[4]}], airbase?: {sortie,destruction,jetAssault,resupply} }]
  consumption = [补给油, 弹, 铝, 入渠油, 入渠钢, 喷式强袭钢]

  注意：记录只有「海域」，没有格子。所以算出来的是整个海域的平均，
  路线不固定时会有误差，UI 必须说清楚。
*/

import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const DIR = 'wheres-my-fuel-gone'
const FILE = 'sortie_records.json'

const num = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

export const getRecordsPath = (appDataPath, admiralId) =>
  join(appDataPath, DIR, String(admiralId), FILE)

/**
 * 提督 ID 归一化。
 *
 * ⚠️ poi 存的是**字符串**（本体里是 `api_member_id: `${...}``），
 * 之前这里用 Number.isInteger 直接判，导致恒为 null、一直提示「未读到提督 ID」。
 * 现在同时接受数字与数字字符串，非正整数一律返回 null。
 */
export const normalizeAdmiralId = raw => {
  const id = typeof raw === 'string' ? Number(raw.trim()) : raw
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * 单条记录 → { time, mapId, cost, extra }。
 * cost 对应本插件的消耗模型；extra 是支援与陆航，默认不计入（单独展示）。
 */
export const normalizeRecord = raw => {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const time = Number(raw.time)
  const mapId = raw.map && typeof raw.map.id === 'string' ? raw.map.id : null
  if (!Number.isFinite(time) || !mapId) {
    return null
  }

  const cost = { supplyFuel: 0, ammo: 0, bauxite: 0, dockFuel: 0, dockSteel: 0, bucket: 0 }
  const fleet = Array.isArray(raw.fleet) ? raw.fleet : []
  for (const ship of fleet) {
    const consumption = ship && Array.isArray(ship.consumption) ? ship.consumption : null
    if (consumption) {
      cost.supplyFuel += num(consumption[0])
      cost.ammo += num(consumption[1])
      cost.bauxite += num(consumption[2])
      cost.dockFuel += num(consumption[3])
      // 入渠钢 + 喷式强袭钢，两者都是钢
      cost.dockSteel += num(consumption[4]) + num(consumption[5])
    }
    if (ship && ship.bucket === true) {
      cost.bucket += 1
    }
  }

  const extra = { fuel: 0, ammo: 0, steel: 0, bauxite: 0 }
  for (const support of Array.isArray(raw.supports) ? raw.supports : []) {
    const consumption = support && Array.isArray(support.consumption) ? support.consumption : null
    if (consumption) {
      extra.fuel += num(consumption[0])
      extra.ammo += num(consumption[1])
      extra.bauxite += num(consumption[3])
    }
  }
  const airbase = raw.airbase
  if (airbase && typeof airbase === 'object') {
    for (const key of ['sortie', 'destruction', 'jetAssault', 'resupply']) {
      const consumption = Array.isArray(airbase[key]) ? airbase[key] : null
      if (consumption) {
        extra.fuel += num(consumption[0])
        extra.ammo += num(consumption[1])
        extra.steel += num(consumption[2])
        extra.bauxite += num(consumption[3])
      }
    }
  }

  return { time, mapId, cost, extra }
}

const COST_KEYS = ['supplyFuel', 'ammo', 'bauxite', 'dockFuel', 'dockSteel', 'bucket']
const EXTRA_KEYS = ['fuel', 'ammo', 'steel', 'bauxite']

/**
 * 按海域 + 时间段聚合。
 * from / to 为毫秒时间戳，null 表示不限。
 */
export const aggregateRecords = (records, { mapId, from = null, to = null } = {}) => {
  const empty = { count: 0, avg: null, extraAvg: null, firstAt: null, lastAt: null, totalBuckets: 0 }
  if (!mapId || !Array.isArray(records)) {
    return empty
  }

  const sum = Object.fromEntries(COST_KEYS.map(k => [k, 0]))
  const extraSum = Object.fromEntries(EXTRA_KEYS.map(k => [k, 0]))
  let count = 0
  let firstAt = null
  let lastAt = null

  for (const record of records) {
    if (!record || record.mapId !== mapId) {
      continue
    }
    if (from != null && record.time < from) {
      continue
    }
    if (to != null && record.time > to) {
      continue
    }
    count += 1
    for (const key of COST_KEYS) {
      sum[key] += record.cost[key] || 0
    }
    for (const key of EXTRA_KEYS) {
      extraSum[key] += record.extra[key] || 0
    }
    if (firstAt == null || record.time < firstAt) {
      firstAt = record.time
    }
    if (lastAt == null || record.time > lastAt) {
      lastAt = record.time
    }
  }

  if (count === 0) {
    return { ...empty, firstAt, lastAt }
  }

  const avg = Object.fromEntries(COST_KEYS.map(k => [k, sum[k] / count]))
  const extraAvg = Object.fromEntries(EXTRA_KEYS.map(k => [k, extraSum[k] / count]))
  return { count, avg, extraAvg, firstAt, lastAt, totalBuckets: sum.bucket }
}

// 文件可能很大（本机 11MB / 3 万条），按 mtime+size 缓存解析结果
let cache = { key: null, records: null }

const resolveAppDataPath = appDataPath => {
  if (typeof appDataPath === 'string' && appDataPath !== '') {
    return appDataPath
  }
  if (typeof window !== 'undefined' && typeof window.APPDATA_PATH === 'string' && window.APPDATA_PATH) {
    return window.APPDATA_PATH
  }
  return null
}

/**
 * 读取并解析。
 * 返回 { ok, records, total } 或 { ok:false, reason }，绝不抛错——
 * 这是别人的插件写的数据，坏了也不能拖垮本插件。
 */
export const readRecords = (admiralId, appDataPath) => {
  const base = resolveAppDataPath(appDataPath)
  if (!base) {
    return { ok: false, reason: 'NO_PATH' }
  }
  // 不信任调用方：数字字符串也接受
  const id = normalizeAdmiralId(admiralId)
  if (!id) {
    return { ok: false, reason: 'NO_ADMIRAL' }
  }
  const path = getRecordsPath(base, id)
  if (!existsSync(path)) {
    return { ok: false, reason: 'MISSING', path }
  }

  try {
    const stat = statSync(path)
    const key = `${path}:${stat.mtimeMs}:${stat.size}`
    if (cache.key === key && cache.records) {
      return { ok: true, records: cache.records, cached: true }
    }
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(raw)) {
      return { ok: false, reason: 'BAD', path }
    }
    const records = raw.map(normalizeRecord).filter(Boolean)
    cache = { key, records }
    return { ok: true, records, total: raw.length, path }
  } catch (err) {
    console.error('[drop-expect] 读取出击记录失败', err)
    return { ok: false, reason: 'BAD', path, error: err && err.message }
  }
}
