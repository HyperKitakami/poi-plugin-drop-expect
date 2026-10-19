import React, { useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Tag } from '@blueprintjs/core'

import { LEVEL_LABEL, SHIP_MIN_SAMPLE, fetchShipDrops, pointKeyOf } from '../services/kcwiki'
import { fmtCount, fmtPercent } from './format'
import { t } from './i18n'

/*
  按目标舰反查点位。

  接口 /api/cache/drop_ship_{id}-{rank} 与点位缓存同源、同窗口（30 天滚动），
  实测同一点位的 rate / totalCount / rankCount 与 drop_map_* 完全一致，
  所以这一份数据可以直接用来建点位，不必再逐点重抓。

  排序按「样本够 → 样本少」分层，层内按掉落率降序：
  纯按率排会被 n=3 的偶然掉落占满首屏。
*/

const MUTED = 'bp6-text-muted'
const MAX_AUTO_SELECT = 5

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
        const solid = free.filter(item => item.count >= SHIP_MIN_SAMPLE)
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
      setSummary(await onApply(picked, result.timeRange || null))
    } catch (err) {
      setSummary({ added: 0, confirmed: 0, missing: 0, failed: picked.length })
    } finally {
      setApplying(false)
    }
  }

  const renderSummary = () =>
    summary ? (
      <div className={MUTED} style={{ fontSize: 11, marginTop: 6 }}>
        {t('Added points', '已加入')} {summary.added}
      </div>
    ) : null

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
            ? t('No drop records', '该舰没有掉落记录（可能样本不足，或只在未收录的点位掉落）')
            : `${t('Fetch failed', '抓取失败')}：${error.message || ''}`}
        </div>
      ) : null}

      {result ? (
        <>
          <div className={MUTED} style={{ fontSize: 11, marginTop: 2 }}>
            {t('Window', '统计窗口')} {result.timeRange ? `${result.timeRange[0].slice(0, 10)} ~ ${result.timeRange[1].slice(0, 10)}` : '—'}
            {' · '}
            {t('Index note', '按掉落率排序，样本少于 100 的点位排在最后')}
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
                        {LEVEL_LABEL[entry.level] || entry.level}
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
                    {entry.count < SHIP_MIN_SAMPLE ? (
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
              {t('Candidate only', '掉落率与本插件抓取的是同一份统计，加入即可直接用')}
            </span>
          </div>

          {renderSummary()}
        </>
      ) : null}
    </div>
  )
}

export { ReverseLookup }
