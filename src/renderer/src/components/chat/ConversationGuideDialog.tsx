/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import * as React from 'react'
import { ExternalLink, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { WEBSITE_URL } from '@renderer/lib/user-guide'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useUIStore } from '@renderer/stores/ui-store'

interface ConversationGuideDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface TourStep {
  key: string
  selector: string
  title: string
  description: string
  ensureVisible?: () => void
}

interface RectState {
  top: number
  left: number
  width: number
  height: number
}

const PADDING = 10
const VIEWPORT_MARGIN = 16
const CARD_WIDTH = 320
const CARD_MIN_WIDTH = 280
const CARD_ESTIMATED_HEIGHT = 300

export function ConversationGuideDialog({
  open,
  onOpenChange
}: ConversationGuideDialogProps): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  const [currentIndex, setCurrentIndex] = React.useState(0)
  const [targetRect, setTargetRect] = React.useState<RectState | null>(null)

  const markSeen = React.useCallback(() => {
    useSettingsStore.getState().updateSettings({ conversationGuideSeen: true })
  }, [])

  const steps = React.useMemo<TourStep[]>(
    () => [
      {
        key: 'modeClarify',
        selector: '[data-tour="mode-clarify"]',
        title: t('guide.steps.modeClarify.title'),
        description: t('guide.steps.modeClarify.description')
      },
      {
        key: 'modeCowork',
        selector: '[data-tour="mode-cowork"]',
        title: t('guide.steps.modeCowork.title'),
        description: t('guide.steps.modeCowork.description')
      },
      {
        key: 'modeCode',
        selector: '[data-tour="mode-code"]',
        title: t('guide.steps.modeCode.title'),
        description: t('guide.steps.modeCode.description')
      },
      {
        key: 'modeAcp',
        selector: '[data-tour="mode-acp"]',
        title: t('guide.steps.modeAcp.title'),
        description: t('guide.steps.modeAcp.description')
      },
      {
        key: 'leftSidebar',
        selector: '[data-tour="left-sidebar"]',
        title: t('guide.steps.leftSidebar.title'),
        description: t('guide.steps.leftSidebar.description'),
        ensureVisible: () => useUIStore.getState().setLeftSidebarOpen(true)
      },
      {
        key: 'sessionActions',
        selector: '[data-tour="session-actions"]',
        title: t('guide.steps.sessionActions.title'),
        description: t('guide.steps.sessionActions.description'),
        ensureVisible: () => useUIStore.getState().setLeftSidebarOpen(true)
      },
      {
        key: 'composer',
        selector: '[data-tour="composer"]',
        title: t('guide.steps.composer.title'),
        description: t('guide.steps.composer.description')
      },
      {
        key: 'mentions',
        selector: '[data-tour="composer"]',
        title: t('guide.steps.mentions.title'),
        description: t('guide.steps.mentions.description')
      },
      {
        key: 'commands',
        selector: '[data-tour="composer-plus"]',
        title: t('guide.steps.commands.title'),
        description: t('guide.steps.commands.description')
      },
      {
        key: 'rightPanel',
        selector: '[data-tour="right-panel"]',
        title: t('guide.steps.rightPanel.title'),
        description: t('guide.steps.rightPanel.description'),
        ensureVisible: () => useUIStore.getState().setRightPanelOpen(true)
      }
    ],
    [t]
  )

  const currentStep = steps[currentIndex]
  const isFirstStep = currentIndex === 0
  const isLastStep = currentIndex === steps.length - 1

  const closeGuide = React.useCallback(() => {
    markSeen()
    onOpenChange(false)
  }, [markSeen, onOpenChange])

  const syncTarget = React.useCallback(() => {
    if (!open || !currentStep) return
    currentStep.ensureVisible?.()
    const element = document.querySelector(currentStep.selector) as HTMLElement | null
    if (!element) {
      setTargetRect(null)
      return
    }
    const rect = element.getBoundingClientRect()
    setTargetRect({
      top: Math.max(8, rect.top - PADDING),
      left: Math.max(8, rect.left - PADDING),
      width: rect.width + PADDING * 2,
      height: rect.height + PADDING * 2
    })
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [currentStep, open])

  React.useEffect(() => {
    if (!open) return
    setCurrentIndex(0)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(syncTarget, 120)
    const onResize = (): void => syncTarget()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
    }
  }, [open, currentIndex, syncTarget])

  if (!open || !currentStep) return null

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const safeCardWidth = Math.max(
    CARD_MIN_WIDTH,
    Math.min(CARD_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2)
  )

  const clampLeft = (left: number): number => {
    return Math.min(
      Math.max(VIEWPORT_MARGIN, left),
      Math.max(VIEWPORT_MARGIN, viewportWidth - safeCardWidth - VIEWPORT_MARGIN)
    )
  }

  const clampTop = (top: number): number => {
    return Math.min(
      Math.max(VIEWPORT_MARGIN, top),
      Math.max(VIEWPORT_MARGIN, viewportHeight - CARD_ESTIMATED_HEIGHT - VIEWPORT_MARGIN)
    )
  }

  const cardStyle = (() => {
    if (!targetRect) {
      return {
        top: clampTop(viewportHeight / 2 - 140),
        left: clampLeft(viewportWidth / 2 - safeCardWidth / 2),
        width: safeCardWidth
      }
    }

    const preferRight = targetRect.left + targetRect.width + safeCardWidth + 24 <= viewportWidth
    const preferLeft = targetRect.left - safeCardWidth - 16 >= VIEWPORT_MARGIN
    const top = clampTop(targetRect.top)

    if (preferRight) {
      return {
        top,
        left: clampLeft(targetRect.left + targetRect.width + 16),
        width: safeCardWidth
      }
    }
    if (preferLeft) {
      return {
        top,
        left: clampLeft(targetRect.left - safeCardWidth - 16),
        width: safeCardWidth
      }
    }

    const belowTop = targetRect.top + targetRect.height + 16
    const aboveTop = targetRect.top - CARD_ESTIMATED_HEIGHT - 16
    const canPlaceBelow = belowTop + CARD_ESTIMATED_HEIGHT + VIEWPORT_MARGIN <= viewportHeight
    const canPlaceAbove = aboveTop >= VIEWPORT_MARGIN

    return {
      top: canPlaceBelow
        ? clampTop(belowTop)
        : canPlaceAbove
          ? clampTop(aboveTop)
          : clampTop(viewportHeight / 2 - CARD_ESTIMATED_HEIGHT / 2),
      left: clampLeft(targetRect.left),
      width: safeCardWidth
    }
  })()

  return (
    <div className="fixed inset-0 z-[200]">
      {targetRect ? (
        <>
          <div
            className="absolute bg-black/55"
            style={{ top: 0, left: 0, right: 0, height: targetRect.top }}
          />
          <div
            className="absolute bg-black/55"
            style={{
              top: targetRect.top,
              left: 0,
              width: targetRect.left,
              height: targetRect.height
            }}
          />
          <div
            className="absolute bg-black/55"
            style={{
              top: targetRect.top,
              left: targetRect.left + targetRect.width,
              right: 0,
              height: targetRect.height
            }}
          />
          <div
            className="absolute bg-black/55"
            style={{ top: targetRect.top + targetRect.height, left: 0, right: 0, bottom: 0 }}
          />
          <div
            className="pointer-events-none absolute rounded-2xl border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.15)] transition-all duration-200"
            style={{
              top: targetRect.top,
              left: targetRect.left,
              width: targetRect.width,
              height: targetRect.height
            }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-black/55" />
      )}

      <div
        className="absolute rounded-2xl border border-border/60 bg-background p-4 shadow-2xl sm:p-5"
        style={{
          ...cardStyle,
          maxHeight: `calc(100vh - ${VIEWPORT_MARGIN * 2}px)`,
          overflowY: 'auto'
        }}
      >
        <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-600 dark:text-violet-400">
            <Sparkles className="size-3" />
            {t('guide.badge')}
          </span>
          <span>{t('guide.progress', { current: currentIndex + 1, total: steps.length })}</span>
        </div>

        <h3 className="text-base font-semibold text-foreground">{currentStep.title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{currentStep.description}</p>

        <div className="mt-4 flex items-center gap-1">
          {steps.map((step, index) => (
            <span
              key={step.key}
              className={`h-1.5 flex-1 rounded-full ${index <= currentIndex ? 'bg-primary' : 'bg-muted'}`}
            />
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() =>
                window.open(`${WEBSITE_URL}/`, '_blank', 'noopener,noreferrer')
              }
            >
              <ExternalLink className="size-3.5" />
              {t('guide.openDocs')}
            </Button>
            <Button variant="outline" size="sm" onClick={closeGuide}>
              {t('guide.skip')}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentIndex((prev) => Math.max(prev - 1, 0))}
              disabled={isFirstStep}
            >
              {t('guide.previous')}
            </Button>
            <Button
              size="sm"
              onClick={() => (isLastStep ? closeGuide() : setCurrentIndex((prev) => prev + 1))}
            >
              {isLastStep ? t('guide.finish') : t('guide.next')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
