import React, { useMemo, useState } from 'react'
import { Button, Callout, InputGroup, Tag } from '@blueprintjs/core'

import { getShipOptions, resolveShipName, shipMatchesQuery } from './selectors'
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
                </Button>
              ))}
            </div>
          ) : query.trim() ? (
            <div className="bp6-text-muted" style={{ fontSize: 12, marginTop: 6 }}>
              {t('No match', '没有匹配的舰船。')}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

export { TargetList }
