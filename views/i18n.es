/*
  文案读取。

  poi 在插件加载时把 i18n/<lang>.json 挂到 window.i18n[包名]。
  这里不做初始化假设：取不到就退回调用方给的字面量，
  这样即使 i18n 尚未就绪，界面也不会出现空白或 undefined。
*/

const NAMESPACE = 'poi-plugin-drop-expect'

export const t = (key, fallback) => {
  try {
    const ns = typeof window !== 'undefined' && window.i18n && window.i18n[NAMESPACE]
    if (ns && typeof ns.__ === 'function') {
      const out = ns.__(key)
      if (typeof out === 'string' && out !== key) {
        return out
      }
    }
  } catch (e) {
    // i18n 未就绪：用字面量
  }
  return fallback == null ? key : fallback
}
