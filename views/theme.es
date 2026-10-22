/*
  强调色。

  只有一处：#6CF。用户指定的舰名/点位标题色，与主题无关。
  集中在这里，是为了让结果页的舰名与设定页的卡片标题永远同色——
  分头写常量的话，改一处忘一处就会漂。

  注意：该色在浅色主题下对比度偏低（约 1.9:1），符号性大于可读性。
  若之后要兼顾浅色主题，改这一个常量即可（如 #2E8BC0）。
*/
export const ACCENT_COLOR = '#6CF'

/*
  危险色（剩余为负 / 超支）。

  踩过的坑：这里原来写 `Classes.TEXT_DANGER || 'bp6-text-danger'`。
  Blueprint 6 没有 `TEXT_DANGER` 这个常量，而兜底的 `bp6-text-danger`
  类也不存在（文本类只有 muted / disabled / overflow-ellipsis / small / large），
  于是 className 挂上去等于没挂——负数一点颜色都没有。

  Blueprint 自带的 `.bp6-intent-danger` 能上色，但只给 #ac2f33 一档：
  深色主题下对比度约 2.2:1，几乎读不出来。所以这里自带两档——
  浅底用偏深的红，`.bp6-dark` 下换亮红，正是 Blueprint 给 danger 图标用的那对值。

  默认（未命中暗色主题）选 #cd4246 是保守选择：万一主题类不在我们的祖先链上
  （插件独立窗口模式），它在白底约 4.7:1、深底约 3.0:1，两边都还认得出来；
  命中 `.bp6-dark` 时再升到约 6.9:1。

  颜色只能写在样式表里，所以由 DropExpectMain 渲染这一段 <style>。
  前缀与 views 里其它地方一致，直接写字面量：这个模块不做任何 import，
  保持纯常量、可被测试直接引用。
*/
export const DANGER_CLASS = 'drop-expect-danger'

export const DANGER_STYLE = [
  `.${DANGER_CLASS}{color:#cd4246}`,
  `.bp6-dark .${DANGER_CLASS}{color:#fa999c}`,
].join('')
