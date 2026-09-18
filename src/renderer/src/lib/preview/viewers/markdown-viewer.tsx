/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import { CodeEditor } from '@renderer/components/editor/CodeEditor'
import type { ViewerProps } from '../viewer-registry'
import {
  createMarkdownComponents,
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS
} from './markdown-components'

export function MarkdownViewer({
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
    <div className="markdown-doc size-full overflow-y-auto p-6">
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown
          remarkPlugins={MARKDOWN_REMARK_PLUGINS}
          rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
          components={createMarkdownComponents(filePath)}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
