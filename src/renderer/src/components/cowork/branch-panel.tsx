import * as React from 'react'
import { AlertCircle, GitBranch, GitCommitHorizontal, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { useGitStore, type GitBranchItem } from '@renderer/stores/git-store'
import { CommitGraphSvg } from './commit-graph'
import {
  GRAPH_PADDING_Y,
  GRAPH_ROW_HEIGHT,
  layoutCommitGraph,
  type CommitGraphLayout
} from './commit-graph-layout'

/**
 * Branch view for the right panel: local / remote branches plus the commit graph that
 * ties them together. Read-only on purpose — mutating branches already has a home in the
 * Git page, and this surface is a quick "where am I" glance.
 */
export function BranchPanel({ workingFolder }: { workingFolder: string }): React.JSX.Element {
  const { t } = useTranslation('layout')
  const { repositories, repoDetailsByPath, scanRepositories, loadCommitGraph } = useGitStore()

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
        <span className="truncate text-xs font-medium">
          {repo?.name ?? t('agentFiles.noRepoSelected', { defaultValue: 'No repository' })}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={refresh}
          title={t('agentFiles.refresh', { defaultValue: 'Refresh' })}
        >
          <RefreshCw className="size-3" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
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
          <CommitGraphList layout={layout} />
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

        <BranchSection
          title={t('agentFiles.localBranches', { defaultValue: 'Local branches' })}
          branches={localBranches}
          currentBranch={details?.currentBranch ?? null}
        />
        <BranchSection
          title={t('agentFiles.remoteBranches', { defaultValue: 'Remote branches' })}
          branches={remoteBranches}
          currentBranch={null}
        />
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
  return (
    <div className="flex">
      <CommitGraphSvg layout={layout} />
      <div className="min-w-0 flex-1" style={{ paddingTop: GRAPH_PADDING_Y }}>
        {layout.rows.map((row) => (
          <div
            key={row.commit.hash}
            className="flex items-center gap-1.5 pr-2"
            style={{ height: GRAPH_ROW_HEIGHT }}
          >
            <span className="min-w-0 flex-1 truncate text-xs" title={row.commit.subject}>
              {row.commit.subject}
            </span>
            {row.commit.refs.map((ref) => (
              <RefBadge key={ref} value={ref} />
            ))}
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {row.commit.shortHash}
            </span>
          </div>
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
  currentBranch
}: {
  title: string
  branches: GitBranchItem[]
  currentBranch: string | null
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
        branches.map((branch) => (
          <div
            key={branch.fullName}
            className="flex items-center gap-1.5 px-2 py-1 text-xs"
            title={branch.fullName}
          >
            <GitBranch className="size-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{branch.name}</span>
            {branch.isCurrent || branch.name === currentBranch ? (
              <span className="shrink-0 rounded border border-primary/40 bg-primary/10 px-1 text-[10px] leading-4 text-primary">
                {t('agentFiles.currentBranch', { defaultValue: 'current' })}
              </span>
            ) : null}
          </div>
        ))
      )}
    </>
  )
}
