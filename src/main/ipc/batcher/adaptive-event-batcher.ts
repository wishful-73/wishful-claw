import {
  AGENT_STREAM_PROTOCOL_VERSION,
  type AgentStreamEnvelope,
  type AgentStreamEvent
} from '../../../shared/agent-stream-protocol'
import { DEFAULT_BATCHER_CONFIG, type AdaptiveEventBatcherConfig } from './batcher-config'
import {
  accumulateEvent,
  accumulatedSize,
  createAccumulator,
  drainAccumulator,
  type BatcherAccumulator
} from './batcher-codec'

export type EnvelopeHandler = (envelope: AgentStreamEnvelope) => void

/**
 * 流式事件批处理器（iter-34 S-135）。
 *
 * 契约：
 * - 可加事件（正文 / 思考 / 工具参数）按 run 攒，最多等一个 flushMs 推一次；
 * - 控制类事件（工具生命周期、循环起止、错误等）先把攒着的 delta 推出去
 *   （保序），再单独立即直通 —— 降频不能改变渲染层看到的事件先后；
 * - 缓冲体积超 maxBufferSize 就直接 flush，不等定时器；
 * - 每个 run 的信封 seq 自己从 0 单调递增，渲染层按它检测丢包，
 *   所以绝不能跳号或回退。
 */
export class AdaptiveEventBatcher {
  private readonly config: AdaptiveEventBatcherConfig
  private readonly runs = new Map<string, BatcherAccumulator>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private handler: EnvelopeHandler | null = null

  constructor(config?: Partial<AdaptiveEventBatcherConfig>) {
    this.config = { ...DEFAULT_BATCHER_CONFIG, ...config }
  }

  setHandler(handler: EnvelopeHandler): void {
    this.handler = handler
  }

  /** 喂一个事件。runId / sessionId 由上游信封带下来。 */
  push(runId: string, sessionId: string, event: AgentStreamEvent): void {
    const acc = this.acquireRun(runId, sessionId)
    acc.lastEventAt = Date.now()

    if (accumulateEvent(acc, event)) {
      if (accumulatedSize(acc) >= this.config.maxBufferSize) {
        this.flushRun(runId)
        return
      }
      this.scheduleFlush(runId)
      return
    }

    // 控制类事件：先把攒着的 delta 推出去（保序），再直通。
    this.flushRun(runId)
    this.emit(acc, [event])

    // 循环结束 / 报错 ⇒ 这个 run 不会再产生事件，清掉它的缓冲。
    if (event.type === 'loop_end' || event.type === 'error') {
      this.dropRun(runId)
    }
  }

  /** 立刻把某个 run 攒着的事件推出去。 */
  flushRun(runId: string): void {
    const acc = this.runs.get(runId)
    if (!acc) return
    this.clearTimer(runId)

    const events = drainAccumulator(acc)
    if (events.length > 0) {
      this.emit(acc, events)
    }
  }

  flushAll(): void {
    for (const runId of [...this.runs.keys()]) {
      this.flushRun(runId)
    }
  }

  /** 进程退出前调用：把剩下的推完，清掉所有定时器。 */
  stop(): void {
    this.flushAll()
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.runs.clear()
  }

  // ---- Internal ----

  private acquireRun(runId: string, sessionId: string): BatcherAccumulator {
    let acc = this.runs.get(runId)
    if (!acc) {
      acc = createAccumulator(runId, sessionId)
      this.runs.set(runId, acc)
    }
    return acc
  }

  private scheduleFlush(runId: string): void {
    if (this.timers.has(runId)) return
    this.timers.set(
      runId,
      setTimeout(() => {
        this.timers.delete(runId)
        this.flushRun(runId)
      }, this.config.flushMs)
    )
  }

  private clearTimer(runId: string): void {
    const timer = this.timers.get(runId)
    if (timer === undefined) return
    clearTimeout(timer)
    this.timers.delete(runId)
  }

  private dropRun(runId: string): void {
    this.clearTimer(runId)
    this.runs.delete(runId)
  }

  private emit(acc: BatcherAccumulator, events: AgentStreamEvent[]): void {
    if (events.length === 0 || !this.handler) return

    const envelope: AgentStreamEnvelope = {
      v: AGENT_STREAM_PROTOCOL_VERSION,
      runId: acc.runId,
      sessionId: acc.sessionId,
      seq: acc.seq++,
      events
    }
    this.handler(envelope)
  }
}
