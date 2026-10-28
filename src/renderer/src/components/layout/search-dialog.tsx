import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CommandDialog,
  CommandInput,
  CommandList
} from '@renderer/components/ui/command'
import { useUIStore } from '@renderer/stores/ui-store'
import { useChatStore } from '@renderer/stores/chat-store'
import { QuickActions } from './search-dialog/quick-actions'
import { SearchResults } from './search-dialog/search-results'
import type { MessageSearchHit, SearchDialogProps } from './search-dialog/types'

export type { MessageSearchHit, SearchDialogProps } from './search-dialog/types'

const SEARCH_DEBOUNCE_MS = 200
const SEARCH_LIMIT = 50

export function SearchDialog({ open, onOpenChange }: SearchDialogProps): React.JSX.Element {
  const { t } = useTranslation('layout')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<MessageSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const navigateToSession = useUIStore((s) => s.navigateToSession)
  const loadRecentSessionMessages = useChatStore((s) => s.loadRecentSessionMessages)
  const toggleLeftSidebar = useUIStore((s) => s.toggleLeftSidebar)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const openSettings = useUIStore((s) => s.openSettings)
  const setShortcutsOpen = useUIStore((s) => s.setShortcutsOpen)
  const openDrawPage = useUIStore((s) => s.openDrawPage)
  const openTasksPage = useUIStore((s) => s.openTasksPage)
  const openTaskBoardPage = useUIStore((s) => s.openTaskBoardPage)
  const navigateToHome = useUIStore((s) => s.navigateToHome)
  const setActiveProjectHome = useChatStore((s) => s.setActiveProjectHome)
  const setMode = useUIStore((s) => s.setMode)

  const sessions = useChatStore((s) => s.sessions)
  const activeSessionId = useChatStore((s) => s.activeSessionId)

  const isDark = useMemo(() => {
    // simple check — same approach as TitleBar
    return document.documentElement.classList.contains('dark')
  }, [open])

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim().toLowerCase()
    if (!trimmed) {
      setHits([])
      setSearching(false)
      return
    }

    setSearching(true)
    try {
      const res = await window.api.workerRequest<{
        success: boolean
        results: Array<{
          messageId: string
          sessionId: string
          sessionTitle: string
          snippet: string
          createdAt: number
        }>
        error: string | null
      }>('db/messages-search-content', {
        query: trimmed,
        limit: SEARCH_LIMIT
      })

      if (res?.success && res.results) {
        setHits(
          res.results.map((r) => ({
            messageId: r.messageId,
            sessionId: r.sessionId,
            sessionTitle: r.sessionTitle,
            snippet: r.snippet,
            createdAt: r.createdAt
          }))
        )
      } else {
        setHits([])
      }
    } catch {
      setHits([])
    }
    setSearching(false)
  }, [])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!query.trim()) {
      setHits([])
      setSearching(false)
      return
    }
    timerRef.current = setTimeout(() => {
      void doSearch(query)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query, doSearch])

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery('')
      setHits([])
      setSearching(false)
    }
  }, [open])

  const runAndClose = useCallback(
    (fn: () => void) => {
      fn()
      onOpenChange(false)
    },
    [onOpenChange]
  )

  const handleSelect = useCallback(
    (sessionId: string) => {
      void loadRecentSessionMessages(sessionId)
      navigateToSession(sessionId)
      onOpenChange(false)
    },
    [loadRecentSessionMessages, navigateToSession, onOpenChange]
  )

  const handleNewChat = useCallback(() => {
    setActiveProjectHome(null)
    setMode('chat')
    navigateToHome()
  }, [setActiveProjectHome, setMode, navigateToHome])

  // Recent sessions (top 5, excluding active)
  const recentSessions = useMemo(
    () =>
      sessions
        .filter((s) => s.id !== activeSessionId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 5),
    [sessions, activeSessionId]
  )

  const hasQuery = query.trim().length > 0

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('sidebar.searchLabel', { defaultValue: 'Search' })}
      description={t('sidebar.searchPlaceholder', { defaultValue: 'Search messages…' })}
      showCloseButton={true}
      className="sm:max-w-2xl h-[70vh] flex flex-col"
    >
      <CommandInput
        placeholder={t('sidebar.searchPlaceholder', { defaultValue: 'Search messages…' })}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList className="flex-1 min-h-0">
        {/* ── Search results mode ── */}
        {hasQuery && (
          <SearchResults
            query={query}
            hits={hits}
            searching={searching}
            onSelect={handleSelect}
          />
        )}

        {/* ── Default mode: quick actions + recent sessions ── */}
        {!hasQuery && (
          <QuickActions
            isDark={isDark}
            recentSessions={recentSessions}
            onRunAndClose={runAndClose}
            onNewChat={handleNewChat}
            onSelectSession={handleSelect}
            openSettings={openSettings}
            setShortcutsOpen={setShortcutsOpen}
            toggleLeftSidebar={toggleLeftSidebar}
            toggleRightPanel={toggleRightPanel}
            openDrawPage={openDrawPage}
            openTasksPage={openTasksPage}
            openTaskBoardPage={openTaskBoardPage}
          />
        )}
      </CommandList>
    </CommandDialog>
  )
}
