import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  Clock,
  Database,
  FileText,
  FolderOpen,
  Loader2,
  RefreshCw,
  Terminal,
  User
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@renderer/components/ui/button'
import { useChatStore } from '@renderer/stores/chat-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { cn } from '@renderer/lib/utils'

import {
  type ArchiveTabId,
  type PersonaSummary,
  type SshConnectionInfo,
  WISHFUL_CLAW_DIR,
  PERSONA_FILE_NAMES,
  joinFsPath,
  getHomeDir,
  listDir
} from './project-archive-helpers'
import { PersonaFilePreview } from './PersonaFilePreview'
import { CodeGraphProjectIndexSection } from './codegraph-project-index'
import ProjectMemoryFileTab from './ProjectMemoryFileTab'
import ProjectMemoryLibraryTab from './ProjectMemoryLibraryTab'


const MEMORY_TABS: { id: ArchiveTabId; icon: typeof FileText; i18nKey: string }[] = [
  { id: 'memory', icon: FileText, i18nKey: 'projectArchive.tabs.memory' },
  // S-91: the old "daily" tab had no backing file (daily memory is never materialised),
  // so it only ever rendered today's empty template. It becomes the read-only memory library.
  { id: 'database', icon: Database, i18nKey: 'projectArchive.tabs.database' },
  { id: 'persona', icon: User, i18nKey: 'projectArchive.tabs.persona' }
]

