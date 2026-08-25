import { useTranslation } from 'react-i18next'
import { ArrowLeft, Server, Info, Settings, User, MessageCircle, Puzzle, Cable, Layers, Keyboard, Gauge } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { WindowControls } from '@renderer/components/layout/WindowControls'
import { useUIStore, type SettingsTab } from '@renderer/stores/ui-store'
import { ProviderPanel } from '@renderer/components/settings/ProviderPanel'
import { PluginPanel } from '@renderer/components/settings/PluginPanel'
import { ExtensionPanel } from '@renderer/components/settings/ExtensionPanel'
import { AppPluginPanel } from '@renderer/components/settings/AppPluginPanel'
import { GeneralPanel } from '@renderer/components/settings/GeneralPanel'
import { RuntimePanel } from '@renderer/components/settings/RuntimePanel'
import { PersonaPanel } from '@renderer/components/settings/PersonaPanel'
import { cn } from '@renderer/lib/utils'
import { APP_VERSION_LABEL } from '@renderer/lib/app-version'
import { SshPanel } from '@renderer/components/settings/SshPanel'
import { SkillPanel } from '@renderer/components/settings/skill-panel'
import { McpPanel } from '@renderer/components/settings/mcp-panel'
import { ModelManagementPanel } from '@renderer/components/settings/model-management/ModelManagementPanel'
import { ShortcutsPanel } from '@renderer/components/settings/ShortcutsPanel'
import { SectionAnchorNav, type SectionAnchor } from '@renderer/components/settings/section-anchor-nav'
import { Server as ServerIcon } from 'lucide-react'
import { useRef } from 'react'

const GENERAL_ANCHORS: SectionAnchor[] = [
  { id: 'sec-general-language', label: 'anchorNav.language' },
  { id: 'sec-general-theme', label: 'anchorNav.theme' },
  { id: 'sec-general-preset', label: 'anchorNav.presets' },
  { id: 'sec-general-appearance', label: 'anchorNav.appearance' }
]

const RUNTIME_ANCHORS: SectionAnchor[] = [
  { id: 'sec-runtime-autostart', label: 'anchorNav.startup' },
  { id: 'sec-runtime-devmode', label: 'anchorNav.developer' },
  { id: 'sec-runtime-timeout', label: 'anchorNav.timeout' },
  { id: 'sec-runtime-retries', label: 'anchorNav.retries' },
  { id: 'sec-runtime-compression', label: 'anchorNav.compression' },
  { id: 'sec-runtime-tools', label: 'anchorNav.toolExecution' }
]

