/*
  动作定义。

  约定：action.type 一律以 '@@poi-plugin-drop-expect/' 开头，避免与 poi 本体
  及其他插件的 action 撞车。id 在这里生成，reducer 保持纯函数。
*/

export const PREFIX = '@@poi-plugin-drop-expect/'

export const POINT_ADD = `${PREFIX}POINT_ADD`
export const POINT_UPDATE = `${PREFIX}POINT_UPDATE`
export const POINT_REMOVE = `${PREFIX}POINT_REMOVE`
export const TARGET_ADD = `${PREFIX}TARGET_ADD`
export const TARGET_REMOVE = `${PREFIX}TARGET_REMOVE`
export const RATE_SET = `${PREFIX}RATE_SET`
export const RATE_CLEAR = `${PREFIX}RATE_CLEAR`
export const HAVE_SET = `${PREFIX}HAVE_SET`
export const UI_SET = `${PREFIX}UI_SET`
export const P_STATE_READY = `${PREFIX}P_STATE_READY`

let seq = 0

/** 点位 id：时间戳 + 自增，够用且可读 */
export const nextPointId = () => `p-${Date.now()}-${seq++}`

/**
 * 新点位。
 * mapId / cell 允许为空——用户可能先建点位再选海域，此时该行不参与计算。
 */
export const createPoint = (patch = {}) => ({
  id: nextPointId(),
  mapId: patch.mapId ?? null,
  cell: patch.cell ?? null,
  level: patch.level ?? 0,
  rank: patch.rank ?? 'SAB',
  reachRate: 1,
  cost: { supplyFuel: 0, ammo: 0, bauxite: 0, dockFuel: 0, dockSteel: 0, bucket: 0 },
  rates: {},
})

export const addPoint = (patch = {}) => ({ type: POINT_ADD, point: createPoint(patch) })

export const updatePoint = (id, patch) => ({ type: POINT_UPDATE, id, patch })

export const removePoint = id => ({ type: POINT_REMOVE, id })

export const addTarget = shipId => ({ type: TARGET_ADD, shipId })

export const removeTarget = shipId => ({ type: TARGET_REMOVE, shipId })

/** rate 用 0~1 的小数；meta 仅在抓取时带上（S4） */
export const setRate = (pointId, shipId, rate, meta) => ({
  type: RATE_SET,
  pointId,
  shipId,
  rate,
  meta,
})

export const clearRate = (pointId, shipId) => ({ type: RATE_CLEAR, pointId, shipId })

/** manual=true 表示用户手改过，此后不再从 poi 自动同步 */
export const setHave = (patch, manual = true) => ({ type: HAVE_SET, patch, manual })

export const setUi = patch => ({ type: UI_SET, patch })

export const pStateReady = pState => ({ type: P_STATE_READY, pState })
