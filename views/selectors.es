/*
  store 取值与派生工具。

  ⚠️ 插件状态在 state.ext[包名]._，漏掉 `_` 会一直拿到 undefined，
  而症状和「还没有数据」一模一样。这里集中处理，别的地方不要直接读 ext。
*/

import { PACKAGE_NAME } from '../redux'
import { normalizeAdmiralId } from '../services/wmfg'

// 每次返回新数组会让 useSelector 认为变了、导致重渲染，所以固定空引用
const EMPTY_ARR = []
const EMPTY_OBJ = {}

export const extSelector = state => {
  const ext = state && state.ext && state.ext[PACKAGE_NAME] && state.ext[PACKAGE_NAME]._
  return ext && typeof ext === 'object' ? ext : EMPTY_OBJ
}

export const readySelector = state => extSelector(state).ready === true

const arr = v => (Array.isArray(v) ? v : EMPTY_ARR)
const obj = v => (v && typeof v === 'object' ? v : EMPTY_OBJ)

export const pointsSelector = state => arr(extSelector(state).points)
export const targetsSelector = state => arr(extSelector(state).targets)
export const haveSelector = state => obj(extSelector(state).have)
export const uiSelector = state => obj(extSelector(state).ui)

export const fcdMapSelector = state => (state && state.fcd && state.fcd.map) || null
export const masterShipsSelector = state => obj(state && state.const && state.const.$ships)
export const masterMapareasSelector = state => obj(state && state.const && state.const.$mapareas)

/** 提督 ID：用来定位 WMFG 的记录目录。poi 存的是字符串，必须统一成数字。 */
export const admiralIdSelector = state =>
  normalizeAdmiralId(state && state.info && state.info.basic && state.info.basic.api_member_id)

/*
  poi 的 info.resources 按 api_material 顺序：
  [0]燃料 [1]弹药 [2]钢材 [3]铝 [4]高速建造材 [5]高速修复材(桶)
  以 kcwiki-report 用 [4] 记「喷火」为佐证。

  手动 memo：res 数组的引用在无关更新时是稳定的，缓存一下可以避免
  每次 render 都造新对象——否则下游 useMemo 会每帧重算整套 DP。
*/
let lastResources = null
let lastResourcesOut = null

export const poiResourcesSelector = state => {
  const res = state && state.info && state.info.resources
  if (!Array.isArray(res) || res.length < 6) {
    return null
  }
  if (res === lastResources) {
    return lastResourcesOut
  }
  lastResources = res
  lastResourcesOut = {
    fuel: res[0],
    ammo: res[1],
    steel: res[2],
    bauxite: res[3],
    bucket: res[5],
  }
  return lastResourcesOut
}

/** 手改过就用存档值，否则实时跟随 poi */
export const effectiveHaveSelector = state => {
  const have = haveSelector(state)
  if (have.manual === true) {
    return have
  }
  return poiResourcesSelector(state) || have
}

export const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

export const getMapOptions = fcdMap =>
  fcdMap && typeof fcdMap === 'object' ? Object.keys(fcdMap).sort(naturalSort) : []

/** 格子候选：排掉出发点（fcd 里 spots 的第 3 位是 'start'） */
export const getSpotOptions = (fcdMap, mapId) => {
  const spots = mapId && fcdMap && fcdMap[mapId] && fcdMap[mapId].spots
  if (!spots || typeof spots !== 'object') {
    return []
  }
  return Object.keys(spots)
    .filter(key => !(Array.isArray(spots[key]) && spots[key][2] === 'start'))
    .sort(naturalSort)
}

/** api_type === 1 表示活动海域；只有活动海域才有 甲/乙/丙/丁 */
export const isEventArea = (mapareas, mapId) => {
  const areaId = String(mapId || '').split('-')[0]
  const area = mapareas && mapareas[areaId]
  return Number(area && area.api_type) === 1
}

