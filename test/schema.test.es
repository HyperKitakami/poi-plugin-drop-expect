import test from 'node:test'
import assert from 'node:assert/strict'

import { DATA_VERSION, sanitizePState, sanitizeRate, sanitizeShipId, toPState } from '../store/schema.es'

test('垃圾输入一律收敛成空状态，不抛错', () => {
  for (const bad of [null, undefined, 0, 'x', [], { points: 'no' }]) {
    const state = sanitizePState(bad)
    assert.deepEqual(state.points, [])
    assert.deepEqual(state.targets, [])
    assert.equal(state.have.manual, false)
    assert.equal(state.ui.mode, 'single')
  }
})

test('点位：缺 id 丢弃，缺海域/格子保留（草稿态）', () => {
  const state = sanitizePState({
    points: [
      { mapId: '2-2', cell: 'B' },
      { id: 'ok', mapId: '2-2', cell: 'b', level: 9, rank: 'ZZ', reachRate: 0, cost: { ammo: 12, junk: 5 } },
      { id: 'draft' },
    ],
  })
  assert.equal(state.points.length, 2)
  assert.equal(state.points[0].id, 'ok')
  assert.equal(state.points[0].level, 0, '非法难度回落 0')
  assert.equal(state.points[0].rank, 'SAB', '非法评价回落 SAB')
  assert.equal(state.points[0].reachRate, 0.01, '到达率下限 1%')
  assert.equal(state.points[0].cost.ammo, 12)
  assert.equal(state.points[0].cost.junk, undefined, '未声明的消耗字段不落盘')
  assert.equal(state.points[1].mapId, null)
  assert.equal(state.points[1].cell, null)
})

test('掉落率：只留合法条目，来源缺省为 manual', () => {
  const state = sanitizePState({
    points: [
      {
        id: 'p',
        mapId: '2-2',
        cell: 'B',
        rates: {
          71: { rate: 0.01, source: 'kcwiki', sampleSize: 1234.7, timeRange: ['a', 'b'], fetchedAt: 1 },
          72: { rate: 1.5 },
          73: { rate: NaN },
          74: { rate: 0.02, source: 'nonsense', extra: 'x' },
          bad: { rate: 0.1 },
        },
      },
    ],
  })
  const rates = state.points[0].rates
  assert.deepEqual(Object.keys(rates), ['71', '74'])
  assert.equal(rates[71].sampleSize, 1234, '样本量取整')
  assert.equal(rates[74].source, 'manual')
  assert.equal(rates[74].extra, undefined)
  assert.equal(rates[71].timeRange.length, 2)
})

test('掉落率锁定：只认 true，且能随存档往返', () => {
  const state = sanitizePState({
    points: [
      {
        id: 'p',
        mapId: '2-2',
        cell: 'B',
        rates: {
          71: { rate: 0.01, locked: true },
          72: { rate: 0.02, locked: 'yes' },
          73: { rate: 0.03, locked: false },
        },
      },
    ],
  })
  const rates = state.points[0].rates
  assert.equal(rates[71].locked, true)
  assert.equal(rates[72].locked, undefined, '非布尔真值不算锁定')
  assert.equal(rates[73].locked, undefined, 'false 不落盘')

  // 写盘再读回来，锁不能丢（sanitize 是白名单，漏字段就会被静默抹掉）
  const round = sanitizePState(JSON.parse(JSON.stringify(toPState(state))))
  assert.equal(round.points[0].rates[71].locked, true)
  assert.equal(round.points[0].rates[71].rate, 0.01)
})

test('点位标签：去空白、截到 10 字、去重、最多 5 个', () => {
  const state = sanitizePState({
    points: [
      {
        id: 'p',
        mapId: '2-2',
        cell: 'B',
        tags: ['  E1  ', 'x'.repeat(20), '', 42, 'E1', 'b', 'c', 'd', 'e', 'f'],
      },
      { id: 'q', mapId: '1-1', cell: 'A' },
    ],
  })
  assert.deepEqual(state.points[0].tags, ['E1', 'xxxxxxxxxx', 'b', 'c', 'd'])
  assert.deepEqual(state.points[1].tags, [], '没标签就是空数组')
})

test('老存档的 note 迁成第一个标签', () => {
  const state = sanitizePState({
    points: [{ id: 'p', mapId: '2-2', cell: 'B', note: 'E1 捞船计划' }],
  })
  assert.deepEqual(state.points[0].tags, ['E1 捞船计划'], '10 字以内原样保留')
  assert.equal(state.points[0].note, undefined, '不再输出 note 字段')

  const long = sanitizePState({ points: [{ id: 'p', mapId: '2-2', cell: 'B', note: 'x'.repeat(40) }] })
  assert.equal(long.points[0].tags[0].length, 10)
})

test('掉落率：允许「已加入但未填率」，非法值仍丢弃', () => {
  const state = sanitizePState({
    points: [
      {
        id: 'p',
        mapId: '2-2',
        cell: 'B',
        rates: { 71: { rate: null, source: 'unset' }, 72: { rate: 'x' }, 73: { rate: 0.01 } },
      },
    ],
  })
  const rates = state.points[0].rates
  assert.deepEqual(Object.keys(rates).sort(), ['71', '73'])
  assert.equal(rates[71].rate, null)
  assert.equal(rates[71].source, 'unset')
})

test('目标舰：去重、丢弃非法 ID', () => {
  const state = sanitizePState({
    targets: [{ shipId: 71 }, { shipId: 71 }, { shipId: 'x' }, { shipId: 0 }, { shipId: 530, note: 'hi' }],
  })
  assert.deepEqual(state.targets.map(t => t.shipId), [71, 530])
  assert.equal(state.targets[1].note, 'hi')
})

test('白名单：写盘只包含约定的字段', () => {
  const persisted = toPState({
    ready: true,
    targets: [],
    points: [],
    have: { fuel: 1, manual: true },
    ui: {},
    somethingElse: 'should not be saved',
  })
  assert.deepEqual(Object.keys(persisted).sort(), ['$dataVersion', 'have', 'points', 'targets', 'ui'])
  assert.equal(persisted.$dataVersion, DATA_VERSION)
  assert.equal(persisted.somethingElse, undefined)
})

test('基础校验函数', () => {
  assert.equal(sanitizeRate(0), 0)
  assert.equal(sanitizeRate(1), 1)
  assert.equal(sanitizeRate(-0.1), null)
  assert.equal(sanitizeRate(1.1), null)
  assert.equal(sanitizeRate('0.5'), null)
  assert.equal(sanitizeShipId(71), 71)
  assert.equal(sanitizeShipId('71'), 71)
  assert.equal(sanitizeShipId(1.5), null)
  assert.equal(sanitizeShipId(-1), null)
})
