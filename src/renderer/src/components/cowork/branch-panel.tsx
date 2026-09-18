import * as React from 'react'
import {
  AlertCircle,
  ArrowDownUp,
  CloudDownload,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Loader2,
  RefreshCcw,
  RefreshCw,
  Upload
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { confirm } from '@renderer/components/ui/confirm-dialog'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@renderer/components/ui/hover-card'
import { cn } from '@renderer/lib/utils'
import { useGitStore, type GitBranchItem } from '@renderer/stores/git-store'
import { COMMIT_GRAPH_LIMIT } from '@renderer/stores/git-store-types'
import { CommitGraphSvg } from './commit-graph'
import {
  GRAPH_PADDING_Y,
  GRAPH_ROW_HEIGHT,
  layoutCommitGraph,
  type CommitGraphLayout
} from './commit-graph-layout'

/**
 * Branch view for the right panel: local / remote branches plus the commit graph that
 * ties them together. Carries the "get me in sync" actions (fetch / pull / push / sync)
 * and branch switching, but no commit entry — committing stays in the Git tab.
 */
export function BranchPanel({ workingFolder }: { workingFolder: string }): React.JSX.Element {
  const { t } = useTranslation('layout')
  const {
    repositories,
    repoDetailsByPath,
    scanRepositories,
    loadCommitGraph,
    fetchRepository,
    pullRebase,
    pushRepository,
    syncRepository,
    checkoutBranch,
    mergeBranch
  } = useGitStore()

  const repo =
    repositories.find(
      (item) => workingFolder === item.fullPath || workingFolder.startsWith(`${item.fullPath}/`)
    ) ?? repositories[0]
  const details = repo ? repoDetailsByPath[repo.fullPath] : undefined

  React.useEffect(() => {
    void scanRepositories()
  }, [scanRepositories, workingFolder])

  React.useEffect(() => {
    if (repo) void loadCommitGraph(repo.fullPath)
  }, [loadCommitGraph, repo])

  const graph = details?.graph ?? null
  const layout = React.useMemo(() => (graph ? layoutCommitGraph(graph) : null), [graph])
  const branches = details?.branches ?? []
  const localBranches = branches.filter((branch) => branch.type === 'local')
  const remoteBranches = branches.filter((branch) => branch.type === 'remote')

  const refresh = (): void => {
    if (repo) void loadCommitGraph(repo.fullPath, { force: true })
  }

  const [busyAction, setBusyAction] = React.useState<string | null>(null)

  const runSyncAction = async (
    action: 'fetch' | 'pullRebase' | 'push' | 'sync'
  ): Promise<void> => {
    if (!repo || busyAction !== null) return
    setBusyAction(action)
    try {
      const result =
        action === 'fetch'
          ? await fetchRepository(repo.fullPath)
          : action === 'pullRebase'
            ? await pullRebase(repo.fullPath)
            : action === 'push'
              ? await pushRepository(repo.fullPath)
              : await syncRepository(repo.fullPath)
      if (!result.success) toast.error(result.error)
      else toast.success(t(`agentFiles.${action}Done`, { defaultValue: 'Done' }))
      refresh()
    } finally {
      setBusyAction(null)
    }
  }

  const handleCheckout = async (branch: GitBranchItem): Promise<void> => {
    if (!repo || branch.type !== 'local' || branch.isCurrent || busyAction !== null) return
    setBusyAction(`checkout:${branch.fullName}`)
    try {
      const result = await checkoutBranch(repo.fullPath, branch.name)
      if (!result.success) toast.error(result.error)
      else {
        toast.success(
          t('agentFiles.branchCheckoutDone', {
            name: branch.name,
            defaultValue: 'Switched to {{name}}'
          })
        )
        refresh()
      }
    } finally {
      setBusyAction(null)
    }
  }

  const handleMergeIntoCurrent = async (branch: GitBranchItem): Promise<void> => {
    if (!repo || branch.type !== 'local' || branch.isCurrent || busyAction !== null) return
    const ok = await confirm({
      title: t('agentFiles.branchMergeIntoConfirm', {
        name: branch.name,
        current: details?.currentBranch ?? '',
        defaultValue: 'Merge {{name}} into {{current}}?'
      }),
      confirmLabel: t('agentFiles.branchMergeIntoCurrent', { defaultValue: 'Merge into current' })
    })
    if (!ok) return
    setBusyAction(`merge:${branch.fullName}`)
    try {
      const result = await mergeBranch(repo.fullPath, branch.name)
      if (!result.success) toast.error(result.error)
      else {
        toast.success(t('agentFiles.branchMergeDone', { defaultValue: 'Merged' }))
        refresh()
      }
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
        <span className="truncate text-xs font-medium">
          {repo?.name ?? t('agentFiles.noRepoSelected', { defaultValue: 'No repository' })}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={!repo || busyAction !== null}
            onClick={() => void runSyncAction('fetch')}
            title={t('agentFiles.fetch', { defaultValue: 'Fetch' })}
          >
            {busyAction === 'fetch' ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <CloudDownload className="size-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={!repo || busyAction !== null}
            onClick={() => void runSyncAction('pullRebase')}
            title={t('agentFiles.pullRebase', { defaultValue: 'Pull (rebase)' })}
          >
            {busyAction === 'pullRebase' ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCcw className="size-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={!repo || busyAction !== null}
            onClick={() => void runSyncAction('push')}
            title={t('agentFiles.push', { defaultValue: 'Push' })}
          >
            {busyAction === 'push' ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Upload className="size-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={!repo || busyAction !== null}
            onClick={() => void runSyncAction('sync')}
            title={t('agentFiles.sync', { defaultValue: 'Sync' })}
          >
            {busyAction === 'sync' ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <ArrowDownUp className="size-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={refresh}
            title={t('agentFiles.refresh', { defaultValue: 'Refresh' })}
          >
            <RefreshCw className="size-3" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 分支列表在提交图之上：进这个选项卡第一眼要看到的是「我在哪个分支、
            有哪些分支可以切」，提交图是次要信息。 */}
        <BranchSection
          title={t('agentFiles.localBranches', { defaultValue: 'Local branches' })}
          branches={localBranches}
          currentBranch={details?.currentBranch ?? null}
          onCheckout={handleCheckout}
          onMergeIntoCurrent={handleMergeIntoCurrent}
          busyAction={busyAction}
        />
        <BranchSection
          title={t('agentFiles.remoteBranches', { defaultValue: 'Remote branches' })}
          branches={remoteBranches}
          currentBranch={null}
        />

        <SectionHeader
          icon={<GitCommitHorizontal className="size-3" />}
          title={t('agentFiles.commitGraph', { defaultValue: 'Commit graph' })}
        />
        {graph === null && details?.graphError ? (
          <div className="flex items-start gap-2 px-2 py-3 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{details.graphError}</span>
          </div>
        ) : layout && layout.rows.length > 0 ? (
          <>
            <CommitGraphList layout={layout} />
            {/* The query is capped (COMMIT_GRAPH_LIMIT), and git log --all is not
                paged — without this line an old repository looks like it simply has
                no history past the cut. */}
            {graph && graph.length >= COMMIT_GRAPH_LIMIT ? (
              <div className="px-2 py-2 text-[11px] text-muted-foreground">
                {t('agentFiles.graphTruncated', {
                  defaultValue: 'Showing the most recent {{count}} commits',
                  count: COMMIT_GRAPH_LIMIT
                })}
              </div>
            ) : null}
          </>
        ) : graph === null ? (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t('agentFiles.loadingDiff', { defaultValue: 'Loading...' })}
          </div>
        ) : (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            {t('agentFiles.graphEmpty', { defaultValue: 'No commits to show' })}
          </div>
        )}
      </div>
    </div>
  )
}

function SectionHeader({
  icon,
  title,
  count
}: {
  icon: React.ReactNode
  title: string
  count?: number
}): React.JSX.Element {
  return (
    <div className="sticky top-0 z-10 flex h-7 items-center gap-1.5 border-b border-border bg-background/95 px-2 text-[11px] font-medium text-muted-foreground backdrop-blur">
      {icon}
      <span className="truncate">{title}</span>
      {count !== undefined ? <span className="ml-auto tabular-nums">{count}</span> : null}
    </div>
  )
}

function CommitGraphList({ layout }: { layout: CommitGraphLayout }): React.JSX.Element {
  // 节点画在 SVG 里、提交说明在兄弟容器里，两者只能靠共享状态联动：
  // hover 任一侧都要把这一行标出来，否则用户分不清哪个节点对应哪条说明。
  const [activeHash, setActiveHash] = React.useState<string | null>(null)

  return (
    <div className="flex">
      <CommitGraphSvg layout={layout} activeHash={activeHash} onRowHover={setActiveHash} />
      <div className="min-w-0 flex-1" style={{ paddingTop: GRAPH_PADDING_Y }}>
        {layout.rows.map((row) => (
          // 提交说明在窄面板里必然被截断。这里用 Radix HoverCard 而不是原生 title：
          // 原生 title 延迟长、样式不可控，且挂在局部元素上时行内空白处不触发。
          <HoverCard key={row.commit.hash} openDelay={400} closeDelay={80}>
            <HoverCardTrigger asChild>
              <div
                className={cn(
                  'flex items-center gap-1.5 rounded-sm pr-2',
                  activeHash === row.commit.hash ? 'bg-accent' : 'hover:bg-accent/60'
                )}
                style={{ height: GRAPH_ROW_HEIGHT }}
                onMouseEnter={() => setActiveHash(row.commit.hash)}
                onMouseLeave={() => setActiveHash(null)}
              >
                <span className="min-w-0 flex-1 truncate text-xs">{row.commit.subject}</span>
                {row.commit.refs.map((ref) => (
                  <RefBadge key={ref} value={ref} />
                ))}
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {row.commit.shortHash}
                </span>
              </div>
            </HoverCardTrigger>
            <HoverCardContent
              side="left"
              align="start"
              className="w-auto max-w-md break-words p-2 text-xs leading-relaxed"
            >
              {row.commit.subject}
            </HoverCardContent>
          </HoverCard>
        ))}
      </div>
    </div>
  )
}

/** `%D` hands us `HEAD -> main` / `tag: v1` / `origin/main` — render each in its own tone. */
function RefBadge({ value }: { value: string }): React.JSX.Element {
  if (value === 'HEAD' || value.startsWith('HEAD -> ')) {
    const label = value === 'HEAD' ? 'HEAD' : value.slice('HEAD -> '.length)
    return (
      <span className="shrink-0 rounded border border-primary/40 bg-primary/10 px-1 text-[10px] leading-4 text-primary">
        {label}
      </span>
    )
  }
  if (value.startsWith('tag: ')) {
    return (
      <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1 text-[10px] leading-4 text-amber-600 dark:text-amber-400">
        {value.slice('tag: '.length)}
      </span>
    )
  }
  return (
    <span className="shrink-0 rounded border border-border bg-muted px-1 text-[10px] leading-4 text-muted-foreground">
      {value}
    </span>
  )
}

function BranchSection({
  title,
  branches,
  currentBranch,
  onCheckout,
  onMergeIntoCurrent,
  busyAction
}: {
  title: string
  branches: GitBranchItem[]
  currentBranch: string | null
  onCheckout?: (branch: GitBranchItem) => void
  onMergeIntoCurrent?: (branch: GitBranchItem) => void
  busyAction?: string | null
}): React.JSX.Element {
  const { t } = useTranslation('layout')

  return (
    <>
      <SectionHeader
        icon={<GitBranch className="size-3" />}
        title={title}
        count={branches.length}
      />
      {branches.length === 0 ? (
        <div className="px-2 py-3 text-xs text-muted-foreground">
          {t('agentFiles.noBranches', { defaultValue: 'None' })}
        </div>
      ) : (
        branches.map((branch) => {
          const isCurrent = branch.isCurrent || branch.name === currentBranch
          const canSwitch = Boolean(onCheckout) && branch.type === 'local' && !isCurrent
          const busy =
            busyAction === `checkout:${branch.fullName}` ||
            busyAction === `merge:${branch.fullName}`
          return (
            <div
              key={branch.fullName}
              className={cn(
                'group flex items-center gap-1.5 px-2 py-1 text-xs',
                canSwitch && 'cursor-pointer hover:bg-muted'
              )}
              title={branch.fullName}
              onClick={canSwitch ? () => onCheckout?.(branch) : undefined}
            >
              <GitBranch className="size-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{branch.name}</span>
              {busy ? <Loader2 className="size-3 shrink-0 animate-spin" /> : null}
              {isCurrent ? (
                <span className="shrink-0 rounded border border-primary/40 bg-primary/10 px-1 text-[10px] leading-4 text-primary">
                  {t('agentFiles.currentBranch', { defaultValue: 'current' })}
                </span>
              ) : null}
              {canSwitch && onMergeIntoCurrent ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 opacity-0 group-hover:opacity-100"
                  title={t('agentFiles.branchMergeIntoCurrent', {
                    defaultValue: 'Merge into current'
                  })}
                  onClick={(event) => {
                    event.stopPropagation()
                    void onMergeIntoCurrent(branch)
                  }}
                >
                  <GitMerge className="size-3" />
                </Button>
              ) : null}
            </div>
          )
        })
      )}
    </>
  )
}
