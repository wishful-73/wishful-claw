import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  DEFAULT_FREE_CHAT_SITES,
  useSettingsStore
} from '@renderer/stores/settings-store'
import type { FreeChatSite } from '@renderer/stores/settings-store-types'
import { SettingsSection } from './settings-primitives'

/** Prepend https:// when the user typed a bare host. */
function normalizeFreeChatUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function createFreeChatSiteId(): string {
  return `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Free Chat site list (v2-iter-30 / S-27). Drives the site switcher on the
 * Free Chat page; the list ships with defaults but is fully user-editable.
 */
export function FreeChatSettingsPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const sites = useSettingsStore((s) => s.freeChatSites)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const [draftName, setDraftName] = useState('')
  const [draftUrl, setDraftUrl] = useState('')

  const canAdd = draftName.trim().length > 0 && draftUrl.trim().length > 0

  const handleAdd = (): void => {
    if (!canAdd) return
    const next: FreeChatSite[] = [
      ...sites,
      {
        id: createFreeChatSiteId(),
        name: draftName.trim(),
        url: normalizeFreeChatUrl(draftUrl)
      }
    ]
    updateSettings({ freeChatSites: next })
    setDraftName('')
    setDraftUrl('')
  }

  const handleRemove = (id: string): void => {
    updateSettings({ freeChatSites: sites.filter((site) => site.id !== id) })
  }

  const handleReset = (): void => {
    updateSettings({ freeChatSites: [...DEFAULT_FREE_CHAT_SITES] })
  }

  return (
    <SettingsSection
      id="sec-free-chat-sites"
      title={t('freeChatPage.title', { defaultValue: '免费对话清单' })}
      description={t('freeChatPage.description', {
        defaultValue:
          '侧栏「新对话」右侧的按钮会打开免费对话页，这里配置该页可切换的站点。登录请在页面内自行完成。'
      })}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="mr-1 size-3.5" />
            {t('freeChatPage.reset', { defaultValue: '恢复默认' })}
          </Button>
          <Button size="sm" onClick={handleAdd} disabled={!canAdd}>
            <Plus className="mr-1 size-3.5" />
            {t('freeChatPage.add', { defaultValue: '添加' })}
          </Button>
        </>
      }
    >
      {sites.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('freeChatPage.empty', { defaultValue: '清单为空，免费对话页将没有可切换的站点。' })}
        </p>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
          {sites.map((site) => (
            <li key={site.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-28 shrink-0 truncate text-sm font-medium">{site.name}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {site.url}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(site.id)}
                title={t('freeChatPage.remove', { defaultValue: '删除' })}
                aria-label={t('freeChatPage.remove', { defaultValue: '删除' })}
                className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          placeholder={t('freeChatPage.namePlaceholder', { defaultValue: '名称' })}
          className="h-8 w-36 text-xs"
        />
        <Input
          value={draftUrl}
          onChange={(event) => setDraftUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleAdd()
          }}
          placeholder={t('freeChatPage.urlPlaceholder', { defaultValue: 'https://example.com' })}
          className="h-8 min-w-0 flex-1 text-xs"
        />
      </div>
    </SettingsSection>
  )
}
