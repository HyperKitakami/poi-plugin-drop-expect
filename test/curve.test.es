import test from 'node:test'
import assert from 'node:assert/strict'

import { buildExpectCurves, Y_KEYS } from '../calc/curve.es'

const POINTS = [
  {
    id: 'p1',
    mapId: '2-2',
    cell: 'B',
    level: 0,
    rank: 'SAB',
    reachRate: 1,
    cost: { supplyFuel: 350, ammo: 420, bauxite: 40, dockFuel: 30, dockSteel: 120, bucket: 0.3 },
    rates: { 71: { rate: 0.03 } },
  },
  {
    id: 'p2',
    mapId: '2-3',
    cell: 'G',
    level: 0,
    rank: 'SAB',
    reachRate: 1,
    cost: { supplyFuel: 530, ammo: 500 },
    rates: { 71: { rate: 0.05 } },
  },
  { id: 'draft', mapId: null, cell: null, reachRate: 1, cost: {}, rates: { 71: { rate: 0.9 } } },
  {
    id: 'p3',
    mapId: '3-2',
    cell: 'A',
    level: 0,
    rank: 'SAB',
    reachRate: 1,
    cost: { supplyFuel: 100 },
    rates: {},
  },
]

test('每个有掉落率的点位一条曲线，草稿点与无率点被跳过', () => {
  const curves = buildExpectCurves({ points: POINTS, shipId: 71, yKey: 'n' })
  assert.deepEqual(curves.map(c => c.pointId), ['p2', 'p1'], '按 99% 把握下的需求升序')
})

test('次数曲线单调递增，终点与单点计算一致', () => {
  const curves = buildExpectCurves({ points: POINTS, shipId: 71, yKey: 'n', from: 0.5, to: 0.9, steps: 40 })
  const p1 = curves.find(c => c.pointId === 'p1')
  assert.equal(p1.values.length, 41)
  for (let i = 1; i < p1.values.length; i++) {
    assert.ok(p1.values[i].value >= p1.values[i - 1].value, `第 ${i} 点不单调`)
  }
  assert.equal(p1.values[p1.values.length - 1].value, 76, '90% 把握下 2-2 B 需要 76 次')
})

test('资源曲线 = 次数 × 单次消耗', () => {
  const nCurve = buildExpectCurves({ points: POINTS, shipId: 71, yKey: 'n', from: 0.9, to: 0.9, steps: 1 })
  const fuelCurve = buildExpectCurves({ points: POINTS, shipId: 71, yKey: 'fuel', from: 0.9, to: 0.9, steps: 1 })
  const n1 = nCurve.find(c => c.pointId === 'p1').values[0].value
  const f1 = fuelCurve.find(c => c.pointId === 'p1').values[0].value
  assert.equal(n1, 76)
  assert.equal(f1, 76 * 380, '(350 补给油 + 30 入渠油) × 76')
})

test('没有该资源的消耗时为 0，而不是断线', () => {
  const curves = buildExpectCurves({ points: POINTS, shipId: 71, yKey: 'bucket', from: 0.9, to: 0.9, steps: 1 })
  const p2 = curves.find(c => c.pointId === 'p2')
  assert.equal(p2.values[0].value, 0, '2-3 G 没填桶')
})

test('纵轴非法键返回空数组，不抛错', () => {
  assert.deepEqual(buildExpectCurves({ points: POINTS, shipId: 71, yKey: 'oil' }), [])
  assert.deepEqual(buildExpectCurves({ points: null, shipId: 71 }), [])
  assert.equal(Y_KEYS.includes('bucket'), true)
})

test('到达率参与曲线', () => {
  const slow = { ...POINTS[0], reachRate: 0.5 }
  const curves = buildExpectCurves({ points: [slow], shipId: 71, yKey: 'n', from: 0.9, to: 0.9, steps: 1 })
  assert.equal(curves[0].values[0].value, 153)
})
