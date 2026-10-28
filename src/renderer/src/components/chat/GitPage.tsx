// 500 行豁免（2026-10-28 实测 506 行）：12 个 state 与 13 个派生 memo 全部围绕同一份 git 状态，状态区 / 提交表单 / 历史三块子视图读同一批派生值；拆开要么重复推导，要么把 memo 结果整包透传。
// 拆出去必须新增 props 链或 context 才能跑通，这个中间层本身就是新的排查成本。
// 豁免依据：AGENTS.md 大文件拆分 第 5 条第 3 类（拆分后需大量 props 透传或 state 搬运的组件）。
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { useGitPageHandlers } from './git-page-handlers'
import { ScmSidebar } from './GitPage/ScmSidebar'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { useGitStore } from '@renderer/stores/git-store'
import { useChatStore } from '@renderer/stores/chat-store'

import { type ScmFileRow, scmFileKey } from './GitPage/utils'
import { GitDiffDialog } from './GitPage/git-diff-dialog'
import { diffTextToChunks } from './GitPage/diff-chunks'
import { CodeDiffViewer } from './CodeDiffViewer'

export interface GitPageProps {
  /**
   * 会话级工作目录，由右侧面板传入。优先于 `activeProject.workingFolder` ——
   * 全局会话没有 activeProject，但右侧面板仍要能对该会话的目录跑 git。
   */
  workingFolder?: string | null
}

/**
 * 右侧面板的 Git 选项卡：面板内只保留一列 SCM 文件列表（对齐 VS Code「源代码管理」）。
 *
 * 面板常态宽度（384px）放不下并排的 SCM / diff / 历史三栏，因此 diff 与文件历史都走弹窗：
 * 左键文件行看工作区 diff，右键文件行看该文件的提交历史。
 */
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
  const [diffDialogOpen, setDiffDialogOpen] = useState(false)
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
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

  // 弹窗走变更面板那套渲染（带行号、可切 split/inline）。
  const diffChunks = useMemo(
    () => (selectedDiffText === null ? [] : diffTextToChunks(selectedDiffText)),
    [selectedDiffText]
  )

  const fileRows = useMemo(
    () => allRows.map((row) => ({ key: scmFileKey(row), path: row.path, badge: row.section })),
    [allRows]
  )

  const historyListForPanel = useMemo(
    () => (fileHistory.length > 0 ? fileHistory : (details?.history ?? [])),
    [fileHistory, details?.history]
  )

  const historyRows = useMemo(
    () =>
      historyListForPanel.map((commit) => ({
        key: commit.hash,
        path: commit.subject,
        badge: commit.shortHash
      })),
    [historyListForPanel]
  )

  const selectedHistoryEntry = useMemo(() => {
    if (!historyPick) return null
    return historyListForPanel.find((c) => c.hash === historyPick.hash) ?? null
  }, [historyPick, historyListForPanel])

  const previewPath =
    selectedRepo && selectedRow ? `${selectedRepo.fullPath}/${selectedRow.path}` : null

  // 点文件行 = 选中该文件并打开工作区 diff 弹窗。
  const handleFileSelect = (key: string | null): void => {
    setSelectedKey(key)
    if (!key) return
    setHistoryPick(null)
    setDiffDialogOpen(true)
  }

  // 右键文件行「文件历史」= 选中该文件并打开提交历史弹窗。
  const handleShowFileHistory = (row: ScmFileRow): void => {
    if (!selectedRepo) return
    setSelectedKey(scmFileKey(row))
    setHistoryPick(null)
    setHistoryDialogOpen(true)
    void loadFileHistory(selectedRepo.fullPath, row.path)
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
      <div className="flex h-full items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <div className="text-sm font-medium text-foreground">{t('noProject')}</div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {t('pickRepo', {
              defaultValue: 'Select a project to inspect repositories and changes.'
            })}
          </p>
        </div>
      </div>
    )
  }

  // 两个弹窗共用同一份 diff 正文：工作区 diff 与历史提交的 patch 只差数据来源。
  const diffPane = !selectedRow ? null : selectedRow.section === 'untracked' ? (
    <div className="px-4 py-6 text-sm text-muted-foreground">{t('untrackedNoDiff')}</div>
  ) : showHistoryDiffSpinner ? (
    <div className="flex flex-1 items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="size-6 animate-spin" />
    </div>
  ) : diffChunks.length === 0 ? (
    <div className="px-4 py-6 text-sm text-muted-foreground">{t('noDiff')}</div>
  ) : (
    <CodeDiffViewer chunks={diffChunks} defaultMode="inline" showModeToggle fillHeight />
  )

  const diffMeta = selectedRow ? (
    <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
      {selectedRow.section}
    </span>
  ) : null

  const historyMeta =
    viewingHistoryDiff && selectedHistoryEntry ? (
      <span
        className="max-w-[min(320px,45%)] shrink-0 truncate text-[10px] text-muted-foreground"
        title={selectedHistoryEntry.subject}
      >
        {selectedHistoryEntry.shortHash} · {selectedHistoryEntry.subject}
      </span>
    ) : null

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
        {/* SCM 侧栏 — 对齐 VS Code「源代码管理」结构 */}
        <ScmSidebar
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
          setSelectedKey={handleFileSelect}
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
          onShowFileHistory={handleShowFileHistory}
        />
      </div>

      {/* 工作区 diff：面板放不下并排 diff，走弹窗（与变更面板同款交互）。 */}
      <GitDiffDialog
        open={diffDialogOpen}
        onOpenChange={(open) => {
          if (!open) setDiffDialogOpen(false)
        }}
        title={selectedRow?.path ?? ''}
        meta={diffMeta}
        rows={fileRows}
        activeKey={activeKey}
        onSelect={setSelectedKey}
        previewPath={previewPath}
      >
        {diffPane}
      </GitDiffDialog>

      {/* 文件历史：入口是 SCM 文件行的右键菜单，列表与 patch 复用 diff 弹窗外壳。 */}
      <GitDiffDialog
        open={historyDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setHistoryDialogOpen(false)
            setHistoryPick(null)
          }
        }}
        title={selectedRow?.path ?? ''}
        listTitle={t('fileHistory')}
        meta={historyMeta}
        rows={historyRows}
        activeKey={historyPick?.hash ?? null}
        onSelect={(hash) => {
          const commit = historyListForPanel.find((c) => c.hash === hash)
          if (commit) void handleHistoryCommitClick(commit)
        }}
        previewPath={previewPath}
        listFooter={
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full text-[11px]"
            disabled={busy}
            onClick={() => {
              if (!selectedRepo) return
              if (selectedRow) void loadFileHistory(selectedRepo.fullPath, selectedRow.path, true)
              else void loadMoreHistory(selectedRepo.fullPath)
            }}
          >
            {t('loadMoreHistory')}
          </Button>
        }
      >
        {diffPane}
      </GitDiffDialog>

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
