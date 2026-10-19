/*
  状态变化 → 落盘。

  不用 redux-observers：那是插件需要依赖的第三方包，而 plugins/node_modules
  里并没有它（旧实现就是栽在「import 了没声明的依赖」上）。用 store.subscribe
  加一个 500ms 防抖就够，行为可控且零依赖。

  只比较 4 个白名单切片的引用，avoid 其他字段（例如 ready）触发无谓写盘。
*/

import { store } from 'views/create-store'

import { PACKAGE_NAME } from '../redux'
import { savePState } from './p-state'

const DEBOUNCE_MS = 500

let unsubscribe = null
let timer = null
let pending = null

const extOf = state => {
  const ext = state && state.ext && state.ext[PACKAGE_NAME] && state.ext[PACKAGE_NAME]._
  return ext && typeof ext === 'object' ? ext : null
}

const pick = ext =>
  ext
    ? { points: ext.points, targets: ext.targets, have: ext.have, ui: ext.ui }
    : null

const changed = (a, b) =>
  !a ||
  !b ||
  a.points !== b.points ||
  a.targets !== b.targets ||
  a.have !== b.have ||
  a.ui !== b.ui

const flush = () => {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!pending) {
    return
  }
  const snapshot = pending
  pending = null
  savePState(snapshot)
}

export const subscribePState = () => {
  unsubscribePState()

  let last = pick(extOf(store.getState()))

  unsubscribe = store.subscribe(() => {
    const ext = extOf(store.getState())
    // 恢复完成前不写盘，否则会用空状态覆盖用户存档
    if (!ext || ext.ready !== true) {
      return
    }
    const next = pick(ext)
    if (!changed(last, next)) {
      return
    }
    last = next
    pending = next
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(flush, DEBOUNCE_MS)
  })
}

/** pluginWillUnload 里调用：把还没落盘的改动立刻写掉 */
export const flushPState = () => flush()

export const unsubscribePState = () => {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
}
