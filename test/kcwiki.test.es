import test from 'node:test'
import assert from 'node:assert/strict'

import {
  NO_DROP_KEY,
  buildKey,
  buildNameIndex,
  buildUrl,
  matchShips,
  parseDropPayload,
} from '../services/kcwiki.es'

test('缓存键：普通图不带难度后缀', () => {
  assert.equal(buildKey({ mapId: '2-2', cell: 'B', level: 0, rank: 'SAB' }), 'drop_map_22_B-SAB')
  assert.equal(buildKey({ mapId: '6-1', cell: 'C', level: 0, rank: 'S' }), 'drop_map_61_C-S')
})

test('缓存键：活动图带难度，格子统一大写', () => {
  assert.equal(buildKey({ mapId: '62-1', cell: 'a', level: 1, rank: 'SAB' }), 'drop_map_621_A-1-SAB')
  assert.equal(buildKey({ mapId: '62-1', cell: 'K', level: 4, rank: 'SA' }), 'drop_map_621_K-4-SA')
})

test('缓存键：非法输入返回 null 而不是拼出坏 URL', () => {
  assert.equal(buildKey({ mapId: '2', cell: 'B' }), null)
  assert.equal(buildKey({ mapId: '2-2', cell: '' }), null)
  assert.equal(buildKey({ mapId: '2-2', cell: 'B', rank: 'AB' }), null) // 接口不支持 AB
  assert.equal(buildKey({ mapId: '2-2', cell: '22' }), null)
  assert.equal(buildUrl({ mapId: '2-2', cell: 'B' }), 'https://db.kcwiki.cn/api/cache/drop_map_22_B-SAB')
})

const payload = {
  totalCount: 1000,
  timeRange: ['2026-08-29 22:20:02', '2026-09-28 22:20:02'],
  data: {
    村雨: { rankCount: [19, 2, 0], totalCount: 21, rate: 2.1 },
    [NO_DROP_KEY]: { rankCount: [500, 100, 0], totalCount: 600, rate: 60 },
    零率: { totalCount: 0, rate: 0 },
    坏数据: null,
  },
}

test('解析：百分数转 0~1，排除「(无)」', () => {
  const parsed = parseDropPayload(payload)
  assert.equal(parsed.totalCount, 1000)
  assert.deepEqual(parsed.timeRange, ['2026-08-29 22:20:02', '2026-09-28 22:20:02'])
  assert.deepEqual(Object.keys(parsed.ships), ['村雨'])
  assert.ok(Math.abs(parsed.ships['村雨'].rate - 0.021) < 1e-12)
  assert.equal(parsed.ships['村雨'].count, 21)
  assert.equal(parsed.ships[NO_DROP_KEY], undefined, '「(无)」不能被当成舰船')
  assert.ok(Math.abs(parsed.noDropRate - 0.6) < 1e-12, '无掉落占比单独保留')
  assert.equal(typeof parsed.fetchedAt, 'number')
})

test('解析：结构异常直接报 PARSE', () => {
  for (const bad of [null, 0, 'x', {}, { data: [] }, { data: 'x' }]) {
    assert.throws(() => parseDropPayload(bad), err => err.code === 'PARSE')
  }
})

test('舰名索引：排除敌方舰与同名舰', () => {
  const masterShips = {
    71: { api_id: 71, api_name: '利根', api_sortno: 63 },
    34: { api_id: 34, api_name: '暁', api_sortno: 34 },
    1501: { api_id: 1501, api_name: '駆逐イ級', api_sortno: 0 },
    900: { api_id: 900, api_name: '重名', api_sortno: 1 },
    901: { api_id: 901, api_name: '重名', api_sortno: 2 },
  }
  const index = buildNameIndex(masterShips)
  assert.equal(index.get('利根'), 71)
  assert.equal(index.get('駆逐イ級'), undefined, '敌方舰不进索引')
  assert.equal(index.get('重名'), undefined, '同名不猜，交给手填')
})

test('匹配：只认出味方舰，其余进 unmatched', () => {
  const masterShips = {
    71: { api_id: 71, api_name: '利根', api_sortno: 63 },
    34: { api_id: 34, api_name: '暁', api_sortno: 34 },
    1501: { api_id: 1501, api_name: '駆逐イ級', api_sortno: 0 },
  }
  const { matched, unmatched } = matchShips(
    {
      利根: { rate: 0.01 },
      暁: { rate: 0.02 },
      駆逐イ級: { rate: 0.5 },
      未知舰: { rate: 0.04 },
    },
    masterShips,
  )
  assert.deepEqual(matched, { 34: 0.02, 71: 0.01 })
  assert.deepEqual(unmatched.sort(), ['未知舰', '駆逐イ級'].sort())
})

test('匹配：缺舰船列表时全部 unmatched，不抛错', () => {
  const { matched, unmatched } = matchShips({ 利根: { rate: 0.01 } }, null)
  assert.deepEqual(matched, {})
  assert.deepEqual(unmatched, ['利根'])
})
