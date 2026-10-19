import { registerHooks } from 'node:module'

/*
  让 Node 把 .es 当 ESM 读。

  poi 本体用 Babel 处理插件，.es 可以直接跑；Node 单独跑会报
  ERR_UNKNOWN_FILE_EXTENSION。测试对象只有 calc/ 的纯逻辑（无 JSX、
  不依赖 poi），所以不需要转译，只要告诉 Node 扩展名的格式即可。

  views/ 含 JSX，不在测试范围内——真要测就得引入 Babel。
*/
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      /*
        poi 走 Babel，允许省略扩展名，也允许 import 目录（'../redux' → redux/index.es）。
        Node 的 ESM 两者都不支持，所以按 poi 的顺序补一遍：
          1) './x'      → './x.es'
          2) './x'      → './x/index.es'
      */
      if (specifier.startsWith('.')) {
        for (const suffix of ['.es', '/index.es']) {
          try {
            return nextResolve(`${specifier}${suffix}`, context)
          } catch (inner) {
            // 继续试下一个后缀
          }
        }
      }
      throw err
    }
  },

  load(url, context, nextLoad) {
    if (url.endsWith('.es')) {
      return nextLoad(url, { ...context, format: 'module' })
    }
    return nextLoad(url, context)
  },
})
