import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { cn } from '@renderer/lib/utils'
import { BUILTIN_BROWSER_PARTITION, stripElectronFromUserAgent } from '@shared/browser-plugin'
import {
  closeFreeChatTab,
  openFreeChatTab,
  reconcileFreeChatTabs,
  restoreFreeChatTabs,
  type FreeChatTabs
} from './free-chat-tabs'

/**
 * Free Chat page (v2-iter-30 / S-27；多选项卡重做见 S-40).
 *
 * 顶部**一行**列出配置里的全部站点：没打开的显示成按钮，打开了的变成带 × 的选项卡。
 * 每个已打开的站点对应一个**常驻** webview —— 切换选项卡只改可见性，不销毁也不重载，
 * 所以页面状态与登录态都留在原地（这正是改成多选项卡的原因）。只有 × 掉才销毁。
 *
 * 分区**写死** `BUILTIN_BROWSER_PARTITION`，不再跟随「复用浏览器数据」设置：
 * 那个开关会让分区在默认 session 与独立分区之间摇摆，而两者是两套 cookie 存储，登录态会丢。
 * 登录由用户自己在页面内完成，应用只提供一个固定的浏览器目标。
 */
export function FreeChatPage(): React.JSX.Element {
  const { t } = useTranslation('layout')
  const closeFreeChatPage = useUIStore((s) => s.closeFreeChatPage)
  const sites = useSettingsStore((s) => s.freeChatSites)

  const [tabs, setTabs] = useState<FreeChatTabs>(() => {
    const availableIds = sites.map((site) => site.id)
    const restored = restoreFreeChatTabs(
      useSettingsStore.getState().freeChatOpenTabIds,
      useSettingsStore.getState().freeChatActiveTabId,
      availableIds
    )
    // 进页面时一个选项卡都没有就默认开第一个。
    // 只在挂载时判这一次 —— 用户手动全关掉之后，不该再被自动打开。
    if (restored.openIds.length > 0) return restored
    return availableIds[0] ? openFreeChatTab(restored, availableIds[0]) : restored
  })
  // UA 在外壳里必须洗成普通 Chromium，否则站点会把内置浏览器认成非标准客户端并拒绝登录。
  const [userAgent] = useState<string>(() => stripElectronFromUserAgent(navigator.userAgent))

  const webviewsRef = useRef(new Map<string, Electron.WebviewTag>())
  // ref 回调按站点缓存：内联箭头函数每次 render 都是新引用，会让 React 反复 detach/attach。
  const refCallbacksRef = useRef(new Map<string, (node: Electron.WebviewTag | null) => void>())

  const { openIds, activeId } = tabs
  const openIdSet = useMemo(() => new Set(openIds), [openIds])

  // 站点清单在设置里被改动：已失效的选项卡一并收掉（按关闭处理，就近顶替）。
  useEffect(() => {
    const availableIds = sites.map((site) => site.id)
    setTabs((current) => reconcileFreeChatTabs(current, availableIds))
  }, [sites])

  // 选项卡状态落盘，下次打开页面时恢复。
  useEffect(() => {
    useSettingsStore.getState().updateSettings({
      freeChatOpenTabIds: openIds,
      freeChatActiveTabId: activeId
    })
  }, [openIds, activeId])

  const handleOpenTab = useCallback((siteId: string): void => {
    setTabs((current) => openFreeChatTab(current, siteId))
  }, [])

  const handleCloseTab = useCallback((siteId: string): void => {
    setTabs((current) => closeFreeChatTab(current, siteId))
  }, [])

  const handleReload = useCallback((): void => {
    const view = webviewsRef.current.get(activeId)
    if (!view) return
    try {
      view.reload()
    } catch {
      // webview 还没 attach（首个文档仍在加载）时 reload 会抛，忽略即可。
    }
  }, [activeId])

  const getRefCallback = (siteId: string): ((node: Electron.WebviewTag | null) => void) => {
    const cached = refCallbacksRef.current.get(siteId)
    if (cached) return cached
    const callback = (node: Electron.WebviewTag | null): void => {
      if (node) webviewsRef.current.set(siteId, node)
      else webviewsRef.current.delete(siteId)
    }
    refCallbacksRef.current.set(siteId, callback)
    return callback
  }

  // 写死的分区 + 洗过的 UA：这两个都必须在 src 之前落到元素上。
  const webviewProps = {
    partition: BUILTIN_BROWSER_PARTITION,
    allowpopups: true,
    ...(userAgent ? { useragent: userAgent } : {})
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 一行：全部站点。开着的显示成选项卡（带 ×），没开的显示成按钮。无地址栏，按设计。 */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        <button
          type="button"
          onClick={closeFreeChatPage}
          title={t('freeChat.close', { defaultValue: '返回' })}
          aria-label={t('freeChat.close', { defaultValue: '返回' })}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sites.map((site) => {
            const isOpen = openIdSet.has(site.id)
            const isActive = isOpen && site.id === activeId

            if (!isOpen) {
              return (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => handleOpenTab(site.id)}
                  title={site.url}
                  className="h-6 shrink-0 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                >
                  {site.name}
                </button>
              )
            }

            return (
              <div
                key={site.id}
                className={cn(
                  'flex h-6 shrink-0 items-center rounded-md pl-2 pr-1 text-xs font-medium transition-colors',
                  isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
                )}
              >
                <button
                  type="button"
                  onClick={() => handleOpenTab(site.id)}
                  title={site.url}
                  className="max-w-[10rem] truncate"
                >
                  {site.name}
                </button>
                <button
                  type="button"
                  onClick={() => handleCloseTab(site.id)}
                  title={t('freeChat.tabClose', { defaultValue: '关闭' })}
                  aria-label={`${t('freeChat.tabClose', { defaultValue: '关闭' })} ${site.name}`}
                  className="ml-1 flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-background/60 hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          onClick={handleReload}
          disabled={!activeId}
          title={t('freeChat.reload', { defaultValue: '重新加载' })}
          aria-label={t('freeChat.reload', { defaultValue: '重新加载' })}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 bg-background">
        {/* 每个已打开的站点一个常驻 webview；非当前的只是不绘制，不销毁。 */}
        {sites.map((site) => {
          if (!openIdSet.has(site.id)) return null
          return (
            <webview
              key={site.id}
              {...webviewProps}
              ref={getRefCallback(site.id) as React.Ref<Electron.WebviewTag>}
              src={site.url}
              className={cn('absolute inset-0 size-full', site.id !== activeId && 'invisible')}
            />
          )
        })}

        {openIds.length === 0 && (
          <div className="flex size-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {sites.length === 0
              ? t('freeChat.empty', {
                  defaultValue: '尚未配置免费对话站点，请在「设置 → AI 服务 → 免费对话清单」中添加。'
                })
              : t('freeChat.noOpenTab', { defaultValue: '点击上方站点名称开始。' })}
          </div>
        )}
      </div>
    </div>
  )
}
