import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '@renderer/stores/chat-store'
import { useAppPluginStore } from '@renderer/stores/app-plugin-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useUIStore, type PreviewPanelTab } from '@renderer/stores/ui-store'
import { useFileWatcher } from '@renderer/hooks/use-file-watcher'
import { isBrowserPreviewFilePath, localPathToFileUrl } from '@renderer/lib/preview/local-target'
import { openWebUrl } from '@renderer/lib/preview/web-url'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { BROWSER_PLUGIN_ID } from '@renderer/lib/app-plugin/types'
import { createSelectFileToken } from '@renderer/lib/select-file-tags'
import { composerEvents } from '@renderer/lib/composer-events'
import {
  breadcrumbParts,
  isExternalUrl,
  shouldReadPreviewText,
  tabTitle
} from './preview-utils'
import { usePreviewSave } from './use-preview-save'
import { PreviewToolbar } from './preview-toolbar'
import { PreviewSaveDialog } from './preview-save-dialog'
import { PreviewContent } from './preview/content'
import { PreviewEmptyState, PreviewTabStrip } from './preview/tab-strip'

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
    error: fileReadError,
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
    // Only show the "copied" feedback after the write actually succeeds.
    navigator.clipboard
      .writeText(activeTab.markdownContent)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch((err) => {
        console.error('[PreviewPanel] Failed to copy markdown:', err)
      })
  }

  const handleOpenLocalFiles = async (): Promise<void> => {
    let result: { canceled?: boolean; path?: string; paths?: string[] }
    try {
      result = (await ipcClient.invoke(IPC.FS_SELECT_FILE, {
        multiSelections: true
      })) as { canceled?: boolean; path?: string; paths?: string[] }
    } catch (err) {
      console.error('[PreviewPanel] Failed to open file dialog:', err)
      return
    }
    if (result.canceled) return

    const selectedPaths = result.paths?.length ? result.paths : result.path ? [result.path] : []
    for (const selectedPath of selectedPaths) {
      // PDF / HTML 交给内置浏览器（S-148）；其余仍按文件 tab 打开 ——
      // 这里是多选入口，图片那套「全屏预览」不适用。
      if (isBrowserPreviewFilePath(selectedPath)) {
        openWebUrl(localPathToFileUrl(selectedPath))
        continue
      }
      useUIStore.getState().openFilePreview(selectedPath)
    }
  }

  if (!activeTab) {
    return (
      <PreviewEmptyState
        showTabStrip={showTabStrip}
        onOpenLocalFiles={handleOpenLocalFiles}
        onClosePanel={() => setRightPanelOpen(false)}
      />
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
        <PreviewTabStrip
          tabs={tabs}
          activeTabId={activeTab.id}
          browserPluginEnabled={browserPluginEnabled}
          onSelectTab={setActivePreviewTab}
          onRequestClose={requestCloseTab}
          onOpenLocalFiles={handleOpenLocalFiles}
          onOpenBrowser={() => setRightPanelTab('browser')}
          onOpenArtifacts={() => setRightPanelTab('artifacts')}
          onClosePanel={() => setRightPanelOpen(false)}
        />
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
      {fileReadError && !fileLoading ? (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400">
          {fileReadError}
        </div>
      ) : null}

      <PreviewContent
        activeTab={activeTab}
        isDiff={isDiff}
        isMarkdown={isMarkdown}
        fileLoading={fileLoading}
        content={content}
        diffModifiedValue={diffModifiedValue}
        diffViewMode={diffViewMode}
        fileVersion={fileVersion}
        onContentChange={handleContentChange}
        onSave={handleSave}
      />

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