/*
  目标舰候选：只留味方舰（api_sortno > 0），并排除「改装后的舰」——
  同一艘船的不同形态在掉落表里只出现一次，留着会重复。
*/
export const getShipOptions = masterShips => {
  if (!masterShips || typeof masterShips !== 'object') {
    return EMPTY_ARR
  }
  const remodeled = new Set(
    Object.values(masterShips)
      .map(ship => Number(ship && ship.api_aftershipid))
      .filter(id => Number.isFinite(id) && id > 0),
  )
  return Object.entries(masterShips)
    .filter(([key, ship]) => {
      const id = (ship && ship.api_id) || Number(key)
      return (
        ship &&
        ship.api_sortno > 0 &&
        typeof ship.api_name === 'string' &&
        ship.api_name.length > 0 &&
        !remodeled.has(id)
      )
    })
    .map(([key, ship]) => ({
      id: (ship && ship.api_id) || Number(key),
      name: ship.api_name,
      yomi: typeof ship.api_yomi === 'string' ? ship.api_yomi : '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
}

export const resolveShipName = (masterShips, shipId) => {
  const ship = masterShips && masterShips[shipId]
  return (ship && ship.api_name) || `#${shipId}`
}

const normalizeText = v =>
  String(v == null ? '' : v)
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('ja')

/*
  搜索匹配：舰名 / 假名 / 舰船 ID。

  ID 必须走单独分支：上面那两条对「153」这种纯数字永远不成立，
  所以以前输入 ID 只会得到「没有匹配」。允许带 # 前缀（#153），也允许
  前后空格；纯数字时按 ID 精确匹配，不做前缀匹配——否则「15」会命中一大片，
  用户反而不知道自己选的是哪艘。
*/
export const shipMatchesQuery = (query, ship) => {
  const raw = String(query == null ? '' : query).trim()
  if (raw === '') {
    return true
  }
  const idText = raw.replace(/^#/, '').trim()
  if (/^\d+$/.test(idText)) {
    return Number(idText) === Number(ship && ship.id)
  }
  const q = normalizeText(raw)
  return normalizeText(ship && ship.name).includes(q) || normalizeText(ship && ship.yomi).includes(q)
}

/*
  改装链的起点。

  掉落统计里同一艘船只记「未改装形态」的名字（村雨，而不是村雨改），
  所以用户按改装后的 ID 或名字找时，要能回到链首。
  这里沿 api_aftershipid 建反向表，一路往回走到没有前驱的那一艘。
*/
export const resolveBaseShipId = (masterShips, shipId) => {
  if (!masterShips || typeof masterShips !== 'object') {
    return null
  }
  const previous = new Map()
  for (const [key, ship] of Object.entries(masterShips)) {
    const id = Number((ship && ship.api_id) || key)
    const next = Number(ship && ship.api_aftershipid)
    if (Number.isFinite(id) && Number.isFinite(next) && next > 0) {
      previous.set(next, id)
    }
  }
  let current = Number(shipId)
  if (!Number.isFinite(current)) {
    return null
  }
  const seen = new Set()
  while (previous.has(current) && !seen.has(current)) {
    seen.add(current)
    current = previous.get(current)
  }
  return current
}

/*
  被 getShipOptions 过滤掉的舰船里，有没有与搜索词匹配的（改装形态、敌舰、未实装）。

  只用来在「没有匹配」的位置给出更具体的原因：用户查「大鳳改」查不到，
  并不是搜索坏了，而是掉落表按「大鳳」记录。
*/
export const findHiddenShipMatch = (masterShips, query) => {
  if (!masterShips || typeof masterShips !== 'object' || !String(query == null ? '' : query).trim()) {
    return null
  }
  const visible = new Set(getShipOptions(masterShips).map(ship => ship.id))
  const hit = Object.entries(masterShips)
    .map(([key, ship]) => ({
      id: Number((ship && ship.api_id) || key),
      name: ship && ship.api_name,
      yomi: (ship && ship.api_yomi) || '',
    }))
    .filter(ship => Number.isFinite(ship.id) && ship.name && !visible.has(ship.id))
    .find(ship => shipMatchesQuery(query, ship))
  if (!hit) {
    return null
  }
  const baseId = resolveBaseShipId(masterShips, hit.id)
  return {
    shipId: hit.id,
    name: hit.name,
    baseId,
    baseName: baseId ? resolveShipName(masterShips, baseId) : null,
  }
}
