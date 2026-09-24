/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { useRef, useEffect } from 'react'
import { CodeEditor } from '@renderer/components/editor/CodeEditor'
import type { ViewerProps } from '../viewer-registry'
import { viewerText } from '../viewer-text'

export function HtmlViewer({
  filePath,
  content,
  viewMode,
  onContentChange,
  onSave,
  initialLine,
  initialColumn,
  initialPositionKey
}: ViewerProps): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (viewMode === 'preview' && iframeRef.current) {
      iframeRef.current.srcdoc = content
    }
  }, [content, viewMode])

  if (viewMode === 'preview') {
    return (
      <iframe
        ref={iframeRef}
        className="size-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin"
        title={viewerText('titleHtml')}
      />
    )
  }

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
