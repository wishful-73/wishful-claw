import * as React from 'react'
import {
  ChevronDown,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import {
  useGitStore,
  type GitBranchItem,
} from '@renderer/stores/git-store'
import {
  type ScmFileRow,
  scmFileKey,
  parseRemoteBranchName,
  ScmSectionHeader,
  ScmFileRowView
} from './utils'
import type { TFunction } from 'i18next'
import { Textarea } from '@renderer/components/ui/textarea'
import { CloudDownload, CloudUpload, EllipsisVertical, Upload, Wand2 } from 'lucide-react'

interface ScmSidebarProps {
  /** 紧凑形态（右侧面板）传 `'100%'` 占满宿主宽度；宽态传拖拽后的像素值。 */
  scmWidth: number | string
  /** 紧凑形态：没有相邻栏可拖，隐藏右侧拖拽把手。 */
  compact?: boolean
  t: TFunction
  isScanning: boolean
  scanError: string | null
  repositories: ReturnType<typeof useGitStore.getState>['repositories']
  selectedRepoPath: string | null
  selectedRepo: ReturnType<typeof useGitStore.getState>['repositories'][number] | null
  busy: boolean
  details: ReturnType<typeof useGitStore.getState>['repoDetailsByPath'][string] | null
  status: ReturnType<typeof useGitStore.getState>['repoDetailsByPath'][string]['status'] | null
  visibleBranches: GitBranchItem[]
  conflictRows: ScmFileRow[]
  stagedRows: ScmFileRow[]
  unstagedRows: ScmFileRow[]
  allRows: ScmFileRow[]
  activeKey: string | null
  selectedKey: string | null
  setSelectedKey: (v: string | null) => void
  setHistoryPick: (v: { path: string; hash: string } | null) => void
  selectRepository: (path: string) => void
  scanRepositories: (opts?: { force?: boolean }) => Promise<void>
  checkoutBranch: (repoPath: string, name: string) => Promise<{ success: boolean; error?: string }>
  newBranchName: string
  setNewBranchName: (v: string) => void
  handleCreateBranch: (repoPath: string) => Promise<void>
  handleFetch: () => Promise<void>
  handlePullRebase: () => Promise<void>
  handleSync: () => Promise<void>
  handlePush: () => Promise<void>
  runMergeInto: (ref: string) => Promise<void>
  runRebaseOnto: (ref: string) => Promise<void>
  runDeleteLocal: (name: string, force: boolean) => Promise<void>
  runDeleteRemote: (branch: GitBranchItem) => Promise<void>
  setBranchNameDialog: (v: { mode: 'createFrom'; startPoint: string } | { mode: 'rename'; oldName: string | null; displayName: string } | null) => void
  setBranchNameInput: (v: string) => void
  stageFiles: (repoPath: string, paths: string[]) => Promise<void>
  unstageFiles: (repoPath: string, paths: string[]) => Promise<void>
  stageAll: (repoPath: string) => Promise<void>
  unstageAll: (repoPath: string) => Promise<void>
  discardFiles: (repoPath: string, paths: string[], scope: string) => Promise<{ success: boolean; error?: string }>
  confirmDiscard: (row: ScmFileRow) => Promise<void>
  isLoadingOlderMessages: boolean
  upstreamHint: string | null
  commitMessage: string
  setCommitMessage: (v: string) => void
  committing: boolean
  aiCommitLoading: boolean
  handleCommit: () => Promise<void>
  handleAiCommitMessage: () => Promise<void>
  onScmResizePointerDown: (e: React.PointerEvent) => void
}

export function ScmSidebar(props: ScmSidebarProps): React.JSX.Element {
  const {
    scmWidth,
    compact,
    t,
    isScanning,
    scanError,
    repositories,
    selectedRepoPath,
    selectedRepo,
    busy,
    details,
    status,
    visibleBranches,
    conflictRows,
    stagedRows,
    unstagedRows,
    activeKey,
    setSelectedKey,
    setHistoryPick,
    selectRepository,
    scanRepositories,
    checkoutBranch,
    newBranchName,
    setNewBranchName,
    handleCreateBranch,
    handleFetch,
    handlePullRebase,
    handleSync,
    handlePush,
    runMergeInto,
    runRebaseOnto,
    runDeleteLocal,
    runDeleteRemote,
    setBranchNameDialog,
    setBranchNameInput,
    stageFiles,
    unstageFiles,
    stageAll,
    unstageAll,
    confirmDiscard,
    upstreamHint,
    commitMessage,
    setCommitMessage,
    committing,
    aiCommitLoading,
    handleCommit,
    handleAiCommitMessage,
    onScmResizePointerDown
  } = props

  return (
        <>
          <aside
            style={{ width: scmWidth }}
            className="flex min-w-0 shrink-0 flex-col border-r border-border/60 bg-muted/10"
          >
            <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('title')}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={isScanning}
                    onClick={() => void scanRepositories({ force: true })}
                  >
                    <RefreshCw className={cn('size-3.5', isScanning && 'animate-spin')} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('refresh')}</TooltipContent>
              </Tooltip>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {repositories.length > 1 ? (
                <div className="border-b border-border px-2 py-2">
                  <Select
                    value={selectedRepoPath ?? undefined}
                    onValueChange={(value) => {
                      setSelectedKey(null)
                      setHistoryPick(null)
                      selectRepository(value)
                    }}
                  >
                    <SelectTrigger size="sm" className="h-8 w-full max-w-full text-left text-xs">
                      <SelectValue placeholder={t('pickRepo')} />
                    </SelectTrigger>
                    <SelectContent>
                      {repositories.map((repo) => (
                        <SelectItem key={repo.fullPath} value={repo.fullPath} className="text-xs">
                          <span className="truncate">
                            {repo.relativePath === '.' ? repo.name : repo.relativePath}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {!selectedRepo ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {isScanning ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-3.5 animate-spin" />
                      {t('scanning')}
                    </span>
                  ) : (
                    t('noRepo')
                  )}
                  {scanError ? <div className="mt-2 text-destructive">{scanError}</div> : null}
                </div>
              ) : (
                <>
                  <div className="border-b border-border px-2 py-2">
                    <div className="flex items-center gap-1">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 max-w-[calc(100%-88px)] flex-1 justify-start gap-1 px-2 font-normal"
                            disabled={busy}
                          >
                            <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate text-xs font-medium">
                              {status?.branch ?? selectedRepo.branch}
                            </span>
                            <ChevronDown className="ml-auto size-3.5 shrink-0 opacity-50" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="max-h-72 w-72 overflow-y-auto">
                          {visibleBranches.map((branch) => (
                            <ContextMenu key={branch.fullName}>
                              <ContextMenuTrigger asChild>
                                <DropdownMenuItem
                                  className="text-xs"
                                  disabled={busy}
                                  onSelect={() =>
                                    void checkoutBranch(selectedRepo.fullPath, branch.name)
                                  }
                                >
                                  <span className="truncate">{branch.name}</span>
                                  {branch.isCurrent ? (
                                    <span className="ml-auto text-[10px] text-muted-foreground">
                                      HEAD
                                    </span>
                                  ) : null}
                                </DropdownMenuItem>
                              </ContextMenuTrigger>
                              <ContextMenuContent className="w-56">
                                {!branch.isCurrent ? (
                                  <ContextMenuItem
                                    className="text-xs"
                                    onSelect={() =>
                                      void checkoutBranch(selectedRepo.fullPath, branch.name)
                                    }
                                  >
                                    {t('branchCheckout')}
                                  </ContextMenuItem>
                                ) : null}
                                {!branch.isCurrent ? (
                                  <ContextMenuItem
                                    className="text-xs"
                                    onSelect={() => void runMergeInto(branch.name)}
                                  >
                                    {t('branchMergeIntoCurrent')}
                                  </ContextMenuItem>
                                ) : null}
                                {!branch.isCurrent ? (
                                  <ContextMenuItem
                                    className="text-xs"
                                    onSelect={() => void runRebaseOnto(branch.name)}
                                  >
                                    {t('branchRebaseOnto')}
                                  </ContextMenuItem>
                                ) : null}
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  className="text-xs"
                                  onSelect={() => {
                                    setBranchNameDialog({
                                      mode: 'createFrom',
                                      startPoint: branch.name
                                    })
                                    setBranchNameInput('')
                                  }}
                                >
                                  {t('branchCreateFrom')}
                                </ContextMenuItem>
                                {branch.type === 'local' ? (
                                  <ContextMenuItem
                                    className="text-xs"
                                    onSelect={() => {
                                      setBranchNameDialog({
                                        mode: 'rename',
                                        oldName: branch.isCurrent ? null : branch.name,
                                        displayName: branch.name
                                      })
                                      setBranchNameInput(branch.name)
                                    }}
                                  >
                                    {t('branchRename')}
                                  </ContextMenuItem>
                                ) : null}
                                {branch.type === 'local' && !branch.isCurrent ? (
                                  <>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem
                                      className="text-xs"
                                      onSelect={() => void runDeleteLocal(branch.name, false)}
                                    >
                                      {t('branchDeleteLocal')}
                                    </ContextMenuItem>
                                    <ContextMenuItem
                                      variant="destructive"
                                      className="text-xs"
                                      onSelect={() => void runDeleteLocal(branch.name, true)}
                                    >
                                      {t('branchDeleteLocalForce')}
                                    </ContextMenuItem>
                                  </>
                                ) : null}
                                {branch.type === 'remote' &&
                                parseRemoteBranchName(branch.name)?.branchName !== 'HEAD' ? (
                                  <>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem
                                      variant="destructive"
                                      className="text-xs"
                                      onSelect={() => void runDeleteRemote(branch)}
                                    >
                                      {t('branchDeleteRemote')}
                                    </ContextMenuItem>
                                  </>
                                ) : null}
                              </ContextMenuContent>
                            </ContextMenu>
                          ))}
                          <DropdownMenuSeparator />
                          <div className="flex gap-2 p-2">
                            <Input
                              value={newBranchName}
                              onChange={(event) => setNewBranchName(event.target.value)}
                              placeholder={t('newBranchPlaceholder')}
                              className="h-8 flex-1 text-xs"
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  void handleCreateBranch(selectedRepo.fullPath)
                                }
                              }}
                            />
                            <Button
                              size="sm"
                              className="h-8 shrink-0 px-2"
                              type="button"
                              onClick={() => void handleCreateBranch(selectedRepo.fullPath)}
                            >
                              <Plus className="size-3.5" />
                            </Button>
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0"
                            disabled={busy}
                            onClick={() => void handleFetch()}
                          >
                            <CloudDownload className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{t('fetch')}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0"
                            disabled={busy}
                            onClick={() => void handlePullRebase()}
                          >
                            <RefreshCw className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{t('pullRebase')}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0"
                            disabled={busy}
                            onClick={() => void handlePush()}
                          >
                            <CloudUpload className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{t('push')}</TooltipContent>
                      </Tooltip>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0"
                            disabled={busy}
                          >
                            <EllipsisVertical className="size-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="text-xs" onSelect={() => void handleSync()}>
                            <Upload className="mr-2 size-3.5" />
                            {t('sync')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {upstreamHint ? (
                      <div className="mt-1 truncate px-1 text-[11px] text-muted-foreground">
                        {upstreamHint}
                      </div>
                    ) : null}
                    {details?.error ? (
                      <div className="mt-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11px] text-destructive">
                        {details.error}
                      </div>
                    ) : null}
                  </div>

                  {conflictRows.length > 0 ? (
                    <ScmSectionHeader title={t('sectionConflicts')} count={conflictRows.length}>
                      {conflictRows.map((row) => (
                        <ScmFileRowView
                          key={scmFileKey(row)}
                          row={row}
                          selected={activeKey === scmFileKey(row)}
                          onSelect={() => {
                            setHistoryPick(null)
                            setSelectedKey(scmFileKey(row))
                          }}
                          onStage={() => void stageFiles(selectedRepo.fullPath, [row.path])}
                          onUnstage={() => void unstageFiles(selectedRepo.fullPath, [row.path])}
                          onDiscard={() => void confirmDiscard(row)}
                          disabled={busy}
                          labels={{
                            stage: t('tooltipStage'),
                            unstage: t('tooltipUnstage'),
                            discard: t('tooltipDiscard')
                          }}
                        />
                      ))}
                    </ScmSectionHeader>
                  ) : null}

                  <ScmSectionHeader
                    title={t('sectionStaged')}
                    count={stagedRows.length}
                    actions={
                      stagedRows.length > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[10px]"
                          disabled={busy}
                          onClick={() => void unstageAll(selectedRepo.fullPath)}
                        >
                          {t('unstageAll')}
                        </Button>
                      ) : null
                    }
                  >
                    {stagedRows.length === 0 ? (
                      <div className="py-2 pl-6 text-[12px] text-muted-foreground">
                        {t('emptyStaged')}
                      </div>
                    ) : (
                      stagedRows.map((row) => (
                        <ScmFileRowView
                          key={scmFileKey(row)}
                          row={row}
                          selected={activeKey === scmFileKey(row)}
                          onSelect={() => {
                            setHistoryPick(null)
                            setSelectedKey(scmFileKey(row))
                          }}
                          onStage={() => void stageFiles(selectedRepo.fullPath, [row.path])}
                          onUnstage={() => void unstageFiles(selectedRepo.fullPath, [row.path])}
                          onDiscard={() => void confirmDiscard(row)}
                          disabled={busy}
                          labels={{
                            stage: t('tooltipStage'),
                            unstage: t('tooltipUnstage'),
                            discard: t('tooltipDiscard')
                          }}
                        />
                      ))
                    )}
                  </ScmSectionHeader>

                  <ScmSectionHeader
                    title={t('sectionChanges')}
                    count={unstagedRows.length}
                    actions={
                      unstagedRows.length > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-[10px]"
                          disabled={busy}
                          onClick={() => void stageAll(selectedRepo.fullPath)}
                        >
                          {t('stageAll')}
                        </Button>
                      ) : null
                    }
                  >
                    {unstagedRows.length === 0 ? (
                      <div className="py-2 pl-6 text-[12px] text-muted-foreground">
                        {t('emptyChanges')}
                      </div>
                    ) : (
                      unstagedRows.map((row) => (
                        <ScmFileRowView
                          key={scmFileKey(row)}
                          row={row}
                          selected={activeKey === scmFileKey(row)}
                          onSelect={() => {
                            setHistoryPick(null)
                            setSelectedKey(scmFileKey(row))
                          }}
                          onStage={() => void stageFiles(selectedRepo.fullPath, [row.path])}
                          onUnstage={() => void unstageFiles(selectedRepo.fullPath, [row.path])}
                          onDiscard={() => void confirmDiscard(row)}
                          disabled={busy}
                          labels={{
                            stage: t('tooltipStage'),
                            unstage: t('tooltipUnstage'),
                            discard: t('tooltipDiscard')
                          }}
                        />
                      ))
                    )}
                  </ScmSectionHeader>

                  <div className="border-t border-border p-2">
                    <div className="relative">
                      <Textarea
                        value={commitMessage}
                        onChange={(event) => setCommitMessage(event.target.value)}
                        placeholder={t('commitPlaceholder')}
                        disabled={busy || aiCommitLoading}
                        className="min-h-[72px] resize-y rounded-sm border-border/80 bg-background pr-10 text-xs"
                        rows={3}
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute top-1 right-1 size-7"
                            disabled={busy || aiCommitLoading || stagedRows.length === 0}
                            onClick={() => void handleAiCommitMessage()}
                          >
                            {aiCommitLoading ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Wand2 className="size-3.5" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left">{t('aiCommitTooltip')}</TooltipContent>
                      </Tooltip>
                    </div>
                    <Button
                      type="button"
                      className="mt-2 h-8 w-full text-xs"
                      disabled={
                        busy ||
                        committing ||
                        aiCommitLoading ||
                        stagedRows.length === 0 ||
                        !commitMessage.trim()
                      }
                      onClick={() => void handleCommit()}
                    >
                      {committing ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : null}
                      {t('commitButton')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </aside>

          {compact ? null : (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('resizeScmPanel')}
              onPointerDown={onScmResizePointerDown}
              className="w-[5px] shrink-0 cursor-col-resize border-x border-transparent bg-border/50 hover:bg-primary/35"
            />
          )}
        </>
  )
}
