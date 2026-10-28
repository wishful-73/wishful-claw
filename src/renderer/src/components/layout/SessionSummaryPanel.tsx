/**
 * SessionSummaryPanel — right panel view for session context and progress.
 * The latest context compression summary remains available as the final
 * section, with a full-history fallback when it predates the loaded window.
 */

import { useEffect, useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import {
  Archive,
  Briefcase,
  Folder,
  GitBranch,
  GitCompare,
  Laptop,
  Loader2,
  Server,
  SquareTerminal
} from 'lucide-react'
import type { UnifiedMessage } from '@renderer/lib/api/types'
import { useChatStore } from '@renderer/stores/chat-store'
import {
  dbLoadContextManifest,
  dbLoadMessages,
  type SessionContextManifest
} from '@renderer/stores/chat-store/db-helpers'
import { SessionContextManifestSection } from './SessionContextManifestSection'
import { useSshStore } from '@renderer/stores/ssh-store'
import { useTerminalStore } from '@renderer/stores/terminal-store'
import { convertChatMessagesToUnified } from '@renderer/components/chat/MessageList/utils'
import { getCompactSummaryDisplayText } from '@renderer/lib/agent/context-compression'
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
  SAFE_LINK_COMPONENTS
} from '@renderer/lib/preview/viewers/markdown-components'
import { ContextRow, terminalLabel } from './session-summary/context-row'
import { compactPath, findLatestSummary, useGitSummary } from './session-summary/use-git-summary'

