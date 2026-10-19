import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { aggregateRecords, getRecordsPath, normalizeAdmiralId, normalizeRecord, readRecords } from '../services/wmfg.es'

const rec = (time, mapId, fleet, extras = {}) => ({ time, map: { id: mapId }, fleet, ...extras })

test('归一化：六项消耗按 WMFG 的下标拆开', () => {
  const record = normalizeRecord(
    rec(1000, '2-2', [
      { consumption: [10, 20, 30, 40, 50, 5] },
      { consumption: [1, 2, 3, 4, 5, 6], bucket: true },
    ]),
  )
  assert.equal(record.mapId, '2-2')
  assert.equal(record.time, 1000)
  assert.equal(record.cost.supplyFuel, 11)
  assert.equal(record.cost.ammo, 22)
  assert.equal(record.cost.bauxite, 33)
  assert.equal(record.cost.dockFuel, 44)
  assert.equal(record.cost.dockSteel, 66, '入渠钢与喷式强袭钢都算钢')
  assert.equal(record.cost.bucket, 1)
})

test('归一化：桶按「用了几个」计，支援与陆航进 extra', () => {
  const record = normalizeRecord(
    rec(1000, '2-2', [{ consumption: [1, 1, 1, 0, 0, 0], bucket: true }, { consumption: [1, 0, 0, 0, 0, 0], bucket: true }], {
      supports: [{ consumption: [7, 8, 0, 9] }],
      airbase: { sortie: [1, 2, 3, 4] },
    }),
  )
  assert.equal(record.cost.bucket, 2)
  assert.deepEqual(record.extra, { fuel: 8, ammo: 10, steel: 3, bauxite: 13 })
})

test('归一化：缺字段/脏数据不抛错', () => {
  assert.equal(normalizeRecord(null), null)
  assert.equal(normalizeRecord({ time: 1 }), null, '没有 map 直接丢弃')
  assert.equal(normalizeRecord({ map: { id: '2-2' } }), null, '没有 time 直接丢弃')
  const dirty = normalizeRecord({
    time: 1,
    map: { id: '2-2' },
    fleet: [null, {}, { consumption: [NaN, -5, 'x', 1, 2, 3] }],
  })
  assert.equal(dirty.cost.supplyFuel, 0)
  assert.equal(dirty.cost.ammo, 0)
  assert.equal(dirty.cost.dockFuel, 1)
  assert.equal(dirty.cost.dockSteel, 5)
})

const RECORDS = [
  normalizeRecord(rec(1000, '2-2', [{ consumption: [10, 20, 30, 40, 50, 5] }, { consumption: [1, 2, 3, 4, 5, 6], bucket: true }])),
  normalizeRecord(rec(2000, '2-2', [{ consumption: [5, 5, 5, 0, 0, 0] }])),
  normalizeRecord(rec(3000, '7-1', [{ consumption: [99, 99, 99, 99, 99, 99] }])),
]

test('聚合：按海域过滤，均值按样本数算', () => {
  const result = aggregateRecords(RECORDS, { mapId: '2-2' })
  assert.equal(result.count, 2)
  assert.equal(result.avg.supplyFuel, 8)
  assert.equal(result.avg.ammo, 13.5)
  assert.equal(result.avg.bauxite, 19)
  assert.equal(result.avg.dockFuel, 22)
  assert.equal(result.avg.dockSteel, 33)
  assert.equal(result.avg.bucket, 0.5)
  assert.equal(result.firstAt, 1000)
  assert.equal(result.lastAt, 2000)
  assert.equal(result.totalBuckets, 1)
})

test('聚合：时间段筛选', () => {
  const onlySecond = aggregateRecords(RECORDS, { mapId: '2-2', from: 1500 })
  assert.equal(onlySecond.count, 1)
  assert.equal(onlySecond.avg.supplyFuel, 5)
  assert.equal(onlySecond.avg.dockSteel, 0)

  const none = aggregateRecords(RECORDS, { mapId: '2-2', from: 5000 })
  assert.equal(none.count, 0)
  assert.equal(none.avg, null)
  assert.equal(none.firstAt, null)
})

test('聚合：没有该海域时返回空结构而不是抛错', () => {
  const result = aggregateRecords(RECORDS, { mapId: '9-9' })
  assert.equal(result.count, 0)
  assert.equal(result.avg, null)
  assert.deepEqual(aggregateRecords(null, { mapId: '2-2' }).count, 0)
  assert.deepEqual(aggregateRecords(RECORDS, {}).count, 0)
})

const withTemp = fn => {
  const dir = mkdtempSync(join(tmpdir(), 'drop-expect-wmfg-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const writeRecords = (dir, admiralId, content) => {
  const path = getRecordsPath(dir, admiralId)
  mkdirSync(join(dir, 'wheres-my-fuel-gone', String(admiralId)), { recursive: true })
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
  return path
}

test('提督 ID：poi 存的是字符串，必须能认', () => {
  // 回归：曾经用 Number.isInteger 直接判，字符串一律 null → 一直提示「未读到提督 ID」
  assert.equal(normalizeAdmiralId('8025940'), 8025940)
  assert.equal(normalizeAdmiralId(' 8025940 '), 8025940)
  assert.equal(normalizeAdmiralId(8025940), 8025940)
  assert.equal(normalizeAdmiralId(''), null)
  assert.equal(normalizeAdmiralId('abc'), null)
  assert.equal(normalizeAdmiralId(0), null)
  assert.equal(normalizeAdmiralId(-1), null)
  assert.equal(normalizeAdmiralId(1.5), null)
  assert.equal(normalizeAdmiralId(null), null)
  assert.equal(normalizeAdmiralId(undefined), null)
})

test('读取：路径符合 WMFG 的约定', () => {
  assert.ok(getRecordsPath('C:/poi', 8025940).endsWith(join('wheres-my-fuel-gone', '8025940', 'sortie_records.json')))
})

test('读取：数字字符串的提督 ID 也能定位到目录', () => {
  withTemp(dir => {
    writeRecords(dir, 8025940, [rec(1000, '2-2', [{ consumption: [1, 1, 1, 1, 1, 1] }])])
    const result = readRecords('8025940', dir)
    assert.equal(result.ok, true)
    assert.equal(result.records.length, 1)
  })
})

test('读取：缺提督 ID / 文件不存在 / 坏 JSON 都给出可读原因', () => {
  withTemp(dir => {
    assert.equal(readRecords(null, dir).reason, 'NO_ADMIRAL')
    assert.equal(readRecords(1, dir).reason, 'MISSING')

    writeRecords(dir, 1, '{oops')
    const bad = readRecords(1, dir)
    assert.equal(bad.ok, false)
    assert.equal(bad.reason, 'BAD')

    writeRecords(dir, 2, { notAnArray: true })
    assert.equal(readRecords(2, dir).reason, 'BAD')
  })
})

test('读取：成功解析并按 mtime 缓存', () => {
  withTemp(dir => {
    writeRecords(dir, 1, [rec(1000, '2-2', [{ consumption: [1, 2, 3, 4, 5, 6] }]), { garbage: true }])
    const first = readRecords(1, dir)
    assert.equal(first.ok, true)
    assert.equal(first.records.length, 1, '坏记录被丢弃，好记录保留')
    assert.equal(first.total, 2)

    const second = readRecords(1, dir)
    assert.equal(second.cached, true)
  })
})
