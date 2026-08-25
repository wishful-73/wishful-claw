import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  Clock,
  FileText,
  FolderOpen,
  Loader2,
  RefreshCw,
  Save,
  Terminal,
  User
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { useChatStore } from '@renderer/stores/chat-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { cn } from '@renderer/lib/utils'

import {
  type ArchiveTabId,
  type FileState,
  type PersonaSummary,
  type SshConnectionInfo,
  WISHFUL_CLAW_DIR,
  PERSONA_FILE_NAMES,
  DEFAULT_MEMORY_TEMPLATE,
  DEFAULT_DAILY_TEMPLATE,
  joinFsPath,
  getTodayDate,
  getHomeDir,
  readTextFile,
  writeTextFile,
  listDir
} from './project-archive-helpers'
import { PersonaFilePreview } from './PersonaFilePreview'
import { CodeGraphProjectIndexSection } from './codegraph-project-index'


const MEMORY_TABS: { id: ArchiveTabId; icon: typeof FileText; i18nKey: string }[] = [
  { id: 'memory', icon: FileText, i18nKey: 'projectArchive.tabs.memory' },
  { id: 'daily', icon: Clock, i18nKey: 'projectArchive.tabs.daily' },
  { id: 'persona', icon: User, i18nKey: 'projectArchive.tabs.persona' }
]

