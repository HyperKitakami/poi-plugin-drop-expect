import { store } from 'views/create-store'

import { reducer } from './redux'
import { pStateReady } from './redux/actions'
import { ensurePState, loadPState } from './store/p-state'
import { flushPState, subscribePState, unsubscribePState } from './store/observer'
import { DropExpectMain as reactClass } from './views'

/*
  poi 会读取这些导出：
    reactClass    主面板（windowMode 为 true 时默认开在独立窗口）
    reducer       挂在 store.ext['poi-plugin-drop-expect']._ 下
    pluginDidLoad 启用后调用
  详细约定见 docs/02-implementation.md §6。
*/
export { reactClass, reducer }

export const windowMode = true

export function pluginDidLoad() {
  /*
    poi 在 reducer 注册之后调用这里。
    同步恢复再挂 observer：若把恢复丢给定时器，等待期间的改动会被恢复动作覆盖。
  */
  let restored = null
  try {
    restored = loadPState()
  } catch (err) {
    console.error('[drop-expect] 恢复存档失败，以空状态启动', err)
  }
  store.dispatch(pStateReady(restored))
  subscribePState()
  // 首次运行：把当前状态立刻落到 plugin-data 下
  ensurePState(restored)
}

export function pluginWillUnload() {
  flushPState()
  unsubscribePState()
}
