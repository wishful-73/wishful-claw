// 一轮怎么结束的 → 展示文案（iter-40 S-210）。
//
// 这里只做「数据 → i18n 键」的纯映射，不 import IPC、不 import i18n 实例：渲染端
// 拿 `MessageMeta.runEnd`（worker 的 loop_end 事件落库下来的实测数据）喂进来，
// 未知 / 缺失就返回 null，由调用方决定兜底 —— 不编原因。

import type { MessageRunEndMeta } from '@renderer/lib/api/types'

export interface RunEndLabelDescriptor {
  key: string
  /** 语言包缺键时的兜底文案（与 zh 同文），避免界面露出裸 key。 */
  fallback: string
  params?: Record<string, string | number>
}

/**
 * 这些异常类型都算「链路断了」，而不是「服务商说不行」：
 * HTTP 层直接抛、连接被掐、流读到一半断了、超时（ProviderRetryPolicy 重试用尽后
 * 抛上来的就是这几个）。`ProviderHttpException` 不在此列 —— 它有状态码，单独判。
 */
const NETWORK_ERROR_TYPES = new Set([
  'HttpRequestException',
  'SocketException',
  'IOException',
  'WebException',
  'TaskCanceledException'
])

const TIMEOUT_ERROR_TYPE = 'TimeoutException'

function statusParams(statusCode: number): Record<string, string | number> {
  return { status: statusCode }
}

function describeError(runEnd: MessageRunEndMeta): RunEndLabelDescriptor | null {
  const { errorType, statusCode } = runEnd

  if (errorType === TIMEOUT_ERROR_TYPE) {
    return { key: 'assistantMessage.runEnd.timeout', fallback: '请求超时，这一轮中断了' }
  }
  if (errorType && NETWORK_ERROR_TYPES.has(errorType)) {
    return { key: 'assistantMessage.runEnd.network', fallback: '网络中断，这一轮没跑完' }
  }
  if (typeof statusCode === 'number') {
    // 502 / 504 是「没连上上游」被网关盖的章（provider 把 HttpRequestException 转成
    // retryable 502 的就是这条路），对用户来说是链路问题，不是服务商拒答。
    if (statusCode === 502 || statusCode === 504) {
      return {
        key: 'assistantMessage.runEnd.network',
        fallback: `网络中断（${statusCode}），这一轮没跑完`,
        params: statusParams(statusCode)
      }
    }
    if (statusCode === 401 || statusCode === 403) {
      return {
        key: 'assistantMessage.runEnd.auth',
        fallback: `服务商拒绝请求（${statusCode}）`,
        params: statusParams(statusCode)
      }
    }
    if (statusCode === 429) {
      return {
        key: 'assistantMessage.runEnd.rateLimited',
        fallback: `服务商限流（${statusCode}）`,
        params: statusParams(statusCode)
      }
    }
    if (statusCode >= 500) {
      return {
        key: 'assistantMessage.runEnd.providerError',
        fallback: `服务商返回错误（${statusCode}）`,
        params: statusParams(statusCode)
      }
    }
    return {
      key: 'assistantMessage.runEnd.rejected',
      fallback: `请求被拒绝（${statusCode}）`,
      params: statusParams(statusCode)
    }
  }
  return { key: 'assistantMessage.runEnd.error', fallback: '出错中断，详见上方错误信息' }
}

/**
 * 返回 null 表示**不该显示任何结束语**：正常跑完（completed）没什么可说的。
 * 老消息完全没有 runEnd ⇒ 也是 null，调用方自行回落到旧文案。
 */
export function resolveRunEndLabel(
  runEnd: MessageRunEndMeta | null | undefined
): RunEndLabelDescriptor | null {
  if (!runEnd || typeof runEnd.reason !== 'string') return null

  switch (runEnd.reason) {
    case 'completed':
      return null
    case 'user_cancelled':
      return { key: 'assistantMessage.runEnd.userCancelled', fallback: '你中止了这一轮' }
    case 'aborted':
      return { key: 'assistantMessage.runEnd.aborted', fallback: '这一轮被中断了' }
    case 'max_iterations':
      return {
        key: 'assistantMessage.runEnd.maxIterations',
        fallback: '这一轮到了迭代上限，停在这里'
      }
    case 'error':
      return describeError(runEnd)
    default:
      // Worker 以后加了新原因而这边还没跟上：照实报出原值，不假装是别的。
      return {
        key: 'assistantMessage.runEnd.stopped',
        fallback: `这一轮已结束（${runEnd.reason}）`,
        params: { reason: runEnd.reason }
      }
  }
}
