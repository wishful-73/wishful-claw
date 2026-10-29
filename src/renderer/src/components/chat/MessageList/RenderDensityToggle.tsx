/*
 * S-225：聊天窗内的渲染档位快捷入口。
 *
 * 与设置页那处改的是**同一个全局值**（`chatRenderDensity`），这里只是离手边近一点的通道。
 *
 * 落点演进（这里栽过两次，别再走回头路）：
 *   1. 最早挂 `MessageList` 里，`absolute right-3 top-2 z-20` —— **被右上角会话操作块整个盖住**
 *      （`SessionConversationPane.tsx:204` 那块是 `right-3 top-3 z-30`，位置几乎重合）。
 *   2. 2026-10-27 我以为是图标不够显眼，把滑杆换成齿轮、去掉 60% 透明度 —— **没解决遮挡**。
 *      老大又报「在聊天窗没找到地方」，才定位到真因是层级 + 位置撞车。
 *   3. 现在：**按钮直接并进右上角那块操作集合**，弹层从竖直条左侧弹出。
 *      新增浮层必然要跟已有的抢位置，而这块本来就是会话级操作的集合，渲染档位属于同一类。
 *
 * 之所以不塞到输入框上方：老大 2026-10-26 明确说过「输入框上方需要显示的东西太多了」。
 *
 *   4. 2026-10-29 老大又说这块「打开以后呈现的内容太多了」—— 弹层里每档两行（名字 + 描述），
 *      三档就是 6 行，还顶着一条总述。改成**只列档位名，描述挂 title**（本项目 `ui/tooltip`
 *      就是原生 title 的包装，别为此引入 Radix）。
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Settings2 } from 'lucide-react'
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
  const label = t('messageList.renderDensity.open')

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings2 className="size-4" />
        </button>
      </PopoverTrigger>
      {/* side="left"：本组件住在贴着右边缘的竖直条里，向左右都不够位，必须往左弹 */}
      <PopoverContent align="start" side="left" className="w-40 p-1.5">
        <div className="px-2 pb-1 pt-1">
          {/* 总述挂 title：弹层常驻的只留标题一行，说明都在 hover 里 */}
          <div className="text-xs font-medium" title={t('messageList.renderDensity.desc')}>
            {t('messageList.renderDensity.title')}
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
                title={t(`general.renderDensity.options.${item}.desc`, { ns: 'settings' })}
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
                    {t(`general.renderDensity.options.${item}.name`, { ns: 'settings' })}
                  </span>
                  {active ? <Check className="size-3 shrink-0 text-primary" /> : null}
                </div>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
