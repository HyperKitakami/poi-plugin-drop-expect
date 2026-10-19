import test from 'node:test'
import assert from 'node:assert/strict'

import {
  NO_DROP_KEY,
  buildKey,
  buildNameIndex,
  buildUrl,
  matchShips,
  parseDropPayload,
  LEVEL_LABEL,
  parseShipDropKey,
  parseShipDropPayload,
  pointKeyOf,
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

test('反查键：普通格、Boss 格、活动难度都能解析', () => {
  assert.deepEqual(parseShipDropKey('2-2-B'), { mapId: '2-2', cell: 'B', level: 0, isBoss: false })
  assert.deepEqual(parseShipDropKey('5-4-Z(Boss)'), {
    mapId: '5-4',
    cell: 'Z',
    level: 0,
    isBoss: true,
  })
  assert.deepEqual(parseShipDropKey('48-7-Y-甲'), { mapId: '48-7', cell: 'Y', level: 4, isBoss: false })
  assert.deepEqual(parseShipDropKey('48-7-Z(Boss)-丁'), {
    mapId: '48-7',
    cell: 'Z',
    level: 1,
    isBoss: true,
  })
  assert.deepEqual(parseShipDropKey('6-5-AB'), { mapId: '6-5', cell: 'AB', level: 0, isBoss: false })
})

test('反查键：非法键返回 null，不抛错', () => {
  for (const bad of ['', 'x', '2-2', 'a-2-B', '2-2-', null, undefined, 42]) {
    assert.equal(parseShipDropKey(bad), null, String(bad))
  }
})

test('反查返回：百分比转小数、剔除 0 率、按掉率降序', () => {
  const parsed = parseShipDropPayload({
    totalCount: 900,
    generateTime: '2026-09-29 03:50:24',
    timeRange: ['2026-08-29 22:20:02', '2026-09-28 22:20:02'],
    data: {
      '2-2-B': { rate: 1.177, totalCount: 6325 },
      '3-3-M(Boss)': { rate: 0.5, totalCount: 100 },
      '4-4-A': { rate: 0, totalCount: 10 },
      '坏键': { rate: 9, totalCount: 1 },
    },
  })
  assert.equal(parsed.generatedAt, '2026-09-29 03:50:24')
  assert.deepEqual(parsed.timeRange, ['2026-08-29 22:20:02', '2026-09-28 22:20:02'])
  assert.equal(parsed.totalCount, 900)
  assert.deepEqual(
    parsed.entries.map(item => [item.mapId, item.cell, item.isBoss, Number(item.rate.toFixed(4))]),
    [
      ['2-2', 'B', false, 0.0118],
      ['3-3', 'M', true, 0.005],
    ],
  )
})

test('反查排序：低样本的高掉落率排到后面', () => {
  const parsed = parseShipDropPayload({
    data: {
      '6-4-H': { rate: 14.286, totalCount: 3 },
      '2-2-B': { rate: 1.191, totalCount: 2217 },
      '1-5-C': { rate: 3.545, totalCount: 24 },
      '1-1-B': { rate: 1.93, totalCount: 1818 },
    },
  })
  assert.deepEqual(
    parsed.entries.map(item => `${item.mapId}-${item.cell}`),
    ['1-1-B', '2-2-B', '6-4-H', '1-5-C'],
    '样本 >= 100 的按掉率降序在前；样本不足的也按掉率降序，但整层在后',
  )
})

test('反查返回：结构不对直接抛 PARSE', () => {
  for (const bad of [null, {}, { data: [] }, { data: 'x' }]) {
    assert.throws(() => parseShipDropPayload(bad), err => err.code === 'PARSE')
  }
})

test('点位键：同格不同难度视为不同点位', () => {
  assert.equal(pointKeyOf({ mapId: '2-2', cell: 'B', level: 0 }), '2-2|B|0')
  assert.notEqual(
    pointKeyOf({ mapId: '48-7', cell: 'Z', level: 1 }),
    pointKeyOf({ mapId: '48-7', cell: 'Z', level: 4 }),
  )
})

test('难度映射：1~4 与 丁丙乙甲 一一对应', () => {
  assert.deepEqual(LEVEL_LABEL, { 1: '丁', 2: '丙', 3: '乙', 4: '甲' })
  assert.equal(parseShipDropKey(`1-1-A-${LEVEL_LABEL[4]}`).level, 4)
  assert.equal(parseShipDropKey(`1-1-A-${LEVEL_LABEL[1]}`).level, 1)
})
