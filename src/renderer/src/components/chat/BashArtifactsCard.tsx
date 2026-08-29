/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FileOutput, FolderOpen } from 'lucide-react'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'

interface BashArtifact {
  path: string
  size: number
}

interface BashArtifactsCardProps {
  artifacts: BashArtifact[]
  truncated?: number
}

function prettySize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function splitPath(path: string): { base: string; dir: string } {
  const normalized = path.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash === -1) return { base: normalized, dir: '' }
  return { base: normalized.slice(lastSlash + 1), dir: normalized.slice(0, lastSlash) }
}

export function BashArtifactsCard({
  artifacts,
  truncated
}: BashArtifactsCardProps): React.JSX.Element {
  const { t } = useTranslation('chat')

  // The main-process handlers expect { path } — a bare string leaves
  // args.path undefined and the call silently does nothing.
  const handleReveal = (path: string): void => {
    void ipcClient.invoke('shell:showItemInFolder', { path }).catch((err) => {
      console.error('[BashArtifactsCard] Reveal in folder failed:', err)
      toast.error(t('artifacts.revealFailed', { defaultValue: 'Failed to reveal file' }))
    })
  }

  const handleOpen = async (path: string): Promise<void> => {
    try {
      // shell:openPath resolves to '' on success or an error message.
      const result = await ipcClient.invoke('shell:openPath', { path })
      const openError =
        typeof result === 'string'
          ? result
          : ((result as { error?: string } | null)?.error ?? '')
      if (openError) {
        toast.error(t('artifacts.openFailed', { defaultValue: 'Failed to open file' }), {
          description: openError
        })
      }
    } catch (err) {
      console.error('[BashArtifactsCard] Open file failed:', err)
      toast.error(t('artifacts.openFailed', { defaultValue: 'Failed to open file' }))
    }
  }

  return (
    <div className="my-0 min-w-0 space-y-1.5 rounded-md border border-dashed px-2.5 py-2">
      <p className="text-xs font-medium text-muted-foreground">
        {t('artifacts.title', { defaultValue: 'Files created' })} · {artifacts.length}
      </p>
      <div className="space-y-1">
        {artifacts.map((artifact) => {
          const { base, dir } = splitPath(artifact.path)
          return (
            <div
              key={artifact.path}
              className="flex min-w-0 items-center gap-2 rounded-md bg-muted/20 px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[11px] text-foreground" title={artifact.path}>
                  {base}
                </p>
                <p className="truncate text-[9px] text-muted-foreground/60" title={dir}>
                  {dir} · {prettySize(artifact.size)}
                </p>
              </div>
              <button
                type="button"
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                onClick={() => handleReveal(artifact.path)}
              >
                <FolderOpen className="size-3" />
                {t('artifacts.reveal', { defaultValue: 'Reveal in Finder' })}
              </button>
              <button
                type="button"
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                onClick={() => void handleOpen(artifact.path)}
              >
                <FileOutput className="size-3" />
                {t('artifacts.open', { defaultValue: 'Open' })}
              </button>
            </div>
          )
        })}
      </div>
      {truncated ? (
        <p className="text-[10px] text-muted-foreground/60">
          {t('artifacts.more', { count: truncated, defaultValue: `+${truncated} more` })}
        </p>
      ) : null}
    </div>
  )
}
