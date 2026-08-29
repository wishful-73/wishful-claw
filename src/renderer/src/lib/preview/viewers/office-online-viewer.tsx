/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { ExternalLink, FileText, ShieldAlert } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import type { ViewerProps } from '../viewer-registry'

function isPublicHttpUrl(value: string): boolean {
  return /^https:\/\/\S+/i.test(value)
}

function microsoftOfficeViewerUrl(sourceUrl: string): string {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(sourceUrl)}`
}

export function OfficeOnlineViewer({ filePath, sshConnectionId }: ViewerProps): React.JSX.Element {
  const canUseOnlineViewer = isPublicHttpUrl(filePath)

  const openInSystem = async (): Promise<void> => {
    if (sshConnectionId) return
    await ipcClient.invoke(IPC.SHELL_OPEN_PATH, { path: filePath })
  }

  if (canUseOnlineViewer) {
    return (
      <iframe
        className="size-full border-0 bg-white"
        src={microsoftOfficeViewerUrl(filePath)}
        title="Microsoft Office Preview"
      />
    )
  }

  return (
    <div className="flex size-full items-center justify-center p-6">
      <div className="max-w-sm rounded-xl border border-border/70 bg-muted/20 p-5 text-center shadow-sm">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-background text-muted-foreground">
          <FileText className="size-5" />
        </div>
        <h3 className="text-sm font-medium text-foreground">Document preview needs a public URL</h3>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Microsoft Office online preview can only load Office-like documents from a reachable HTTPS
          URL. Local and SSH files are not sent online automatically.
        </p>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-[11px] leading-4 text-amber-700 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>Use local preview or open the file in the system app for private documents.</span>
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
