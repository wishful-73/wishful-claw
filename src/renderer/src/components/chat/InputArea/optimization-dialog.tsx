import * as React from 'react'
import { Wand2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle
} from '@renderer/components/ui/dialog'
import { useTranslation } from 'react-i18next'
import type { OptimizationOption } from './use-prompt-optimizer'

interface OptimizationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: OptimizationOption[]
  optimizingText?: string
  selectedOptionIndex: number
  onSelectOption: (index: number) => void
  onUseOption: (content: string) => void
  onCancel: () => void
  isOptimizing: boolean
}

export function OptimizationDialog({
  open,
  onOpenChange,
  options,
  optimizingText,
  selectedOptionIndex,
  onSelectOption,
  onUseOption,
  onCancel,
  isOptimizing
}: OptimizationDialogProps) {
  const { t } = useTranslation('chat')
  const contentScrollRef = React.useRef<HTMLDivElement>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl h-[85vh] max-h-[90vh] overflow-hidden flex flex-col gap-4 sm:max-w-7xl">
        <DialogHeader className="space-y-2 shrink-0">
          <DialogTitle className="text-xl flex items-center gap-2">
            <Wand2 className="size-5 text-primary" />
            {t('input.optimizationResults', { defaultValue: 'Optimized Prompt Options' })}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {t('input.optimizationResultsDesc', {
              defaultValue:
                'Select one of the optimized versions below to use in your prompt.'
            })}
          </DialogDescription>
        </DialogHeader>

        {/* Tab-style Layout */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Tabs - Options as tabs at top */}
          <div className="flex gap-2 border-b border-border shrink-0">
            {/* Render 3 slots: filled or loading */}
            {Array.from({ length: 3 }).map((_, slotIdx) => {
              const option = options[slotIdx]
              return option ? (
                <button
                  key={slotIdx}
                  type="button"
                  className={`flex-1 px-4 py-3 rounded-t-lg border-2 border-b-0 transition-all ${
                    selectedOptionIndex === slotIdx
                      ? 'border-primary bg-primary/5 -mb-[2px] border-b-2 border-b-background'
                      : 'border-transparent hover:bg-muted/30'
                  }`}
                  onClick={() => {
                    onSelectOption(slotIdx)
                    if (contentScrollRef.current) {
                      contentScrollRef.current.scrollTop = 0
                    }
                  }}
                >
                  <div className="flex items-center justify-center gap-2">
                    <span
                      className={`inline-flex items-center justify-center size-6 rounded-full text-xs font-bold ${
                        selectedOptionIndex === slotIdx
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {slotIdx + 1}
                    </span>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-foreground">{option.title}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {option.focus}
                      </p>
                    </div>
                  </div>
                </button>
              ) : (
                <div
                  key={`loading-${slotIdx}`}
                  className="flex-1 px-4 py-3 rounded-t-lg border-2 border-b-0 border-transparent"
                >
                  <div className="flex items-center justify-center gap-2 opacity-50">
                    <span className="inline-flex items-center justify-center size-6 rounded-full text-xs font-bold bg-muted text-muted-foreground">
                      {slotIdx + 1}
                    </span>
                    <div className="text-left">
                      {isOptimizing ? (
                        <>
                          <div className="h-3.5 w-20 bg-muted rounded animate-pulse" />
                          <div className="h-2.5 w-16 bg-muted rounded animate-pulse mt-1" />
                        </>
                      ) : (
                        <div className="h-3.5 w-20" />
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Content Area */}
          <div
            ref={contentScrollRef}
            className="flex-1 min-h-0 mt-2 h-[60vh] overflow-y-auto rounded-lg border border-border bg-background px-6 py-4"
          >
            {options[selectedOptionIndex] ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed font-sans">
                  {options[selectedOptionIndex]?.content}
                </div>
              </div>
            ) : optimizingText ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed font-sans">
                  {optimizingText}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-32">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Spinner className="size-4" />
                  <span className="text-sm">
                    {t('input.optimizing', { defaultValue: 'Optimizing your prompt...' })}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between shrink-0">
          <Button variant="outline" onClick={onCancel}>
            {t('action.cancel', { ns: 'common' })}
          </Button>
          <Button
            disabled={!options[selectedOptionIndex]}
            onClick={() => onUseOption(options[selectedOptionIndex]?.content)}
          >
            {t('input.useThisOption', { defaultValue: 'Use This' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