export function SessionSummaryPanel({
  sessionId
}: {
  sessionId: string | null
}): React.JSX.Element {
  const { t } = useTranslation('layout')
  // Re-scan persisted context data after the message count changes or a new
  // compact summary is merged into the session. Compression status is tracked
  // in a registry, so it is not a reliable Zustand dependency here; the summary
  // artifact itself is the observable source of truth.
  const messageCount = useChatStore((state) => {
    if (!sessionId) return 0
    return state.sessions.find((session) => session.id === sessionId)?.messageCount ?? 0
  })
  const summaryVersion = useChatStore((state) => {
    if (!sessionId) return ''
    const messages = state.sessions.find((session) => session.id === sessionId)?.messages ?? []
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (!message.meta?.compactSummary) continue
      return `${message.id}:${message._revision ?? ''}:${message.createdAt}`
    }
    return ''
  })
  const context = useChatStore(
    useShallow((state) => {
      const session = sessionId ? state.sessions.find((item) => item.id === sessionId) : null
      const project = session?.projectId
        ? (state.projects.find((item) => item.id === session.projectId) ?? null)
        : null
      return {
        sessionTitle: session?.title ?? null,
        projectName: project?.name ?? null,
        projectId: project?.id ?? null,
        workingFolder: session?.workingFolder ?? project?.workingFolder ?? null,
        sshConnectionId: session?.sshConnectionId ?? project?.sshConnectionId ?? null
      }
    })
  )
  const sshConnectionName = useSshStore((state) =>
    context.sshConnectionId
      ? (state.connections.find((item) => item.id === context.sshConnectionId)?.name ?? null)
      : null
  )
  const loadSshConnections = useSshStore((state) => state.loadAll)
  const sshConnectionsLoaded = useSshStore((state) => state._loaded)
  const terminalTabs = useTerminalStore((state) => state.tabs)
  const hasProjectContext = Boolean(context.projectId)
  const gitSummary = useGitSummary(
    hasProjectContext ? context.workingFolder : null,
    hasProjectContext ? context.sshConnectionId : null
  )

  const runningTerminals = useMemo(
    () =>
      hasProjectContext
        ? terminalTabs
            .filter(
              (terminal) =>
                terminal.status === 'running' &&
                (terminal.sessionId === sessionId ||
                  (!terminal.sessionId && terminal.projectId === context.projectId))
            )
            .sort((left, right) => right.createdAt - left.createdAt)
        : [],
    [context.projectId, hasProjectContext, sessionId, terminalTabs]
  )

  useEffect(() => {
    if (context.sshConnectionId && !sshConnectionsLoaded) void loadSshConnections()
  }, [context.sshConnectionId, loadSshConnections, sshConnectionsLoaded])

  const [manifest, setManifest] = useState<SessionContextManifest | null>(null)
  const [manifestLoading, setManifestLoading] = useState(false)
  const [manifestError, setManifestError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadManifest = async (): Promise<void> => {
      if (!sessionId) {
        setManifest(null)
        setManifestError(null)
        setManifestLoading(false)
        return
      }

      setManifestLoading(true)
      setManifestError(null)
      try {
        const nextManifest = await dbLoadContextManifest(sessionId)
        if (!cancelled) setManifest(nextManifest)
      } catch (err) {
        console.error('[SessionSummaryPanel] Failed to load context manifest:', err)
        if (!cancelled) {
          setManifest(null)
          setManifestError(err instanceof Error ? err.message : 'Context manifest unavailable')
        }
      } finally {
        if (!cancelled) setManifestLoading(false)
      }
    }

    void loadManifest()
    return () => {
      cancelled = true
    }
  }, [summaryVersion, messageCount, sessionId])

  // undefined = resolving, null = no summary, otherwise the summary message.
  const [summary, setSummary] = useState<UnifiedMessage | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    const resolve = async (): Promise<void> => {
      if (!sessionId) {
        setSummary(null)
        return
      }
      const session = useChatStore.getState().sessions.find((item) => item.id === sessionId)
      const inMemory = session?.messages?.length
        ? convertChatMessagesToUnified(session.messages)
        : []
      const found = findLatestSummary(inMemory)
      if (found) {
        if (!cancelled) setSummary(found)
        return
      }
      // The summary may predate the loaded turn window — scan full history.
      try {
        const rows = await dbLoadMessages(sessionId)
        if (cancelled) return
        setSummary(findLatestSummary(convertChatMessagesToUnified(rows)))
      } catch (err) {
        console.error('[SessionSummaryPanel] Failed to load summary:', err)
        if (!cancelled) setSummary(null)
      }
    }

    setSummary(undefined)
    void resolve()
    return () => {
      cancelled = true
    }
  }, [summaryVersion, messageCount, sessionId])

  const content = summary ? getCompactSummaryDisplayText(summary).trim() : ''
  const meta = summary?.meta?.compactSummary
  const targetLabel = context.sshConnectionId
    ? sshConnectionName
      ? t('contextProgress.sshNamed', { name: sshConnectionName })
      : t('contextProgress.ssh')
    : t('contextProgress.local')
  const branchLabel = !context.workingFolder
    ? t('contextProgress.noWorkingFolder')
    : gitSummary.branch
      ? [
          gitSummary.branch,
          gitSummary.ahead > 0 ? `↑${gitSummary.ahead}` : null,
          gitSummary.behind > 0 ? `↓${gitSummary.behind}` : null
        ]
          .filter(Boolean)
          .join(' ')
      : gitSummary.loading
        ? t('contextProgress.gitLoading')
        : gitSummary.error
          ? t('contextProgress.gitUnavailable')
          : t('contextProgress.unknownBranch')
  const changesLabel = !context.workingFolder ? (
    t('contextProgress.noWorkingFolder')
  ) : gitSummary.loading ? (
    t('contextProgress.gitLoading')
  ) : gitSummary.error ? (
    t('contextProgress.gitUnavailable')
  ) : gitSummary.dirty ? (
    gitSummary.added !== null && gitSummary.deleted !== null ? (
      <span className="space-x-1 tabular-nums">
        <span className="text-emerald-500">+{gitSummary.added}</span>
        <span className="text-red-500">-{gitSummary.deleted}</span>
      </span>
    ) : (
      t('contextProgress.changedFiles', { count: gitSummary.changedFileCount })
    )
  ) : (
    t('contextProgress.clean')
  )
  const syncLabel = !context.workingFolder
    ? t('contextProgress.noWorkingFolder')
    : gitSummary.loading
      ? t('contextProgress.gitLoading')
      : gitSummary.error
        ? t('contextProgress.gitUnavailable')
        : gitSummary.dirty
          ? t('contextProgress.commitPending')
          : gitSummary.ahead > 0
            ? t('contextProgress.pushPending')
            : gitSummary.behind > 0
              ? t('contextProgress.pullPending')
              : t('contextProgress.synced')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-4">
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              {t('contextProgress.environment')}
            </h3>
            <div className="space-y-1.5">
              <ContextRow
                icon={<Briefcase className="size-3.5" />}
                label={t('contextProgress.session')}
                value={context.sessionTitle ?? t('contextProgress.unknown')}
                muted={!context.sessionTitle}
              />
              {hasProjectContext ? (
                <>
                  <ContextRow
                    icon={<Folder className="size-3.5" />}
                    label={t('contextProgress.project')}
                    value={context.projectName ?? t('contextProgress.noProject')}
                    muted={!context.projectName}
                  />
                  <ContextRow
                    icon={
                      context.sshConnectionId ? (
                        <Server className="size-3.5" />
                      ) : (
                        <Laptop className="size-3.5" />
                      )
                    }
                    label={t('contextProgress.target')}
                    value={targetLabel}
                  />
                  <ContextRow
                    icon={<Folder className="size-3.5" />}
                    label={t('contextProgress.workingFolder')}
                    value={compactPath(context.workingFolder)}
                    title={context.workingFolder ?? undefined}
                  />
                  <ContextRow
                    icon={<GitBranch className="size-3.5" />}
                    label={t('contextProgress.branch')}
                    value={branchLabel}
                  />
                  <ContextRow
                    icon={<GitCompare className="size-3.5" />}
                    label={t('contextProgress.changes')}
                    value={changesLabel}
                  />
                  <ContextRow
                    icon={<GitCompare className="size-3.5" />}
                    label={t('contextProgress.sync')}
                    value={syncLabel}
                  />
                </>
              ) : null}
            </div>
          </section>

          {runningTerminals.length > 0 ? (
            <section className="space-y-2 border-t border-border/70 pt-4">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <SquareTerminal className="size-3.5" />
                <span>{t('contextProgress.runningTerminals')}</span>
                <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-300">
                  {runningTerminals.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {runningTerminals.map((terminal) => (
                  <div
                    key={terminal.id}
                    className="flex min-w-0 items-center gap-2 rounded-md border border-border/60 bg-muted/15 px-2 py-1.5"
                  >
                    <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-[11px] font-medium text-foreground/85"
                        title={terminalLabel(terminal)}
                      >
                        {terminalLabel(terminal)}
                      </div>
                      <div
                        className="truncate text-[10px] text-muted-foreground/65"
                        title={terminal.cwd || terminal.shell}
                      >
                        {compactPath(terminal.cwd) || compactPath(terminal.shell) || terminal.id}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <SessionContextManifestSection
            manifest={manifest}
            loading={manifestLoading}
            error={manifestError}
          />

          <section className="space-y-2 border-t border-border/70 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Archive className="size-3.5" />
                <span>{t('rightPanel.summary', { defaultValue: 'Session summary' })}</span>
              </div>
              {typeof meta?.messagesSummarized === 'number' && meta.messagesSummarized > 0 ? (
                <span className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {t('rightPanel.summaryMessages', {
                    defaultValue: 'Earlier {{count}} messages summarized',
                    count: meta.messagesSummarized
                  })}
                </span>
              ) : null}
            </div>

            {summary === undefined ? (
              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {t('thinking.thinkingEllipsis', { ns: 'chat', defaultValue: 'Loading...' })}
              </div>
            ) : !summary || !content ? (
              <p className="py-1 text-xs text-muted-foreground">
                {t('rightPanel.summaryEmpty', { defaultValue: 'No summary yet' })}
              </p>
            ) : (
              <div className="prose prose-sm max-w-none text-[13px] leading-relaxed text-foreground dark:prose-invert [&_h1]:mb-2 [&_h1]:mt-1 [&_h1]:text-base [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-sm [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_li]:my-0.5 [&_p]:my-1.5 [&_pre]:overflow-x-auto">
                <Markdown
                  remarkPlugins={MARKDOWN_REMARK_PLUGINS}
                  rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                  components={SAFE_LINK_COMPONENTS}
                >
                  {content}
                </Markdown>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
