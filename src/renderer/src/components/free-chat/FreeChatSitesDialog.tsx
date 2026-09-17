import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Plus, RotateCcw, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { DEFAULT_FREE_CHAT_SITES, useSettingsStore } from '@renderer/stores/settings-store'
import type { FreeChatSite } from '@renderer/stores/settings-store-types'
import { moveFreeChatSite, type FreeChatSiteMoveDirection } from './free-chat-sites'

/** 用户可能只敲了主机名，补上 https:// 前缀。 */
function normalizeFreeChatUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function createFreeChatSiteId(): string {
  return `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

interface FreeChatSitesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 免费对话站点清单（v2-iter-30）。
 *
 * 原先挂在「设置 → AI 服务 → 免费对话」，但它只服务于免费对话页 ——
 * 配置项跟作用对象待在一起更好找，所以挪进页面内的设置弹窗（老大 2026-09-16 定）。
 */
export function FreeChatSitesDialog({
  open,
  onOpenChange
}: FreeChatSitesDialogProps): React.JSX.Element {
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

  const handleMove = (id: string, direction: FreeChatSiteMoveDirection): void => {
    const next = moveFreeChatSite(sites, id, direction)
    // 已在首位/末位时原样返回同一个引用 —— 没有变化就不写盘。
    if (next === sites) return
    updateSettings({ freeChatSites: next })
  }

  const handleReset = (): void => {
    updateSettings({ freeChatSites: [...DEFAULT_FREE_CHAT_SITES] })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('freeChatPage.title', { defaultValue: '免费对话' })}</DialogTitle>
          <DialogDescription>
            {t('freeChatPage.description', {
              defaultValue: '管理免费对话页可切换的站点，登录请在页面内自行完成。'
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="mr-1 size-3.5" />
            {t('freeChatPage.reset', { defaultValue: '恢复默认' })}
          </Button>
          <Button size="sm" onClick={handleAdd} disabled={!canAdd}>
            <Plus className="mr-1 size-3.5" />
            {t('freeChatPage.add', { defaultValue: '添加' })}
          </Button>
        </div>

        {sites.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('freeChatPage.empty', { defaultValue: '清单为空，免费对话页将没有可切换的站点。' })}
          </p>
        ) : (
          <ul className="max-h-[45vh] divide-y divide-border/60 overflow-y-auto rounded-lg border border-border/60">
            {sites.map((site, index) => (
              <li key={site.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-24 shrink-0 truncate text-sm font-medium">{site.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {site.url}
                </span>
                {/* 顺序即免费对话页选项卡的排列顺序（那一页直接 sites.map 渲染），
                    所以这里挪一格就够了，页面自己会跟着变。 */}
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => handleMove(site.id, 'up')}
                    disabled={index === 0}
                    title={t('freeChatPage.moveUp', { defaultValue: '上移' })}
                    aria-label={`${t('freeChatPage.moveUp', { defaultValue: '上移' })} ${site.name}`}
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMove(site.id, 'down')}
                    disabled={index === sites.length - 1}
                    title={t('freeChatPage.moveDown', { defaultValue: '下移' })}
                    aria-label={`${t('freeChatPage.moveDown', { defaultValue: '下移' })} ${site.name}`}
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(site.id)}
                  title={t('freeChatPage.remove', { defaultValue: '删除' })}
                  aria-label={`${t('freeChatPage.remove', { defaultValue: '删除' })} ${site.name}`}
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
            className="h-8 w-32 text-xs"
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
      </DialogContent>
    </Dialog>
  )
}
