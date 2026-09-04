/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { Fragment } from 'react'
import {
  Activity,
  Bot,
  Brain,
  FileCode,
  FileDiff,
  FolderOpen,
  GitCompare,
  Globe,
  MoreHorizontal,
  PanelRightClose,
  Plus,
  SquareTerminal,
  Target,
  X
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { spring } from '@renderer/components/animate-ui/transitions'
import { cn } from '@renderer/lib/utils'
import { useSettingsStore } from '@renderer/stores/settings-store'
import type { RightPanelTabInstance } from '@renderer/stores/ui-store'

type TranslateFn = (key: string, options?: Record<string, unknown>) => string

interface RightPanelHeaderProps {
  tabs: RightPanelTabInstance[]
  activeTabId: string
  browserEnabled: boolean
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onCloseOtherTabs: (tabId: string) => void
  onCloseAllTabs: () => void
  onAddActivity: () => void
  onAddBrowser: () => void
  onOpenFile: () => void
  onClosePanel: () => void
  t: TranslateFn
}

interface TabCloseHandlers {
  onCloseTab: (tabId: string) => void
  onCloseOtherTabs: (tabId: string) => void
  onCloseAllTabs: () => void
  onClosePanel: () => void
}

function TabIcon({ tab }: { tab: RightPanelTabInstance }): React.JSX.Element {
  if (tab.kind === 'activity') return <Activity className="size-3.5" />
  if (tab.kind === 'memory') return <Brain className="size-3.5" />
  if (tab.kind === 'review') return <FileDiff className="size-3.5" />
  if (tab.kind === 'files') return <FolderOpen className="size-3.5 text-sky-500 dark:text-sky-400" />
  if (tab.kind === 'browser') return <Globe className="size-3.5" />
  if (tab.kind === 'subagent') return <Bot className="size-3.5" />
  if (tab.kind === 'terminal') return <SquareTerminal className="size-3.5" />
  if (tab.kind === 'goal') return <Target className="size-3.5" />
  if (tab.kind === 'summary') return <GitCompare className="size-3.5 text-violet-500 dark:text-violet-400" />
  return <FileCode className="size-3.5" />
}

const TAB_INDICATOR_CLASS =
  'absolute inset-0 rounded-md bg-muted shadow-[inset_0_0_0_1px_hsl(var(--border)/0.55)]'

interface CloseAction {
  key: 'close' | 'closeOthers' | 'closeAll' | 'closePanel'
  label: string
  disabled: boolean
  separatorBefore?: boolean
  run: () => void
}

/**
 * Tab 右键菜单与面板级「更多」下拉共用同一组动作，只有首项文案随目标变化
 * （有明确目标 tab 时是「关闭」，面板级指向当前激活 tab 时是「关闭当前」）。
 * 描述符在这里算一次，两处各用自己的菜单原语渲染，避免禁用规则走偏。
 */
function buildCloseActions(
  targetTabId: string | null,
  options: { closable: boolean; tabCount: number },
  handlers: TabCloseHandlers,
  t: TranslateFn
): CloseAction[] {
  const { closable, tabCount } = options
  return [
    {
      key: 'close',
      label: targetTabId
        ? t('rightPanelAction.closeTab', { defaultValue: 'Close' })
        : t('rightPanelAction.closeCurrentTab', { defaultValue: 'Close current' }),
      disabled: !targetTabId || !closable,
      run: () => {
        if (targetTabId) handlers.onCloseTab(targetTabId)
      }
    },
    {
      key: 'closeOthers',
      label: t('rightPanelAction.closeOtherTabs', { defaultValue: 'Close others' }),
      disabled: !targetTabId || tabCount <= 1,
      run: () => {
        if (targetTabId) handlers.onCloseOtherTabs(targetTabId)
      }
    },
    {
      key: 'closeAll',
      label: t('rightPanelAction.closeAllTabs', { defaultValue: 'Close all' }),
      disabled: tabCount === 0,
      run: handlers.onCloseAllTabs
    },
    {
      key: 'closePanel',
      label: t('rightPanelAction.closePanel', { defaultValue: 'Close panel' }),
      disabled: false,
      separatorBefore: true,
      run: handlers.onClosePanel
    }
  ]
}

function TabButton({
  tab,
  active,
  animated,
  closeActions,
  onSelectTab,
  onCloseTab,
  t
}: {
  tab: RightPanelTabInstance
  active: boolean
  animated: boolean
  closeActions: CloseAction[]
  onSelectTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  t: TranslateFn
}): React.JSX.Element {
  const className = cn(
    'group relative inline-flex h-7 max-w-44 shrink-0 items-center rounded-md px-2 text-[11px] font-medium transition-colors',
    active ? 'text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
  )

  const content = (
    <>
      {active ? (
        animated ? (
          <motion.div
            layoutId="right-panel-tab-indicator"
            transition={spring.stiff}
            className={TAB_INDICATOR_CLASS}
          />
        ) : (
          <div className={TAB_INDICATOR_CLASS} />
        )
      ) : null}
      <span className="relative z-10 flex min-w-0 items-center gap-1.5">
        <TabIcon tab={tab} />
        <span className="min-w-0 truncate">{tab.title}</span>
        {tab.modified ? <span className="size-1.5 shrink-0 rounded-full bg-amber-500" /> : null}
        {tab.closable ? (
          <span
            role="button"
            tabIndex={-1}
            className="ml-0.5 rounded p-0.5 opacity-55 transition-opacity hover:bg-background/70 hover:opacity-100"
            aria-label={t('action.close', { ns: 'common', defaultValue: 'Close' })}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onCloseTab(tab.id)
            }}
          >
            <X className="size-3" />
          </span>
        ) : null}
      </span>
    </>
  )

  // 两个返回分支合并成同一个 element 再包 ContextMenuTrigger：只包 motion 分支
  // 会让 animationsEnabled=false 的路径右键静默失效。asChild 走 Slot 透传 props
  // 与 ref，既不会把 button 嵌进 button，也不影响 motion 的 layout/exit 动画。
  const buttonElement = animated ? (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ ...spring.stiff, opacity: { duration: 0.15 } }}
      className={className}
      title={tab.title}
      onClick={() => onSelectTab(tab.id)}
    >
      {content}
    </motion.button>
  ) : (
    <button
      type="button"
      className={className}
      title={tab.title}
      onClick={() => onSelectTab(tab.id)}
    >
      {content}
    </button>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{buttonElement}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        {closeActions.map((action) => (
          <Fragment key={action.key}>
            {action.separatorBefore ? <ContextMenuSeparator /> : null}
            <ContextMenuItem disabled={action.disabled} onSelect={action.run}>
              {action.label}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function RightPanelHeader({
  tabs,
  activeTabId,
  browserEnabled,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onAddActivity,
  onAddBrowser,
  onOpenFile,
  onClosePanel,
  t
}: RightPanelHeaderProps): React.JSX.Element {
  const animationsEnabled = useSettingsStore((s) => s.animationsEnabled)

  const closeHandlers: TabCloseHandlers = {
    onCloseTab,
    onCloseOtherTabs,
    onCloseAllTabs,
    onClosePanel
  }
  // 两个动画分支共用同一份 tab 条目，避免 6 个 props 在两处逐字重复。
  const tabEntries = tabs.map((tab) => ({
    tab,
    active: tab.id === activeTabId,
    closeActions: buildCloseActions(
      tab.id,
      { closable: tab.closable, tabCount: tabs.length },
      closeHandlers,
      t
    )
  }))
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const panelActions = buildCloseActions(
    activeTab?.id ?? null,
    { closable: activeTab?.closable ?? false, tabCount: tabs.length },
    closeHandlers,
    t
  )

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/55 bg-background/95 px-2">
      <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto pt-1">
        {animationsEnabled ? (
          <AnimatePresence initial={false}>
            {tabEntries.map((entry) => (
              <TabButton
                key={entry.tab.id}
                tab={entry.tab}
                active={entry.active}
                animated
                closeActions={entry.closeActions}
                onSelectTab={onSelectTab}
                onCloseTab={onCloseTab}
                t={t}
              />
            ))}
          </AnimatePresence>
        ) : (
          tabEntries.map((entry) => (
            <TabButton
              key={entry.tab.id}
              tab={entry.tab}
              active={entry.active}
              animated={false}
              closeActions={entry.closeActions}
              onSelectTab={onSelectTab}
              onCloseTab={onCloseTab}
              t={t}
            />
          ))
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7 shrink-0 rounded-md">
            <Plus className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={onAddActivity}>
            <Activity className="size-4" />
            {t('sectionExecution.title', { defaultValue: 'Activity' })}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenFile}>
            <FolderOpen className="size-4 text-sky-500 dark:text-sky-400" />
            {t('rightPanel.openFile', { defaultValue: 'Open file' })}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!browserEnabled} onSelect={onAddBrowser}>
            <Globe className="size-4" />
            {t('rightPanel.browser', { defaultValue: 'Browser' })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            title={t('rightPanelAction.more', { defaultValue: 'More' })}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {panelActions.map((action) => (
            <Fragment key={action.key}>
              {action.separatorBefore ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem disabled={action.disabled} onSelect={action.run}>
                {action.key === 'closePanel' ? <PanelRightClose className="size-4" /> : null}
                {action.label}
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
