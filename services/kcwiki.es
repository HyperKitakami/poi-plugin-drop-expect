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
