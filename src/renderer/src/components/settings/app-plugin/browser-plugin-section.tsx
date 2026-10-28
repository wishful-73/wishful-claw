import { useTranslation } from 'react-i18next'
import { DownloadCloud, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { toast } from 'sonner'
import { parseBrowserDomainList } from '@renderer/lib/app-plugin/browser-access'
import type { AppPluginInstance } from '@renderer/lib/app-plugin/types'
import {
  BROWSER_USER_DATA_SOURCES,
  type BrowserUserDataSource
} from '../../../../../shared/browser-plugin'
import type { BrowserEmulationStatus } from './types'

interface BrowserPluginSectionProps {
  selectedPlugin: AppPluginInstance
  browserUserDataReuseEnabled: boolean
  browserUserDataSource: BrowserUserDataSource
  browserEmulationStatus: BrowserEmulationStatus | null
  clearingCookies: boolean
  importingCookies: boolean
  onClearCookies: () => void
  onImportCookies: () => void
  updateSettings: (patch: {
    browserUserDataReuseEnabled?: boolean
    browserUserDataSource?: BrowserUserDataSource
  }) => void
  updatePlugin: (id: AppPluginInstance['id'], patch: Partial<AppPluginInstance>) => void
}

export function BrowserPluginSection({
  selectedPlugin,
  browserUserDataReuseEnabled,
  browserUserDataSource,
  browserEmulationStatus,
  clearingCookies,
  importingCookies,
  onClearCookies,
  onImportCookies,
  updateSettings,
  updatePlugin
}: BrowserPluginSectionProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const browserAllowedDomainText = (selectedPlugin.browserAllowedDomains ?? []).join('\n')
  const browserBlockedDomainText = (selectedPlugin.browserBlockedDomains ?? []).join('\n')

  return (
    <section className="space-y-4 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{t('plugin.browser.title')}</p>
          <p className="text-xs text-muted-foreground">{t('plugin.browser.desc')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={onImportCookies}
            disabled={importingCookies || !browserUserDataReuseEnabled}
          >
            <DownloadCloud className="size-3.5" />
            {importingCookies
              ? t('plugin.browser.importingCookies')
              : t('plugin.browser.importCookies')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={onClearCookies}
            disabled={clearingCookies}
          >
            <Trash2 className="size-3.5" />
            {clearingCookies
              ? t('plugin.browser.clearingCookies')
              : t('plugin.browser.clearCookies')}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/10 p-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">{t('plugin.browser.userDataReuse')}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('plugin.browser.userDataReuseDesc')}
            </p>
          </div>
          <Switch
            checked={browserUserDataReuseEnabled}
            onCheckedChange={(checked) => {
              updateSettings({ browserUserDataReuseEnabled: checked })
              toast.info(t('plugin.browser.restartRequired'))
            }}
          />
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center">
          <div>
            <p className="text-xs font-medium">{t('plugin.browser.userDataSource')}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('plugin.browser.userDataSourceDesc')}
            </p>
          </div>
          <Select
            value={browserUserDataSource}
            onValueChange={(value) => {
              updateSettings({ browserUserDataSource: value as BrowserUserDataSource })
              toast.info(t('plugin.browser.restartRequired'))
            }}
            disabled={!browserUserDataReuseEnabled}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BROWSER_USER_DATA_SOURCES.map((source) => (
                <SelectItem key={source} value={source} className="text-xs">
                  {t(`plugin.browser.sources.${source}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          {browserEmulationStatus?.usingDetectedBrowserProfile ? (
            <p>
              {t('plugin.browser.activeProfile', {
                browserName: browserEmulationStatus.browserName,
                profileName: browserEmulationStatus.browserProfileDisplayName,
                path: browserEmulationStatus.browserProfilePath
              })}
            </p>
          ) : (
            <p>{t('plugin.browser.profileFallback')}</p>
          )}
          {browserEmulationStatus?.browserSessionStoragePath ? (
            <p>
              {t('plugin.browser.isolatedStorage', {
                path: browserEmulationStatus.browserSessionStoragePath
              })}
            </p>
          ) : null}
          <p>{t('plugin.browser.restartRequired')}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="text-xs font-medium">{t('plugin.browser.blockedDomains')}</label>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('plugin.browser.blockedDomainsDesc')}
          </p>
          <Textarea
            className="mt-2 min-h-28 font-mono text-xs"
            placeholder={t('plugin.browser.domainPlaceholder')}
            value={browserBlockedDomainText}
            onChange={(event) =>
              updatePlugin(selectedPlugin.id, {
                browserBlockedDomains: parseBrowserDomainList(event.target.value)
              })
            }
          />
        </div>

        <div>
          <label className="text-xs font-medium">{t('plugin.browser.allowedDomains')}</label>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('plugin.browser.allowedDomainsDesc')}
          </p>
          <Textarea
            className="mt-2 min-h-28 font-mono text-xs"
            placeholder={t('plugin.browser.domainPlaceholder')}
            value={browserAllowedDomainText}
            onChange={(event) =>
              updatePlugin(selectedPlugin.id, {
                browserAllowedDomains: parseBrowserDomainList(event.target.value)
              })
            }
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground/80">{t('plugin.browser.domainRuleHint')}</p>
    </section>
  )
}
