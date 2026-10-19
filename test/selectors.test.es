import test from 'node:test'
import assert from 'node:assert/strict'

import {
  filterOptions,
  findHiddenShipMatch,
  getShipOptions,
  resolveBaseShipId,
  shipMatchesQuery,
} from '../views/selectors.es'

/*
  用真实的 ID 关系做样本：
  153 大鳳（链首）/ 156 大鳳改（改装形态）/ 71 利根（独立）/ 501 敵舰（无图鉴号）。
  poi 的 const.$ships 就是 api_mst_ship 的形状，api_aftershipid 指向下一形态。
*/
const MASTER = {
  153: { api_id: 153, api_name: '大鳳', api_yomi: 'たいほう', api_sortno: 153, api_aftershipid: '156' },
  156: { api_id: 156, api_name: '大鳳改', api_yomi: 'たいほうかい', api_sortno: 156, api_aftershipid: '0' },
  71: { api_id: 71, api_name: '利根', api_yomi: 'とね', api_sortno: 63, api_aftershipid: '0' },
  501: { api_id: 501, api_name: '駆逐イ級', api_yomi: '', api_sortno: 0, api_aftershipid: '0' },
}

const ship = (id, name, yomi = '') => ({ id, name, yomi })

test('搜索：按 ID 精确匹配', () => {
  assert.equal(shipMatchesQuery('153', ship(153, '大鳳')), true)
  assert.equal(shipMatchesQuery('#153', ship(153, '大鳳')), true)
  assert.equal(shipMatchesQuery(' 153 ', ship(153, '大鳳')), true)
  assert.equal(shipMatchesQuery('153', ship(156, '大鳳改')), false, 'ID 不做模糊匹配')
  assert.equal(shipMatchesQuery('15', ship(156, '大鳳改')), false, '短数字不该命中一片')
})

test('搜索：舰名与假名仍按包含匹配', () => {
  assert.equal(shipMatchesQuery('大鳳', ship(153, '大鳳', 'たいほう')), true)
  assert.equal(shipMatchesQuery('たいほう', ship(153, '大鳳', 'たいほう')), true)
  assert.equal(shipMatchesQuery('とね', ship(71, '利根', 'とね')), true)
  assert.equal(shipMatchesQuery('鳳', ship(153, '大鳳')), true, '子串也要命中')
  assert.equal(shipMatchesQuery('村雨', ship(153, '大鳳')), false)
})

test('搜索：空查询视为全部通过（列表默认态）', () => {
  assert.equal(shipMatchesQuery('', ship(153, '大鳳')), true)
  assert.equal(shipMatchesQuery('   ', ship(153, '大鳳')), true)
  assert.equal(shipMatchesQuery(null, ship(153, '大鳳')), true)
})

test('候选列表：排除改装形态与敌舰，按名称排序', () => {
  const options = getShipOptions(MASTER)
  assert.deepEqual(options.map(item => item.id).sort((a, b) => a - b), [71, 153])
  assert.ok(!options.some(item => item.id === 156), '改装形态不该重复出现')
  assert.ok(!options.some(item => item.id === 501), '没有图鉴号的是敌舰/未实装')
  assert.deepEqual(options.map(item => item.name), ['大鳳', '利根'], '按 localeCompare(ja) 排序')
  assert.deepEqual(options[0], { id: 153, name: '大鳳', yomi: 'たいほう' })
})

test('改装链：回到链首', () => {
  assert.equal(resolveBaseShipId(MASTER, 156), 153)
  assert.equal(resolveBaseShipId(MASTER, 153), 153)
  assert.equal(resolveBaseShipId(MASTER, 71), 71)
  assert.equal(resolveBaseShipId(null, 153), null)
  assert.equal(resolveBaseShipId(MASTER, 'abc'), null)
})

test('查不到时给出具体原因：查的是改装形态', () => {
  const byId = findHiddenShipMatch(MASTER, '156')
  assert.equal(byId.shipId, 156)
  assert.equal(byId.name, '大鳳改')
  assert.equal(byId.baseId, 153)
  assert.equal(byId.baseName, '大鳳')

  assert.equal(findHiddenShipMatch(MASTER, '大鳳改').shipId, 156, '按名字查也要能识别')
})

test('查不到时给出具体原因：只有真正被过滤的才提示', () => {
  assert.equal(findHiddenShipMatch(MASTER, '153'), null, '153 本来就在列表里，不算隐藏')
  assert.equal(findHiddenShipMatch(MASTER, '村雨'), null, '不存在的舰船不编造提示')
  assert.equal(findHiddenShipMatch(MASTER, ''), null)
  assert.equal(findHiddenShipMatch(null, '156'), null)

  const enemy = findHiddenShipMatch(MASTER, '駆逐イ級')
  assert.equal(enemy.shipId, 501)
  assert.equal(enemy.baseId, 501, '敌舰没有前驱，baseId 等于自身 → UI 不显示「改为加入」')
})

test('候选筛选：空查询不给候选（海域 200 多个，空值铺开会糊一屏）', () => {
  assert.deepEqual(filterOptions(['1-1', '2-2'], ''), [])
  assert.deepEqual(filterOptions(['1-1', '2-2'], '   '), [])
  assert.deepEqual(filterOptions(['1-1', '2-2'], null), [])
  assert.deepEqual(filterOptions(null, '2'), [])
})

test('候选筛选：前缀命中排在包含命中之前', () => {
  const options = ['12-1', '2-2', '2-3', '1-2', '62-1']
  assert.deepEqual(filterOptions(options, '2'), ['2-2', '2-3', '12-1', '1-2', '62-1'])
})

test('候选筛选：大小写不敏感且可截断', () => {
  assert.deepEqual(filterOptions(['a', 'B', 'ab'], 'A'), ['a', 'ab'])
  assert.equal(filterOptions(Array.from({ length: 50 }, (_, i) => `2-${i}`), '2', 5).length, 5)
  assert.deepEqual(filterOptions(['2-2', '3-3'], '9'), [])
})
