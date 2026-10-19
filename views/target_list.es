import React, { useMemo, useState } from 'react'
import { Button, Callout, InputGroup, Tag } from '@blueprintjs/core'

import { findHiddenShipMatch, getShipOptions, resolveShipName, shipMatchesQuery } from './selectors'
import { t } from './i18n'

const MAX_RESULTS = 12

/*
  目标舰清单。

  舰船列表来自 poi 自带的 const.$ships（登录后才有），不需要联网，
  也不要用 kcwikizh 的 3MB all.json —— 旧实现那份是多余的。
*/
const TargetList = ({ targets, masterShips, onAdd, onRemove }) => {
  const [query, setQuery] = useState('')
  const options = useMemo(() => getShipOptions(masterShips), [masterShips])
  const picked = useMemo(() => new Set(targets.map(item => item.shipId)), [targets])
  const results = useMemo(() => {
    if (!query.trim()) {
      return []
    }
    return options.filter(ship => !picked.has(ship.id) && shipMatchesQuery(query, ship)).slice(0, MAX_RESULTS)
  }, [options, picked, query])

  // 查不到时，先确认是不是「查到了但被过滤掉」（改装形态 / 敌舰），给出具体原因
  const hidden = useMemo(
    () => (query.trim() && results.length === 0 ? findHiddenShipMatch(masterShips, query) : null),
    [masterShips, query, results.length],
  )
  const hiddenHint =
    hidden && hidden.baseId && hidden.baseId !== hidden.shipId
      ? t('Remodeled hint', '「{0}」为改装形态，掉落统计按「{1}」记录')
          .replace('{0}', hidden.name)
          .replace('{1}', hidden.baseName)
      : null

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {targets.length === 0 ? (
          <span className="bp6-text-muted">{t('No target yet', '还没有目标舰。')}</span>
        ) : (
          targets.map(item => (
            <Tag
              key={item.shipId}
              intent="primary"
              onRemove={() => onRemove(item.shipId)}
              style={{ marginBottom: 4 }}
            >
              {resolveShipName(masterShips, item.shipId)}
            </Tag>
          ))
        )}
      </div>

      {options.length === 0 ? (
        <Callout intent="warning">
          {t('Ship list unavailable', '读取不到舰船列表，请先在 poi 里进入游戏。')}
        </Callout>
      ) : (
        <>
          <InputGroup
            value={query}
            placeholder={t('Search ship by name / kana / id', '输入舰名、假名或 ID 搜索')}
            leftIcon="search"
            onChange={e => setQuery(e.target.value)}
          />
          {results.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
              {results.map(ship => (
                <Button
                  key={ship.id}
                  small
                  minimal
                  onClick={() => {
                    onAdd(ship.id)
                    setQuery('')
                  }}
                >
                  {ship.name}
                  <span className="bp6-text-muted" style={{ marginLeft: 4 }}>
                    {ship.yomi}
                  </span>
                  {/* 把 ID 显示出来：一来能核对搜索结果，二来让「可以按 ID 搜」这件事被看见 */}
                  <span className="bp6-text-muted" style={{ marginLeft: 4, fontSize: 11 }}>
                    #{ship.id}
                  </span>
                </Button>
              ))}
            </div>
          ) : query.trim() ? (
            <div style={{ marginTop: 6 }}>
              <div className="bp6-text-muted" style={{ fontSize: 12 }}>
                {t('No match', '没有匹配的舰船。')}
              </div>
              {hiddenHint ? (
                <div style={{ marginTop: 4 }}>
                  <div className="bp6-text-muted" style={{ fontSize: 12 }}>
                    {hiddenHint}
                  </div>
                  <Button
                    small
                    intent="primary"
                    style={{ marginTop: 4 }}
                    onClick={() => {
                      onAdd(hidden.baseId)
                      setQuery('')
                    }}
                  >
                    {t('Add base ship', '改为加入')} {hidden.baseName}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

export { TargetList }
