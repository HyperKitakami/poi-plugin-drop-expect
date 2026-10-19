/*
  kcwiki 掉落统计（db.kcwiki.cn，poi-statistics）抓取与解析。

  为什么用 Node 的 https 而不是 fetch：
  - 该接口响应没有 Access-Control-Allow-Origin
  - poi 的 BrowserWindow 是 webSecurity: true（未关闭同源策略）
  → 渲染进程里 fetch 一定被拦，http.get 不受同源策略约束

  解析与匹配都是纯函数，可以脱离网络单测；只有 fetchDrop 会发请求。
*/

import { get } from 'https'

const BASE = 'https://db.kcwiki.cn/api/cache'
// 这个键代表「本次没有掉落」，不是一艘船
export const NO_DROP_KEY = '(无)'
const RANKS = new Set(['SAB', 'SA', 'S', 'A', 'B'])
const TIMEOUT_MS = 8000
const MAX_REDIRECTS = 3

const fail = (code, message) => {
  const error = new Error(message)
  error.code = code
  return error
}

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * 拼 kcwiki 的缓存键：drop_map_{海域+图号}_{格}{-难度}-{评价}
 * '2-2' → 22；'62-1' → 621；难度 0（普通图）不加后缀。
 */
export const buildKey = ({ mapId, cell, level = 0, rank = 'SAB' } = {}) => {
  const matched = /^(\d+)-(\d+)$/.exec(String(mapId || '').trim())
  if (!matched) {
    return null
  }
  const point = String(cell || '').trim().toUpperCase()
  if (!/^[A-Z]{1,3}$/.test(point)) {
    return null
  }
  if (!RANKS.has(rank)) {
    return null
  }
  const difficulty = Number(level) > 0 ? `-${Number(level)}` : ''
  return `drop_map_${matched[1]}${matched[2]}_${point}${difficulty}-${rank}`
}

export const buildUrl = point => {
  const key = buildKey(point)
  return key == null ? null : `${BASE}/${key}`
}

/**
 * 解析接口返回。
 * rate 是百分数（1.191 表示 1.191%），分母是该点位该评价的战斗结果总数，
 * 已经包含「无掉落」的情形，所以可直接当作单次到达的掉落率。
 */
export const parseDropPayload = json => {
  if (
    !json ||
    typeof json !== 'object' ||
    !json.data ||
    typeof json.data !== 'object' ||
    Array.isArray(json.data)
  ) {
    throw fail('PARSE', '返回结构异常')
  }

  const ships = {}
  for (const [name, info] of Object.entries(json.data)) {
    if (!name || name === NO_DROP_KEY) {
      continue
    }
    if (!info || typeof info !== 'object') {
      continue
    }
    const rate = Number(info.rate)
    if (!Number.isFinite(rate) || rate <= 0) {
      continue
    }
    ships[name] = {
      rate: clamp01(rate / 100),
      count: Number(info.totalCount) || 0,
    }
  }

  const noDrop = json.data[NO_DROP_KEY]
  const noDropRate = noDrop && Number.isFinite(Number(noDrop.rate)) ? clamp01(Number(noDrop.rate) / 100) : null

  return {
    totalCount: Number(json.totalCount) || 0,
    timeRange: Array.isArray(json.timeRange) && json.timeRange.length === 2 ? json.timeRange.slice(0, 2) : null,
    ships,
    noDropRate,
    fetchedAt: Date.now(),
  }
}

const requestJson = (url, redirects = 0) =>
  new Promise((resolve, reject) => {
    const request = get(url, { headers: { Accept: 'application/json' } }, response => {
      const status = response.statusCode || 0

      if (status >= 300 && status < 400 && response.headers.location && redirects < MAX_REDIRECTS) {
        response.resume()
        const next = new URL(response.headers.location, url).toString()
        resolve(requestJson(next, redirects + 1))
        return
      }
      if (status === 404) {
        response.resume()
        reject(fail('NOT_FOUND', '该海域/难度暂无统计'))
        return
      }
      if (status !== 200) {
        response.resume()
        reject(fail('NETWORK', `HTTP ${status}`))
        return
      }

      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
      })
      response.on('end', () => {
        // 舰船索引对「没有这份数据」的舰船返回 200 + 空 body（不是 404），
        // 所以这里必须先判空，否则会被当成「结构变了」
        if (body.trim() === '') {
          reject(fail('EMPTY', '返回内容为空'))
          return
        }
        try {
          resolve(JSON.parse(body))
        } catch (err) {
          reject(fail('PARSE', '返回内容不是 JSON'))
        }
      })
      response.on('error', err => reject(fail('NETWORK', err.message)))
    })

    request.setTimeout(TIMEOUT_MS, () => {
      request.destroy()
      reject(fail('NETWORK', '请求超时'))
    })
    request.on('error', err => reject(fail('NETWORK', err.message)))
  })

/** 抓取一个点位；失败时抛带 code 的 Error（NOT_FOUND / EMPTY / NETWORK / PARSE / BAD_POINT） */
export const fetchDrop = point => {
  const url = buildUrl(point)
  if (!url) {
    return Promise.reject(fail('BAD_POINT', '点位缺少海域/格子或评价不合法'))
  }
  return requestJson(url).then(json => {
    const parsed = parseDropPayload(json)
    if (parsed.totalCount <= 0 || Object.keys(parsed.ships).length === 0) {
      throw fail('EMPTY', '该点位在统计期内没有样本')
    }
    return parsed
  })
}

