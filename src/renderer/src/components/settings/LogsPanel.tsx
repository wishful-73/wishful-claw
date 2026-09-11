import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Loader2, RefreshCw, ScrollText, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Input } from '@renderer/components/ui/input'
import { SettingsSection } from '@renderer/components/settings/settings-primitives'
import { confirm } from '@renderer/components/ui/confirm-dialog'
import { useSettingsStore } from '@renderer/stores/settings-store'
import type {
  LogCleanupResult,
  LogFileContent,
  LogFileInfo,
  LogLevel
} from '@shared/logging'

const LOG_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug']

const DEFAULT_CLEANUP_DAYS = 7
const MIN_CLEANUP_DAYS = 1
const MAX_CLEANUP_DAYS = 3650

type PreviewState = 'empty' | 'loading' | 'ok' | 'error'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Settings → Logs page: level config on top, daily-file viewer below.
 * Log content is only read when the user clicks a file — never on page
 * entry, and never polled in the background.
 */
export function LogsPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const logLevel = useSettingsStore((s) => s.logLevel)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const [files, setFiles] = useState<LogFileInfo[] | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<LogFileContent | null>(null)
  const [previewState, setPreviewState] = useState<PreviewState>('empty')
  const [cleanupDays, setCleanupDays] = useState(String(DEFAULT_CLEANUP_DAYS))
  const [cleaning, setCleaning] = useState(false)
  const loadSeq = useRef(0)

  const refreshList = useCallback(async (): Promise<LogFileInfo[]> => {
    setListLoading(true)
    try {
      const result = await window.api.invoke<LogFileInfo[]>('log:list-files', {})
      setFiles(Array.isArray(result) ? result : [])
      return Array.isArray(result) ? result : []
    } catch {
      setFiles(null)
      return []
    } finally {
      setListLoading(false)
    }
  }, [])

  // Load the file list once on entry; content stays unloaded until a click.
  useEffect(() => {
    void refreshList()
  }, [refreshList])

  const openFile = useCallback(async (name: string): Promise<void> => {
    const seq = ++loadSeq.current
    setSelected(name)
    setPreviewState('loading')
    setPreview(null)
    try {
      const result = await window.api.invoke<LogFileContent | null>('log:read-file', { name })
      if (seq !== loadSeq.current) return
      if (!result) {
        setPreviewState('error')
        return
      }
      setPreview(result)
      setPreviewState('ok')
    } catch {
      if (seq !== loadSeq.current) return
      setPreviewState('error')
    }
  }, [])

  const refreshCurrentFile = useCallback(async (): Promise<void> => {
    if (selected) await openFile(selected)
  }, [selected, openFile])

  const handleRefreshList = useCallback(async (): Promise<void> => {
    const next = await refreshList()
    // A manual list refresh may reveal the selected file is gone; keep the
    // preview but flag it so the user knows the source vanished.
    if (selected && !next.some((f) => f.name === selected)) {
      setPreviewState('error')
    }
  }, [refreshList, selected])

  const handleLevelChange = useCallback(
    (value: string): void => {
      updateSettings({ logLevel: value as LogLevel })
      toast.success(t('logsPage.level.saved'))
    },
    [updateSettings, t]
  )

  const handleCleanup = useCallback(async (): Promise<void> => {
    const days = Math.floor(Number(cleanupDays))
    if (!Number.isFinite(days) || days < MIN_CLEANUP_DAYS || days > MAX_CLEANUP_DAYS) {
      toast.error(t('logsPage.cleanup.invalidDays', { min: MIN_CLEANUP_DAYS, max: MAX_CLEANUP_DAYS }))
      return
    }
    const ok = await confirm({
      title: t('logsPage.cleanup.confirmTitle', { days }),
      description: t('logsPage.cleanup.confirmDesc', { days }),
      confirmText: t('logsPage.cleanup.confirm'),
      cancelText: t('logsPage.cleanup.cancel'),
      variant: 'destructive'
    })
    if (!ok) return
    setCleaning(true)
    try {
      const result = await window.api.invoke<LogCleanupResult>('log:cleanup', { days })
      const deleted = result?.deletedCount ?? 0
      const deletedNames = new Set(result?.deletedNames ?? [])
      if (deleted > 0) {
        toast.success(t('logsPage.cleanup.success', { count: deleted }))
      } else {
        toast.info(t('logsPage.cleanup.none'))
      }
      if (selected && deletedNames.has(selected)) {
        setSelected(null)
        setPreview(null)
        setPreviewState('empty')
        toast.info(t('logsPage.cleanup.previewCleared'))
      }
      await refreshList()
    } catch (error) {
      toast.error(t('logsPage.cleanup.failed', { error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setCleaning(false)
    }
  }, [cleanupDays, selected, refreshList, t])

  const parsedDays = Math.floor(Number(cleanupDays))
  const displayDays =
    Number.isFinite(parsedDays) && parsedDays >= MIN_CLEANUP_DAYS
      ? parsedDays
      : DEFAULT_CLEANUP_DAYS

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* ── Top: level config ── */}
      <div className="shrink-0 px-8 pt-8">
        <SettingsSection
          id="sec-logs-level"
          title={t('logsPage.level.title')}
          description={t('logsPage.level.desc')}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Select value={logLevel} onValueChange={handleLevelChange}>
              <SelectTrigger className="w-56" aria-label={t('logsPage.level.title')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOG_LEVELS.map((level) => (
                  <SelectItem key={level} value={level}>
                    {t(`logsPage.level.${level}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              {t(`logsPage.level.${logLevel}Desc`)}
            </p>
          </div>
        </SettingsSection>
      </div>

      {/* ── Bottom: viewer ── */}
      <div className="flex min-h-0 w-full flex-1 flex-col px-8 pb-8 pt-6">
        <div className="shrink-0 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ScrollText className="size-4" />
              {t('logsPage.viewer.title')}
            </h2>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={MIN_CLEANUP_DAYS}
                max={MAX_CLEANUP_DAYS}
                value={cleanupDays}
                onChange={(e) => setCleanupDays(e.target.value)}
                className="h-8 w-20"
                aria-label={t('logsPage.cleanup.days')}
              />
              <span className="shrink-0 text-xs text-muted-foreground">{t('logsPage.cleanup.unit')}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleCleanup()}
                disabled={cleaning}
              >
                {cleaning ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {t('logsPage.cleanup.button', { days: displayDays })}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleRefreshList()} disabled={listLoading}>
                {listLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                {t('logsPage.viewer.refresh')}
              </Button>
            </div>
          </div>
          <p className="pt-1.5 text-xs text-muted-foreground">{t('logsPage.cleanup.desc')}</p>
        </div>

        <div className="flex min-h-0 flex-1 gap-3">
          {/* Left: file list */}
          <div className="flex w-56 shrink-0 flex-col overflow-hidden rounded-lg border bg-background/60">
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {files === null ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">{t('logsPage.viewer.listError')}</p>
              ) : files.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">{t('logsPage.viewer.listEmpty')}</p>
              ) : (
                files.map((file) => (
                  <button
                    key={file.name}
                    onClick={() => void openFile(file.name)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                      selected === file.name
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                    }`}
                  >
                    <FileText className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/70">
                      {formatBytes(file.sizeBytes)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right: preview */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background/60">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
              <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
                {selected ?? t('logsPage.viewer.noSelection')}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => void refreshCurrentFile()}
                disabled={!selected || previewState === 'loading'}
                title={t('logsPage.viewer.refreshFile')}
              >
                {previewState === 'loading' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {previewState === 'empty' && (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-muted-foreground">{t('logsPage.viewer.empty')}</p>
                </div>
              )}
              {previewState === 'loading' && (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {previewState === 'error' && (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-destructive">{t('logsPage.viewer.readError')}</p>
                </div>
              )}
              {previewState === 'ok' && preview && (
                <div className="flex h-full flex-col">
                  {preview.truncated && (
                    <p className="shrink-0 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                      {t('logsPage.viewer.truncated')}
                    </p>
                  )}
                  <pre className="min-h-0 flex-1 whitespace-pre-wrap break-all p-3 font-mono text-xs leading-5">
                    {preview.content || t('logsPage.viewer.fileEmpty')}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
