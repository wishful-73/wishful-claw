import { useTranslation } from 'react-i18next'
import {
  CalendarDays,
  Image,
  Keyboard,
  MessageSquare,
  Moon,
  PanelLeft,
  PanelRight,
  Plus,
  Server,
  Settings,
  SquareKanban,
  Sun,
  User
} from 'lucide-react'
import {
  CommandGroup,
  CommandItem,
  CommandSeparator
} from '@renderer/components/ui/command'
import { formatRelativeTime } from '../workspace-sidebar-items'
import type { SettingsTab } from '@renderer/stores/ui-types'

interface RecentSessionItem {
  id: string
  title: string
  updatedAt: number
}

interface QuickActionsProps {
  isDark: boolean
  recentSessions: RecentSessionItem[]
  onRunAndClose: (fn: () => void) => void
  onNewChat: () => void
  onSelectSession: (sessionId: string) => void
  openSettings: (tab: SettingsTab) => void
  setShortcutsOpen: (open: boolean) => void
  toggleLeftSidebar: () => void
  toggleRightPanel: () => void
  openDrawPage: () => void
  openTasksPage: () => void
  openTaskBoardPage: () => void
}

export function QuickActions({
  isDark,
  recentSessions,
  onRunAndClose,
  onNewChat,
  onSelectSession,
  openSettings,
  setShortcutsOpen,
  toggleLeftSidebar,
  toggleRightPanel,
  openDrawPage,
  openTasksPage,
  openTaskBoardPage
}: QuickActionsProps): React.JSX.Element {
  const { t } = useTranslation('layout')
  const { t: tSettings } = useTranslation('settings')

  return (
    <>
      {/* Quick actions */}
      <CommandGroup heading={t('searchDialog.quickActions', { defaultValue: 'Quick Actions' })}>
        <CommandItem onSelect={() => onRunAndClose(onNewChat)}>
          <Plus className="size-4" />
          <span>{t('sidebar.newChat', { defaultValue: 'New Chat' })}</span>
        </CommandItem>
        <CommandItem onSelect={() => onRunAndClose(() => openSettings('general'))}>
          <Settings className="size-4" />
          <span>{tSettings('tabs.general.label', { defaultValue: 'General' })}</span>
        </CommandItem>
        <CommandItem onSelect={() => onRunAndClose(() => openSettings('provider'))}>
          <Server className="size-4" />
          <span>{tSettings('tabs.provider.label', { defaultValue: 'AI Provider' })}</span>
        </CommandItem>
        <CommandItem onSelect={() => onRunAndClose(() => openSettings('persona'))}>
          <User className="size-4" />
          <span>{tSettings('tabs.persona.label', { defaultValue: 'Persona' })}</span>
        </CommandItem>
        <CommandItem onSelect={() => onRunAndClose(() => setShortcutsOpen(true))}>
          <Keyboard className="size-4" />
          <span>{t('searchDialog.keyboardShortcuts', { defaultValue: 'Keyboard Shortcuts' })}</span>
        </CommandItem>
        <CommandItem onSelect={() => onRunAndClose(toggleLeftSidebar)}>
          <PanelLeft className="size-4" />
          <span>{t('searchDialog.toggleSidebar', { defaultValue: 'Toggle Sidebar' })}</span>
        </CommandItem>
        <CommandItem onSelect={() => onRunAndClose(toggleRightPanel)}>
          <PanelRight className="size-4" />
          <span>{t('searchDialog.toggleRightPanel', { defaultValue: 'Toggle Right Panel' })}</span>
        </CommandItem>
        <CommandItem
          onSelect={() =>
            onRunAndClose(() => {
              document.documentElement.classList.toggle('dark')
            })
          }
        >
          {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          <span>{t('searchDialog.toggleTheme', { defaultValue: 'Toggle Theme' })}</span>
        </CommandItem>
      </CommandGroup>

      <CommandSeparator />

      {/* Extensions */}
      <CommandGroup heading={t('sidebar.extensionsLabel', { defaultValue: 'Extensions' })}>
        <CommandItem onSelect={() => onRunAndClose(openDrawPage)}>
          <Image className="size-4" />
          <span>{t('sidebar.drawLabel', { defaultValue: 'Draw' })}</span>
        </CommandItem>
        <CommandItem onSelect={() => onRunAndClose(openTasksPage)}>
          <CalendarDays className="size-4" />
          <span>{t('sidebar.automationLabel', { defaultValue: 'Automation' })}</span>
        </CommandItem>
        <CommandItem onSelect={() => onRunAndClose(openTaskBoardPage)}>
          <SquareKanban className="size-4" />
          <span>{t('sidebar.taskBoardLabel', { defaultValue: 'Task Board' })}</span>
        </CommandItem>
      </CommandGroup>

      <CommandSeparator />

      {/* Recent sessions */}
      {recentSessions.length > 0 && (
        <CommandGroup
          heading={t('searchDialog.recentSessions', { defaultValue: 'Recent Sessions' })}
        >
          {recentSessions.map((s) => (
            <CommandItem key={s.id} value={s.title} onSelect={() => onSelectSession(s.id)}>
              <MessageSquare className="size-4 shrink-0 text-muted-foreground/50" />
              <span className="truncate text-sm">{s.title}</span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/40">
                {formatRelativeTime(s.updatedAt)}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </>
  )
}
