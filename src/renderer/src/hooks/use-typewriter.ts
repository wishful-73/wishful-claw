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
}

export const RENDER_POOL_CONFIG: Record<LiveOutputAnimationStyle, RenderPoolConfig> = {
  agile: {
    catchupFrames: 2,
    frameIntervalMs: 32
  },
  elegant: {
    catchupFrames: 3,
    frameIntervalMs: 36
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
 */
export function getCatchupStep(poolSize: number, config: RenderPoolConfig): number {
  if (poolSize <= 0) return 0
  return Math.max(1, Math.ceil(poolSize / config.catchupFrames))
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
      const lastFlushAt = lastFlushAtRef.current
      const elapsedMs = lastFlushAt > 0 ? now - lastFlushAt : config.frameIntervalMs

      if (elapsedMs >= config.frameIntervalMs) {
        lastFlushAtRef.current = now
        const targetLength = targetLengthRef.current
        const currentLength = renderedLengthRef.current
        const poolSize = Math.max(0, targetLength - currentLength)

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
