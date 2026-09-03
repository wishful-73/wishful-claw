import { AlertTriangle, CheckCircle2, CircleSlash2, GitBranch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SessionContextManifest } from '@renderer/stores/chat-store/db-helpers'
import { cn } from '@renderer/lib/utils'

function formatPosition(createdAt: number | null, sortOrder: number | null): string {
  if (createdAt === null || sortOrder === null) return '—'
  return `${createdAt} / ${sortOrder}`
}

function formatSnapshotId(snapshotId: string | null): string {
  if (!snapshotId) return '—'
  return snapshotId.length > 16 ? `${snapshotId.slice(0, 16)}…` : snapshotId
}

function ContextRow({
  label,
  value,
  title,
  muted = false
}: {
  label: string
  value: React.ReactNode
  title?: string
  muted?: boolean
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs" title={title}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-right text-foreground/85',
          muted && 'text-muted-foreground/70'
        )}
      >
        {value}
      </span>
    </div>
  )
}

export function SessionContextManifestSection({
  manifest,
  loading,
  error
}: {
  manifest: SessionContextManifest | null
  loading: boolean
  error: string | null
}): React.JSX.Element {
  const { t } = useTranslation('layout')

  const sourceLabel = manifest
    ? manifest.restoreSource === 'snapshot'
      ? t('contextProgress.manifestSourceSnapshot')
      : manifest.restoreSource === 'blocked'
        ? t('contextProgress.manifestSourceBlocked')
        : t('contextProgress.manifestSourceFull')
    : '—'
  const statusClass = manifest?.restoreSource === 'blocked' ? 'text-red-500' : 'text-emerald-500'
  const statusIcon =
    manifest?.restoreSource === 'blocked' ? (
      <AlertTriangle className="size-3.5" />
    ) : manifest?.restoreSource === 'snapshot' ? (
      <CheckCircle2 className="size-3.5" />
    ) : (
      <CircleSlash2 className="size-3.5" />
    )

  return (
    <section className="space-y-2 border-t border-border/70 pt-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <GitBranch className="size-3.5" />
        <span>{t('contextProgress.manifestTitle')}</span>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">{t('contextProgress.manifestLoading')}</p>
      ) : error ? (
        <p className="text-xs text-red-500">
          {t('contextProgress.manifestUnavailable')}: {error}
        </p>
      ) : manifest ? (
        <div className="space-y-1.5">
          <ContextRow
            label={t('contextProgress.manifestSource')}
            value={
              <span className={cn('inline-flex items-center justify-end gap-1', statusClass)}>
                {statusIcon}
                {sourceLabel}
              </span>
            }
          />
          <ContextRow
            label={t('contextProgress.snapshotId')}
            value={formatSnapshotId(manifest.currentSnapshotId)}
            title={manifest.currentSnapshotId ?? undefined}
            muted={!manifest.currentSnapshotId}
          />
          <ContextRow
            label={t('contextProgress.contextRevision')}
            value={manifest.contextRevision}
          />
          <ContextRow
            label={t('contextProgress.cursor')}
            value={formatPosition(manifest.throughCreatedAt, manifest.throughSortOrder)}
          />
          <ContextRow
            label={t('contextProgress.contextMessages')}
            value={t('contextProgress.contextMessageCounts', {
              prefix: manifest.prefixMessageCount,
              incremental: manifest.incrementalMessageCount
            })}
          />
          {manifest.messagesSummarized !== null ? (
            <ContextRow
              label={t('contextProgress.messagesSummarized')}
              value={manifest.messagesSummarized}
            />
          ) : null}
          {manifest.failure ? (
            <p className="pt-1 text-xs text-red-500">
              {t('contextProgress.restoreBlocked')}: {manifest.failure.reason}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
