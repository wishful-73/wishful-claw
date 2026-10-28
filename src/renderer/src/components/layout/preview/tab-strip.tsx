/**
 * 预览面板的顶部两条：标签条（含新建菜单、浏览器/产物入口、收起面板）与无标签时的空态顶栏。
 *
 * S-250 从 `PreviewPanel.tsx` 搬出，JSX 与类名逐字平移。两处「新建」菜单在原文件里就是
 * 各自内联的，这里保持原样，不新增抽象。
 */

import { useTranslation } from 'react-i18next'
import { FileOutput, FolderOpen, Globe, PanelRightClose, Plus, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { cn } from '@renderer/lib/utils'
import { TabIcon, tabPathTitle, tabTitle } from '../preview-utils'

export function PreviewEmptyState({
  showTabStrip,
  onOpenLocalFiles,
  onClosePanel
}: {
  showTabStrip: boolean
  onOpenLocalFiles: () => Promise<void>
  onClosePanel: () => void
}): React.JSX.Element {
  const { t } = useTranslation('layout')

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {showTabStrip ? (
        <div className="flex h-10 shrink-0 items-center justify-end border-b border-border/50 px-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7">
                <Plus className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => void onOpenLocalFiles()}>
                <FolderOpen className="size-4" />
                {t('preview.openFile', { defaultValue: 'Open file' })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            onClick={onClosePanel}
            title={t('rightPanelAction.closePanel', { defaultValue: 'Close panel' })}
          >
            <PanelRightClose className="size-4" />
          </Button>
        </div>
      ) : null}
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        {t('rightPanel.previewEmpty', { defaultValue: 'No preview content' })}
      </div>
    </div>
  )
}

export function PreviewTabStrip({
  tabs,
  activeTabId,
  browserPluginEnabled,
  onSelectTab,
  onRequestClose,
  onOpenLocalFiles,
  onOpenBrowser,
  onOpenArtifacts,
  onClosePanel
}: {
  tabs: Array<any>
  activeTabId: string | null
  browserPluginEnabled: boolean
  onSelectTab: (id: string) => void
  onRequestClose: (tab: any) => void
  onOpenLocalFiles: () => Promise<void>
  onOpenBrowser: () => void
  onOpenArtifacts: () => void
  onClosePanel: () => void
}): React.JSX.Element {
  const { t } = useTranslation('layout')

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/50 bg-background px-1">
      <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto pt-1">
        {tabs.map((tab: any) => {
          const active = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              className={cn(
                'group flex h-8 min-w-0 max-w-48 shrink-0 items-center gap-1.5 rounded-t-md border border-transparent px-2 text-left text-xs transition-colors',
                active
                  ? 'border-border/70 border-b-background bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
              title={tabPathTitle(tab)}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                onClick={() => onSelectTab(tab.id)}
              >
                <TabIcon tab={tab} />
                <span className="min-w-0 truncate">{tabTitle(tab)}</span>
                {tab.modified && (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-amber-500"
                    title={t('preview.modified')}
                  />
                )}
              </button>
              <button
                type="button"
                className="ml-0.5 rounded p-0.5 opacity-60 transition-opacity hover:bg-muted hover:opacity-100"
                title={t('action.close', { ns: 'common' })}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onRequestClose(tab)
                }}
              >
                <X className="size-3" />
              </button>
            </div>
          )
        })}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7 shrink-0">
            <Plus className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => void onOpenLocalFiles()}>
            <FolderOpen className="size-4" />
            {t('preview.openFile', { defaultValue: 'Open file' })}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {browserPluginEnabled && (
            <DropdownMenuItem onSelect={onOpenBrowser}>
              <Globe className="size-4" />
              {t('rightPanel.browser')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onOpenArtifacts}>
            <FileOutput className="size-4" />
            {t('rightPanel.artifacts')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={onClosePanel}
        title={t('rightPanelAction.closePanel', { defaultValue: 'Close panel' })}
      >
        <PanelRightClose className="size-4" />
      </Button>
    </div>
  )
}
