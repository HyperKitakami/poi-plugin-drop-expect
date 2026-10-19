import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Classes, InputGroup } from '@blueprintjs/core'

import { filterOptions } from './selectors'

/*
  带候选的下拉输入：只在**已经输入了内容**时才展开候选。

  为什么不用 <datalist>：浏览器（Chrome/Edge）在输入框获得焦点、值为空时
  会把整份 option 列表铺开，海域有 200 多个值，一点就是一大片。
  datalist 又没有「为空时不展开」的开关，所以改成自己渲染候选面板。

  交互刻意保持简单：
  - 空值聚焦不展开，输入文字后才按包含关系筛选
  - 候选用 onMouseDown + preventDefault 落选，避免 blur 先触发导致点不中
  - ↑↓ 移动、Enter 选中、Esc 关闭，键盘也能用
*/

const MAX_ITEMS = 12

const SuggestInput = ({
  value,
  options,
  placeholder,
  width = 110,
  disabled = false,
  upper = false,
  onChange,
  ariaLabel,
}) => {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(-1)
  const wrapperRef = useRef(null)

  const query = String(value == null ? '' : value)
  const matches = useMemo(
    () => (open ? filterOptions(options, query, MAX_ITEMS) : []),
    [open, options, query],
  )

  // 点面板以外的地方关闭
  useEffect(() => {
    if (!open) {
      return undefined
    }
    const handle = event => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  const commit = option => {
    onChange(upper ? String(option).toUpperCase() : option)
    setOpen(false)
    setIndex(-1)
  }

  const handleChange = event => {
    const next = upper ? event.target.value.toUpperCase() : event.target.value
    onChange(next)
    // 输入被清空时收起，避免又回到「空值铺一屏」
    setOpen(next.trim() !== '')
    setIndex(-1)
  }

  const handleKeyDown = event => {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open || matches.length === 0) {
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIndex(prev => (prev + 1) % matches.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex(prev => (prev <= 0 ? matches.length - 1 : prev - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      commit(matches[index >= 0 ? index : 0])
    }
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width }}>
      <InputGroup
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        style={{ width }}
        onFocus={() => setOpen(query.trim() !== '')}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      {open && matches.length > 0 ? (
        <div
          className={`${Classes.MENU} ${Classes.ELEVATION_1}`}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 20,
            minWidth: width,
            marginTop: 2,
            maxHeight: 180,
            overflowY: 'auto',
          }}
        >
          {matches.map((option, itemIndex) => (
            <div
              key={option}
              role="option"
              aria-selected={itemIndex === index}
              className={`${Classes.MENU_ITEM} ${itemIndex === index ? Classes.ACTIVE : ''}`}
              style={{ fontSize: 12, lineHeight: '20px' }}
              onMouseDown={event => {
                event.preventDefault()
                commit(option)
              }}
              onMouseEnter={() => setIndex(itemIndex)}
            >
              {option}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export { SuggestInput }
