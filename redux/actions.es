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
export const RATE_LINK = `${PREFIX}RATE_LINK`
export const RATE_LOCK = `${PREFIX}RATE_LOCK`
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
  tags: Array.isArray(patch.tags) ? patch.tags.slice(0, 5) : [],
  mapId: patch.mapId ?? null,
  cell: patch.cell ?? null,
  level: patch.level ?? 0,
  rank: patch.rank ?? 'SAB',
  reachRate: 1,
  cost: { supplyFuel: 0, ammo: 0, supplySteel: 0, bauxite: 0, dockFuel: 0, dockSteel: 0, bucket: 0 },
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

/**
 * 把一个舰船挂到点位下但还不填率（占位）。
 * 抓取列表里手选、或从全局清单里挑进来时用它，之后由 RATE_SET 补值。
 */
export const linkRate = (pointId, shipId) => ({ type: RATE_LINK, pointId, shipId })

/**
 * 锁定/解锁某艘船在该点位上的掉落率。
 *
 * 锁定是「值受保护」：抓取不会覆盖、输入框不能改、也不能把这条从点位里删掉。
 * 只有本 action 能解开——这是唯一的口子，别在别处顺手写 locked。
 */
export const setRateLock = (pointId, shipId, locked) => ({
  type: RATE_LOCK,
  pointId,
  shipId,
  locked: locked === true,
})

/** manual=true 表示用户手改过，此后不再从 poi 自动同步 */
export const setHave = (patch, manual = true) => ({ type: HAVE_SET, patch, manual })

export const setUi = patch => ({ type: UI_SET, patch })

export const pStateReady = pState => ({ type: P_STATE_READY, pState })
