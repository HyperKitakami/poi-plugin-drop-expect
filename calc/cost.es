/*
  资源消耗计算。

  口径（docs/02-implementation.md §4.3 / D4）：
  - 输入拆成「补给」（出击当下扣的油/弹/铝）与「入渠」（按入渠价折算的油/钢）
  - 对外统一成五项资源：油 = 补给油 + 入渠油；钢 = 入渠钢
  - 桶单独一项，可带小数（0.3 桶/次 这类平均值）
*/

export const COST_KEYS = ['supplyFuel', 'ammo', 'supplySteel', 'bauxite', 'dockFuel', 'dockSteel', 'bucket']

export const RESOURCE_KEYS = ['fuel', 'ammo', 'steel', 'bauxite', 'bucket']

/*
  行分组：补给 = 出击当下扣的，入渠 = 修船折算的，桶算在入渠行。
  钢在两组里都有：喷式强袭/支援消耗的是补给钢，修理消耗的是入渠钢。
*/
export const COST_GROUPS = [
  { id: 'supply', keys: ['supplyFuel', 'ammo', 'supplySteel', 'bauxite'] },
  { id: 'dock', keys: ['dockFuel', 'dockSteel', 'bucket'] },
]

const num = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/** 把残缺/污染的消耗对象补成全 0 起步的合法对象 */
export const normalizeCost = cost => {
  const out = {}
  for (const key of COST_KEYS) {
    out[key] = num(cost && cost[key])
  }
  return out
}

/** 单次出击折算成资源向量 */
export const perSortie = cost => {
  const c = normalizeCost(cost)
  return {
    fuel: c.supplyFuel + c.dockFuel,
    ammo: c.ammo,
    steel: c.supplySteel + c.dockSteel,
    bauxite: c.bauxite,
    bucket: c.bucket,
  }
}

/** 消耗是否完全为空（用于 UI 显示「—」而不是「0」） */
export const isEmptyCost = cost => RESOURCE_KEYS.every(r => perSortie(cost)[r] === 0)

/** n 次出击的总消耗；n 非法时按 0 算，避免把 NaN 传到界面 */
export const totalCost = (cost, n) => {
  const one = perSortie(cost)
  const times = typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0
  const out = {}
  for (const r of RESOURCE_KEYS) {
    out[r] = one[r] * times
  }
  return out
}

/**
 * 反算：现有资源最多能出击多少次，以及卡在哪项资源上。
 * 单次消耗为 0 的资源不构成限制；全部为 0 时返回 Infinity。
 */
export const maxSorties = (cost, have) => {
  const one = perSortie(cost)
  let best = Infinity
  let bottleneck = null
  for (const r of RESOURCE_KEYS) {
    if (one[r] <= 0) {
      continue
    }
    const available = num(have && have[r])
    const limit = Math.floor(available / one[r])
    if (limit < best) {
      best = limit
      bottleneck = r
    }
  }
  return { n: best, bottleneck }
}

/** 需求 vs 持有：给出是否够，以及每一项的缺口 */
export const afford = (have, need) => {
  const shortfall = {}
  let ok = true
  for (const r of RESOURCE_KEYS) {
    const gap = num(need && need[r]) - num(have && have[r])
    shortfall[r] = gap > 0 ? gap : 0
    if (gap > 0) {
      ok = false
    }
  }
  return { ok, shortfall }
}
