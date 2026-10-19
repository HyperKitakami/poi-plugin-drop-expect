import React from 'react'
import { Callout } from '@blueprintjs/core'

/*
  渲染兜底。

  插件面板一旦在 render 里抛错，poi 的整个 tab 会白掉，而且不看 DevTools
  根本不知道原因。这里把错误截住并直接显示在面板上——开发期改一版刷新一次，
  比来回切控制台快得多。上线后这段也留着，至少不会白屏。
*/
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[drop-expect] 渲染出错', error, info)
  }

  render() {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }
    return (
      <div style={{ padding: 8 }}>
        <Callout intent="danger" title="面板渲染出错">
          <div style={{ fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap' }}>
            {String((error && (error.stack || error.message)) || error)}
          </div>
        </Callout>
      </div>
    )
  }
}

export { ErrorBoundary }