function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settingsTab = useUIStore((s) => s.settingsTab)
  const setSettingsTab = useUIStore((s) => s.setSettingsTab)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const menuGroups: Array<{
    label: string
    items: { id: SettingsTab; icon: React.ReactNode; label: string }[]
  }> = [
    {
      label: t('tabs.groups.general'),
      items: [
        { id: 'general', icon: <Settings className="size-4" />, label: t('tabs.general.label') },
        { id: 'shortcuts', icon: <Keyboard className="size-4" />, label: t('tabs.shortcuts.label', { defaultValue: '快捷键' }) },
        { id: 'persona', icon: <User className="size-4" />, label: t('tabs.persona.label', { defaultValue: '人格管理' }) },
        { id: 'ssh', icon: <ServerIcon className="size-4" />, label: t('tabs.ssh.label', { defaultValue: 'SSH 连接' }) }
      ]
    },
    {
      label: t('tabs.groups.aiService'),
      items: [
        { id: 'provider', icon: <Server className="size-4" />, label: t('tabs.provider.label') },
        { id: 'modelManagement', icon: <Layers className="size-4" />, label: t('provider.modelManagement', { defaultValue: 'Model Management' }) },
        { id: 'runtime', icon: <Gauge className="size-4" />, label: t('tabs.runtime.label') }
      ]
    },
    {
      label: t('tabs.groups.channels', { defaultValue: '渠道' }),
      items: [
        { id: 'channel', icon: <MessageCircle className="size-4" />, label: t('tabs.channel.label', { defaultValue: '渠道配置' }) }
      ]
    },
    {
      label: t('tabs.groups.extensions', { defaultValue: '插件' }),
      items: [
        { id: 'plugin', icon: <Puzzle className="size-4" />, label: t('tabs.appPlugins.label', { defaultValue: '插件' }) },
        { id: 'extension', icon: <Puzzle className="size-4" />, label: t('tabs.extensions.label', { defaultValue: '自定义扩展' }) },
        { id: 'skills', icon: <Puzzle className="size-4" />, label: t('tabs.skills.label', { defaultValue: 'Skills' }) },
        { id: 'mcp', icon: <Cable className="size-4" />, label: t('tabs.mcp.label', { defaultValue: 'MCP' }) }
      ]
    },
    {
      label: t('tabs.groups.about'),
      items: [
        { id: 'about', icon: <Info className="size-4" />, label: t('tabs.about.label') }
      ]
    }
  ]

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-full min-h-0 w-full flex-col bg-muted/10">
        {/* Header with back button + window controls */}
        <header className="relative flex h-10 shrink-0 items-center gap-3 border-b bg-background/90 px-3 backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground"
            onClick={closeSettings}
            title={t('title')}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground/92">{t('title')}</div>
          </div>
          <WindowControls />
        </header>

        {/* Body: sidebar + content */}
        <div className="flex min-h-0 flex-1">
          {/* Sidebar nav */}
          <div className="flex w-[236px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
            <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 pb-2 pt-4">
              {menuGroups.map((group) => (
                <div key={group.label} className="space-y-0.5">
                  <p className="mb-1 px-3 text-[11px] font-medium text-muted-foreground/70">
                    {group.label}
                  </p>
                  {group.items.map((item) => {
                    const active = settingsTab === item.id
                    return (
                      <button
                        key={item.id}
                        onClick={() => setSettingsTab(item.id)}
                        className={cn(
                          'group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors duration-150',
                          active
                            ? 'font-medium text-sidebar-accent-foreground bg-sidebar-accent'
                            : 'text-muted-foreground hover:bg-sidebar-accent/55 hover:text-foreground'
                        )}
                      >
                        <span
                          className={cn(
                            'flex shrink-0 items-center justify-center transition-colors',
                            active
                              ? 'text-foreground'
                              : 'text-muted-foreground group-hover:text-foreground'
                          )}
                        >
                          {item.icon}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </nav>

            <div className="border-t border-sidebar-border/60 px-4 py-3 text-[11px] text-muted-foreground/55">
              Wishful Claw {APP_VERSION_LABEL}
            </div>
          </div>

          {/* Content area */}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {settingsTab === 'provider' ? (
              <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                <ProviderPanel />
              </div>
            ) : settingsTab === 'modelManagement' ? (
              <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                <ModelManagementPanel />
              </div>
            ) : settingsTab === 'runtime' ? (
              <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
                <div className="mx-auto flex max-w-5xl items-start gap-2 px-8">
                  <div className="min-w-0 flex-1">
                    <RuntimePanel />
                  </div>
                  <SectionAnchorNav containerRef={scrollContainerRef} anchors={RUNTIME_ANCHORS} />
                </div>
              </div>
            ) : settingsTab === 'shortcuts' ? (
              <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                <ShortcutsPanel />
              </div>
            ) : settingsTab === 'general' ? (
              <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
                <div className="mx-auto flex max-w-5xl items-start gap-2 px-8">
                  <div className="min-w-0 flex-1">
                    <GeneralPanel />
                  </div>
                  <SectionAnchorNav containerRef={scrollContainerRef} anchors={GENERAL_ANCHORS} />
                </div>
              </div>
            ) : settingsTab === 'persona' ? (
              <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                <PersonaPanel />
              </div>
            ) : settingsTab === 'plugin' ? (
              <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                <AppPluginPanel />
              </div>
            ) : settingsTab === 'extension' ? (
              <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                <ExtensionPanel />
              </div>
            ) : settingsTab === 'channel' ? (
              <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                <PluginPanel />
              </div>
            ) : settingsTab === 'ssh' ? (
              <div className="flex-1 overflow-y-auto">
                <SshPanel />
              </div>
            ) : settingsTab === 'skills' ? (
              <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                <SkillPanel />
              </div>
            ) : settingsTab === 'mcp' ? (
              <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                <McpPanel />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <AboutPanel />
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}

function AboutPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')

  return (
    <div className="mx-auto max-w-2xl px-8 pb-16 pt-10">
      <h1 className="mb-1 text-xl font-semibold">{t('about.title')}</h1>
      <p className="text-sm text-muted-foreground">{APP_VERSION_LABEL}</p>
      <div className="mt-6 space-y-3 text-sm text-muted-foreground">
        <p>{t('about.description')}</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>{t('about.wishfulClaw')}</li>
          <li>{t('about.kodaClaw')}</li>
          <li>{t('about.openClaw')}</li>
        </ul>
      </div>
    </div>
  )
}

export { SettingsPage }
