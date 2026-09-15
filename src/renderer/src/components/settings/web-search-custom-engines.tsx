import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { SettingsSection, SETTINGS_LIST_CLASS } from './settings-primitives'
import { INTENT_IDS, intentDisplayName } from '@renderer/lib/tools/browser-search/engines'
import type { CustomSearchEngine } from '@renderer/stores/settings-store-types'

interface Props {
  engines: CustomSearchEngine[]
  onChange: (engines: CustomSearchEngine[]) => void
}

const EMPTY_SELECTORS = { item: '', title: '', url: '', snippet: '' }

function createDraft(): CustomSearchEngine {
  return {
    id: `custom-${Date.now().toString(36)}`,
    name: '',
    enabled: true,
    intent: 'general',
    tier: 'basic',
    urlTemplate: '',
    renderMode: 'http',
    selectors: { ...EMPTY_SELECTORS }
  }
}

/**
 * Custom search engines (S-23.5).
 *
 * Two tiers, and deliberately only two. `basic` is a URL template parsed with the
 * generic h2/h3 heuristic and its hits are flagged low-confidence; `selector` adds
 * a fetch mode and CSS selectors for precise parsing. Handing the fetched HTML to
 * a model to parse is *not* a tier — it is slow, costly and unstable, so it is not
 * offered as a main path.
 */
export function WebSearchCustomEngines({ engines, onChange }: Props): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CustomSearchEngine | null>(null)

  const beginAdd = (): void => {
    const next = createDraft()
    setDraft(next)
    setEditingId(next.id)
  }

  const beginEdit = (engine: CustomSearchEngine): void => {
    setDraft({ ...engine, selectors: { ...engine.selectors } })
    setEditingId(engine.id)
  }

  const cancel = (): void => {
    setDraft(null)
    setEditingId(null)
  }

  const urlTemplateValid = Boolean(draft?.urlTemplate.includes('{query}'))
  const nameValid = Boolean(draft?.name.trim())
  const canSave = Boolean(draft) && urlTemplateValid && nameValid

  const save = (): void => {
    if (!draft || !canSave) return
    const trimmed: CustomSearchEngine = {
      ...draft,
      name: draft.name.trim(),
      urlTemplate: draft.urlTemplate.trim(),
      selectors: draft.tier === 'selector' ? draft.selectors : { ...EMPTY_SELECTORS }
    }
    const exists = engines.some((engine) => engine.id === trimmed.id)
    onChange(exists ? engines.map((engine) => (engine.id === trimmed.id ? trimmed : engine)) : [...engines, trimmed])
    cancel()
  }

  const remove = (id: string): void => {
    onChange(engines.filter((engine) => engine.id !== id))
    if (editingId === id) cancel()
  }

  const setEnabled = (id: string, enabled: boolean): void => {
    onChange(engines.map((engine) => (engine.id === id ? { ...engine, enabled } : engine)))
  }

  return (
    <SettingsSection
      id="sec-web-search-custom"
      title={t('webSearch.custom.title')}
      description={t('webSearch.custom.desc')}
      actions={
        <Button size="sm" variant="outline" onClick={beginAdd} disabled={draft !== null}>
          <Plus className="size-3.5" />
          {t('webSearch.custom.add')}
        </Button>
      }
    >
      {engines.length === 0 && !draft ? (
        <p className="text-xs text-muted-foreground">{t('webSearch.custom.empty')}</p>
      ) : null}

      <div className={SETTINGS_LIST_CLASS}>
        {engines.map((engine) => (
          <div key={engine.id} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{engine.name || engine.id}</span>
                <Badge variant="outline">
                  {engine.tier === 'selector'
                    ? t('webSearch.custom.tierSelectorShort')
                    : t('webSearch.custom.tierBasicShort')}
                </Badge>
                <Badge variant="secondary">{intentDisplayName(engine.intent)}</Badge>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">{engine.urlTemplate}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Switch checked={engine.enabled} onCheckedChange={(value) => setEnabled(engine.id, value)} />
              <Button size="sm" variant="ghost" onClick={() => beginEdit(engine)}>
                {t('webSearch.custom.edit')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('webSearch.custom.remove')}
                onClick={() => remove(engine.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {draft ? (
        <div className="space-y-4 rounded-lg border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium">{t('webSearch.custom.name')}</span>
              <Input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder={t('webSearch.custom.namePlaceholder')}
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-medium">{t('webSearch.custom.intent')}</span>
              <Select
                value={draft.intent}
                onValueChange={(value) => setDraft({ ...draft, intent: value })}
              >
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTENT_IDS.map((intent) => (
                    <SelectItem key={intent} value={intent} className="text-xs">
                      {intentDisplayName(intent)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="space-y-1.5 sm:col-span-2">
              <span className="text-xs font-medium">{t('webSearch.custom.urlTemplate')}</span>
              <Input
                value={draft.urlTemplate}
                onChange={(event) => setDraft({ ...draft, urlTemplate: event.target.value })}
                placeholder="https://example.com/search?q={query}"
                aria-invalid={draft.urlTemplate.length > 0 && !urlTemplateValid}
              />
              <span
                className={
                  draft.urlTemplate.length > 0 && !urlTemplateValid
                    ? 'text-[11px] text-destructive'
                    : 'text-[11px] text-muted-foreground'
                }
              >
                {t('webSearch.custom.urlTemplateHint')}
              </span>
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-medium">{t('webSearch.custom.tier')}</span>
              <Select
                value={draft.tier}
                onValueChange={(value) =>
                  setDraft({ ...draft, tier: value as CustomSearchEngine['tier'] })
                }
              >
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="basic" className="text-xs">
                    {t('webSearch.custom.tierBasic')}
                  </SelectItem>
                  <SelectItem value="selector" className="text-xs">
                    {t('webSearch.custom.tierSelector')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-medium">{t('webSearch.custom.renderMode')}</span>
              <Select
                value={draft.renderMode}
                onValueChange={(value) =>
                  setDraft({ ...draft, renderMode: value as CustomSearchEngine['renderMode'] })
                }
              >
                <SelectTrigger className="text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http" className="text-xs">
                    {t('webSearch.badges.http')}
                  </SelectItem>
                  <SelectItem value="rendered" className="text-xs">
                    {t('webSearch.badges.rendered')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>

          {draft.tier === 'basic' ? (
            <p className="text-[11px] text-muted-foreground">{t('webSearch.custom.tierBasicHint')}</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {(['item', 'title', 'url', 'snippet'] as const).map((field) => (
                <label key={field} className="space-y-1.5">
                  <span className="text-xs font-medium">
                    {t(`webSearch.custom.selectors.${field}`)}
                  </span>
                  <Input
                    value={draft.selectors[field]}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        selectors: { ...draft.selectors, [field]: event.target.value }
                      })
                    }
                    placeholder={t(`webSearch.custom.selectors.${field}Placeholder`)}
                  />
                </label>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs">
              <Switch
                checked={draft.enabled}
                onCheckedChange={(value) => setDraft({ ...draft, enabled: value })}
              />
              {t('webSearch.custom.enabled')}
            </label>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={cancel}>
                {t('webSearch.custom.cancel')}
              </Button>
              <Button size="sm" disabled={!canSave} onClick={save}>
                {t('webSearch.custom.save')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </SettingsSection>
  )
}
