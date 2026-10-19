import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  ensurePState,
  getLegacyPStateFilePath,
  getPStateFilePath,
  loadPState,
  savePState,
} from '../store/p-state.es'

const withTempDir = fn => {
  const dir = mkdtempSync(join(tmpdir(), 'drop-expect-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// plugin-data/<包名>/ 是 poi 的插件数据约定
const dataDir = dir => join(dir, 'plugin-data', 'poi-plugin-drop-expect')

const sample = {
  targets: [{ shipId: 71, note: '' }],
  points: [
    {
      id: 'p1',
      mapId: '2-2',
      cell: 'B',
      level: 0,
      rank: 'SAB',
      reachRate: 1,
      cost: { supplyFuel: 350, ammo: 420, bauxite: 40, dockFuel: 0, dockSteel: 0, bucket: 0.3 },
      rates: { 71: { rate: 0.0119, source: 'manual' } },
    },
  ],
  have: { fuel: 10000, ammo: 20000, steel: 30000, bauxite: 4000, bucket: 100, manual: true },
  ui: { activeTargetId: 71, probTarget: 0.9, mode: 'single', sortKey: 'n', sortDesc: false },
}

test('路径落在 <appData>/plugin-data/<包名>/state.json', () => {
  withTempDir(dir => {
    const path = getPStateFilePath(dir)
    assert.equal(path, join(dir, 'plugin-data', 'poi-plugin-drop-expect', 'state.json'))
  })
})

test('文件不存在时返回空状态', () => {
  withTempDir(dir => {
    const state = loadPState(dir)
    assert.deepEqual(state.points, [])
    assert.deepEqual(state.targets, [])
  })
})

test('存取往返：内容一致', () => {
  withTempDir(dir => {
    assert.equal(savePState(sample, dir), true)
    const loaded = loadPState(dir)
    assert.equal(loaded.points.length, 1)
    assert.equal(loaded.points[0].cell, 'B')
    assert.equal(loaded.points[0].rates[71].rate, 0.0119)
    assert.equal(loaded.have.fuel, 10000)
    assert.equal(loaded.have.manual, true)
    assert.equal(loaded.ui.activeTargetId, 71)

    // 落盘内容带版本号，且不含 ready 之类的运行期字段
    const raw = JSON.parse(readFileSync(getPStateFilePath(dir), 'utf8'))
    assert.equal(raw.$dataVersion, '1.0.0')
    assert.equal(raw.ready, undefined)
  })
})

test('保存后不留临时文件', () => {
  withTempDir(dir => {
    savePState(sample, dir)
    const files = readdirSync(dataDir(dir))
    assert.deepEqual(files, ['state.json'])
  })
})

test('坏 JSON：退回空状态并留下 .bak', () => {
  withTempDir(dir => {
    savePState(sample, dir)
    const path = getPStateFilePath(dir)
    writeFileSync(path, '{ this is not json', 'utf8')

    const loaded = loadPState(dir)
    assert.deepEqual(loaded.points, [])
    const files = readdirSync(dataDir(dir))
    assert.ok(files.includes('state.json.bak'), files.join(','))
  })
})

test('版本不匹配：退回空状态并留下 .bak', () => {
  withTempDir(dir => {
    savePState(sample, dir)
    const path = getPStateFilePath(dir)
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    raw.$dataVersion = '0.0.1-from-future'
    writeFileSync(path, JSON.stringify(raw), 'utf8')

    const loaded = loadPState(dir)
    assert.deepEqual(loaded.points, [])
    assert.ok(readdirSync(dataDir(dir)).includes('state.json.bak'))
  })
})

test('写盘前会剔除非法条目', () => {
  withTempDir(dir => {
    savePState(
      {
        ...sample,
        points: [...sample.points, { mapId: '3-3' }],
      },
      dir,
    )
    const raw = JSON.parse(readFileSync(getPStateFilePath(dir), 'utf8'))
    assert.equal(raw.points.length, 1, '没有 id 的点位不该被写入')
  })
})

test('旧位置（<appData>/drop-expect）的存档会被读取并迁移到 plugin-data', () => {
  withTempDir(dir => {
    // 模拟早期版本写在旧路径
    const legacy = getLegacyPStateFilePath(dir)
    mkdirSync(dirname(legacy), { recursive: true })
    writeFileSync(legacy, JSON.stringify({ $dataVersion: '1.0.0', ...sample }), 'utf8')

    const loaded = loadPState(dir)
    assert.equal(loaded.points.length, 1, '旧存档应当被读出来')

    // 运行时会调用 ensurePState 把内容立刻落到新位置
    assert.equal(ensurePState(loaded, dir), true)
    assert.ok(existsSync(getPStateFilePath(dir)), '保存后应落到新位置')
    assert.ok(existsSync(legacy), '旧文件不删除，留给用户自行清理')

    // 新位置已存在时不再重复写
    assert.equal(ensurePState(loaded, dir), false)
  })
})
