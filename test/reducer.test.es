import test from 'node:test'
import assert from 'node:assert/strict'

import { reducer, initState } from '../redux/index.es'
import {
  addPoint,
  addTarget,
  clearRate,
  pStateReady,
  removePoint,
  removeTarget,
  setHave,
  setRate,
  updatePoint,
} from '../redux/actions.es'

const base = () => reducer(undefined, { type: '@@INIT' })

test('初始状态形状完整', () => {
  const state = base()
  assert.deepEqual(state.points, [])
  assert.deepEqual(state.targets, [])
  assert.equal(state.ready, false)
  assert.equal(state.have.manual, false)
  assert.equal(state.ui.mode, 'single')
})

test('poi 先塞 {} 时也能补形', () => {
  const state = reducer({}, { type: '@@INIT' })
  assert.deepEqual(state.points, [])
  assert.deepEqual(state.targets, [])
})

test('未知 action 返回同一引用，避免无谓重渲染', () => {
  const state = base()
  assert.equal(reducer(state, { type: '@@poi-plugin-other/something' }), state)
  assert.equal(reducer(state, { type: undefined }), state)
})

test('添加/更新/删除点位', () => {
  let state = reducer(base(), addPoint({ mapId: '2-2', cell: 'B' }))
  assert.equal(state.points.length, 1)
  const id = state.points[0].id
  assert.equal(state.points[0].mapId, '2-2')
  assert.equal(state.points[0].rank, 'SAB')
  assert.equal(state.points[0].reachRate, 1)

  state = reducer(state, updatePoint(id, { cell: 'K', reachRate: 0.8, id: 'hacked' }))
  assert.equal(state.points[0].cell, 'K')
  assert.equal(state.points[0].reachRate, 0.8)
  assert.equal(state.points[0].id, id, 'id 不允许被 patch 覆盖')

  state = reducer(state, removePoint(id))
  assert.equal(state.points.length, 0)
})

test('重复 id 不会被添加两次', () => {
  const state0 = base()
  const action = addPoint({ mapId: '1-1' })
  const state1 = reducer(state0, action)
  const state2 = reducer(state1, action)
  assert.equal(state2.points.length, 1)
})

test('目标舰去重，删除时连带清掉各点位的掉落率', () => {
  let state = base()
  state = reducer(state, addTarget(71))
  state = reducer(state, addTarget(71))
  assert.equal(state.targets.length, 1)

  state = reducer(state, addPoint({ mapId: '2-2', cell: 'B' }))
  const pointId = state.points[0].id
  state = reducer(state, setRate(pointId, 71, 0.0119))
  assert.ok(state.points[0].rates[71])

  state = reducer(state, removeTarget(71))
  assert.equal(state.targets.length, 0)
  assert.equal(state.points[0].rates[71], undefined, '孤儿掉落率必须一并清除')
})

test('掉落率：写入、来源、超界截断、非法值忽略、清除', () => {
  let state = reducer(base(), addPoint({ mapId: '2-2', cell: 'B' }))
  const pointId = state.points[0].id

  state = reducer(state, setRate(pointId, 71, 0.05))
  assert.equal(state.points[0].rates[71].rate, 0.05)
  assert.equal(state.points[0].rates[71].source, 'manual')

  state = reducer(state, setRate(pointId, 71, 0.08, { source: 'kcwiki', sampleSize: 186182 }))
  assert.equal(state.points[0].rates[71].rate, 0.08)
  assert.equal(state.points[0].rates[71].source, 'kcwiki')
  assert.equal(state.points[0].rates[71].sampleSize, 186182)

  state = reducer(state, setRate(pointId, 71, 3))
  assert.equal(state.points[0].rates[71].rate, 1, '超过 1 截断')

  state = reducer(state, setRate(pointId, 71, NaN))
  assert.equal(state.points[0].rates[71].rate, 1, '非法值不覆盖原值')

  state = reducer(state, clearRate(pointId, 71))
  assert.equal(state.points[0].rates[71], undefined)
})

test('现有资源：手改会置 manual', () => {
  let state = reducer(base(), setHave({ fuel: 100 }, true))
  assert.equal(state.have.fuel, 100)
  assert.equal(state.have.manual, true)

  state = reducer(state, setHave({ fuel: 99999, ammo: 88888 }, false))
  assert.equal(state.have.fuel, 99999)
  assert.equal(state.have.manual, false)
})

test('P_STATE_READY 恢复并置 ready', () => {
  const state = reducer(base(), pStateReady({
    targets: [{ shipId: 71 }],
    points: [{ id: 'p1', mapId: '2-2', cell: 'B', level: 0, rank: 'SAB', reachRate: 1, cost: {}, rates: { 71: { rate: 0.01, source: 'manual' } } }],
    have: { fuel: 1234, manual: true },
    ui: { probTarget: 0.8 },
  }))
  assert.equal(state.ready, true)
  assert.equal(state.points.length, 1)
  assert.equal(state.have.fuel, 1234)
  assert.equal(state.ui.probTarget, 0.8)
  assert.equal(state.ui.mode, 'single', '缺失的 ui 字段回落默认值')
})

test('P_STATE_READY 传入垃圾也不炸', () => {
  const state = reducer(base(), pStateReady(null))
  assert.equal(state.ready, true)
  assert.deepEqual(state.points, [])
  assert.equal(state.have.manual, false)
})

test('initState 是冻结语义上的“工厂”，reducer 不就地修改它', () => {
  reducer(base(), setHave({ fuel: 1 }, true))
  assert.equal(initState.have.fuel, 0)
})
