import React, { useEffect, useState } from 'react'
import { InputGroup } from '@blueprintjs/core'

/*
  数字输入。

  直接用受控 input 会打断「0.」这种中间态：值变成 0 后光标后面的点被抹掉。
  所以内部保留一份文本草稿，只有当「外部值」与「草稿解析结果」不一致时才回写，
  这样既不会覆盖正在输入的内容，也能响应外部重置。

  空字符串向上汇报 null（= 未设置），而不是 0。

  焦点是回写的闸门：编辑期间一律不拿外部值覆盖草稿。
  父组件常把 null 兜成默认值（目标把握 null → 0.9、到达率 null → 1、
  现有资源 null → 0），于是「删到空」会让外部值从 9 跳回 90，
  校验发现草稿解析结果（null）与外部值（90）不符，就把「90」写回输入框——
  表现就是删掉最后一位数值自己弹回来，根本没法清空重打。
  改成失焦时才校准：编辑期间草稿归用户，失焦后如果解析结果与外部值
  不一致（空、越界、非法），再回落到真实值。

  宽度必须给外层 div：bp6 的 InputGroup 把 style 透传给内部 <input>，
  而 .bp6-input-group 本身只是 display:block 的壳（块级、宽度跟着内容走）。
  若直接把 width 打在 input 上，壳会按 140px 撑开再被 flex 压缩，
  input 就从格子里溢出来——后面的兄弟节点盖住它，聚焦时它又浮到上层，
  视觉上就成了「一个框套住两个输入框」。所以这里固定外壳、让 input 取 100%。
*/

const toText = value => (typeof value === 'number' && Number.isFinite(value) ? String(value) : '')

const parse = text => {
  if (text === '' || text === '-' || text === '.' || text === '-.') {
    return null
  }
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

const NumberInput = ({ value, onChange, placeholder, min, max, disabled, ariaLabel, width = 140 }) => {
  const [draft, setDraft] = useState(toText(value))
  // 是否正在编辑（焦点在输入框内）；编辑期间外部值不覆盖草稿
  const [editing, setEditing] = useState(false)
  const external = typeof value === 'number' && Number.isFinite(value) ? value : null

  useEffect(() => {
    if (editing) {
      return
    }
    if (parse(draft) !== external) {
      setDraft(toText(value))
    }
    // 只盯外部值与焦点：draft 变化由用户输入驱动，不应触发回写
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [external, editing])

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
    <div style={{ width, flexShrink: 0 }}>
      <InputGroup
        value={draft}
        onChange={handleChange}
        onFocus={() => setEditing(true)}
        onBlur={() => setEditing(false)}
        placeholder={placeholder}
        disabled={disabled}
        inputMode="decimal"
        aria-label={ariaLabel}
        style={{ width: '100%' }}
      />
    </div>
  )
}

export { NumberInput }
