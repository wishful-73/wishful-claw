import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Search, FileText, Archive, Database, RefreshCw, Layers, Clock, RotateCcw } from 'lucide-react'
import {
  memoryStats,
  memorySearch,
  memoryEntriesByStatus,
  memoryBatchStatus,
  type MemoryStats as MemoryStatsType,
  type MemorySearchResult,
  type MemoryStatusEntry
} from '../../stores/chat-store/memory-helpers'
import {
  readOrganizationReports,
  readOrganizationWatermark,
  runMemoryOrganization,
  restoreMemoryEntryToHot,
  type MemoryOrganizationReport
} from '../../lib/agent/memory-organization'
import { useSettingsStore } from '../../stores/settings-store'

interface MemoryPanelProps {
  workingFolder?: string | null
  projectId?: string | null
  sshConnectionId?: string | null
}

export function MemoryPanel({
  workingFolder,
  projectId,
  sshConnectionId
}: MemoryPanelProps): React.JSX.Element {
  const [stats, setStats] = React.useState<MemoryStatsType | null>(null)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [searchResults, setSearchResults] = React.useState<MemorySearchResult[]>([])
  const [searching, setSearching] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [organizing, setOrganizing] = React.useState(false)
  const [organizationNote, setOrganizationNote] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [organizationReports, setOrganizationReports] = React.useState<MemoryOrganizationReport[]>([])
  const [organizationWatermark, setOrganizationWatermark] = React.useState(0)
  const [tierEntries, setTierEntries] = React.useState<MemoryStatusEntry[]>([])
  const [tierLoading, setTierLoading] = React.useState(false)
  const [tierActionId, setTierActionId] = React.useState<number | null>(null)
  const settings = useSettingsStore()
  const { t } = useTranslation('layout')

  const scope = workingFolder ? 'project' : 'global'

  const refreshStats = React.useCallback(async () => {
    setLoading(true)
    try {
      const s = await memoryStats(scope, workingFolder, projectId, sshConnectionId)
      setStats(s)
    } catch (e) {
      console.error('Failed to load memory stats:', e)
    } finally {
      setLoading(false)
    }
  }, [scope, workingFolder, projectId, sshConnectionId])

  const refreshOrganizationData = React.useCallback(async () => {
    setTierLoading(true)
    try {
      const [reports, watermark, warm, cold] = await Promise.all([
        readOrganizationReports(),
        readOrganizationWatermark(),
        memoryEntriesByStatus('warm', scope, workingFolder, 200, projectId, sshConnectionId),
        memoryEntriesByStatus('cold', scope, workingFolder, 200, projectId, sshConnectionId)
      ])
      setOrganizationReports(reports)
      setOrganizationWatermark(watermark)
      setTierEntries([...(warm.entries ?? []), ...(cold.entries ?? [])])
    } catch (e) {
      console.error('Failed to load memory organization data:', e)
    } finally {
      setTierLoading(false)
    }
  }, [scope, workingFolder, projectId, sshConnectionId])

  React.useEffect(() => {
    void refreshStats()
    void refreshOrganizationData()
  }, [refreshStats, refreshOrganizationData])

  const handleSearch = React.useCallback(async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const result = await memorySearch(searchQuery, scope, 10, workingFolder, projectId, sshConnectionId)
      setSearchResults(result.hits || [])
    } catch (e) {
      console.error('Memory search failed:', e)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [searchQuery, scope, workingFolder, projectId, sshConnectionId])

  const handleRefresh = React.useCallback(async () => {
    await Promise.all([refreshStats(), refreshOrganizationData()])
  }, [refreshOrganizationData, refreshStats])

  const handleOrganize = React.useCallback(async () => {
    setOrganizing(true)
    setOrganizationNote(null)
    try {
      const report = await runMemoryOrganization({ trigger: 'manual' })
      if (!report) {
        setOrganizationNote({
          kind: 'error',
          text: t('memory.organizeBusy', { defaultValue: 'An organization run is already in progress.' })
        })
      } else if (report.error === 'missing_provider') {
        setOrganizationNote({
          kind: 'error',
          text: t('memory.organizeNoProvider', { defaultValue: 'Organization skipped: no usable text provider.' })
        })
      } else if (report.error) {
        setOrganizationNote({
          kind: 'error',
          text: t('memory.organizeFailed', { defaultValue: 'Memory organization failed.' })
        })
      } else {
        const organizedCount = report.scopes.filter((item) => item.organized).length
        setOrganizationNote({
          kind: 'ok',
          text: t('memory.organizeResult', {
            scopes: `${organizedCount}/${report.scopes.length}`,
            warm: report.demotedToWarm,
            cold: report.demotedToCold,
            defaultValue: 'Organized {{scopes}} scopes; {{warm}} demoted to warm, {{cold}} to cold.'
          })
        })
      }
      await Promise.all([refreshStats(), refreshOrganizationData()])
    } catch (e) {
      console.error('Memory organization failed:', e)
      setOrganizationNote({
        kind: 'error',
        text: t('memory.organizeFailed', { defaultValue: 'Memory organization failed.' })
      })
    } finally {
      setOrganizing(false)
    }
  }, [refreshOrganizationData, refreshStats, t])

  const handleRecover = React.useCallback(
    async (entry: MemoryStatusEntry) => {
      setTierActionId(entry.id)
      try {
        const nextStatus = entry.status === 'cold' ? 'warm' : 'active'
        if (nextStatus === 'active') {
          const hotError = await restoreMemoryEntryToHot({
            title: entry.title,
            content: entry.content,
            workingFolder,
            projectId,
            sshConnectionId
          })
          if (hotError) throw new Error(hotError)
        }
        const result = await memoryBatchStatus(
          [entry.id],
          nextStatus,
          true,
          scope,
          workingFolder,
          projectId,
          sshConnectionId
        )
        if (!result.ok) throw new Error(result.error ?? 'Memory recovery failed')
        await Promise.all([refreshStats(), refreshOrganizationData()])
      } catch (e) {
        console.error('Memory recovery failed:', e)
        setOrganizationNote({
          kind: 'error',
          text: t('memory.recoverFailed', { defaultValue: 'Memory recovery failed.' })
        })
      } finally {
        setTierActionId(null)
      }
    },
    [refreshOrganizationData, refreshStats, t, workingFolder, projectId, sshConnectionId]
  )

  const now = Date.now()
  const nextOrganizationAt =
    settings.memoryOrganizationSchedule === 'nightly'
      ? (() => {
          const [hours, minutes] = settings.memoryOrganizationNightlyTime.split(':').map(Number)
          const next = new Date(now)
          next.setHours(hours || 0, minutes || 0, 0, 0)
          if (next.getTime() <= now) next.setDate(next.getDate() + 1)
          return next.getTime()
        })()
      : null

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('memory.title', { defaultValue: 'Memory' })}</h2>
        <div className="flex gap-2">
          <button
            onClick={handleOrganize}
            disabled={organizing}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            title={t('memory.organize', { defaultValue: 'Organize memory now' })}
          >
            <Layers className="h-4 w-4" />
            {organizing
              ? t('memory.organizing', { defaultValue: 'Organizing...' })
              : t('memory.organize', { defaultValue: 'Organize now' })}
          </button>
          <button
            onClick={() => void handleRefresh()}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title={t('memory.refresh', { defaultValue: 'Refresh memory status' })}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {organizationNote && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            organizationNote.kind === 'ok'
              ? 'border-border text-muted-foreground'
              : 'border-destructive/40 text-destructive'
          }`}
        >
          {organizationNote.text}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard icon={<FileText className="h-4 w-4" />} label={t('memory.hot', { defaultValue: 'Hot' })} value={stats?.hotCount ?? 0} />
        <StatCard icon={<Archive className="h-4 w-4" />} label={t('memory.warm', { defaultValue: 'Warm' })} value={stats?.warmCount ?? 0} />
        <StatCard icon={<Database className="h-4 w-4" />} label={t('memory.cold', { defaultValue: 'Cold' })} value={stats?.coldCount ?? 0} />
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={t('memory.searchPlaceholder', { defaultValue: 'Search memory...' })}
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={searching || !searchQuery.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          {searching ? t('memory.searching', { defaultValue: '...' }) : t('memory.search', { defaultValue: 'Search' })}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border p-3 text-xs">
          <div className="mb-2 flex items-center gap-1.5 font-medium">
            <Clock className="h-4 w-4 text-muted-foreground" />
            {t('memory.organizationStatus', { defaultValue: 'Organization schedule' })}
          </div>
          <p className="text-muted-foreground">
            {t('memory.lastOrganized', { defaultValue: 'Last organized: ' })}
            {organizationWatermark ? formatMemoryTimestamp(organizationWatermark) : t('memory.never', { defaultValue: 'Never' })}
          </p>
          <p className="text-muted-foreground">
            {t('memory.nextOrganized', { defaultValue: 'Next: ' })}
            {!settings.memoryOrganizationEnabled
              ? t('memory.disabled', { defaultValue: 'Disabled' })
              : nextOrganizationAt
                ? formatMemoryTimestamp(nextOrganizationAt)
                : t('memory.onStartup', { defaultValue: 'After startup' })}
          </p>
        </div>
        <div className="rounded-md border border-border p-3 text-xs">
          <div className="mb-2 flex items-center gap-1.5 font-medium">
            <Layers className="h-4 w-4 text-muted-foreground" />
            {t('memory.recentReports', { defaultValue: 'Recent organization reports' })}
          </div>
          {organizationReports.length === 0 ? (
            <p className="text-muted-foreground">{t('memory.noReports', { defaultValue: 'No organization reports yet.' })}</p>
          ) : (
            <div className="space-y-1.5">
              {organizationReports.slice(0, 3).map((report) => (
                <div key={report.id} className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span className="truncate">{report.trigger} · {report.scopes.filter((item) => item.organized).length}/{report.scopes.length}</span>
                  <span className="shrink-0">{formatMemoryTimestamp(report.finishedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {tierEntries.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{t('memory.recoveryTitle', { defaultValue: 'Warm / Cold memory' })}</h3>
            {tierLoading && <span className="text-xs text-muted-foreground">{t('memory.loading', { defaultValue: 'Loading...' })}</span>}
          </div>
          <div className="max-h-56 space-y-2 overflow-y-auto">
            {tierEntries.map((entry) => (
              <div key={entry.id} className="rounded-md border border-border p-2.5 text-xs">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{entry.title || entry.content.slice(0, 80)}</span>
                  <span className="shrink-0 text-muted-foreground">{entry.status}</span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 whitespace-pre-wrap text-muted-foreground">{entry.content}</p>
                  <button
                    type="button"
                    onClick={() => void handleRecover(entry)}
                    disabled={tierActionId === entry.id}
                    className="shrink-0 rounded-md border border-border px-2 py-1 hover:bg-accent disabled:opacity-50"
                  >
                    <RotateCcw className="mr-1 inline h-3 w-3" />
                    {entry.status === 'cold'
                      ? t('memory.restoreWarm', { defaultValue: 'Restore warm' })
                      : t('memory.restoreHot', { defaultValue: 'Restore hot' })}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div className="flex-1 space-y-2 overflow-y-auto">
          <p className="text-xs text-muted-foreground">{t('memory.matches', { count: searchResults.length, defaultValue: '{{count}} matches' })}</p>
          {searchResults.map((hit, i) => (
            <div key={i} className="rounded-md border border-border p-3 text-sm">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">{hit.title}</span>
                <span className="text-xs text-muted-foreground">
                  {hit.tier} · {hit.scope === 'global' ? t('memory.scope.global', { defaultValue: 'global' }) : t('memory.scope.project', { defaultValue: 'project' })}
                </span>
              </div>
              <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">
                {hit.content.length > 200 ? hit.content.slice(0, 200) + '...' : hit.content}
              </p>
            </div>
          ))}
        </div>
      )}

      {searchResults.length === 0 && searchQuery && !searching && (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t('memory.noResults', { defaultValue: 'No matching memory entries found.' })}
        </div>
      )}

      {!searchQuery && tierEntries.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {loading ? t('memory.loading', { defaultValue: 'Loading...' }) : t('memory.idle', { defaultValue: 'Search memory or use memory tools in chat.' })}
        </div>
      )}
    </div>
  )
}

function formatMemoryTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(timestamp)
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }): React.JSX.Element {
  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-xl font-semibold">{value}</span>
    </div>
  )
}
