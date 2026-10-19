import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildReport,
  buildSetRow,
  buildShipRows,
  isPointUsable,
  pointLabel,
  rateOf,
} from '../calc/aggregate.es'

const POINTS = [
  {
    id: 'p1',
    mapId: '2-2',
    cell: 'B',
    level: 0,
    rank: 'SAB',
    reachRate: 1,
    cost: { supplyFuel: 350, ammo: 420, bauxite: 40, dockFuel: 30, dockSteel: 120, bucket: 0.3 },
    rates: { 71: { rate: 0.03 }, 72: { rate: 0.02 } },
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
  { id: 'draft', mapId: null, cell: null, level: 0, rank: 'SAB', reachRate: 1, cost: {}, rates: { 71: { rate: 0.9 } } },
]

const HAVE = { fuel: 10000, ammo: 100000, steel: 100000, bauxite: 100000, bucket: 100 }
const TARGETS = [{ shipId: 71 }, { shipId: 72 }]

test('基础判定', () => {
  assert.equal(isPointUsable(POINTS[0]), true)
  assert.equal(isPointUsable(POINTS[2]), false, '缺海域/格子是草稿')
  assert.equal(pointLabel(POINTS[0]), '2-2 B')
  assert.equal(pointLabel({ mapId: '62-1', cell: 'X', level: 4 }), '62-1 X 甲')
  assert.equal(rateOf(POINTS[0], 71), 0.03)
  assert.equal(rateOf(POINTS[0], 999), null)
})

test('单舰行：草稿点被排除', () => {
  const rows = buildShipRows({ points: POINTS, shipId: 71, probTarget: 0.9, have: HAVE })
  assert.deepEqual(rows.map(r => r.pointId), ['p1', 'p2'], '草稿点与无序：排序在 buildReport 层做')
  assert.equal(rows[1].n, 45)
  assert.equal(rows[0].n, 76)
  assert.equal(rows[1].expected, 20) // 1 / 0.05
})

test('单舰行：总消耗与缺口', () => {
  const rows = buildShipRows({ points: POINTS, shipId: 71, probTarget: 0.9, have: HAVE })
  const p1 = rows.find(r => r.pointId === 'p1')
  assert.equal(p1.total.fuel, 28880) // (350 + 30) × 76
  assert.equal(p1.total.ammo, 420 * 76)
  assert.equal(p1.budget.ok, false)
  assert.equal(p1.budget.shortfall.fuel, 28880 - 10000)

  const p2 = rows.find(r => r.pointId === 'p2')
  assert.equal(p2.total.fuel, 23850) // 530 × 45
  assert.equal(p2.budget.shortfall.fuel, 13850)
  assert.equal(p2.budget.shortfall.ammo, 0)
})

test('单舰行：反算给出最多次数与对应成功率，并指出瓶颈', () => {
  const rows = buildShipRows({ points: POINTS, shipId: 71, probTarget: 0.9, have: HAVE })
  const p2 = rows.find(r => r.pointId === 'p2')
  assert.equal(p2.reverse.n, 18) // 10000 / 530
  assert.equal(p2.reverse.bottleneck, 'fuel')
  assert.ok(Math.abs(p2.reverse.prob - 0.6027856815) < 1e-9)
})

test('到达率参与计算', () => {
  const point = { ...POINTS[0], reachRate: 0.5 }
  const rows = buildShipRows({ points: [point], shipId: 71, probTarget: 0.9, have: HAVE })
  assert.equal(rows[0].q, 0.015)
  assert.equal(rows[0].n, 153)
})

test('没填掉落率的点位不产生行', () => {
  const rows = buildShipRows({ points: POINTS, shipId: 999, probTarget: 0.9, have: HAVE })
  assert.deepEqual(rows, [])
})

test('集合「至少一艘」按点位给一条结论', () => {
  const row = buildSetRow({
    point: POINTS[0],
    shipIds: [71, 72],
    mode: 'anyOf',
    probTarget: 0.9,
    have: HAVE,
  })
  assert.equal(row.n, 45)
  assert.deepEqual(row.qs, [0.03, 0.02])
  assert.deepEqual(row.missing, [])
  // 反算：10000 / 380 = 26 次，1 - 0.95^26
  assert.equal(row.reverse.n, 26)
  assert.ok(Math.abs(row.reverse.prob - 0.7364799055) < 1e-9)
})

test('集合「全部收集」用精确 DP', () => {
  const row = buildSetRow({
    point: POINTS[0],
    shipIds: [71, 72],
    mode: 'all',
    probTarget: 0.9,
    have: HAVE,
  })
  assert.equal(row.n, 126)
})

test('集合「全部收集」：缺率/目标过多时给出可解释的结果', () => {
  const incomplete = buildSetRow({
    point: POINTS[1],
    shipIds: [71, 72],
    mode: 'all',
    probTarget: 0.9,
    have: HAVE,
  })
  assert.equal(incomplete.reason, 'incomplete-set')
  assert.deepEqual(incomplete.missing, [72])
  assert.equal(incomplete.n, Infinity)

  const many = buildSetRow({
    point: POINTS[0],
    shipIds: [999],
    mode: 'all',
    probTarget: 0.9,
    have: HAVE,
  })
  assert.equal(many.reason, 'no-rate', '该点位一个相关掉落率都没有')

  const manyWithRates = buildSetRow({
    point: {
      ...POINTS[0],
      rates: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [71 + i, { rate: 0.01 }])),
    },
    shipIds: Array.from({ length: 13 }, (_, i) => 71 + i),
    mode: 'all',
    probTarget: 0.9,
    have: HAVE,
  })
  assert.equal(manyWithRates.reason, 'too-many-targets')
  assert.equal(manyWithRates.n, null)
})

