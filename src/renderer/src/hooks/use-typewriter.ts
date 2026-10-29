/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { LiveOutputAnimationStyle } from '@renderer/stores/settings-store'
import { recordStreamingRenderPoolFlush } from '@renderer/lib/streaming-perf'

interface StreamingRenderPoolState {
  text: string
  poolSize: number
  renderedLength: number
  targetLength: number
}

interface RenderPoolConfig {
  /** Frames needed to drain the whole backlog: each frame consumes 1/K of it. */
  catchupFrames: number
  frameIntervalMs: number
  /** S-149：池子超过这个体积就算「压力大」，帧间隔开始放宽。 */
  pressurePoolSize: number
  /** S-149：压力拉满时允许放到的最长帧间隔（ms）。 */
  maxFrameIntervalMs: number
  /**
   * S-256（2026-10-29）：单帧最多喂多少字符进解析器。
   *
   * **这是 iter-29 T-15 的反向修正** —— T-15 当年为了「长思考能追上上游」取消了步长上限，
   * 结果积压一百万字符时单帧就要排五十万字符：markdown 解析 + React commit + layout/paint
   * 串行做完，主线程被连续占满，整页像截图一样静止、停止按钮点下去几分钟才生效（S-149 §7.4
   * 就写明「要真消除得上流式期间限制单帧渲染的文本量，未做、等口径」，这就是那个口径）。
   *
   * 取值按「够快追得上，又不至于卡住一帧」：1600 字符 / 32ms ≈ 每秒 5 万字符，仍远高于
   * 模型输出速度，正常流式永远追得上，只有异常积压才会慢下来。
   */
  maxStepChars: number
}

export const RENDER_POOL_CONFIG: Record<LiveOutputAnimationStyle, RenderPoolConfig> = {
  agile: {
    catchupFrames: 2,
    frameIntervalMs: 32,
    pressurePoolSize: 2_000,
    maxFrameIntervalMs: 64,
    maxStepChars: 1_600
  },
  elegant: {
    catchupFrames: 3,
    frameIntervalMs: 36,
    pressurePoolSize: 1_500,
    maxFrameIntervalMs: 72,
    maxStepChars: 1_200
  }
}

/**
 * Bounded catch-up: every frame drains 1/K of the backlog, so the pool is empty within
 * K frames no matter how large it grew.
 *
 * The previous version mixed a fixed typewriter rate with three stepped catch-up ratios,
 * and both halves were the problem:
 *  - the fixed rate (220 chars/s) capped the drain speed, so the lag scaled with the
 *    amount of text — a long reasoning block kept rendering long after the backend had
 *    already moved on to later tool calls;
 *  - the stepped ratios (0.14 / 0.2 / 0.28) switched hard at pool-size boundaries, so a
 *    pool hovering around 120 kept flipping the per-frame step between ~7 and ~17 chars,
 *    which reads as stuttering.
 *
 * One continuous, monotonic formula removes both: the step grows smoothly with the
 * backlog, and the remaining pool decays geometrically (K = 2 halves the backlog every
 * frame, so a 10k-char burst drains in ~15 frames ≈ half a second) — the lag no longer
 * scales with the response length.
 *
 * A larger K reads as more gradual, at the cost of a longer tail; a smaller K is punchier.
 *
 * **S-256 追加：单帧还有绝对上限 `maxStepChars`。** 纯比例公式在积压极深时会算出天文数字
 * 的步长（100 万字符 ⇒ 50 万字符/帧），一帧就把主线程钉死 —— 那正是「整页像截图一样静止」
 * 的成因。所以取 `min(比例步长, maxStepChars)`：比例保证不卡顿、上限保证不卡死。
 */
export function getCatchupStep(poolSize: number, config: RenderPoolConfig): number {
  if (poolSize <= 0) return 0
  const proportional = Math.ceil(poolSize / config.catchupFrames)
  const cap = config.maxStepChars > 0 ? config.maxStepChars : proportional
  return Math.max(1, Math.min(proportional, cap))
}