export function ProjectArchivePage(): React.JSX.Element {
  const { t } = useTranslation('chat')
  const { t: tCommon } = useTranslation('common')

  const activeProjectId = useChatStore((s) => s.activeProjectId)
  const projects = useChatStore((s) => s.projects)
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null

  const [activeTab, setActiveTab] = useState<ArchiveTabId>('memory')
  const [memoryFile, setMemoryFile] = useState<FileState>({
    path: '',
    savedContent: '',
    draftContent: '',
    loading: true,
    saving: false,
    missingFile: true,
    error: null
  })
  const [dailyFile, setDailyFile] = useState<FileState>({
    path: '',
    savedContent: '',
    draftContent: '',
    loading: true,
    saving: false,
    missingFile: true,
    error: null
  })
  const [personas, setPersonas] = useState<PersonaSummary[]>([])
  const [personasLoading, setPersonasLoading] = useState(false)
  // unused: dormant files are stored in SQLite, not filesystem

  const sshConnectionId = activeProject?.sshConnectionId
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
  const dailyPath = useMemo(
    () => (memoryRoot ? joinFsPath(memoryRoot, 'memory', 'daily', `${getTodayDate()}.md`) : ''),
    [memoryRoot]
  )
  const personasDir = useMemo(
    () => (memoryRoot ? joinFsPath(memoryRoot, 'personas') : ''),
    [memoryRoot]
  )
  // Cold memory: stored in SQLite (memory_archive + FTS5), not file system

  // ─── Load memory file ───

  const loadMemoryFile = useCallback(async () => {
    if (!memoryPath) {
      setMemoryFile((prev) => ({ ...prev, loading: false, path: '' }))
      return
    }
    setMemoryFile((prev) => ({ ...prev, loading: true, path: memoryPath, error: null }))
    const result = await readTextFile(memoryPath)
    if (result.error) {
      // ENOENT — file doesn't exist yet
      const isMissing = result.error.toLowerCase().includes('no such') || result.error.toLowerCase().includes('enotfound') || result.error.toLowerCase().includes('找不到')
      setMemoryFile({
        path: memoryPath,
        savedContent: isMissing ? DEFAULT_MEMORY_TEMPLATE : '',
        draftContent: isMissing ? DEFAULT_MEMORY_TEMPLATE : '',
        loading: false,
        saving: false,
        missingFile: isMissing,
        error: isMissing ? null : result.error
      })
    } else {
      setMemoryFile({
        path: memoryPath,
        savedContent: result.content ?? '',
        draftContent: result.content ?? '',
        loading: false,
        saving: false,
        missingFile: false,
        error: null
      })
    }
  }, [memoryPath])

  // ─── Load daily file ───

  const loadDailyFile = useCallback(async () => {
    if (!dailyPath) {
      setDailyFile((prev) => ({ ...prev, loading: false, path: '' }))
      return
    }
    setDailyFile((prev) => ({ ...prev, loading: true, path: dailyPath, error: null }))
    const result = await readTextFile(dailyPath)
    if (result.error) {
      const isMissing = result.error.toLowerCase().includes('no such') || result.error.toLowerCase().includes('enotfound') || result.error.toLowerCase().includes('找不到')
      setDailyFile({
        path: dailyPath,
        savedContent: isMissing ? DEFAULT_DAILY_TEMPLATE : '',
        draftContent: isMissing ? DEFAULT_DAILY_TEMPLATE : '',
        loading: false,
        saving: false,
        missingFile: isMissing,
        error: isMissing ? null : result.error
      })
    } else {
      setDailyFile({
        path: dailyPath,
        savedContent: result.content ?? '',
        draftContent: result.content ?? '',
        loading: false,
        saving: false,
        missingFile: false,
        error: null
      })
    }
  }, [dailyPath])

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
    void loadMemoryFile()
  }, [loadMemoryFile])

  useEffect(() => {
    if (activeTab === 'daily') void loadDailyFile()
  }, [activeTab, loadDailyFile])

  useEffect(() => {
    if (activeTab === 'persona') void loadPersonas()
  }, [activeTab, loadPersonas])

  // Dormant memory tab removed — cold memory is stored in SQLite, accessed via memory/search

  // ─── Save handler ───

  const handleSave = useCallback(async () => {
    const file = activeTab === 'memory' ? memoryFile : dailyFile
    if (!file.path) return

    const setter = activeTab === 'memory' ? setMemoryFile : setDailyFile
    setter((prev) => ({ ...prev, saving: true, error: null }))

    const err = await writeTextFile(file.path, file.draftContent)
    if (err) {
      setter((prev) => ({ ...prev, saving: false, error: err }))
      toast.error(t('projectArchive.saveFailed', { defaultValue: 'Failed to save' }), {
        description: err
      })
    } else {
      setter((prev) => ({
        ...prev,
        saving: false,
        savedContent: prev.draftContent,
        missingFile: false,
        error: null
      }))
      toast.success(t('projectArchive.saved', { defaultValue: 'Saved' }))
    }
  }, [activeTab, memoryFile, dailyFile, t])

  // ─── Reset handler ───

  const handleReset = useCallback(() => {
    if (activeTab === 'memory') {
      setMemoryFile((prev) => ({ ...prev, draftContent: prev.savedContent, error: null }))
    } else {
      setDailyFile((prev) => ({ ...prev, draftContent: prev.savedContent, error: null }))
    }
  }, [activeTab])

  // ─── Reload current tab ───

  const handleReload = useCallback(() => {
    switch (activeTab) {
      case 'memory':
        void loadMemoryFile()
        break
      case 'daily':
        void loadDailyFile()
        break
      case 'persona':
        void loadPersonas()
        break
    }
  }, [activeTab, loadMemoryFile, loadDailyFile, loadPersonas])

  // ─── Derived state ───

  const activeFile = activeTab === 'memory' ? memoryFile : dailyFile
  const hasUnsavedChanges = activeFile.draftContent !== activeFile.savedContent
  const canSave = activeFile.missingFile || hasUnsavedChanges
  const isLoading =
    activeTab === 'memory'
      ? memoryFile.loading
      : activeTab === 'daily'
        ? dailyFile.loading
        : personasLoading

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
          {/* Tab 1: Project Memory / Tab 2: Daily Memory */}
          {(activeTab === 'memory' || activeTab === 'daily') && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <FileText className="size-4 shrink-0" />
                  <span className="truncate text-xs">{activeFile.path || t('projectArchive.pathUnavailable', { defaultValue: 'Path unavailable' })}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {activeFile.missingFile && (
                    <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                      {t('projectArchive.notCreated', { defaultValue: 'Not yet created' })}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {hasUnsavedChanges
                      ? t('projectArchive.unsavedState', { defaultValue: 'Unsaved changes' })
                      : t('projectArchive.savedState', { defaultValue: 'Content synced' })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-md px-2.5 text-xs"
                    onClick={handleReset}
                    disabled={!hasUnsavedChanges}
                  >
                    {t('projectArchive.resetAction', { defaultValue: 'Reset' })}
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 rounded-md px-2.5 text-xs"
                    onClick={() => void handleSave()}
                    disabled={activeFile.saving || !canSave}
                  >
                    {activeFile.saving ? (
                      <Loader2 className="mr-1 size-3 animate-spin" />
                    ) : (
                      <Save className="mr-1 size-3" />
                    )}
                    {tCommon('action.save', { defaultValue: 'Save' })}
                  </Button>
                </div>
              </div>

              {activeFile.missingFile && (
                <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                  {t('projectArchive.missingFileHint', {
                    defaultValue: 'File does not exist yet. An initial template has been loaded — click Save to create it.'
                  })}
                </p>
              )}

              <div className="mt-3 flex-1 overflow-auto">
                {activeFile.loading ? (
                  <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {t('projectArchive.loading', { defaultValue: 'Loading...' })}
                  </div>
                ) : (
                  <Textarea
                    value={activeFile.draftContent}
                    onChange={(e) => {
                      const value = e.target.value
                      if (activeTab === 'memory') {
                        setMemoryFile((prev) => ({ ...prev, draftContent: value }))
                      } else {
                        setDailyFile((prev) => ({ ...prev, draftContent: value }))
                      }
                    }}
                    placeholder={t('projectArchive.placeholder', {
                      defaultValue: 'Edit content here...'
                    })}
                    rows={24}
                    className="min-h-[480px] w-full rounded-md border-border/60 bg-background font-mono text-xs leading-5"
                  />
                )}
              </div>

              {activeFile.error && (
                <div className="border-t px-5 py-3 text-sm text-destructive">
                  {t('projectArchive.errorLabel', { defaultValue: 'Error: ' })}
                  {activeFile.error}
                </div>
              )}
            </div>
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