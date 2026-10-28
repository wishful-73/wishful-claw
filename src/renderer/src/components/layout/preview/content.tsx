/**
 * 预览面板的内容区：diff / markdown / 加载中 / 注册表 viewer / 无可用视图 五个分支。
 *
 * S-250 从 `PreviewPanel.tsx` 搬出，JSX 与类名逐字平移，分支顺序不变。
 * 状态仍留在容器层，这里只收 props。
 */

import { Suspense, lazy } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import type { PreviewPanelTab } from '@renderer/stores/ui-store'
import type { FileDiffViewMode } from '@renderer/stores/settings-store-types'
import { viewerRegistry } from '@renderer/lib/preview/viewer-registry'
import {
  createMarkdownComponents,
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS
} from '@renderer/lib/preview/viewers/markdown-components'

const MonacoDiffEditor = lazy(() =>
  import('@renderer/components/editor/MonacoDiffEditor').then((m) => ({
    default: m.MonacoDiffEditor
  }))
)

export function PreviewContent({
  activeTab,
  isDiff,
  isMarkdown,
  fileLoading,
  content,
  diffModifiedValue,
  diffViewMode,
  fileVersion,
  onContentChange,
  onSave
}: {
  activeTab: PreviewPanelTab
  isDiff: boolean
  isMarkdown: boolean
  fileLoading: boolean
  content: string
  diffModifiedValue: string
  diffViewMode: FileDiffViewMode
  fileVersion: number
  onContentChange: (newContent: string) => void
  onSave: () => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation('layout')
  const viewerDef = viewerRegistry.getByType(activeTab.viewerType)
  const ViewerComponent = viewerDef?.component

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {isDiff ? (
        <Suspense
          fallback={
            <div className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="size-4 animate-spin" />
              Loading preview...
            </div>
          }
        >
          <MonacoDiffEditor
            filePath={activeTab.filePath}
            original={activeTab.diffOriginal ?? ''}
            modified={diffModifiedValue}
            language={activeTab.diffLanguage}
            modifiedEditable={Boolean(activeTab.diffModifiedEditable)}
            renderSideBySide={diffViewMode !== 'inline'}
            isBinary={Boolean(activeTab.diffIsBinary)}
            onModifiedChange={onContentChange}
            onSave={onSave}
          />
        </Suspense>
      ) : isMarkdown ? (
        <div className="size-full overflow-y-auto p-6">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown
              remarkPlugins={MARKDOWN_REMARK_PLUGINS}
              rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
              components={createMarkdownComponents()}
            >
              {activeTab.markdownContent || ''}
            </ReactMarkdown>
          </div>
        </div>
      ) : fileLoading && !activeTab.modified ? (
        <div className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" />
          Loading preview...
        </div>
      ) : ViewerComponent ? (
        <Suspense
          fallback={
            <div className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="size-4 animate-spin" />
              Loading preview...
            </div>
          }
        >
          <ViewerComponent
            filePath={activeTab.filePath}
            content={content}
            viewMode={activeTab.viewMode}
            onContentChange={onContentChange}
            onSave={onSave}
            sshConnectionId={activeTab.sshConnectionId}
            initialLine={activeTab.targetLine}
            initialColumn={activeTab.targetColumn}
            initialPositionKey={activeTab.targetPositionKey}
            fileVersion={fileVersion}
          />
        </Suspense>
      ) : (
        <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
          {t('preview.noViewer')}
        </div>
      )}
    </div>
  )
}
