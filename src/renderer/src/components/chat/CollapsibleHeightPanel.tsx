/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import * as React from 'react'

const PANEL_TRANSITION = 'height 0.2s ease-in-out, opacity 0.2s ease-in-out'

interface CollapsibleHeightPanelProps {
  open: boolean
  children: React.ReactNode
  className?: string
  /** When false, content is always shown without animation (e.g. non-collapsible groups). */
  enabled?: boolean
  contentClassName?: string
}

/**
 * Height collapse/expand panel using CSS transitions.
 *
 * Uses a ref-based approach to measure and set pixel heights, avoiding
 * framer-motion's inability to animate from 'auto' to a numeric value.
 *
 * - Open: set height to 0px, then to measured scrollHeight, then to 'auto'
 *   after transition ends (so content can grow freely).
 * - Close: set height to current measured px, then to 0px on next frame.
 */
export function CollapsibleHeightPanel({
  open,
  children,
  className,
  enabled = true,
  contentClassName
}: CollapsibleHeightPanelProps): React.JSX.Element | null {
  const [mounted, setMounted] = React.useState(open || !enabled)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const openRef = React.useRef(open)
  const rafRef = React.useRef<number | null>(null)

  // Apply height to the DOM element directly for reliable transitions
  const applyHeight = React.useCallback((px: number | 'auto') => {
    const el = panelRef.current
    if (!el) return
    if (px === 'auto') {
      el.style.height = 'auto'
    } else {
      el.style.height = `${px}px`
    }
  }, [])

  React.useLayoutEffect(() => {
    if (!enabled) {
      setMounted(true)
      openRef.current = open
      return
    }

    const wasOpen = openRef.current
    openRef.current = open

    if (open && !wasOpen) {
      // Opening
      setMounted(true)
      // Start from 0px, then animate to measured height
      applyHeight(0)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        const measured = panelRef.current?.scrollHeight ?? 0
        applyHeight(measured > 0 ? measured : 'auto')
      })
      return
    }

    if (!open && wasOpen) {
      // Closing: lock current height as px, then animate to 0 on next frame
      const el = panelRef.current
      if (!el) return
      const measured = el.getBoundingClientRect().height
      if (measured > 0) {
        applyHeight(measured)
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          applyHeight(0)
        })
      })
      return
    }
  }, [enabled, open, applyHeight])

  // After CSS transition ends, switch to 'auto' when open so content can resize.
  //
  // S-247（2026-10-31）：`transitionend` **会冒泡**。面板里装的卡片到处是
  // `transition-colors` / `transition-shadow` / `transition-opacity`（鼠标划过就触发），
  // 以前不辨来源，收起动画进行中（`mounted` 仍为 true）时，子元素任何一次 transition
  // 结束都会冒泡到这里 → 提前 `setMounted(false)` → 高度从「正在收」突变成 0。
  // 症状就是聊天窗抖动，且「并没有组件正在回收高度」。只认面板自己那一次。
  const handleTransitionEnd = React.useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      if (!enabled) return
      if (event.target !== event.currentTarget) return
      if (open) {
        applyHeight('auto')
      } else {
        // Fully collapsed - unmount
        setMounted(false)
      }
    },
    [enabled, open, applyHeight]
  )

  // Keep height in sync when content changes while open
  React.useLayoutEffect(() => {
    if (!enabled || !open || !mounted) return
    const el = panelRef.current
    if (!el) return
    // Only adjust if currently 'auto' (settled state) - no transition needed
    if (el.style.height === 'auto' || el.style.height === '') {
      // Already auto, content flows naturally
      return
    }
    // If we're in a px-locked state during open, update to new content height
    const measured = el.scrollHeight
    if (measured > 0) applyHeight(measured)
  }, [children, enabled, mounted, open, applyHeight])

  // Cleanup rAF on unmount
  React.useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  if (!enabled) {
    return <div className={className}>{children}</div>
  }

  if (!mounted) return null

  return (
    <div
      ref={panelRef}
      style={{
        height: open ? 'auto' : 0,
        overflow: 'hidden',
        transition: PANEL_TRANSITION,
        opacity: open ? 1 : 0
      }}
      onTransitionEnd={handleTransitionEnd}
      className={className}
    >
      <div className={contentClassName}>{children}</div>
    </div>
  )
}
