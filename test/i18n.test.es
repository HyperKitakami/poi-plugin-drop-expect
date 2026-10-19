import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/*
  i18n 一致性守卫。

  代码里所有文案都走 t('key', '中文兜底')，兜底能保证「即使词典缺条目
  也不会显示英文键」——但正因为不会报错，漏翻译很容易被忽略。
  这个测试把「代码里用到的键」和「zh-CN.json 里的键」对齐。

  新增文案时忘记加词典，这里会挂。
*/

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const DIRS = ['views', 'redux']
const DICT_PATH = join(ROOT, 'i18n', 'zh-CN.json')

// 支持 t('key' 与 t(\n 'key'
const KEY_PATTERN = /\bt\(\s*'([^'\\]+)'/g

const collectKeys = () => {
  const found = new Map()
  for (const dir of DIRS) {
    for (const file of readdirSync(join(ROOT, dir))) {
      if (!file.endsWith('.es')) {
        continue
      }
      const source = readFileSync(join(ROOT, dir, file), 'utf8')
      let match
      while ((match = KEY_PATTERN.exec(source)) !== null) {
        found.set(match[1], file)
      }
    }
  }
  return found
}

test('代码里用到的每个文案键都在 zh-CN.json 里', () => {
  const dict = JSON.parse(readFileSync(DICT_PATH, 'utf8'))
  const used = collectKeys()

  assert.ok(used.size > 40, `只扫到 ${used.size} 个键，扫描逻辑可能失效了`)

  const missing = []
  for (const [key, file] of used) {
    if (!Object.prototype.hasOwnProperty.call(dict, key)) {
      missing.push(`${key} (${file})`)
    }
  }
  assert.deepEqual(missing, [], `词典缺少：\n${missing.join('\n')}`)
})

test('词典里没有多余的空壳条目', () => {
  const dict = JSON.parse(readFileSync(DICT_PATH, 'utf8'))
  const used = collectKeys()
  const unused = Object.keys(dict).filter(key => !used.has(key))
  assert.deepEqual(unused, [], `词典里没用到的键：\n${unused.join('\n')}`)
})