test('剩余资源：现有资源 − 需求，负数保留（第一页要按项标红）', () => {
  const rows = buildShipRows({ points: POINTS, shipId: 71, probTarget: 0.9, have: HAVE })
  const p1 = rows.find(r => r.pointId === 'p1')
  assert.equal(p1.remaining.fuel, 10000 - 28880)
  assert.ok(p1.remaining.fuel < 0, '不够时要保留负号')
  assert.equal(p1.remaining.ammo, 100000 - 420 * 76)
  assert.ok(p1.remaining.ammo > 0)

  const p2 = rows.find(r => r.pointId === 'p2')
  assert.equal(p2.remaining.fuel, 10000 - 23850)
})

test('没填消耗时不给剩余（而不是显示「剩余 = 现有」）', () => {
  const emptyCost = [{ ...POINTS[0], cost: {} }]
  const rows = buildShipRows({ points: emptyCost, shipId: 71, probTarget: 0.9, have: HAVE })
  assert.equal(rows[0].remaining, null)
})

test('整份报告：single 按舰分组，其他口径按点位', () => {
  const single = buildReport({
    points: POINTS,
    targets: TARGETS,
    mode: 'single',
    probTarget: 0.9,
    have: HAVE,
  })
  assert.equal(single.groups.length, 2)
  assert.deepEqual(single.groups.map(g => g.shipId), [71, 72])
  assert.equal(single.groups[1].rows.length, 1, '72 只在一个点位上有率')

  const anyOf = buildReport({
    points: POINTS,
    targets: TARGETS,
    mode: 'anyOf',
    probTarget: 0.9,
    have: HAVE,
  })
  assert.equal(anyOf.rows.length, 2, '草稿点不出现')
  assert.equal(anyOf.rows[0].pointId, 'p1', '默认按次数升序')
})

test('整份报告：按总油排序', () => {
  const report = buildReport({
    points: POINTS,
    targets: TARGETS,
    mode: 'single',
    probTarget: 0.9,
    have: HAVE,
    sortKey: 'fuel',
  })
  const rows = report.groups[0].rows
  assert.deepEqual(rows.map(r => r.pointId), ['p2', 'p1'], '23850 < 28880')
})

test('空输入不炸', () => {
  const report = buildReport({ points: [], targets: [], mode: 'single', probTarget: 0.9, have: HAVE })
  assert.deepEqual(report.groups, [])
  const report2 = buildReport({ points: [], targets: TARGETS, mode: 'all', probTarget: 0.9, have: HAVE })
  assert.deepEqual(report2.rows, [])
})
