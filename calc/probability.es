/*
  掉落概率计算核心。

  约束（docs/02-implementation.md §6）：
  - 纯函数：不 import 任何 poi / React / Electron 模块，也不 import services/
  - 零运行时依赖：只用语言内置能力
  - 口径：q = 单次**出击**获得该舰的概率 = 到达率 × 单次到达掉落率

  模型前提（§4.1）：
  - 一次到达最多掉落一艘（api_get_ship 是单对象），各舰在同次内互斥
  - 各次出击相互独立
*/

// DP 的状态数是 2^k，k 超过 12 就要 4096 个状态；再大应改用近似
export const ALL_DP_MAX_K = 12

// 防止 q 极小时 n 无限膨胀把界面卡死
const MAX_N = 1000000

const isPositive = v => typeof v === 'number' && Number.isFinite(v) && v > 0
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v)

/** 把任意输入收敛成 [0,1] 的概率；非数值、负数、NaN 一律当 0 */
export const normalizeQ = q => (isPositive(q) ? clamp01(q) : 0)

/** 集合的合概率（互斥事件相加，超过 1 截断） */
export const sumQ = qs => {
  let s = 0
  for (const q of qs || []) {
    s += normalizeQ(q)
  }
  return clamp01(s)
}

/*
  单舰：P(n) = 1 - (1-q)^n

  用 expm1/log1p 而不是 Math.pow：q 很小、n 很大时 1-(1-q)^n 会因相减丢精度，
  -expm1(n·log1p(-q)) 在同样的输入下是稳定的。
*/
export const singleP = (q, n) => {
  const p = normalizeQ(q)
  if (p <= 0 || !(n > 0)) {
    return 0
  }
  if (p >= 1) {
    return 1
  }
  return -Math.expm1(n * Math.log1p(-p))
}

/*
  单舰：n(t) = ceil( ln(1-t) / ln(1-q) )

  ceil 前减 1e-9：浮点比值的误差量级是 1e-16，这点修正足以避免
  「算出来本该是 76 却因 76.0000000001 得到 77」。
*/
export const singleN = (q, t) => {
  const p = normalizeQ(q)
  if (!(t > 0)) {
    return 0
  }
  if (t >= 1) {
    return Infinity
  }
  if (p <= 0) {
    return Infinity
  }
  if (p >= 1) {
    return 1
  }
  return Math.ceil(Math.log1p(-t) / Math.log1p(-p) - 1e-9)
}

/** 集合「至少一艘」：因同次互斥，q_any = Σq_i 是精确合概率 */
export const anyOfP = (qs, n) => singleP(sumQ(qs), n)

/** 集合「至少一艘」的分位数 */
export const anyOfN = (qs, t) => singleN(sumQ(qs), t)

/*
  「全部收集」的滚动 DP 机。

  dp[mask] = 已收集 mask 中这些舰的概率；每步
    dp'[m]          += dp[m] · (本次无掉落)
    dp'[m | 1<<i]   += dp[m] · q_i
  用两个缓冲区轮换，避免每步分配新数组。
*/
const createMachine = qs => {
  const list = (qs || []).map(normalizeQ)
  const k = list.length
  if (k === 0) {
    return null
  }
  if (k > ALL_DP_MAX_K) {
    throw new RangeError(`目标数 ${k} 超过 DP 上限 ${ALL_DP_MAX_K}`)
  }
  const size = 1 << k
  const full = size - 1
  const none = Math.max(0, 1 - list.reduce((a, b) => a + b, 0))
  let cur = new Float64Array(size)
  let next = new Float64Array(size)
  cur[0] = 1

  const step = () => {
    next.fill(0)
    for (let m = 0; m < size; m++) {
      const v = cur[m]
      if (v === 0) {
        continue
      }
      if (none > 0) {
        next[m] += v * none
      }
      for (let i = 0; i < k; i++) {
        next[m | (1 << i)] += v * list[i]
      }
    }
    const swap = cur
    cur = next
    next = swap
  }

  return { step, prob: () => cur[full], k, size }
}

