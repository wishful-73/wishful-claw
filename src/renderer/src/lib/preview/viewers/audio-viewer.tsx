/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import * as React from 'react'
import { Music, Volume2, VolumeX } from 'lucide-react'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import type { ViewerProps } from '../viewer-registry'
import { viewerText } from '../viewer-text'

const MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wave': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.weba': 'audio/webm',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff'
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function extension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
}

function mimeType(filePath: string): string {
  return MIME_TYPES[extension(filePath)] ?? 'audio/mpeg'
}

export function AudioViewer({
  filePath,
  sshConnectionId,
  fileVersion
}: ViewerProps): React.JSX.Element {
  const [src, setSrc] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

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
        const readFailed = viewerText('failReadAudio')
        setError(result.error ? `${readFailed}: ${result.error}` : readFailed)
        return
      }

      try {
        const bytes = Uint8Array.from(atob(result.data), (char) => char.charCodeAt(0))
        const blob = new Blob([bytes], { type: mimeType(filePath) })
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
  }, [filePath, fileVersion, sshConnectionId])

  if (error) {
    return (
      <div className="flex size-full items-center justify-center gap-2 text-sm text-destructive">
        <VolumeX className="size-5" />
        {error}
      </div>
    )
  }

  if (!src) {
    return (
      <div className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Music className="size-5 animate-pulse" />
        {viewerText('loadingAudio')}
      </div>
    )
  }

  return (
    <div className="flex size-full items-center justify-center bg-[radial-gradient(circle_at_top,hsl(var(--muted))_0,transparent_48%)] p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/70 bg-background/90 p-5 shadow-lg">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Volume2 className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{fileName(filePath)}</div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {extension(filePath).replace('.', '') || 'audio'}
            </div>
          </div>
        </div>
        <audio className="w-full" controls src={src}>
          Your browser does not support audio playback.
        </audio>
      </div>
    </div>
  )
}
