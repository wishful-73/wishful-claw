import * as React from 'react'
import { Command, FileCode2, Puzzle, Sparkles } from 'lucide-react'
import { Spinner } from '@renderer/components/ui/spinner'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'

import type { SlashSuggestionItem, FileSearchItem } from './types'

interface ComposerFlyoversProps {
  // File search flyover
  fileMenuOpen: boolean
  fileSearchLoading: boolean
  fileSearchResults: FileSearchItem[]
  selectedFileSearchIndex: number
  setSelectedFileSearchIndex: React.Dispatch<React.SetStateAction<number>>
  flyoutPointerRef: React.MutableRefObject<{ x: number; y: number } | null>
  insertSelectedFile: (path: string) => void
  needsWorkingFolder: boolean
  onSelectFolder?: () => void

  // Slash menu flyover
  slashMenuOpen: boolean
  slashQuery: string | null
  slashSuggestionsLoading: boolean
  slashSuggestions: SlashSuggestionItem[]
  selectedSlashIndex: number
  setSelectedSlashIndex: React.Dispatch<React.SetStateAction<number>>
  slashListRef: React.RefObject<HTMLDivElement | null>
  applySlashSuggestion: (item: SlashSuggestionItem) => void
}

export function ComposerFlyovers({
  fileMenuOpen,
  fileSearchLoading,
  fileSearchResults,
  selectedFileSearchIndex,
  setSelectedFileSearchIndex,
  flyoutPointerRef,
  insertSelectedFile,
  needsWorkingFolder,
  onSelectFolder,
  slashMenuOpen,
  slashQuery,
  slashSuggestionsLoading,
  slashSuggestions,
  selectedSlashIndex,
  setSelectedSlashIndex,
  slashListRef,
  applySlashSuggestion
}: ComposerFlyoversProps) {
  const { t } = useTranslation('chat')

  return (
    <>
      {fileMenuOpen && (
        <div className="composer-flyout absolute inset-x-0 bottom-full z-30 mb-2 overflow-hidden rounded-[18px]">
          <div className="composer-flyout-header flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
            <FileCode2 className="size-3.5" />
            <span>
              {t('input.fileSearch', { defaultValue: 'File search — select to insert @file reference' })}
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {needsWorkingFolder ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-muted/50"
                onClick={() => onSelectFolder?.()}
              >
                <FileCode2 className="size-3.5 shrink-0" />
                <span>
                  {t('input.noWorkingFolderSelected', {
                    defaultValue: 'Please select a working directory first'
                  })}
                </span>
              </button>
            ) : fileSearchLoading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <Spinner className="size-3.5" />
                <span>
                  {t('input.loadingFiles', { defaultValue: 'Searching files...' })}
                </span>
              </div>
            ) : fileSearchResults.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                {t('input.noFilesFound', { defaultValue: 'No matching files' })}
              </div>
            ) : (
              fileSearchResults.map((file, index) => {
                const isSelected = index === selectedFileSearchIndex
                return (
                  <button
                    key={file.path}
                    type="button"
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                      isSelected
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-muted/50 text-foreground'
                    )}
                    onMouseMove={(event) => {
                      const prev = flyoutPointerRef.current
                      if (prev?.x === event.clientX && prev?.y === event.clientY) return
                      flyoutPointerRef.current = { x: event.clientX, y: event.clientY }
                      if (index !== selectedFileSearchIndex) {
                        setSelectedFileSearchIndex(index)
                      }
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      insertSelectedFile(file.path)
                    }}
                    onClick={(event) => {
                      event.preventDefault()
                    }}
                  >
                    <FileCode2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{file.name}</div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {file.path}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}

      {slashMenuOpen && (
        <div className="composer-flyout absolute inset-x-0 bottom-full z-30 mb-2 overflow-hidden rounded-[18px]">
          <div className="composer-flyout-header flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
            <Command className="size-3.5" />
            <span>
              {t('input.slashSuggestions', {
                defaultValue: 'Command, plugin & skill suggestions'
              })}
            </span>
            <span className="composer-status-pill ml-auto rounded-full px-1.5 py-0.5 text-[10px]">
              /{slashQuery ?? ''}
            </span>
          </div>
          <div ref={slashListRef} className="max-h-64 overflow-y-auto p-1">
            {slashSuggestionsLoading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <Spinner className="size-3.5" />
                <span>
                  {t('input.loadingSuggestions', { defaultValue: 'Loading suggestions...' })}
                </span>
              </div>
            ) : slashSuggestions.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                {t('input.noSuggestions', { defaultValue: 'No matching suggestions' })}
              </div>
            ) : (
              slashSuggestions.map((item, index) => {
                const isSelected = index === selectedSlashIndex
                return (
                  <button
                    key={`${item.kind}-${item.name}`}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                      isSelected
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-muted/50 text-foreground'
                    )}
                    onMouseMove={(event) => {
                      const prev = flyoutPointerRef.current
                      if (prev?.x === event.clientX && prev?.y === event.clientY) return
                      flyoutPointerRef.current = { x: event.clientX, y: event.clientY }
                      if (index !== selectedSlashIndex) {
                        setSelectedSlashIndex(index)
                      }
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      applySlashSuggestion(item)
                    }}
                  >
                    {item.kind === 'skill' ? (
                      <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : item.kind === 'plugin' ? (
                      <Puzzle className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <Command className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex flex-1 items-center gap-2 overflow-hidden">
                      <div className="max-w-[45%] shrink-0 truncate text-sm font-medium">
                        {item.kind === 'command'
                          ? `/${item.name}`
                          : (item.label ?? item.name)}
                      </div>
                      {item.summary && (
                        <div className="truncate text-[11px] text-muted-foreground">
                          {item.summary}
                        </div>
                      )}
                    </div>
                    <span className="composer-status-pill shrink-0 rounded-full px-1.5 py-0.5 text-[10px]">
                      {item.kind === 'command'
                        ? t('skills.commandsLabel')
                        : item.kind === 'plugin'
                          ? t('skills.pluginsLabel')
                          : t('skills.skillsLabel')}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </>
  )
}