/** 「全部收集」：n 次出击后全部至少出过一次的概率（精确 DP） */
export const allP = (qs, n) => {
  const machine = createMachine(qs)
  if (!machine) {
    return 1
  }
  if (!(n > 0)) {
    return 0
  }
  if (sumQ(qs) <= 0 || (qs || []).some(q => normalizeQ(q) <= 0)) {
    // 有一艘概率为 0，就永远集不齐
    return 0
  }
  for (let i = 0; i < n; i++) {
    machine.step()
  }
  return machine.prob()
}

/**
 * 「全部收集」的分位数：逐步推进，第一次达到 t 即返回。
 * 不做倍增+二分——那会从头重算 DP，而单次推进本身就是 O(2^k·k)。
 */
export const allN = (qs, t) => {
  const machine = createMachine(qs)
  if (!machine) {
    return 0
  }
  if (!(t > 0)) {
    return 0
  }
  if (t >= 1) {
    return Infinity
  }
  if (sumQ(qs) <= 0 || (qs || []).some(q => normalizeQ(q) <= 0)) {
    return Infinity
  }
  /*
    收集齐一定不比「至少一艘」早，所以「至少一艘」的闭式解是下界。
    若下界已经大到不值得算，直接返回 Infinity，避免为了极小概率
    把 DP 推上百万步、把界面卡死。
  */
  const lowerBound = anyOfN(qs, t)
  if (!Number.isFinite(lowerBound) || lowerBound > MAX_N) {
    return Infinity
  }
  for (let n = 1; n <= MAX_N; n++) {
    machine.step()
    if (machine.prob() >= t) {
      return n
    }
  }
  return Infinity
}

/** 一次 DP 产出整条曲线，供概率曲线复用；返回值下标即次数 */
export const allCurve = (qs, nMax) => {
  const machine = createMachine(qs)
  const limit = Math.max(0, Math.floor(nMax) || 0)
  if (!machine) {
    return new Array(limit + 1).fill(1)
  }
  const out = new Array(limit + 1)
  out[0] = 0
  for (let n = 1; n <= limit; n++) {
    machine.step()
    out[n] = machine.prob()
  }
  return out
}

/**
 * 「全部收集」的平均次数 E[T] = Σ_{n≥0} (1 - P(T≤n))。
 * 注意它不等于 1/Σq：两艘 3%/2% 时精确值是 63.33，而 1/0.05 = 20。
 */
export const expectedAll = (qs, maxIter = 20000) => {
  const machine = createMachine(qs)
  if (!machine) {
    return 0
  }
  if (sumQ(qs) <= 0 || (qs || []).some(q => normalizeQ(q) <= 0)) {
    return Infinity
  }
  /*
    每步成本是 O(2^k·k)，目标多时不能一路算到 maxIter。
    按总工作量给一个上限，算不完就返回 Infinity（界面显示「—」），
    而不是让面板卡住。收敛不了本身也说明这个值没有展示意义。
  */
  const budget = 5e7
  const perStep = machine.size * Math.max(1, machine.k)
  const limit = Math.min(maxIter, Math.floor(budget / perStep))
  let sum = 0
  for (let n = 0; n <= limit; n++) {
    const miss = 1 - machine.prob()
    sum += miss
    if (n > 10 && miss < 1e-13) {
      return sum
    }
    machine.step()
  }
  return Infinity
}

/** 单舰平均次数 E[n] = 1/q */
export const expectedSingle = q => {
  const p = normalizeQ(q)
  return p > 0 ? 1 / p : Infinity
}

/** 集合「至少一艘」平均次数 */
export const expectedAnyOf = qs => expectedSingle(sumQ(qs))

/*
  独立乘积近似：∏(1-(1-q_i)^n)。

  只保留给「目标过多、DP 退化」的兜底与对照测试。它假设各舰互不排斥，
  实际会**偏乐观**（p=30%/30%、n=5 时精确 0.6741、近似 0.6921）。
*/
export const allApproxP = (qs, n) => {
  const list = (qs || []).map(normalizeQ)
  if (list.length === 0) {
    return 1
  }
  if (!(n > 0)) {
    return 0
  }
  let acc = 1
  for (const q of list) {
    acc *= singleP(q, n)
  }
  return acc
}
