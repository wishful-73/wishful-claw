/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import * as React from 'react'
import { Baseline, Type } from 'lucide-react'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import type { ViewerProps } from '../viewer-registry'
import { viewerText } from '../viewer-text'

const MIME_TYPES: Record<string, string> = {
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

const FONT_FORMATS: Record<string, string> = {
  '.ttf': 'truetype',
  '.otf': 'opentype',
  '.woff': 'woff',
  '.woff2': 'woff2'
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function extension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
}

function cssFontFamily(filePath: string): string {
  return `preview-${fileName(filePath).replace(/[^a-z0-9_-]/gi, '-')}`
}

export function FontViewer({
  filePath,
  sshConnectionId,
  fileVersion
}: ViewerProps): React.JSX.Element {
  const [src, setSrc] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const ext = extension(filePath)
  const family = React.useMemo(() => cssFontFamily(filePath), [filePath])

  React.useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    setSrc(null)
    setError(null)

    const channel = sshConnectionId ? IPC.SSH_FS_READ_FILE_BINARY : IPC.FS_READ_FILE_BINARY
    const args = sshConnectionId
      ? { connectionId: sshConnectionId, path: filePath }
      : { path: filePath }

    ipcClient.invoke(channel, args).then((raw: unknown) => {
      if (cancelled) return
      const result = raw as { data?: string; error?: string }
      if (result.error || !result.data) {
        const readFailed = viewerText('failReadFont')
        setError(result.error ? `${readFailed}: ${result.error}` : readFailed)
        return
      }

      try {
        const bytes = Uint8Array.from(atob(result.data), (char) => char.charCodeAt(0))
        const blob = new Blob([bytes], { type: MIME_TYPES[ext] ?? 'font/ttf' })
        objectUrl = URL.createObjectURL(blob)
        if (!cancelled) setSrc(objectUrl)
      } catch (err) {
        if (!cancelled) setError(String(err))
      }
    })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [ext, filePath, fileVersion, sshConnectionId])

  if (error) {
    return (
      <div className="flex size-full items-center justify-center gap-2 text-sm text-destructive">
        <Type className="size-5" />
        {error}
      </div>
    )
  }

  if (!src) {
    return (
      <div className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Type className="size-5 animate-pulse" />
        {viewerText('loadingFont')}
      </div>
    )
  }

  return (
    <div className="size-full overflow-y-auto bg-muted/15 p-5">
      <style>
        {`@font-face{font-family:"${family}";src:url("${src}") format("${FONT_FORMATS[ext] ?? 'truetype'}");font-display:block;}`}
      </style>
      <div className="mx-auto max-w-3xl rounded-2xl border border-border/70 bg-background p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Baseline className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{fileName(filePath)}</div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {ext.replace('.', '') || 'font'}
            </div>
          </div>
        </div>

        <div style={{ fontFamily: `"${family}", serif` }}>
          <div className="text-6xl leading-tight">Aa Bb Cc</div>
          <div className="mt-4 text-3xl leading-tight text-muted-foreground">
            The quick brown fox jumps over the lazy dog.
          </div>
          <div className="mt-4 text-2xl leading-tight">0123456789 !? &amp; @ #</div>
          <div className="mt-4 text-2xl leading-tight">中文预览：智能协作与文件审查</div>
        </div>
      </div>
    </div>
  )
}
