import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import type { MemoryOrganizationReport } from '@renderer/lib/agent/memory-organization'
import { SettingsSection, SettingHint } from './settings-primitives'

/** Timestamp formatter matching the one MemoryPanel keeps locally. */
function formatMemoryTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(timestamp)
}

/**
 * The memory page's execution-log tab (iter-33 S-90): split out of MemorySettingsPanel so each page
 * holds one responsibility and both files stay under the 500-line budget. The inner scroll container
 * is gone on purpose — a dedicated tab scrolls with the page instead of in a 16rem box.
 */
function MemoryExecutionLogSection({
  reports
}: {
  reports: MemoryOrganizationReport[]
}): React.JSX.Element {
  const { t } = useTranslation('settings')

  return (
    <SettingsSection
      id="sec-memory-execution-log"
      title={t('memoryPage.executionLog.title')}
      description={t('memoryPage.executionLog.desc')}
    >
      {reports.length === 0 ? (
        <SettingHint>{t('memoryPage.executionLog.empty')}</SettingHint>
      ) : (
        <div className="space-y-1.5">
          {reports.map((report) => {
            const organized = report.scopes.filter((scope) => scope.organized).length
            const detail =
              report.error ??
              report.scopes.find((scope) => scope.error)?.error ??
              report.scopes.find((scope) => scope.skippedReason && !scope.organized)
                ?.skippedReason ??
              null
            return (
              <div
                key={report.id}
                className={cn(
                  'rounded-md border border-border p-2 text-xs',
                  detail && 'border-amber-500/40'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">
                    {t(`memoryPage.executionLog.trigger.${report.trigger}`, {
                      defaultValue: report.trigger
                    })}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatMemoryTimestamp(report.finishedAt)}
                  </span>
                </div>
                <p className="mt-0.5 text-muted-foreground/70">
                  {t('memoryPage.executionLog.progress', {
                    organized,
                    total: report.scopes.length
                  })}
                </p>
                {detail && (
                  <p
                    className="mt-0.5 truncate text-[10px] text-muted-foreground/70"
                    title={detail}
                  >
                    {detail}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </SettingsSection>
  )
}

export default MemoryExecutionLogSection
