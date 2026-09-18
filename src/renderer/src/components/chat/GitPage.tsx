import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { useGitPageHandlers } from './git-page-handlers'
import { ScmSidebar } from './GitPage/ScmSidebar'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@renderer/components/ui/hover-card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { cn } from '@renderer/lib/utils'
import { useGitStore } from '@renderer/stores/git-store'
import { useGitPanelSplit } from '@renderer/hooks/use-git-panel-split'
import { useChatStore } from '@renderer/stores/chat-store'


import { type ScmFileRow, scmFileKey, parseDiffBlocks } from './GitPage/utils'
import { GitDiffContent } from './GitPage/GitDiffContent'
import { GitDiffDialog } from './GitPage/git-diff-dialog'
import { diffTextToChunks } from './GitPage/diff-chunks'
import { CodeDiffViewer } from './CodeDiffViewer'

/** 宿主宽度低于此值时走紧凑形态（右侧面板常态 384px）。 */
const GIT_PAGE_COMPACT_MAX_WIDTH = 640

export interface GitPageProps {
  /**
   * 会话级工作目录，由右侧面板传入。优先于 `activeProject.workingFolder` ——
   * 全局会话没有 activeProject，但右侧面板仍要能对该会话的目录跑 git。
   */
  workingFolder?: string | null
}

