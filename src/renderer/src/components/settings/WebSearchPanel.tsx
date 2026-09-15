import { useTranslation } from 'react-i18next'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { SettingRow, SettingsSection, SETTINGS_LIST_CLASS } from './settings-primitives'
import { WebSearchCustomEngines } from './web-search-custom-engines'
import { useSettingsStore } from '@renderer/stores/settings-store'
import {
  BUILTIN_ENGINES,
  BUILTIN_ENGINE_IDS,
  INTENT_IDS,
  MAX_SEARCH_RESULTS,
  MIN_SEARCH_RESULTS,
  clampSearchMaxResults,
  engineDisplayName,
  intentDisplayName,
  isIntentCustomized,
  resetIntentEngines,
  resolveIntentEngines,
  toggleEnabledEngine,
  toggleIntentEngine
} from '@renderer/lib/tools/browser-search/engines'
import type { BrowserSearchSettings } from '@renderer/stores/settings-store-types'

/**
 * Web search settings (iter-29 / S-23.4).
 *
 * This panel is the only place the search engine set is configured. Before S-23
 * the configurable search was the API-backed WebSearch chain — which had no UI at
 * all — while the scraper the agent actually used was hard-wired. Both halves are
 * now one: the built-in engine switches below decide what the agent may query.
 */
export function WebSearchPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const browserSearch = useSettingsStore((state) => state.browserSearch)
  const updateSettings = useSettingsStore((state) => state.updateSettings)

  const patch = (partial: Partial<BrowserSearchSettings>): void => {
    updateSettings({ browserSearch: { ...browserSearch, ...partial } })
  }

  const isEngineEnabled = (id: string): boolean => browserSearch.enabledEngineIds.includes(id)
  const enabledCount = BUILTIN_ENGINE_IDS.filter(isEngineEnabled).length

  const setMaxResults = (raw: string): void => {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isNaN(parsed)) return
    patch({ maxResults: clampSearchMaxResults(parsed) })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t('webSearch.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('webSearch.subtitle')}</p>
      </div>

      <SettingsSection
        id="sec-web-search-routing"
        title={t('webSearch.routing.title')}
        description={t('webSearch.routing.desc')}
      >
        <SettingRow
          label={t('webSearch.autoRoute.label')}
          description={t('webSearch.autoRoute.desc')}
          control={
            <Switch
              checked={browserSearch.autoRoute}
              onCheckedChange={(value) => patch({ autoRoute: value })}
            />
          }
        />
        <SettingRow
          label={t('webSearch.maxResults.label')}
          description={t('webSearch.maxResults.desc')}
          control={
              <Input
                type="number"
                min={MIN_SEARCH_RESULTS}
                max={MAX_SEARCH_RESULTS}
              className="w-24 text-xs"
              value={browserSearch.maxResults}
              onChange={(event) => setMaxResults(event.target.value)}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        id="sec-web-search-engines"
        title={t('webSearch.engines.title')}
        description={t('webSearch.engines.desc', { enabled: enabledCount })}
      >
        <div className={SETTINGS_LIST_CLASS}>
          {BUILTIN_ENGINE_IDS.map((id) => {
            const engine = BUILTIN_ENGINES[id]
            if (!engine) return null
            const enabled = isEngineEnabled(id)
            return (
              <div key={id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{engineDisplayName(engine)}</span>
                    <Badge variant="outline">{t(`webSearch.types.${engine.type}`)}</Badge>
                    <Badge variant={engine.renderMode === 'rendered' ? 'secondary' : 'outline'}>
                      {engine.renderMode === 'rendered'
                        ? t('webSearch.badges.rendered')
                        : t('webSearch.badges.http')}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{engine.searchUrl}</p>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={(value) =>
                    patch({ enabledEngineIds: toggleEnabledEngine(browserSearch.enabledEngineIds, id, value) })
                  }
                />
              </div>
            )
          })}
        </div>
        {enabledCount === 0 ? (
          <p className="text-xs text-muted-foreground">{t('webSearch.engines.noneEnabled')}</p>
        ) : null}
      </SettingsSection>

      <SettingsSection
        id="sec-web-search-intents"
        title={t('webSearch.intents.title')}
        description={t('webSearch.intents.desc')}
      >
        <div className={SETTINGS_LIST_CLASS}>
          {INTENT_IDS.map((intent) => {
            const routed = resolveIntentEngines(browserSearch.intentEngines, intent)
            const customized = isIntentCustomized(browserSearch.intentEngines, intent)
            return (
              <div key={intent} className="space-y-2 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{intentDisplayName(intent)}</span>
                    <Badge variant={customized ? 'default' : 'outline'}>
                      {customized
                        ? t('webSearch.intents.customized')
                        : t('webSearch.intents.byDefault')}
                    </Badge>
                  </div>
                  {customized ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        patch({
                          intentEngines: resetIntentEngines(browserSearch.intentEngines, intent)
                        })
                      }
                    >
                      {t('webSearch.intents.reset')}
                    </Button>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {BUILTIN_ENGINE_IDS.map((id) => {
                    const engine = BUILTIN_ENGINES[id]
                    if (!engine) return null
                    const active = routed.includes(id)
                    const globallyEnabled = isEngineEnabled(id)
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() =>
                          patch({
                            intentEngines: toggleIntentEngine(
                              browserSearch.intentEngines,
                              intent,
                              id
                            )
                          })
                        }
                        className={[
                          'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                          active
                            ? 'border-primary/40 bg-primary/10 text-foreground'
                            : 'border-border text-muted-foreground hover:border-foreground/20',
                          globallyEnabled ? '' : 'opacity-50'
                        ].join(' ')}
                        title={
                          globallyEnabled ? undefined : t('webSearch.intents.engineDisabledGlobally')
                        }
                      >
                        {engineDisplayName(engine)}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">{t('webSearch.intents.fallbackHint')}</p>
      </SettingsSection>

      <WebSearchCustomEngines
        engines={browserSearch.customEngines}
        onChange={(customEngines) => patch({ customEngines })}
      />
    </div>
  )
}
