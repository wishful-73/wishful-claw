/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { useEffect, useRef, useState } from 'react'
import { formatTokens } from '@renderer/lib/format-tokens'

interface TokenCounterProps {
  /** Target token count to animate to */
  target: number
  /** Animation duration in milliseconds */
  duration?: number
  /** Starting value (for cumulative counting) */
  startFrom?: number
  /** Whether to animate or show immediately */
  animate?: boolean
}

/**
 * Animated token counter component with smooth counting animation
 */
export function TokenCounter({
  target,
  duration = 500,
  startFrom = 0,
  animate = true
}: TokenCounterProps): React.JSX.Element {
  const [displayValue, setDisplayValue] = useState(startFrom)
  const rafRef = useRef<number | undefined>(undefined)
  const startTimeRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!animate) {
      setDisplayValue(target)
      return
    }

    if (target === startFrom) {
      setDisplayValue(target)
      return
    }

    // Cancel any ongoing animation
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
    }

    startTimeRef.current = performance.now()
    const startValue = startFrom
    const delta = target - startFrom

    const animateCount = (currentTime: number): void => {
      if (!startTimeRef.current) return

      const elapsed = currentTime - startTimeRef.current
      const progress = Math.min(elapsed / duration, 1)

      // Easing function: ease-out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = startValue + delta * eased

      setDisplayValue(current)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animateCount)
      } else {
        setDisplayValue(target)
      }
    }

    rafRef.current = requestAnimationFrame(animateCount)

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [target, duration, startFrom, animate])

  return <span className="tabular-nums">{formatTokens(displayValue)}</span>
}
