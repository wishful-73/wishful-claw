/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import * as React from 'react'
import { Film, VideoOff } from 'lucide-react'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { videoMediaTypeFor } from '@renderer/lib/media-file-types'
import type { ViewerProps } from '../viewer-registry'
import { viewerText } from '../viewer-text'

export function VideoViewer({
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
        const readFailed = viewerText('failReadVideo')
        setError(result.error ? `${readFailed}: ${result.error}` : readFailed)
        return
      }

      try {
        const bytes = Uint8Array.from(atob(result.data), (char) => char.charCodeAt(0))
        const blob = new Blob([bytes], { type: videoMediaTypeFor(filePath) })
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
        <VideoOff className="size-5" />
        {error}
      </div>
    )
  }

  if (!src) {
    return (
      <div className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Film className="size-5 animate-pulse" />
        {viewerText('loadingVideo')}
      </div>
    )
  }

  return (
    <div className="flex size-full items-center justify-center bg-black">
      <video className="max-h-full max-w-full" controls src={src}>
        Your browser does not support video playback.
      </video>
    </div>
  )
}