export function ProjectArchivePage(): React.JSX.Element {
  const { t } = useTranslation('chat')
  const { t: tCommon } = useTranslation('common')

  const activeProjectId = useChatStore((s) => s.activeProjectId)
  const projects = useChatStore((s) => s.projects)
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

  const [activeTab, setActiveTab] = useState<ArchiveTabId>('memory')
  // Bumped whenever the user hits Refresh: the two memory tabs are self-contained, so remounting
  // them with a new key is how the page asks them to re-read their source.
  const [reloadToken, setReloadToken] = useState(0)
  const [personas, setPersonas] = useState<PersonaSummary[]>([])
  const [personasLoading, setPersonasLoading] = useState(false)
  // unused: dormant files are stored in SQLite, not filesystem

  const sshConnectionId = activeProject?.sshConnectionId
  const workingFolder = activeProject?.workingFolder
  const isSshProject = !!sshConnectionId
  const [sshConnectionInfo, setSshConnectionInfo] = useState<SshConnectionInfo | null>(null)

  // ─── Paths ───
  // Local project: {workingFolder}/.wishful-claw/
  // SSH project: ~/.wishful-claw/projects/{projectId}/ (local storage, not remote)
  const memoryRoot = useMemo(() => {
    if (isSshProject) {
      const home = getHomeDir()
      if (!home || !activeProjectId) return ''
      return joinFsPath(home, WISHFUL_CLAW_DIR, 'projects', activeProjectId)
    }
    if (!activeProject?.workingFolder) return ''
    return joinFsPath(activeProject.workingFolder, WISHFUL_CLAW_DIR)
  }, [isSshProject, activeProject?.workingFolder, activeProjectId])

  const memoryPath = useMemo(
    () => (memoryRoot ? joinFsPath(memoryRoot, 'MEMORY.md') : ''),
    [memoryRoot]
  )
  const personasDir = useMemo(
    () => (memoryRoot ? joinFsPath(memoryRoot, 'personas') : ''),
    [memoryRoot]
  )
  // Cold memory: stored in SQLite (memory_archive + FTS5), not file system

  // ─── Load personas ───

  const loadPersonas = useCallback(async () => {
    if (!personasDir) {
      setPersonas([])
      setPersonasLoading(false)
      return
    }
    setPersonasLoading(true)
    // List persona directories
    const entries = await listDir(personasDir)
    const personaDirs = entries.filter((e) => e.type === 'directory')

    const results: PersonaSummary[] = []
    for (const dir of personaDirs) {
      const dirPath = joinFsPath(personasDir, dir.name)
      const fileEntries = await listDir(dirPath)
      const files = fileEntries
        .filter((e) => e.type === 'file' && PERSONA_FILE_NAMES.includes(e.name))
        .map((e) => ({ name: e.name, path: joinFsPath(dirPath, e.name) }))
      results.push({ id: dir.name, name: dir.name, files })
    }
    setPersonas(results)
    setPersonasLoading(false)
  }, [personasDir])

  // ─── Load dormant files ───

  // Cold memory loaded via memory/stats IPC (SQLite), not file system

  // ─── Load SSH connection info ───

  useEffect(() => {
    if (!isSshProject || !sshConnectionId) {
      setSshConnectionInfo(null)
      return
    }
    void (async () => {
      try {
        const list = await ipcClient.invoke(IPC.SSH_CONNECTION_LIST)
        if (Array.isArray(list)) {
          const conn = list.find((c: Record<string, unknown>) => c.id === sshConnectionId)
          if (conn) {
            setSshConnectionInfo({
              name: String(conn.name ?? ''),
              host: String(conn.host ?? ''),
              port: Number(conn.port ?? 22),
              username: String(conn.username ?? ''),
              defaultDirectory: conn.default_directory ?? null,
              lastConnectedAt: conn.last_connected_at ?? null
            })
          }
        }
      } catch {
        // ignore
      }
    })()
  }, [isSshProject, sshConnectionId])

  // ─── Initial load ───

  useEffect(() => {
    if (activeTab === 'persona') void loadPersonas()
  }, [activeTab, loadPersonas])

  // ─── Reload current tab ───

  // The two memory tabs load themselves; remounting them delivers the refresh. Only the persona
  // tab still needs an explicit reload.
  const handleReload = useCallback(() => {
    if (activeTab === 'persona') {
      void loadPersonas()
      return
    }
    setReloadToken((token) => token + 1)
  }, [activeTab, loadPersonas])

  // ─── Derived state ───

  const isLoading = personasLoading

  // ─── Empty state: no project ───

  if (!activeProject) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background px-6">
        <div className="max-w-md text-center">
          <div className="text-[28px] font-semibold tracking-tight text-foreground">
            {t('projectArchive.noProjectTitle', { defaultValue: 'No project selected' })}
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {t('projectArchive.noProjectDesc', {
              defaultValue: 'Select a project first, then view the project archive.'
            })}
          </p>
          <Button
            className="mt-6 h-9 rounded-md px-4"
            onClick={() => useUIStore.getState().navigateToHome()}
          >
            <ChevronRight className="mr-1.5 size-4" />
            {t('projectArchive.backHome', { defaultValue: 'Return to home' })}
          </Button>
        </div>
      </div>
    )
  }

  // ─── Render ───

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-background px-6 pb-6 pt-4">
      <div className="mx-auto w-full max-w-[1480px]">
        {/* ── Header: Project info ── */}
        <div className="flex flex-wrap items-end justify-between gap-4 pb-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
              {t('projectArchive.title', { defaultValue: 'Project archive' })}
            </p>
            <h1 className="mt-1 truncate text-sm font-medium text-foreground/92">
              {activeProject.name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground/72">
              {activeProject.workingFolder && (
                <span className="flex items-center gap-1">
                  <FolderOpen className="size-3" />
                  <span className="truncate max-w-[400px]">{activeProject.workingFolder}</span>
                </span>
              )}
              {isSshProject && sshConnectionInfo?.defaultDirectory && (
                <span className="flex items-center gap-1">
                  <FolderOpen className="size-3" />
                  <span className="truncate max-w-[300px]" title={sshConnectionInfo.defaultDirectory}>
                    {sshConnectionInfo.defaultDirectory}
                  </span>
                </span>
              )}
              {isSshProject && sshConnectionInfo && (
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400" title={sshConnectionInfo.name}>
                  <Terminal className="size-3" />
                  {sshConnectionInfo.username}@{sshConnectionInfo.host}:{sshConnectionInfo.port}
                </span>
              )}
              {isSshProject && !sshConnectionInfo && (
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <Terminal className="size-3" />
                  SSH
                </span>
              )}
              {activeProject.createdAt > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {new Date(activeProject.createdAt).toLocaleDateString()}
                </span>
              )}
              {activeProject.sessionCount !== undefined && (
                <span>
                  {activeProject.sessionCount}{' '}
                  {t('projectArchive.sessions', { defaultValue: 'sessions' })}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-md px-3 text-xs"
              onClick={() => useUIStore.getState().navigateToProject()}
            >
              {t('projectArchive.backProject', { defaultValue: 'Return to project' })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-md px-3 text-xs"
              onClick={handleReload}
              disabled={isLoading}
            >
              <RefreshCw className={cn('mr-1.5 size-3.5', isLoading && 'animate-spin')} />
              {tCommon('action.refresh', { defaultValue: 'Refresh' })}
            </Button>
          </div>
        </div>

        {/* ── Code graph (per-project index) ── */}
        <div className="pb-4">
          <CodeGraphProjectIndexSection />
        </div>

        {/* ── Tab bar ── */}
        <div className="flex gap-1 border-b border-border/60 pb-2">
          {MEMORY_TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <Button
                key={tab.id}
                variant={isActive ? 'default' : 'ghost'}
                size="sm"
                className="h-8 rounded-md px-3 text-xs"
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon className="mr-1.5 size-3.5" />
                {t(tab.i18nKey, { defaultValue: tab.id })}
              </Button>
            )
          })}
        </div>

        {/* ── Tab content ── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-4">
          {/* Tab 1: Project Memory (editable MEMORY.md). Stays mounted while another tab is
              active, otherwise switching tabs would discard an unsaved draft. */}
          <div className={activeTab === 'memory' ? 'contents' : 'hidden'}>
            <ProjectMemoryFileTab key={`memory-${reloadToken}`} path={memoryPath} />
          </div>

          {/* Tab 2: Memory Library — read-only memory_entries of this project (S-91) */}
          {activeTab === 'database' && (
            <ProjectMemoryLibraryTab
              key={`library-${reloadToken}`}
              projectId={activeProjectId}
              workingFolder={workingFolder}
              sshConnectionId={sshConnectionId}
            />
          )}

          {/* Tab 3: Project Persona */}
          {activeTab === 'persona' && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {personasLoading ? (
                <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {t('projectArchive.loading', { defaultValue: 'Loading...' })}
                </div>
              ) : personas.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
                  <User className="size-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    {t('projectArchive.persona.noPersonas', {
                      defaultValue: 'No project-specific personas yet. Add personas via the persona settings page.'
                    })}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-md px-3 text-xs"
                    onClick={() => useUIStore.getState().navigateToPersona()}
                  >
                    {t('projectArchive.persona.goToSettings', {
                      defaultValue: 'Persona settings'
                    })}
                  </Button>
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
                  <div className="flex flex-wrap gap-2">
                    {personas.map((p) => (
                      <Button
                        key={p.id}
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-md px-3 text-xs"
                        onClick={() => setActiveTab('persona')}
                      >
                        <User className="mr-1.5 size-3.5" />
                        {p.name}
                      </Button>
                    ))}
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border/60 p-4">
                    {personas.length > 0 && (
                      <PersonaFilePreview
                        persona={personas[0]}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 4 removed — cold memory is stored in SQLite (memory_archive + FTS5), not file system */}
        </div>
      </div>
    </div>
  )
}