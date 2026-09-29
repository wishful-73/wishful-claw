/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { CodeEditor } from '@renderer/components/editor/CodeEditor'
import type { ViewerProps } from '../viewer-registry'
import { viewerText } from '../viewer-text'

export function SvgViewer({
  filePath,
  content,
  viewMode,
  onContentChange,
  onSave,
  initialLine,
  initialColumn,
  initialPositionKey
}: ViewerProps): React.JSX.Element {
  if (viewMode === 'code') {
    return (
      <CodeEditor
        filePath={filePath}
        content={content}
        onChange={onContentChange}
        onSave={onSave}
        initialLine={initialLine}
        initialColumn={initialColumn}
        initialPositionKey={initialPositionKey}
      />
    )
  }

  return (
    <div className="flex size-full flex-col bg-background">
      <div className="flex-1 overflow-auto bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-6">
        <div className="flex min-h-full items-center justify-center">
          <iframe
            className="h-full min-h-[360px] w-full rounded-lg border border-border/60 bg-white shadow-sm"
            sandbox=""
            srcDoc={content}
            title={viewerText('titleSvg')}
          />
        </div>
      </div>
    </div>
  )
}
