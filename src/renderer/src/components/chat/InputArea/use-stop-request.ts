// S-309 §4.3 第 3 条：点了停止之后，要能看出「到底停没停」。
//
// 背景：`stopStreaming` → `cancelStream` 是一条到 worker 的命名管道请求，worker 卡死时
// 它可能很多秒都不返回。在此之前，按钮点下去毫无变化 —— 用户分不清是「已经停了但界面
// 没刷新」还是「压根没停」。
//
// 这里只管**反馈**，不管取消：真伪判据只有一个 —— `isStreaming` 有没有变回 false。
// 超时并不等于确认仍在执行（可能只是回流慢），所以文案说的是「未停住」而不是「失败了」。

import * as React from 'react'

/** 点了停止之后，超过这么久还没停下来的，就认为「没停住」。 */
export const STOP_FEEDBACK_TIMEOUT_MS = 5_000

export type StopRequestState = 'idle' | 'stopping' | 'failed'

export interface UseStopRequestStateResult {
  state: StopRequestState
  requestStop: () => void
}

export function useStopRequestState(params: {
  isStreaming: boolean
  onStop?: () => void
  timeoutMs?: number
}): UseStopRequestStateResult {
  const { isStreaming, onStop, timeoutMs = STOP_FEEDBACK_TIMEOUT_MS } = params
  const [state, setState] = React.useState<StopRequestState>('idle')
  const timerRef = React.useRef<number | null>(null)

  const clearTimer = React.useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // 唯一判据：流真的结束了才复位。别用「点了就算停了」来自我安慰。
  React.useEffect(() => {
    if (!isStreaming) {
      clearTimer()
      setState('idle')
    }
  }, [isStreaming, clearTimer])

  React.useEffect(() => clearTimer, [clearTimer])

  const requestStop = React.useCallback(() => {
    clearTimer()
    setState('stopping')
    try {
      // onStop 是 async 的，但它内部自己收尾；这里只挡同步异常与漏网的 rejection。
      void Promise.resolve(onStop?.()).catch(() => {})
    } catch {
      // ignore —— 停止失败不该阻断反馈状态
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setState('failed')
    }, timeoutMs)
  }, [clearTimer, onStop, timeoutMs])

  return { state, requestStop }
}
