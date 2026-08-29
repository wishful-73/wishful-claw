/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { Archive, ExternalLink, ShieldAlert } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import type { ViewerProps } from '../viewer-registry'

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

function extension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
}

export function BinaryFileViewer({ filePath, sshConnectionId }: ViewerProps): React.JSX.Element {
  const openInSystem = async (): Promise<void> => {
    if (sshConnectionId) return
    await ipcClient.invoke(IPC.SHELL_OPEN_PATH, { path: filePath })
  }

  return (
    <div className="flex size-full items-center justify-center p-6">
      <div className="max-w-sm rounded-xl border border-border/70 bg-muted/20 p-5 text-center shadow-sm">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-background text-muted-foreground">
          <Archive className="size-5" />
        </div>
        <h3 className="truncate text-sm font-medium text-foreground">{fileName(filePath)}</h3>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {extension(filePath).toUpperCase() || 'Binary'} files are recognized, but they are not
          safe to render as text inside the inspector.
        </p>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/60 bg-background px-3 py-2 text-left text-[11px] leading-4 text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>Use the system app when you need to inspect or extract this file.</span>
        </div>
        {!sshConnectionId ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-4 h-8 gap-1.5 text-xs"
            onClick={() => void openInSystem()}
          >
            <ExternalLink className="size-3.5" />
            Open in system app
          </Button>
        ) : null}
      </div>
    </div>
  )
}
