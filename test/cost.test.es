import test from 'node:test'
import assert from 'node:assert/strict'

import {
  RESOURCE_KEYS,
  afford,
  isEmptyCost,
  maxSorties,
  normalizeCost,
  perSortie,
  totalCost,
} from '../calc/cost.es'

const cost = {
  supplyFuel: 350,
  ammo: 420,
  bauxite: 40,
  dockFuel: 30,
  dockSteel: 120,
  bucket: 0.3,
}

test('单次消耗合并补给与入渠', () => {
  assert.deepEqual(perSortie(cost), {
    fuel: 380,
    ammo: 420,
    steel: 120,
    bauxite: 40,
    bucket: 0.3,
  })
})

test('脏输入不影响其他项', () => {
  const dirty = { supplyFuel: 100, ammo: NaN, bauxite: -5, dockFuel: '7', dockSteel: 10 }
  const one = perSortie(dirty)
  assert.equal(one.fuel, 100)
  assert.equal(one.ammo, 0)
  assert.equal(one.bauxite, 0)
  assert.equal(one.steel, 10)
  assert.deepEqual(Object.keys(normalizeCost(null)), [
    'supplyFuel',
    'ammo',
    'bauxite',
    'dockFuel',
    'dockSteel',
    'bucket',
  ])
})

test('总消耗 = 单次 × 次数', () => {
  const total = totalCost(cost, 76)
  assert.equal(total.fuel, 380 * 76)
  assert.equal(total.ammo, 420 * 76)
  assert.equal(total.steel, 120 * 76)
  assert.equal(total.bauxite, 40 * 76)
  assert.ok(Math.abs(total.bucket - 22.8) < 1e-9)
  // 非法次数按 0 算，不让 NaN 传到界面
  assert.equal(totalCost(cost, NaN).fuel, 0)
  assert.equal(totalCost(cost, -3).fuel, 0)
})

test('反算：受最紧的资源限制，并指出瓶颈', () => {
  const have = { fuel: 10000, ammo: 100000, steel: 100000, bauxite: 100000, bucket: 100 }
  const { n, bottleneck } = maxSorties(cost, have)
  // 油 380/次 → 26；弹 420 → 238；钢 120 → 833；铝 40 → 2500；桶 0.3 → 333
  assert.equal(n, 26)
  assert.equal(bottleneck, 'fuel')
})

test('反算：单次消耗为 0 的资源不构成限制', () => {
  const onlyAmmo = { ammo: 100 }
  const { n, bottleneck } = maxSorties(onlyAmmo, { fuel: 999, ammo: 1000, steel: 1, bauxite: 1 })
  assert.equal(n, 10)
  assert.equal(bottleneck, 'ammo')

  const none = maxSorties({}, { fuel: 1 })
  assert.equal(none.n, Infinity)
  assert.equal(none.bottleneck, null)
})

test('够不够：给出每项缺口', () => {
  const need = totalCost(cost, 30)
  const enough = afford({ fuel: 20000, ammo: 20000, steel: 20000, bauxite: 20000, bucket: 100 }, need)
  assert.equal(enough.ok, true)
  assert.deepEqual(enough.shortfall, { fuel: 0, ammo: 0, steel: 0, bauxite: 0, bucket: 0 })

  const short = afford({ fuel: 5000, ammo: 20000, steel: 20000, bauxite: 20000, bucket: 100 }, need)
  assert.equal(short.ok, false)
  assert.equal(short.shortfall.fuel, 11400 - 5000)
})

test('空消耗判定', () => {
  assert.equal(isEmptyCost({}), true)
  assert.equal(isEmptyCost({ bucket: 0.01 }), false)
  assert.deepEqual(Object.keys(totalCost({}, 5)), RESOURCE_KEYS)
})
