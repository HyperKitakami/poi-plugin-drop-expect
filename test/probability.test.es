import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ALL_DP_MAX_K,
  allApproxP,
  allCurve,
  allN,
  allP,
  anyOfN,
  anyOfP,
  expectedAll,
  expectedAnyOf,
  expectedSingle,
  normalizeQ,
  singleN,
  singleP,
  sumQ,
} from '../calc/probability.es'

const close = (actual, want, tol = 1e-6) =>
  assert.ok(Math.abs(actual - want) < tol, `expected ${want}, got ${actual}`)

test('单舰：分位数与概率', () => {
  assert.equal(singleN(0.03, 0.9), 76)
  close(singleP(0.03, 76), 0.9012239161)
  assert.equal(singleN(0.03, 0.5), 23)
  assert.equal(singleN(0.03, 0.99), 152)
})

test('到达率 80% 时 3% 的点位要 95 次', () => {
  // q = r · p = 0.8 × 0.03
  assert.equal(singleN(0.8 * 0.03, 0.9), 95)
  assert.equal(singleN(0.024, 0.9), 95)
})

test('单舰：边界', () => {
  assert.equal(singleN(0, 0.9), Infinity)
  assert.equal(singleN(0.03, 1), Infinity)
  assert.equal(singleN(0.03, 1.2), Infinity)
  assert.equal(singleN(0.03, 0), 0)
  assert.equal(singleN(0.03, -0.5), 0)
  assert.equal(singleN(1, 0.9), 1)
  assert.equal(singleP(0, 100), 0)
  assert.equal(singleP(0.03, 0), 0)
  assert.equal(singleP(1, 3), 1)
})

test('单舰：小概率大次数不丢精度', () => {
  // (1-1e-6)^1e6 的精确值；naive 的 1-Math.pow 会差在末几位
  close(singleP(1e-6, 1000000), 0.6321207427683548, 1e-12)
  // q=1e-9 时 1-(1-q)^n 出现灾难性抵消，改用 expm1/log1p 才能保住这几位
  close(singleP(1e-9, 1000000), 0.0009995001671245088, 1e-15)
})

test('集合「至少一艘」', () => {
  assert.equal(anyOfN([0.03, 0.02], 0.9), 45)
  close(anyOfP([0.03, 0.02], 50), 0.9230550247, 1e-9)
  assert.equal(anyOfN([], 0.9), Infinity)
  // 合计超过 1 时按 1 处理，不返回 NaN
  assert.equal(anyOfP([0.8, 0.7], 5), 1)
})

test('集合「全部收集」：精确 DP 基准值', () => {
  assert.equal(allN([0.03, 0.02], 0.5), 51)
  assert.equal(allN([0.03, 0.02], 0.8), 94)
  assert.equal(allN([0.03, 0.02], 0.9), 126)
  assert.equal(allN([0.03, 0.02], 0.99), 233)
  close(allP([0.03, 0.02], 50), 0.4947099198, 1e-9)
  close(allP([0.3, 0.3], 5), 0.6741, 1e-9)
})

test('DP 比独立乘积近似更保守（近似偏乐观）', () => {
  const exact = allP([0.3, 0.3], 5)
  const approx = allApproxP([0.3, 0.3], 5)
  close(approx, 0.6921, 1e-4)
  assert.ok(approx > exact, '近似应高于精确值，这正是不能用的原因')
})

test('集合「全部收集」：边界', () => {
  assert.equal(allP([0.5], 0), 0)
  assert.equal(allP([], 5), 1)
  assert.equal(allN([], 0.9), 0)
  assert.equal(allP([0.03, 0], 100), 0)
  assert.equal(allN([0.03, 0], 0.9), Infinity)
  assert.equal(allN([0.5], 1), Infinity)
  assert.equal(allP([1, 0.5], 1), 0)
  assert.equal(allP([1, 0.5], 2), 1)
})

test('目标数超过 DP 上限时明确报错，而不是静默降级', () => {
  const tooMany = Array.from({ length: ALL_DP_MAX_K + 1 }, () => 0.01)
  assert.throws(() => allP(tooMany, 10), RangeError)
})

test('曲线与逐点计算一致、单调不减', () => {
  const qs = [0.03, 0.02]
  const curve = allCurve(qs, 60)
  assert.equal(curve.length, 61)
  assert.equal(curve[0], 0)
  for (let n = 1; n < curve.length; n++) {
    assert.ok(curve[n] >= curve[n - 1], `n=${n} 处不单调`)
  }
  close(curve[50], allP(qs, 50), 1e-12)
  close(curve[60], allP(qs, 60), 1e-12)
})

test('平均次数：全收集不等于 1/Σq', () => {
  // 两艘 3%/2% 的精确期望是 1/0.03 + 1/0.02 - 1/0.05 = 63.33
  close(expectedAll([0.03, 0.02]), 63.3333333, 1e-4)
  close(expectedAll([0.05, 0.05]), 30, 1e-4)
  assert.equal(expectedSingle(0.03), 1 / 0.03)
  assert.equal(expectedAnyOf([0.03, 0.02]), 20)
})

test('normalizeQ / sumQ 对脏输入收敛', () => {
  assert.equal(normalizeQ(-1), 0)
  assert.equal(normalizeQ(NaN), 0)
  assert.equal(normalizeQ('0.5'), 0)
  assert.equal(normalizeQ(1.5), 1)
  assert.equal(sumQ([0.6, 0.6]), 1)
  assert.equal(sumQ(null), 0)
  assert.equal(sumQ([]), 0)
})
