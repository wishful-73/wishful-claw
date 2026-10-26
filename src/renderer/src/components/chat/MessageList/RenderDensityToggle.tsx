/*
 * S-225：聊天窗内的渲染档位快捷入口。
 *
 * 与设置页那处改的是**同一个全局值**（`chatRenderDensity`），这里只是离手边近一点的通道。
 *
 * 落点选在助手回复导轨正上方而不是输入框上方 —— 老大 2026-10-26 上午明确说过
 * 「输入框上方需要显示的东西太多了」，再往那塞就是添乱。导轨本身只在 `items >= 2`
 * 时才渲染，所以本组件独立挂载，任何会话里都能用。
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, SlidersHorizontal } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useSettingsStore } from '@renderer/stores/settings-store'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@renderer/components/ui/popover'
import { CHAT_RENDER_DENSITIES } from '../render-density'

export function RenderDensityToggle(): React.JSX.Element {
  const { t } = useTranslation('chat')
  const chatRenderDensity = useSettingsStore((s) => s.chatRenderDensity)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  return (
    <div className="pointer-events-none absolute right-3 top-2 z-20 hidden md:block">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('messageList.renderDensity.open')}
            title={t('messageList.renderDensity.open')}
            className="pointer-events-auto flex size-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted/40 hover:text-foreground dark:hover:bg-white/[0.06]"
          >
            <SlidersHorizontal className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" side="bottom" className="w-64 p-1.5">
          <div className="px-2 pb-1.5 pt-1">
            <div className="text-xs font-medium">{t('messageList.renderDensity.title')}</div>
            <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              {t('messageList.renderDensity.desc')}
            </div>
          </div>
          <div className="space-y-0.5">
            {CHAT_RENDER_DENSITIES.map((item) => {
              const active = item === chatRenderDensity
              return (
                <button
                  key={item}
                  type="button"
                  aria-pressed={active}
                  onClick={() => updateSettings({ chatRenderDensity: item })}
                  className={cn(
                    'w-full rounded-md px-2 py-1.5 text-left transition-colors',
                    active
                      ? 'bg-muted/60 dark:bg-white/[0.07]'
                      : 'hover:bg-muted/40 dark:hover:bg-white/[0.05]'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        'text-xs',
                        active ? 'font-medium text-foreground' : 'text-foreground/80'
                      )}
                    >
                      {t(`general.appearance.renderDensity.options.${item}.name`, { ns: 'settings' })}
                    </span>
                    {active ? <Check className="size-3 shrink-0 text-primary" /> : null}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                    {t(`general.appearance.renderDensity.options.${item}.desc`, { ns: 'settings' })}
                  </div>
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
