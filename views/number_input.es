import React, { useEffect, useState } from 'react'
import { InputGroup } from '@blueprintjs/core'

/*
  数字输入。

  直接用受控 input 会打断「0.」这种中间态：值变成 0 后光标后面的点被抹掉。
  所以内部保留一份文本草稿，只有当「外部值」与「草稿解析结果」不一致时才回写，
  这样既不会覆盖正在输入的内容，也能响应外部重置。

  空字符串向上汇报 null（= 未设置），而不是 0。
*/

const toText = value => (typeof value === 'number' && Number.isFinite(value) ? String(value) : '')

const parse = text => {
  if (text === '' || text === '-' || text === '.' || text === '-.') {
    return null
  }
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

const NumberInput = ({ value, onChange, placeholder, step = 'any', min, max, disabled, ariaLabel, width = 140 }) => {
  const [draft, setDraft] = useState(toText(value))
  const external = typeof value === 'number' && Number.isFinite(value) ? value : null

  useEffect(() => {
    if (parse(draft) !== external) {
      setDraft(toText(value))
    }
    // 只盯外部值：draft 变化由用户输入驱动，不应触发回写
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [external])

  const handleChange = event => {
    const text = event.target.value
    setDraft(text)
    const parsed = parse(text)
    if (parsed === null) {
      onChange(null)
      return
    }
    let next = parsed
    if (typeof min === 'number' && next < min) {
      next = min
    }
    if (typeof max === 'number' && next > max) {
      next = max
    }
    onChange(next)
  }

  return (
    <InputGroup
      value={draft}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      inputMode="decimal"
      aria-label={ariaLabel}
      style={{ width, maxWidth: width }}
    />
  )
}

export { NumberInput }
