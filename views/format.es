/* 数字格式化。只做展示，不参与计算。 */

export const RESOURCE_LABEL = {
  fuel: '油',
  ammo: '弹',
  steel: '钢',
  bauxite: '铝',
  bucket: '桶',
}

export const fmtCount = n => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('zh-CN') : '—')

/*
  去掉小数末尾的 0。

  ⚠️ 必须先判断有没有小数点：'90' 也满足 /\.?0+$/，
  直接替换会得到 '9'——这正是「期望 90% 显示成 9%」的原因。
*/
const trimZeros = s => (s.indexOf('.') === -1 ? s : s.replace(/\.?0+$/, ''))

export const fmtPercent = (rate, digits = 3) => {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    return '—'
  }
  return `${trimZeros((rate * 100).toFixed(digits))}%`
}

/** 资源总量：上万用「万」，否则千分位 */
export const fmtAmount = v => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return '—'
  }
  if (v >= 10000) {
    return `${(v / 10000).toFixed(1)}万`
  }
  return Math.round(v).toLocaleString('zh-CN')
}

/** 桶允许小数（0.3 桶/次），但不会显示成 0.30000000004 */
export const fmtBucket = v => {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return '—'
  }
  if (v === 0) {
    return '0'
  }
  // 100 以上按整数；以下保留一位（22.8 桶是有意义的，不要四舍五入成 23）
  if (v >= 100) {
    return String(Math.round(v))
  }
  const text = v.toFixed(1)
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

/** 一行五项消耗；缺项按 0 显示，保持列宽稳定 */
export const costLine = (cost, { zeroDash = false } = {}) => {
  if (!cost) {
    return '—'
  }
  const parts = [
    fmtAmount(cost.fuel),
    fmtAmount(cost.ammo),
    fmtAmount(cost.steel),
    fmtAmount(cost.bauxite),
    fmtBucket(cost.bucket),
  ]
  if (zeroDash && parts.every(p => p === '0')) {
    return '—'
  }
  return parts.join(' / ')
}
