/*
  持久化读写。

  路径：APPDATA_PATH/plugin-data/poi-plugin-drop-expect/state.json
  （与 poi 其他插件一致：plugin-data/<包名>/...）

  写入先落 .tmp 再 rename，避免写到一半留下半截 JSON。
  读不出来时把原文件改名成 .bak，绝不静默覆盖用户数据。

  早期版本曾写在 APPDATA_PATH/drop-expect/；新路径没有存档时会读一次旧位置，
  之后由 observer 写到新位置，等于自动迁移。旧文件不删。
*/

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

import { PACKAGE_NAME } from '../redux'
import { DATA_VERSION, sanitizePState, toPState } from './schema'

const DATA_DIR = 'plugin-data'
const FILE_NAME = 'state.json'
// 旧的落盘目录（不含 plugin-data），只用于读取迁移
const LEGACY_DIR = 'drop-expect'

export const emptyPState = () => sanitizePState(null)

/*
  测试与规则脚本都会传 appDataPath；只在 poi 运行时才回落 window.APPDATA_PATH。
  计算路径的函数不做任何 mkdir —— 渲染期间产生副作用会让整个 tab 崩掉。
*/
export const resolveAppDataPath = appDataPath => {
  if (typeof appDataPath === 'string' && appDataPath !== '') {
    return appDataPath
  }
  if (
    typeof window !== 'undefined' &&
    typeof window.APPDATA_PATH === 'string' &&
    window.APPDATA_PATH !== ''
  ) {
    return window.APPDATA_PATH
  }
  throw new Error('APPDATA_PATH 不可用')
}

export const getPStateFilePath = appDataPath =>
  join(resolveAppDataPath(appDataPath), DATA_DIR, PACKAGE_NAME, FILE_NAME)

export const getLegacyPStateFilePath = appDataPath =>
  join(resolveAppDataPath(appDataPath), LEGACY_DIR, FILE_NAME)

const backupUnreadable = path => {
  let backupPath = `${path}.bak`
  let suffix = 1
  while (existsSync(backupPath)) {
    backupPath = `${path}.bak.${suffix}`
    suffix += 1
  }
  renameSync(path, backupPath)
  console.error(`[drop-expect] 存档无法读取，已退避到 ${backupPath}`)
}

/** 读并校验；版本不符或解析失败返回 null，由调用方决定是否退避 */
const tryRead = path => {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || parsed.$dataVersion !== DATA_VERSION) {
      return null
    }
    return sanitizePState(parsed)
  } catch (err) {
    console.error('[drop-expect] 解析存档失败', err)
    return null
  }
}

export const loadPState = appDataPath => {
  const path = getPStateFilePath(appDataPath)

  if (existsSync(path)) {
    const loaded = tryRead(path)
    if (loaded) {
      return loaded
    }
    try {
      backupUnreadable(path)
    } catch (backupErr) {
      console.error('[drop-expect] 退避失败', backupErr)
    }
    return emptyPState()
  }

  // 旧位置迁移：读到就用，后续保存会落到新位置
  try {
    const legacy = getLegacyPStateFilePath(appDataPath)
    if (existsSync(legacy)) {
      const loaded = tryRead(legacy)
      if (loaded) {
        console.log('[drop-expect] 已读取旧位置存档，下次保存写入 plugin-data')
        return loaded
      }
    }
  } catch (err) {
    console.error('[drop-expect] 读取旧存档失败', err)
  }

  return emptyPState()
}

export const savePState = (state, appDataPath) => {
  try {
    const path = getPStateFilePath(appDataPath)
    mkdirSync(dirname(path), { recursive: true })
    const temporaryPath = `${path}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(toPState(state), null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, path)
    return true
  } catch (err) {
    console.error('[drop-expect] 保存存档失败', err)
    return false
  }
}

/**
 * 新位置还没有存档时，把当前状态写一份。
 * 用于旧位置迁移后立刻落地——否则要等用户下次改动才会真正搬过去。
 */
export const ensurePState = (state, appDataPath) => {
  try {
    if (existsSync(getPStateFilePath(appDataPath))) {
      return false
    }
    return savePState(state, appDataPath)
  } catch (err) {
    console.error('[drop-expect] 初始化存档失败', err)
    return false
  }
}
