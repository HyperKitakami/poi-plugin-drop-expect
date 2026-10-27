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

/*
  加权消耗：把五项折成一个可比的价格。

  默认权重按「稀缺程度」给：油 1、弹 0.5、钢 0.3、铝 10、桶 100。
  铝和桶远高于油弹钢，是因为远征产出慢、且桶还要额外补给；
  钢给 0.3 是因为它最容易堆积。数值只是默认值，界面上可以改。
*/
export const DEFAULT_WEIGHTS = { fuel: 1, ammo: 0.5, steel: 0.3, bauxite: 10, bucket: 100 }

const weightOf = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

/** 补齐缺失/非法的权重，负值与小数值都按「未设置」处理 */
export const normalizeWeights = raw => {
  const out = {}
  for (const key of RESOURCE_KEYS) {
    const given = weightOf(raw && raw[key])
    out[key] = given == null ? DEFAULT_WEIGHTS[key] : given
  }
  return out
}

/**
 * 一组资源向量按权重折成单个数。
 * total 缺失（这个点位没填消耗）时返回 null —— 排序时空值一律沉底，
 * 不能当成 0，否则「没填」会排到最前、看起来最省。
 */
export const weightedTotal = (total, weights) => {
  if (!total || typeof total !== 'object') {
    return null
  }
  const w = normalizeWeights(weights)
  let sum = 0
  let seen = false
  for (const key of RESOURCE_KEYS) {
    const value = total[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      continue
    }
    sum += value * w[key]
    seen = true
  }
  return seen ? sum : null
}