/**
 * S-149 — 帧间隔由池子压力决定。
 *
 * 池子小（渲染追得上上游）：固定 `frameIntervalMs`，观感与原来完全一致。
 * 池子大（上游在爆发）：**每帧的渲染成本也随之变大** —— 正文每帧要重解析 markdown、
 * 思考块每帧要重排整段长文本。此时再按 32ms 一帧催，主线程就被连续占满，
 * 「整页像截图一样静止、停止按钮点下去几分钟才生效」正是这条链走到极端的样子。
 *
 * 所以池子越大，允许拉得越长（线性逼近 `maxFrameIntervalMs`），把主线程让出来给
 * 点击 / 滚动 / 停止。压力从 `pressurePoolSize` 起算，到 4 倍时拉满。
 *
 * **只放宽间隔，不动步长** —— 步长仍是 `ceil(pool/K)`。iter-29 T-15 取消的是步长上限
 * （让长思考能追上上游），跟帧频是两件事，不要把这条当成回退。
 */
export function resolveFrameIntervalMs(poolSize: number, config: RenderPoolConfig): number {
  const { frameIntervalMs, maxFrameIntervalMs, pressurePoolSize } = config
  if (poolSize <= pressurePoolSize) return frameIntervalMs
  const ratio = Math.min(1, (poolSize - pressurePoolSize) / (pressurePoolSize * 3))
  return frameIntervalMs + (maxFrameIntervalMs - frameIntervalMs) * ratio
}

/**
 * Keeps live text in a render pool instead of rendering every upstream delta directly.
 *
 * The pool exists so React/Markstream does not re-render on every token; it deliberately
 * does NOT rate-limit the text, so the visible output tracks the upstream stream with a
 * bounded lag (see `getCatchupStep`).
 */
export function useStreamingRenderPool(
  fullText: string,
  isStreaming: boolean,
  style: LiveOutputAnimationStyle = 'agile'
): StreamingRenderPoolState {
  const config = RENDER_POOL_CONFIG[style] ?? RENDER_POOL_CONFIG.agile
  const targetLengthRef = useRef(fullText.length)
  const renderedLengthRef = useRef(fullText.length)
  const committedLengthRef = useRef(fullText.length)
  const rafRef = useRef<number | null>(null)
  const lastFlushAtRef = useRef(0)
  const [renderedLength, setRenderedLength] = useState(fullText.length)

  useEffect(() => {
    targetLengthRef.current = fullText.length
  }, [fullText.length])

  useEffect(() => {
    if (!isStreaming) {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      renderedLengthRef.current = fullText.length
      return
    }

    if (renderedLengthRef.current > fullText.length) {
      renderedLengthRef.current = fullText.length
    }
  }, [fullText.length, isStreaming])

  useEffect(() => {
    if (!isStreaming) return

    lastFlushAtRef.current = 0

    const tick = (now: number): void => {
      const targetLength = targetLengthRef.current
      const currentLength = renderedLengthRef.current
      const poolSize = Math.max(0, targetLength - currentLength)
      // S-149：帧间隔随池子压力浮动 —— 池子越大，单帧渲染越贵，就放得越慢，
      // 把主线程让出来（见 resolveFrameIntervalMs）。池子空时即基准间隔，语义同原来。
      const intervalMs = resolveFrameIntervalMs(poolSize, config)

      const lastFlushAt = lastFlushAtRef.current
      const elapsedMs = lastFlushAt > 0 ? now - lastFlushAt : intervalMs

      if (elapsedMs >= intervalMs) {
        lastFlushAtRef.current = now

        if (poolSize > 0) {
          const measureStart = performance.now()
          const step = getCatchupStep(poolSize, config)
          const nextLength = Math.min(targetLength, currentLength + step)

          renderedLengthRef.current = nextLength
          committedLengthRef.current = nextLength
          setRenderedLength(nextLength)
          recordStreamingRenderPoolFlush(performance.now() - measureStart, {
            poolSize,
            step,
            renderedLength: nextLength,
            targetLength
          })
        } else if (committedLengthRef.current !== currentLength) {
          committedLengthRef.current = currentLength
          setRenderedLength(currentLength)
        }
      }

      rafRef.current = window.requestAnimationFrame(tick)
    }

    rafRef.current = window.requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [config, isStreaming])

  const safeRenderedLength = Math.min(renderedLength, fullText.length)
  const poolSize = Math.max(0, fullText.length - safeRenderedLength)
  const text = useMemo(() => {
    if (!isStreaming) return fullText
    return fullText.slice(0, safeRenderedLength)
  }, [fullText, isStreaming, safeRenderedLength])

  return {
    text,
    poolSize,
    renderedLength: safeRenderedLength,
    targetLength: fullText.length
  }
}

export function useTypewriter(fullText: string, isStreaming: boolean): string {
  return useStreamingRenderPool(fullText, isStreaming).text
}
