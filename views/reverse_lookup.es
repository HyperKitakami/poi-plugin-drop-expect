import React, { useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Classes, Tag } from '@blueprintjs/core'

import { fetchShipDrops, pointKeyOf } from '../services/kcwiki'
import { fmtCount, fmtPercent } from './format'
import { t } from './i18n'

/*
  按目标舰反查点位。

  数据来自 kcwiki 的舰船索引 /drop/ship/{id}/SAB.json —— 一条请求拿全部点位，
  比「逐图逐格抓」便宜几个数量级。

  ⚠️ 但这份索引明显滞后（实测 2026-10 时 generateTime 仍停在 2022-05-11，
  且 700 之后的舰船 ID 直接 404）。所以它只当「候选来源」：
  界面上明写索引时间，加入后由调用方立刻用点位接口校正掉落率，以校正结果为准。
*/

const DANGER = Classes.TEXT_DANGER || 'bp6-text-danger'
const MUTED = 'bp6-text-muted'
const MAX_AUTO_SELECT = 5
// 样本低于这个数的点位不默认勾选：多半是「偶然掉过一次」，加进去只会污染配置
const LOW_SAMPLE = 100

const pointLabel = entry => `${entry.mapId} ${entry.cell}`

const ReverseLookup = ({ shipId, shipName, existingKeys, onApply, onClose }) => {
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [applying, setApplying] = useState(false)
  const [summary, setSummary] = useState(null)

  /*
    只在换舰时重新查。
    故意不依赖 existingKeys：加入点位后那个集合会变，
    若把它写进依赖，刚加完就会重拉一次、把结果摘要冲掉。
    已有位点位的「已有点位/禁用」是渲染期算的，不依赖这个 effect。
  */
  useEffect(() => {
    let alive = true
    setResult(null)
    setError(null)
    setSummary(null)
    setSelected(new Set())
    fetchShipDrops(shipId)
      .then(data => {
        if (!alive) {
          return
        }
        setResult(data)
        // 默认勾选「还没配过、样本又够」的前几个，省掉逐行点
        const free = data.entries.filter(item => !existingKeys.has(pointKeyOf(item)))
        const solid = free.filter(item => item.count >= LOW_SAMPLE)
        setSelected(new Set((solid.length > 0 ? solid : free).slice(0, MAX_AUTO_SELECT).map(pointKeyOf)))
      })
      .catch(err => {
        if (alive) {
          setError(err)
        }
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipId])

  const picked = useMemo(
    () => (result ? result.entries.filter(item => selected.has(pointKeyOf(item))) : []),
    [result, selected],
  )

  const toggle = key => {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const apply = async () => {
    if (applying || picked.length === 0) {
      return
    }
    setApplying(true)
    setSummary(null)
    try {
      setSummary(await onApply(picked))
    } catch (err) {
      setSummary({ added: 0, confirmed: 0, missing: 0, failed: picked.length })
    } finally {
      setApplying(false)
    }
  }

  const renderSummary = () => {
    if (!summary) {
      return null
    }
    const parts = [`${t('Added points', '已加入')} ${summary.added}`]
    if (summary.confirmed) {
      parts.push(`${t('Rates refreshed', '已校正')} ${summary.confirmed}`)
    }
    if (summary.failed) {
      parts.push(`${t('Fetch failed', '抓取失败')} ${summary.failed}`)
    }
    return (
      <div style={{ marginTop: 6 }}>
        <div className={MUTED} style={{ fontSize: 11 }}>
          {parts.join(' · ')}
        </div>
        {summary.missing ? (
          <div className={DANGER} style={{ fontSize: 11, marginTop: 2 }}>
            {t('Not in current data', '有 {0} 个点位在当前数据里没有该舰，可能已移出掉落池（已保留，可手动删除）').replace(
              '{0}',
              String(summary.missing),
            )}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div style={{ marginTop: 8, borderTop: '1px solid rgba(128,128,128,0.25)', paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <b style={{ fontSize: 12 }}>
          {t('Find points', '反查点位')} · {shipName}
        </b>
        <Button
          minimal
          small
          icon="cross"
          style={{ marginLeft: 'auto' }}
          aria-label={t('Close', '关闭')}
          onClick={onClose}
        />
      </div>

      {!result && !error ? (
        <div className={MUTED} style={{ fontSize: 11, marginTop: 4 }}>
          {t('Loading state', '正在读取配置…')}
        </div>
      ) : null}

      {error ? (
        <div className={MUTED} style={{ fontSize: 11, marginTop: 4 }}>
          {error.code === 'NOT_FOUND' || error.code === 'EMPTY'
            ? t('No drop records', '该舰在索引里没有掉落记录（索引只覆盖到 2022 年前后，新舰可能查不到）')
            : `${t('Fetch failed', '抓取失败')}：${error.message || ''}`}
        </div>
      ) : null}

      {result ? (
        <>
          <div className={MUTED} style={{ fontSize: 11, marginTop: 2 }}>
            {t('Index time', '索引更新于')} {result.generatedAt || '—'} ·{' '}
            {t('Index note', '按样本量排序；旧索引可能缺少较新的点位，加入后会按当前数据校正掉落率')}
          </div>

          <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 6 }}>
            {result.entries.map(entry => {
              const key = pointKeyOf(entry)
              const exists = existingKeys.has(key)
              return (
                <div
                  key={key}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0' }}
                >
                  <Checkbox
                    checked={selected.has(key)}
                    disabled={exists || applying}
                    onChange={() => toggle(key)}
                    style={{ marginBottom: 0 }}
                  >
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{pointLabel(entry)}</span>
                    {entry.isBoss ? (
                      <Tag minimal style={{ marginLeft: 4 }}>
                        Boss
                      </Tag>
                    ) : null}
                    {entry.level ? (
                      <Tag minimal style={{ marginLeft: 4 }}>
                        {t('Difficulty', '难度')} {entry.level}
                      </Tag>
                    ) : null}
                    {exists ? (
                      <span className={MUTED} style={{ marginLeft: 4, fontSize: 11 }}>
                        {t('Existing point', '已有点位')}
                      </span>
                    ) : null}
                  </Checkbox>
                  <span
                    className={MUTED}
                    style={{ marginLeft: 'auto', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {fmtPercent(entry.rate, 2)}
                    {entry.count < LOW_SAMPLE ? (
                      <span style={{ marginLeft: 4 }}>{t('few samples', '样本少')}</span>
                    ) : null}
                    {' · n='}
                    {fmtCount(entry.count)}
                  </span>
                </div>
              )
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
            <Button
              small
              intent="primary"
              loading={applying}
              disabled={picked.length === 0 || applying}
              onClick={apply}
            >
              {t('Add selected', '加入选中')}（{picked.length}）
            </Button>
            <span className={MUTED} style={{ fontSize: 11 }}>
              {t('Candidate only', '候选来自旧索引，加入后会重新抓取当前掉落率')}
            </span>
          </div>

          {renderSummary()}
        </>
      ) : null}
    </div>
  )
}

export { ReverseLookup }
