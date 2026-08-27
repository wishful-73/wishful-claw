import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FileOutput,
  FolderOpen,
  Globe,
  PanelRightClose,
  Plus,
  RefreshCw,
  X
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { useChatStore } from '@renderer/stores/chat-store'
import { useAppPluginStore } from '@renderer/stores/app-plugin-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useUIStore, type PreviewPanelTab } from '@renderer/stores/ui-store'
import { useFileWatcher } from '@renderer/hooks/use-file-watcher'
import { viewerRegistry } from '@renderer/lib/preview/viewer-registry'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import {
  createMarkdownComponents,
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS
} from '@renderer/lib/preview/viewers/markdown-components'
import { BROWSER_PLUGIN_ID } from '@renderer/lib/app-plugin/types'
import { cn } from '@renderer/lib/utils'

const MonacoDiffEditor = lazy(() =>
  import('@renderer/components/editor/MonacoDiffEditor').then((m) => ({
    default: m.MonacoDiffEditor
  }))
)

import { createSelectFileToken } from '@renderer/lib/select-file-tags'
import { composerEvents } from '@renderer/lib/composer-events'
import { breadcrumbParts, isExternalUrl, shouldReadPreviewText, tabTitle, tabPathTitle, TabIcon } from './preview-utils'
import { usePreviewSave } from './use-preview-save'
import { PreviewToolbar } from './preview-toolbar'
import { PreviewSaveDialog } from './preview-save-dialog'
export function PreviewPanel({
  embedded = false,
  showTabStrip = !embedded
}: {
  embedded?: boolean
  showTabStrip?: boolean
}): React.JSX.Element {
  const { t } = useTranslation('layout')
  const tabs = useUIStore((s) => s.previewPanelTabs)
  const activeTabId = useUIStore((s) => s.activePreviewPanelTabId)
  const activeTab = tabs.find((tab: any) => tab.id === activeTabId) ?? null
  const closePreviewTab = useUIStore((s) => s.closePreviewTab)
  const setActivePreviewTab = useUIStore((s) => s.setActivePreviewTab)
  const updatePreviewTab = useUIStore((s) => s.updatePreviewTab)
  const setViewMode = useUIStore((s) => s.setPreviewViewMode)
  const setRightPanelOpen = useUIStore((s) => s.setRightPanelOpen)
  const setRightPanelTab = useUIStore((s) => s.setRightPanelTab)
  const activeProjectId = useChatStore((state) => state.activeProjectId)
  const browserPluginEnabled = useAppPluginStore((state) =>
    Boolean(state.getPlugin(BROWSER_PLUGIN_ID, activeProjectId)?.enabled)
  )
  const workingFolder = useChatStore((state) => {
    const activeSession = state.sessions.find((session) => session.id === state.activeSessionId)
    const activeProject = activeSession?.projectId
      ? state.projects.find((project) => project.id === activeSession.projectId)
      : null
    return activeSession?.workingFolder ?? activeProject?.workingFolder ?? null
  })

  const watchedFilePath =
    activeTab?.source === 'file' && !isExternalUrl(activeTab.filePath) ? activeTab.filePath : null
  const shouldReadActiveFileText = shouldReadPreviewText(activeTab)
  const {
    content: fileContent,
    setContent,
    loading: fileLoading,
    reload,
    version: fileVersion
  } = useFileWatcher(watchedFilePath, activeTab?.sshConnectionId, {
    readContent: shouldReadActiveFileText
  })
  const content =
    activeTab?.modified && activeTab.draftContent !== undefined
      ? activeTab.draftContent
      : fileContent
  const isMarkdown = activeTab?.source === 'markdown'
  const isDiff = activeTab?.source === 'diff'
  const diffViewMode = useSettingsStore((s) => s.fileDiffViewMode)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const diffModifiedValue =
    activeTab && isDiff ? (activeTab.draftContent ?? activeTab.diffModified ?? '') : ''
  const viewerDef = activeTab ? viewerRegistry.getByType(activeTab.viewerType) : undefined
  const ViewerComponent = viewerDef?.component
  const [copied, setCopied] = useState(false)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null)
  const pendingCloseTab = tabs.find((tab: any) => tab.id === pendingCloseTabId) ?? null

  const fileDisplayName = activeTab
    ? tabTitle(activeTab)
    : t('rightPanel.preview', { defaultValue: 'Preview' })
  const pendingFileDisplayName = pendingCloseTab ? tabTitle(pendingCloseTab) : fileDisplayName
  const canOpenInSystem =
    activeTab?.source === 'file' && !!activeTab.filePath && !activeTab.sshConnectionId
  const canToggleViewMode =
    activeTab?.source === 'file' &&
    (activeTab.viewerType === 'html' ||
      activeTab.viewerType === 'svg' ||
      activeTab.viewerType === 'markdown')
  const activeFilePath = activeTab?.source === 'file' ? activeTab.filePath : ''
  const breadcrumbs = activeFilePath ? breadcrumbParts(activeFilePath, workingFolder) : []

  const MIN_WIDTH = 320
  const MAX_WIDTH = 960
  const DEFAULT_WIDTH = 480
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH)
  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(DEFAULT_WIDTH)
  const [isDragging, setIsDragging] = useState(false)

  const onResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      draggingRef.current = true
      startXRef.current = event.clientX
      startWidthRef.current = panelWidth
      setIsDragging(true)
    },
    [panelWidth]
  )

  useEffect(() => {
    if (!isDragging) return

    const onMouseMove = (event: MouseEvent): void => {
      if (!draggingRef.current) return
      const delta = startXRef.current - event.clientX
      setPanelWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta)))
    }
    const onMouseUp = (): void => {
      draggingRef.current = false
      setIsDragging(false)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDragging])

  const handleContentChange = (newContent: string): void => {
    if (!activeTab) return
    if (activeTab.source === 'file') setContent(newContent)
    updatePreviewTab(activeTab.id, {
      draftContent: newContent,
      modified: true
    })
  }

  const { saveTab, handleSave } = usePreviewSave({ activeTab, content, setContent })

  const handleSaveDialogOpenChange = (open: boolean): void => {
    setShowSaveDialog(open)
    if (!open) setPendingCloseTabId(null)
  }

  const handleSaveDialogConfirm = async (): Promise<void> => {
    const tabToClose = tabs.find((tab: any) => tab.id === pendingCloseTabId)
    if (!tabToClose) {
      setShowSaveDialog(false)
      setPendingCloseTabId(null)
      return
    }

    const saved = await saveTab(tabToClose)
    if (!saved) return

    setShowSaveDialog(false)
    closePreviewTab(tabToClose.id)
    setPendingCloseTabId(null)
  }

  const handleSaveDialogDiscard = (): void => {
    if (pendingCloseTabId) {
      updatePreviewTab(pendingCloseTabId, {
        draftContent: undefined,
        modified: false
      })
      closePreviewTab(pendingCloseTabId)
    }
    setPendingCloseTabId(null)
    setShowSaveDialog(false)
  }

  const handleReload = (): void => {
    try {
      if (activeTab?.modified) {
        updatePreviewTab(activeTab.id, {
          draftContent: undefined,
          modified: false
        })
      }
      void reload()
    } catch (err) {
      console.error('[PreviewPanel] Reload failed:', err)
    }
  }

  const handleOpenInSystem = async (): Promise<void> => {
    if (!activeTab?.filePath || activeTab.sshConnectionId) return
    try {
      await ipcClient.invoke(IPC.SHELL_OPEN_PATH, { path: activeTab.filePath })
    } catch (err) {
      console.error('[PreviewPanel] Open in system app failed:', err)
    }
  }

  const handleSendPathToChat = (): void => {
    if (!activeTab?.filePath) return
    const filePath = activeTab.filePath
    const text = activeTab.sshConnectionId
      ? `\`${filePath}\``
      : (createSelectFileToken(filePath) || filePath)
    composerEvents.emit({ text })
  }

  const requestCloseTab = (tab: PreviewPanelTab): void => {
    if (tab.modified) {
      setActivePreviewTab(tab.id)
      setPendingCloseTabId(tab.id)
      setShowSaveDialog(true)
      return
    }
    closePreviewTab(tab.id)
  }

  const handleCopyMarkdown = (): void => {
    if (!activeTab?.markdownContent) return
    navigator.clipboard.writeText(activeTab.markdownContent)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const handleOpenLocalFiles = async (): Promise<void> => {
    const result = (await ipcClient.invoke(IPC.FS_SELECT_FILE, {
      multiSelections: true
    })) as { canceled?: boolean; path?: string; paths?: string[] }
    if (result.canceled) return

    const selectedPaths = result.paths?.length ? result.paths : result.path ? [result.path] : []
    for (const selectedPath of selectedPaths) {
      useUIStore.getState().openFilePreview(selectedPath)
    }
  }

  if (!activeTab) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        {showTabStrip ? (
          <div className="flex h-10 shrink-0 items-center justify-end border-b border-border/50 px-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <Plus className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={() => void handleOpenLocalFiles()}>
                  <FolderOpen className="size-4" />
                  {t('preview.openFile', { defaultValue: 'Open file' })}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              onClick={() => setRightPanelOpen(false)}
              title={t('rightPanelAction.closePanel', { defaultValue: 'Close panel' })}
            >
              <PanelRightClose className="size-4" />
            </Button>
          </div>
        ) : null}
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {t('rightPanel.previewEmpty', { defaultValue: 'No preview content' })}
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative flex h-full min-h-0 min-w-0 flex-col bg-background"
      style={embedded ? undefined : { width: panelWidth }}
    >
      {!embedded && (
        <div
          className="absolute bottom-0 left-0 top-0 z-20 w-1 cursor-col-resize transition-colors hover:bg-primary/20 active:bg-primary/30"
          onMouseDown={onResizeStart}
        />
      )}
      {isDragging && !embedded && <div className="absolute inset-0 z-10" />}

      {showTabStrip ? (
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/50 bg-background px-1">
          <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto pt-1">
            {tabs.map((tab: any) => {
              const active = tab.id === activeTab.id
              return (
                <div
                  key={tab.id}
                  className={cn(
                    'group flex h-8 min-w-0 max-w-48 shrink-0 items-center gap-1.5 rounded-t-md border border-transparent px-2 text-left text-xs transition-colors',
                    active
                      ? 'border-border/70 border-b-background bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  )}
                  title={tabPathTitle(tab)}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    onClick={() => setActivePreviewTab(tab.id)}
                  >
                    <TabIcon tab={tab} />
                    <span className="min-w-0 truncate">{tabTitle(tab)}</span>
                    {tab.modified && (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-amber-500"
                        title={t('preview.modified')}
                      />
                    )}
                  </button>
                  <button
                    type="button"
                    className="ml-0.5 rounded p-0.5 opacity-60 transition-opacity hover:bg-muted hover:opacity-100"
                    title={t('action.close', { ns: 'common' })}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      requestCloseTab(tab)
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )
            })}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7 shrink-0">
                <Plus className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => void handleOpenLocalFiles()}>
                <FolderOpen className="size-4" />
                {t('preview.openFile', { defaultValue: 'Open file' })}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {browserPluginEnabled && (
                <DropdownMenuItem onSelect={() => setRightPanelTab('browser')}>
                  <Globe className="size-4" />
                  {t('rightPanel.browser')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setRightPanelTab('artifacts')}>
                <FileOutput className="size-4" />
                {t('rightPanel.artifacts')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setRightPanelOpen(false)}
            title={t('rightPanelAction.closePanel', { defaultValue: 'Close panel' })}
          >
            <PanelRightClose className="size-4" />
          </Button>
        </div>
      ) : null}

      <PreviewToolbar
        activeTab={activeTab}
        fileDisplayName={fileDisplayName}
        breadcrumbs={breadcrumbs}
        isMarkdown={isMarkdown}
        isDiff={isDiff}
        canToggleViewMode={canToggleViewMode}
        canOpenInSystem={canOpenInSystem}
        diffViewMode={diffViewMode}
        copied={copied}
        onSetViewMode={setViewMode}
        onCopyMarkdown={handleCopyMarkdown}
        onSetDiffViewMode={(mode) => updateSettings({ fileDiffViewMode: mode })}
        onSave={() => void handleSave()}
        onReload={handleReload}
        onOpenInSystem={() => void handleOpenInSystem()}
        onSendPathToChat={handleSendPathToChat}
      />
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
              onModifiedChange={handleContentChange}
              onSave={handleSave}
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
              onContentChange={handleContentChange}
              onSave={handleSave}
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

      <PreviewSaveDialog
        open={showSaveDialog}
        pendingFileDisplayName={pendingFileDisplayName}
        onOpenChange={handleSaveDialogOpenChange}
        onConfirm={() => void handleSaveDialogConfirm()}
        onDiscard={handleSaveDialogDiscard}
      />
    </div>
  )
}
