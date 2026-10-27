/*
  持久化读写。

  路径：APPDATA_PATH/plugin-data/poi-plugin-drop-expect/state.json
  （与 poi 其他插件一致：plugin-data/<包名>/...）

  写入先落 .tmp 再 rename，避免写到一半留下半截 JSON。
  读不出来时把原文件改名成 .bak，绝不静默覆盖用户数据。

  开发期曾写在 APPDATA_PATH/drop-expect/，该位置已废弃且不再读取；
  0.1.0 起落盘路径只有 plugin-data 一处。
*/

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

import { PACKAGE_NAME } from '../redux'
import { DATA_VERSION, sanitizePState, toPState } from './schema'

const DATA_DIR = 'plugin-data'
const FILE_NAME = 'state.json'

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

  if (!existsSync(path)) {
    return emptyPState()
  }

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
 * 首次运行时立刻落地，否则要等用户下次改动才会真正生成文件。
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