/*
  舰名 → 舰娘 ID。

  kcwiki 的键是舰名（日文），与 poi 的 $ships.api_name 基本一致。
  同名（理论上不该有）直接剔除，宁可让用户手填也不要挂错船。
  敌方舰（api_sortno <= 0）不进索引。
*/
export const buildNameIndex = masterShips => {
  const index = new Map()
  const duplicated = new Set()
  for (const [key, ship] of Object.entries(masterShips || {})) {
    if (!ship || !(ship.api_sortno > 0)) {
      continue
    }
    if (typeof ship.api_name !== 'string' || ship.api_name === '') {
      continue
    }
    const id = ship.api_id || Number(key)
    if (!Number.isInteger(id) || id <= 0) {
      continue
    }
    if (index.has(ship.api_name)) {
      duplicated.add(ship.api_name)
    } else {
      index.set(ship.api_name, id)
    }
  }
  for (const name of duplicated) {
    index.delete(name)
  }
  return index
}

export const matchShips = (ships, masterShips) => {
  const index = buildNameIndex(masterShips)
  const matched = {}
  const unmatched = []
  for (const [name, info] of Object.entries(ships || {})) {
    const id = index.get(name)
    if (id == null) {
      unmatched.push(name)
      continue
    }
    matched[id] = info && typeof info.rate === 'number' ? info.rate : 0
  }
  return { matched, unmatched }
}

/*
  反向查询：某艘舰在哪些点位掉落。

  接口：/api/cache/drop_ship_{舰船ID}-{评价}
  与点位缓存同一套命名规则、同一份统计（实测同一点位的 rate / totalCount / rankCount
  与 drop_map_* 完全一致），同样带 30 天滚动窗口。

  ⚠️ 不要用 /drop/ship/{id}/{rank}.json —— 那是老页面 ship.js 在用的旧索引，
  实测已冻结在 2022-05，新舰返回 200 + 空 body。新版页面用的是 ship2.js，
  走的就是下面的 /api/cache 路径。
*/

// 样本低于这个数的点位排在最后，并标「样本少」：n=3 的偶然掉落不具备参考性
export const SHIP_MIN_SAMPLE = 100

// 难度：接口里用汉字（甲/乙/丙/丁），点位里用 1~4（丁=1 … 甲=4）
export const LEVEL_LABEL = { 1: '丁', 2: '丙', 3: '乙', 4: '甲' }
const DIFFICULTY_LEVEL = { 丁: 1, 丙: 2, 乙: 3, 甲: 4 }

/** 解析索引键：'2-2-B'、'5-4-Z(Boss)'、'48-7-Z(Boss)-甲' → 点位 */
export const parseShipDropKey = key => {
  if (typeof key !== 'string') {
    return null
  }
  // Boss 标记可能夹在难度前面（'48-7-Z(Boss)-甲'），所以整串剔除，不能只处理结尾
  const isBoss = /\(boss\)/i.test(key)
  const parts = key.replace(/\(boss\)/gi, '').trim().split('-')
  if (parts.length < 3) {
    return null
  }
  const [area, no, rawCell, rawLevel] = parts
  if (!/^\d+$/.test(area) || !/^\d+$/.test(no)) {
    return null
  }
  const cell = String(rawCell || '').trim().toUpperCase()
  if (!/^[A-Z]{1,3}$/.test(cell)) {
    return null
  }
  const level = rawLevel && DIFFICULTY_LEVEL[rawLevel] ? DIFFICULTY_LEVEL[rawLevel] : 0
  return { mapId: `${area}-${no}`, cell, level, isBoss }
}

export const parseShipDropPayload = json => {
  const data = json && json.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw fail('PARSE', '返回结构异常')
  }
  const entries = []
  for (const [key, info] of Object.entries(data)) {
    const point = parseShipDropKey(key)
    if (!point || !info || typeof info !== 'object') {
      continue
    }
    const rate = Number(info.rate)
    if (!Number.isFinite(rate) || rate <= 0) {
      continue
    }
    entries.push({
      ...point,
      rate: clamp01(rate / 100),
      count: Number(info.totalCount) || 0,
    })
  }
  /*
    排序：先按「样本够不够」分层，层内按掉落率降序。

    纯按率排，n=3 的偶然掉落会以 14% 之类挤到首屏；纯按样本排，
    又会让真正高掉率的点淹没在「样本多但率低」的大图里。
    分层能同时避开这两个坑，且规则一句话能说清。
  */
  const tier = item => (item.count >= SHIP_MIN_SAMPLE ? 0 : 1)
  entries.sort((a, b) => tier(a) - tier(b) || b.rate - a.rate || b.count - a.count)
  return {
    totalCount: Number(json.totalCount) || 0,
    generatedAt: typeof json.generateTime === 'string' ? json.generateTime : null,
    timeRange: Array.isArray(json.timeRange) && json.timeRange.length === 2 ? json.timeRange.slice(0, 2) : null,
    entries,
  }
}

export const fetchShipDrops = (shipId, rank = 'SAB') => {
  const id = Number(shipId)
  if (!Number.isInteger(id) || id <= 0) {
    return Promise.reject(fail('BAD_SHIP', '舰船 ID 不合法'))
  }
  if (!RANKS.has(rank)) {
    return Promise.reject(fail('BAD_SHIP', '评价不合法'))
  }
  return requestJson(`${BASE}/drop_ship_${id}-${rank}`).then(json => {
    const parsed = parseShipDropPayload(json)
    if (parsed.entries.length === 0) {
      throw fail('EMPTY', '该舰船没有掉落记录')
    }
    return parsed
  })
}

export const pointKeyOf = point => `${point.mapId}|${point.cell}|${Number(point.level) || 0}`