export function GitPage({ workingFolder: workingFolderProp }: GitPageProps = {}): React.JSX.Element {
  const { t, i18n } = useTranslation('chat', { keyPrefix: 'git' })
  const activeProjectId = useChatStore((s) => s.activeProjectId)
  const projects = useChatStore((s) => s.projects)
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null
  const workingFolder = workingFolderProp ?? activeProject?.workingFolder ?? null
  const {
    repositories,
    selectedRepoPath,
    isScanning,
    scanError,
    repoDetailsByPath,
    scanRepositories,
    selectRepository,
    loadFileDiff,
    loadFileHistory,
    loadMoreHistory,
    checkoutBranch,
    stageFiles,
    unstageFiles,
    stageAll,
    unstageAll,
    discardFiles,
    startPolling,
    stopPolling,
    reset
  } = useGitStore()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [newBranchName, setNewBranchName] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [historyPick, setHistoryPick] = useState<{ path: string; hash: string } | null>(null)
  const [historyPatchLoading, setHistoryPatchLoading] = useState(false)
  const [aiCommitLoading, setAiCommitLoading] = useState(false)
  const [branchNameDialog, setBranchNameDialog] = useState<
    | { mode: 'createFrom'; startPoint: string }
    | { mode: 'rename'; oldName: string | null; displayName: string }
    | null
  >(null)
  const [branchNameInput, setBranchNameInput] = useState('')

  // 窄宿主（右侧面板）只有 SCM 单栏 + diff 弹窗；宽宿主保持三栏。
  const hostRef = React.useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  const [compactDiffOpen, setCompactDiffOpen] = useState(false)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setCompact(width > 0 && width < GIT_PAGE_COMPACT_MAX_WIDTH)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const {
    scmWidth,
    historyWidth,
    containerRef,
    onScmResizePointerDown,
    onHistoryResizePointerDown
  } = useGitPanelSplit()

  const selectedRepo = repositories.find((repo) => repo.fullPath === selectedRepoPath) ?? null
  const details = selectedRepoPath ? repoDetailsByPath[selectedRepoPath] : null
  const status = details?.status
  const busy = (details?.loading ?? false) || isScanning || committing

  const conflictRows = useMemo<ScmFileRow[]>(
    () =>
      (status?.conflicted ?? []).map((file) => ({
        path: file.path,
        section: 'conflicted' as const,
        file
      })),
    [status?.conflicted]
  )
  const stagedRows = useMemo<ScmFileRow[]>(
    () =>
      (status?.staged ?? []).map((file) => ({ path: file.path, section: 'staged' as const, file })),
    [status?.staged]
  )
  const unstagedRows = useMemo<ScmFileRow[]>(
    () => [
      ...(status?.unstaged ?? []).map((file) => ({
        path: file.path,
        section: 'unstaged' as const,
        file
      })),
      ...(status?.untracked ?? []).map((file) => ({
        path: file.path,
        section: 'untracked' as const,
        file
      }))
    ],
    [status?.unstaged, status?.untracked]
  )

  const allRows = useMemo(
    () => [...conflictRows, ...stagedRows, ...unstagedRows],
    [conflictRows, stagedRows, unstagedRows]
  )

  useEffect(() => {
    if (!workingFolder) {
      reset()
      return
    }
    void scanRepositories()
    startPolling()
    return () => stopPolling()
  }, [
    workingFolder,
    activeProject?.sshConnectionId,
    reset,
    scanRepositories,
    startPolling,
    stopPolling
  ])

  const activeKey = useMemo(() => {
    if (!selectedRepoPath) return null
    if (selectedKey && allRows.some((row) => scmFileKey(row) === selectedKey)) {
      return selectedKey
    }
    const first = allRows[0]
    return first ? scmFileKey(first) : null
  }, [allRows, selectedKey, selectedRepoPath])

  const selectedRow = useMemo(() => {
    if (!activeKey) return null
    return allRows.find((row) => scmFileKey(row) === activeKey) ?? null
  }, [allRows, activeKey])

  useEffect(() => {
    if (!selectedRepoPath || !selectedRow) return
    if (selectedRow.section === 'untracked') return
    void loadFileDiff(selectedRepoPath, selectedRow.path, selectedRow.section === 'staged')
  }, [loadFileDiff, selectedRepoPath, selectedRow])

  const fileHistory = useMemo(
    () => (selectedRow ? (details?.fileHistoryByPath[selectedRow.path] ?? []) : []),
    [details?.fileHistoryByPath, selectedRow]
  )

  const workingTreeDiff =
    selectedRow && details
      ? (details.diffByKey[
          `${selectedRow.section === 'staged' ? 'staged' : 'unstaged'}:${selectedRow.path}`
        ] ?? '')
      : ''

  const viewingHistoryDiff = Boolean(
    selectedRow &&
    selectedRow.section !== 'untracked' &&
    historyPick &&
    historyPick.path === selectedRow.path &&
    selectedRepoPath
  )

  const historyDiffCommitHash = viewingHistoryDiff && historyPick ? historyPick.hash : null

  const historyDiffCacheKey =
    viewingHistoryDiff && historyDiffCommitHash && selectedRow
      ? `${historyDiffCommitHash}:${selectedRow.path}`
      : null

  const cachedHistoryDiff =
    historyDiffCacheKey && details ? details.historyFileDiffByKey[historyDiffCacheKey] : undefined

  const selectedDiffText: string | null = viewingHistoryDiff
    ? cachedHistoryDiff !== undefined
      ? cachedHistoryDiff
      : null
    : workingTreeDiff

  const showHistoryDiffSpinner =
    viewingHistoryDiff && cachedHistoryDiff === undefined && historyPatchLoading

  const diffBlocks = useMemo(() => {
    if (selectedDiffText === null) return []
    return parseDiffBlocks(selectedDiffText)
  }, [selectedDiffText])

  // 紧凑弹窗走变更面板那套渲染（带行号、可切 split/inline），宽态内联继续用简表。
  const diffChunks = useMemo(
    () => (selectedDiffText === null ? [] : diffTextToChunks(selectedDiffText)),
    [selectedDiffText]
  )

  const compactRows = useMemo(
    () => allRows.map((row) => ({ key: scmFileKey(row), path: row.path, badge: row.section })),
    [allRows]
  )

  const historyListForPanel = useMemo(
    () => (fileHistory.length > 0 ? fileHistory : (details?.history ?? [])),
    [fileHistory, details?.history]
  )

  const selectedHistoryEntry = useMemo(() => {
    if (!historyPick) return null
    return historyListForPanel.find((c) => c.hash === historyPick.hash) ?? null
  }, [historyPick, historyListForPanel])

  const selectedRepoLabel = selectedRepo
    ? selectedRepo.relativePath === '.'
      ? selectedRepo.name
      : selectedRepo.relativePath
    : null
  const totalChangeCount = conflictRows.length + stagedRows.length + unstagedRows.length

  // 全局会话没有 activeProject，标题回落到目录名。
  const projectLabel =
    activeProject?.name ??
    ((workingFolder ?? '').split(/[\\/]/).filter(Boolean).pop() || workingFolder || '')
  const titleRepoPath = selectedRepoLabel ?? workingFolder

  // 紧凑形态点文件 = 打开 diff 弹窗（宽态由内联区域直接呈现，不走这里）。
  const handleDiffSelect = (key: string | null): void => {
    setSelectedKey(key)
    if (key) setCompactDiffOpen(true)
  }

  const {
    handlePullRebase,
    handleSync,
    handleFetch,
    handlePush,
    handleCreateBranch,
    runMergeInto,
    runRebaseOnto,
    runDeleteLocal,
    runDeleteRemote,
    handleBranchDialogConfirm,
    handleHistoryCommitClick,
    handleCommit,
    handleAiCommitMessage,
    confirmDiscard
  } = useGitPageHandlers({
    selectedRepoPath,
    newBranchName,
    commitMessage,
    branchNameDialog,
    branchNameInput,
    selectedRow,
    stagedRows,
    details,
    setNewBranchName,
    setCommitMessage,
    setCommitting,
    setAiCommitLoading,
    setBranchNameDialog,
    setBranchNameInput,
    setHistoryPick,
    setHistoryPatchLoading,
    t,
    i18n
  })

  if (!workingFolder) {
    return (
      <div
        className={
          compact
            ? 'flex h-full items-center justify-center bg-background px-4'
            : 'flex flex-1 items-center justify-center bg-background px-6'
        }
      >
        <div className="max-w-md text-center">
          <div
            className={
              compact
                ? 'text-sm font-medium text-foreground'
                : 'text-[28px] font-semibold tracking-tight text-foreground'
            }
          >
            {t('noProject')}
          </div>
          <p
            className={
              compact
                ? 'mt-2 text-xs leading-5 text-muted-foreground'
                : 'mt-3 text-sm leading-6 text-muted-foreground'
            }
          >
            {t('pickRepo', {
              defaultValue: 'Select a project to inspect repositories and changes.'
            })}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={hostRef}
      className={
        compact
          ? 'flex h-full min-h-0 flex-col overflow-hidden bg-background'
          : 'relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background px-6 pb-6 pt-4'
      }
    >
      {compact ? null : (
        <div className="mx-auto w-full max-w-[1480px] pb-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
                {t('title')}
              </p>
              <h1 className="mt-1 truncate text-sm font-medium text-foreground/92">
                {projectLabel}
              </h1>
              <p className="mt-1 max-w-[880px] truncate text-xs text-muted-foreground/72">
                {titleRepoPath}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground/72">
              <span>{repositories.length} repos</span>
              <span>{totalChangeCount} changes</span>
              {conflictRows.length > 0 ? <span>{conflictRows.length} conflicts</span> : null}
            </div>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className={
          compact
            ? 'flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background'
            : 'mx-auto flex min-h-0 min-w-0 w-full max-w-[1480px] flex-1 overflow-hidden rounded-md border border-border/60 bg-background'
        }
      >
        {/* SCM 侧栏 — 对齐 VS Code「源代码管理」结构 */}
        <ScmSidebar
          scmWidth={compact ? '100%' : scmWidth}
          compact={compact}
          t={t}
          isScanning={isScanning}
          scanError={scanError}
          repositories={repositories}
          selectedRepoPath={selectedRepoPath}
          selectedRepo={selectedRepo}
          busy={busy}
          details={details}
          status={status ?? null}
          visibleBranches={details?.branches ?? []}
          conflictRows={conflictRows}
          stagedRows={stagedRows}
          unstagedRows={unstagedRows}
          allRows={allRows}
          activeKey={activeKey}
          selectedKey={selectedKey}
          setSelectedKey={compact ? handleDiffSelect : setSelectedKey}
          setHistoryPick={setHistoryPick}
          selectRepository={selectRepository}
          scanRepositories={scanRepositories}
          checkoutBranch={checkoutBranch}
          newBranchName={newBranchName}
          setNewBranchName={setNewBranchName}
          handleCreateBranch={handleCreateBranch}
          handleFetch={handleFetch}
          handlePullRebase={handlePullRebase}
          handleSync={handleSync}
          handlePush={handlePush}
          runMergeInto={runMergeInto}
          runRebaseOnto={runRebaseOnto}
          runDeleteLocal={runDeleteLocal}
          runDeleteRemote={runDeleteRemote}
          setBranchNameDialog={setBranchNameDialog}
          setBranchNameInput={setBranchNameInput}
          stageFiles={stageFiles as any}
          unstageFiles={unstageFiles as any}
          stageAll={stageAll as any}
          unstageAll={unstageAll as any}
          discardFiles={discardFiles as any}
          confirmDiscard={confirmDiscard}
          isLoadingOlderMessages={false}
          upstreamHint={status?.upstream
            ? t('upstreamHint', { upstream: status.upstream, ahead: status.ahead, behind: status.behind })
            : null}
          commitMessage={commitMessage}
          setCommitMessage={setCommitMessage}
          committing={committing}
          aiCommitLoading={aiCommitLoading}
          handleCommit={handleCommit}
          handleAiCommitMessage={handleAiCommitMessage}
          onScmResizePointerDown={onScmResizePointerDown}
        />
        {compact ? null : (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          {!selectedRepo || !selectedRow ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              {selectedRepo ? t('pickFile') : t('noRepo')}
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-row">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-border">
                <div className="flex h-9 min-h-9 shrink-0 items-center gap-2 border-b border-border px-2">
                  {viewingHistoryDiff ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-[11px]"
                      onClick={() => setHistoryPick(null)}
                    >
                      {t('backToWorkingDiff')}
                    </Button>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {selectedRow.path}
                  </span>
                  {viewingHistoryDiff && selectedHistoryEntry ? (
                    <span
                      className="max-w-[min(280px,45%)] shrink-0 truncate text-[10px] text-muted-foreground"
                      title={selectedHistoryEntry.subject}
                    >
                      {selectedHistoryEntry.shortHash} · {selectedHistoryEntry.subject}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                      {selectedRow.section}
                    </span>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  {selectedRow.section === 'untracked' ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">
                      {t('untrackedNoDiff')}
                    </div>
                  ) : showHistoryDiffSpinner ? (
                    <div className="flex flex-1 items-center justify-center py-16 text-muted-foreground">
                      <Loader2 className="size-6 animate-spin" />
                    </div>
                  ) : diffBlocks.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">{t('noDiff')}</div>
                  ) : (
                    <GitDiffContent blocks={diffBlocks} />
                  )}
                </div>
              </div>

              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t('resizeHistoryPanel')}
                onPointerDown={onHistoryResizePointerDown}
                className="w-[5px] shrink-0 cursor-col-resize border-x border-transparent bg-border/50 hover:bg-primary/35"
              />

              <div style={{ width: historyWidth }} className="flex min-h-0 shrink-0 flex-col">
                <div className="flex h-9 shrink-0 items-center border-b border-border px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('fileHistory')}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  <div className="space-y-1">
                    {historyListForPanel.map((c) => {
                      const canOpenHistory =
                        Boolean(selectedRow) &&
                        selectedRow.section !== 'untracked' &&
                        Boolean(selectedRepoPath)
                      const isHistorySelected =
                        Boolean(selectedRow) &&
                        historyPick?.hash === c.hash &&
                        historyPick?.path === selectedRow.path
                      return (
                        // disabled 的 button 在 Chromium 里不派发鼠标事件，原生 title 也就
                        // 不显示。这里让 disabled 时鼠标穿透到外层 span，由 HoverCard 接手。
                        <HoverCard key={c.hash} openDelay={400} closeDelay={80}>
                          <HoverCardTrigger asChild>
                            <span className="block">
                              <button
                                type="button"
                                disabled={!canOpenHistory || busy}
                                onClick={() => void handleHistoryCommitClick(c)}
                                className={cn(
                                  'w-full rounded-sm border px-2 py-1.5 text-left text-xs transition-colors disabled:pointer-events-none',
                                  canOpenHistory && !busy
                                    ? 'cursor-pointer border-border/60 bg-muted/10 hover:bg-muted/40'
                                    : 'cursor-not-allowed border-border/40 opacity-60',
                                  isHistorySelected &&
                                    'border-primary/50 bg-primary/10 ring-1 ring-primary/20'
                                )}
                              >
                                <div className="line-clamp-2 font-medium leading-snug">
                                  {c.subject}
                                </div>
                                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                  {c.shortHash} · {c.author}
                                </div>
                              </button>
                            </span>
                          </HoverCardTrigger>
                          <HoverCardContent
                            side="left"
                            align="start"
                            className="w-auto max-w-md break-words p-2 text-xs leading-relaxed"
                          >
                            {c.subject}
                          </HoverCardContent>
                        </HoverCard>
                      )
                    })}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 h-7 w-full text-[11px]"
                    disabled={busy}
                    onClick={() =>
                      selectedRow
                        ? void loadFileHistory(selectedRepo.fullPath, selectedRow.path, true)
                        : void loadMoreHistory(selectedRepo.fullPath)
                    }
                  >
                    {t('loadMoreHistory')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
        )}

        {/* 紧凑形态没有并排的空间给 diff，改成弹窗看（与变更面板同款交互）。 */}
        {compact ? (
          <GitDiffDialog
            open={compactDiffOpen}
            onOpenChange={(open) => {
              if (!open) setCompactDiffOpen(false)
            }}
            title={selectedRow?.path ?? ''}
            meta={
              selectedRow ? (
                <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                  {selectedRow.section}
                </span>
              ) : null
            }
            rows={compactRows}
            activeKey={activeKey}
            onSelect={setSelectedKey}
            previewPath={
              selectedRepo && selectedRow ? `${selectedRepo.fullPath}/${selectedRow.path}` : null
            }
          >
            {!selectedRow ? null : selectedRow.section === 'untracked' ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">{t('untrackedNoDiff')}</div>
            ) : showHistoryDiffSpinner ? (
              <div className="flex flex-1 items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="size-6 animate-spin" />
              </div>
            ) : diffChunks.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">{t('noDiff')}</div>
            ) : (
              <CodeDiffViewer chunks={diffChunks} defaultMode="inline" showModeToggle fillHeight />
            )}
          </GitDiffDialog>
        ) : null}
      </div>

      <Dialog
        open={branchNameDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setBranchNameDialog(null)
            setBranchNameInput('')
          }
        }}
      >
        <DialogContent className="gap-3 sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle className="text-base">
              {branchNameDialog?.mode === 'createFrom'
                ? t('branchCreateFromTitle', { ref: branchNameDialog.startPoint })
                : branchNameDialog
                  ? t('branchRenameTitle', { name: branchNameDialog.displayName })
                  : ''}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {branchNameDialog?.mode === 'createFrom'
                ? t('branchCreateFromDesc')
                : t('branchRenameDesc')}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={branchNameInput}
            onChange={(e) => setBranchNameInput(e.target.value)}
            placeholder={t('newBranchPlaceholder')}
            className="h-9 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleBranchDialogConfirm()
              }
            }}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setBranchNameDialog(null)
                setBranchNameInput('')
              }}
            >
              {t('branchDialogCancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!branchNameInput.trim() || busy}
              onClick={() => void handleBranchDialogConfirm()}
            >
              {t('branchDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
