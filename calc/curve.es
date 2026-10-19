/*
  期望曲线：横轴「目标把握」，纵轴「所需次数」或「某项资源总量」。

  为什么横轴用把握而不是次数：
  次数 → 资源 是线性的（n × 单次消耗），画出来是一堆直线，没有信息量；
  把握 → 次数 是分位数曲线，能看出「再稳一点要付多少代价」，
  多个点位叠在一起时也能直接看出交叉点在哪。
*/

import { isPointUsable, pointLabel, rateOf } from './aggregate'
import { perSortie } from './cost'
import { singleN } from './probability'

export const Y_KEYS = ['n', 'fuel', 'ammo', 'steel', 'bauxite', 'bucket']

/**
 * 每个可用点位一条曲线。
 * values 里的 t 是把握（0~1），value 是纵轴取值。
 */
export const buildExpectCurves = ({
  points,
  shipId,
  yKey = 'n',
  from = 0.1,
  to = 0.99,
  steps = 90,
} = {}) => {
  if (!Y_KEYS.includes(yKey)) {
    return []
  }
  const list = []
  for (const point of (points || []).filter(isPointUsable)) {
    const rate = rateOf(point, shipId)
    if (rate == null || rate <= 0) {
      continue
    }
    const q = point.reachRate * rate
    if (!(q > 0)) {
      continue
    }
    const per = perSortie(point.cost)
    const values = []
    for (let i = 0; i <= steps; i++) {
      const t = from + ((to - from) * i) / steps
      const n = singleN(q, t)
      if (!Number.isFinite(n)) {
        continue
      }
      values.push({ t, value: yKey === 'n' ? n : n * (per[yKey] || 0) })
    }
    if (values.length === 0) {
      continue
    }
    list.push({ pointId: point.id, label: pointLabel(point), q, per, values })
  }

  // 按「目标把握下的需求」升序：图例顺带就是一份排行
  return list.sort((a, b) => {
    const av = a.values[a.values.length - 1].value
    const bv = b.values[b.values.length - 1].value
    return av - bv
  })
}
