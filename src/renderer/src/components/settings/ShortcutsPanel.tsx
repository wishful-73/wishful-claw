import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AppWindow, Clipboard, Search } from 'lucide-react'
import { Switch } from '@renderer/components/ui/switch'
import { MultiShortcutEditor } from './multi-shortcut-editor'

interface ShortcutConfig {
  enabled: boolean
  accelerators: string[]
}

/** The main-window tab shares the shortcut shape and adds the start-hidden switch. */
interface MainWindowConfig extends ShortcutConfig {
  hideWindowOnLaunch: boolean
}

type TabId = 'clipboard' | 'launcher' | 'main-window'

function ShortcutsPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [activeTab, setActiveTab] = useState<TabId>('main-window')
  const [clipboardConfig, setClipboardConfig] = useState<ShortcutConfig | null>(null)
  const [launcherConfig, setLauncherConfig] = useState<ShortcutConfig | null>(null)
  const [mainWindowConfig, setMainWindowConfig] = useState<MainWindowConfig | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.invoke<ShortcutConfig>('clipboard:get-config', null).then((config) => {
      if (!cancelled) setClipboardConfig(config)
    })
    void window.api.invoke<ShortcutConfig>('launcher:get-config', null).then((config) => {
      if (!cancelled) setLauncherConfig(config)
    })
    void window.api.invoke<MainWindowConfig>('main-window:get-config', null).then((config) => {
      if (!cancelled) setMainWindowConfig(config)
    })
    return () => { cancelled = true }
  }, [])

  const updateClipboardConfig = useCallback(async (patch: Partial<ShortcutConfig>): Promise<void> => {
    const config = await window.api.invoke<ShortcutConfig>('clipboard:update-config', patch)
    setClipboardConfig(config)
  }, [])

  const updateLauncherConfig = useCallback(async (patch: Partial<ShortcutConfig>): Promise<void> => {
    const config = await window.api.invoke<ShortcutConfig>('launcher:update-config', patch)
    setLauncherConfig(config)
  }, [])

  const updateMainWindowConfig = useCallback(async (patch: Partial<MainWindowConfig>): Promise<void> => {
    const config = await window.api.invoke<MainWindowConfig>('main-window:update-config', patch)
    setMainWindowConfig(config)
  }, [])

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'main-window', label: t('shortcuts.mainWindow', { defaultValue: 'Main Window' }), icon: <AppWindow className="size-4" /> },
    { id: 'clipboard', label: t('shortcuts.clipboard', { defaultValue: 'Clipboard Enhancer' }), icon: <Clipboard className="size-4" /> },
    { id: 'launcher', label: t('shortcuts.launcher', { defaultValue: 'Quick Search' }), icon: <Search className="size-4" /> }
  ]

  const shortcutEditorProps = {
    label: t('shortcuts.wakeShortcut', { defaultValue: 'Wake shortcut' }),
    description: t('shortcuts.multipleHint', { defaultValue: 'Configure multiple shortcuts; any one can open the window' }),
    recordingLabel: t('shortcuts.recording', { defaultValue: 'Press keys...' }),
    saveLabel: t('shortcuts.save', { defaultValue: 'Save' }),
    cancelLabel: t('shortcuts.cancel', { defaultValue: 'Cancel' }),
    modifyLabel: t('shortcuts.modify', { defaultValue: 'Modify' }),
    addLabel: t('shortcuts.add', { defaultValue: 'Add shortcut' })
  }

  const hint = t('shortcuts.hint', { defaultValue: 'Enable a feature before configuring or using its shortcuts. Click "Modify" and press the desired key combination; press ESC to cancel. Changes take effect immediately.' })

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-background">
      {/* Left: tab list */}
      <div className="flex w-60 shrink-0 flex-col border-r bg-muted/10">
        <div className="border-b px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/55">
            {t('shortcuts.title', { defaultValue: 'Shortcuts' })}
          </p>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ' +
                (activeTab === tab.id
                  ? 'bg-accent font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent/55 hover:text-foreground')
              }
            >
              <span className={activeTab === tab.id ? 'text-foreground' : 'text-muted-foreground'}>
                {tab.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Right: content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {/* Main window tab */}
        {activeTab === 'main-window' && mainWindowConfig && (
          <div className="space-y-6 p-6">
            {/* Enable switch */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('shortcuts.mainWindowToggle', { defaultValue: 'Show / hide main window' })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('shortcuts.mainWindowToggleDesc', { defaultValue: 'Press once to hide to the tray, again to bring it back' })}
                </p>
              </div>
              <Switch
                checked={mainWindowConfig.enabled}
                onCheckedChange={(enabled) => void updateMainWindowConfig({ enabled })}
                aria-label={t('shortcuts.mainWindowToggle', { defaultValue: 'Show / hide main window' })}
              />
            </div>

            {/* Shortcut editor */}
            <MultiShortcutEditor
              accelerators={mainWindowConfig.accelerators}
              onChange={(accelerators) => updateMainWindowConfig({ accelerators })}
              disabled={!mainWindowConfig.enabled}
              {...shortcutEditorProps}
            />

            {/* Quiet start at login */}
            <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('shortcuts.hideOnLaunch', { defaultValue: 'Start hidden on login' })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('shortcuts.hideOnLaunchDesc', { defaultValue: 'Run tray-only at login and post a notification' })}
                </p>
              </div>
              <Switch
                checked={mainWindowConfig.hideWindowOnLaunch}
                onCheckedChange={(hideWindowOnLaunch) => void updateMainWindowConfig({ hideWindowOnLaunch })}
                aria-label={t('shortcuts.hideOnLaunch', { defaultValue: 'Start hidden on login' })}
              />
            </div>

            {/* Hint */}
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
              <p className="text-xs text-muted-foreground">{hint}</p>
            </div>

            {/* Introduction */}
            <div className="space-y-3 border-t border-border pt-4">
              <h3 className="text-sm font-medium text-foreground">
                {t('shortcuts.mainWindowIntroTitle', { defaultValue: 'About the main window shortcut' })}
              </h3>
              <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
                <p>{t('shortcuts.mainWindowIntro.p1', { defaultValue: 'The main window shortcut hides or recalls Wishful Claw at any time, without reaching for the tray icon.' })}</p>
                <p>{t('shortcuts.mainWindowIntro.p2', { defaultValue: 'No accelerator is set by default: a global shortcut is exclusive, so any default we shipped would already be taken on some machines. Click "Add shortcut" to set your own.' })}</p>
              </div>
            </div>
          </div>
        )}

        {/* Clipboard tab */}
        {activeTab === 'clipboard' && clipboardConfig && (
          <div className="space-y-6 p-6">
            {/* Enable switch */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('shortcuts.clipboard', { defaultValue: 'Clipboard Enhancer' })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('shortcuts.clipboardDesc', { defaultValue: 'Capture clipboard history and open it with a global shortcut' })}
                </p>
              </div>
              <Switch
                checked={clipboardConfig.enabled}
                onCheckedChange={(enabled) => void updateClipboardConfig({ enabled })}
                aria-label={t('shortcuts.clipboard', { defaultValue: 'Clipboard Enhancer' })}
              />
            </div>

            {/* Shortcut editor */}
            <MultiShortcutEditor
              accelerators={clipboardConfig.accelerators}
              onChange={(accelerators) => updateClipboardConfig({ accelerators })}
              disabled={!clipboardConfig.enabled}
              {...shortcutEditorProps}
            />

            {/* Hint */}
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
              <p className="text-xs text-muted-foreground">{hint}</p>
            </div>

            {/* Introduction */}
            <div className="space-y-3 border-t border-border pt-4">
              <h3 className="text-sm font-medium text-foreground">
                {t('shortcuts.clipboardIntroTitle', { defaultValue: 'About Clipboard Enhancer' })}
              </h3>
              <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
                <p>{t('shortcuts.clipboardIntro.p1', { defaultValue: 'Clipboard Enhancer is a ditto-style clipboard history manager. It automatically captures every text you copy, building a searchable history that survives reboots.' })}</p>
                <p>{t('shortcuts.clipboardIntro.p2', { defaultValue: 'Press the global shortcut to summon the floating panel. Type to search, arrow keys to navigate, Enter to paste into the app you were using — no window switching, no context loss.' })}</p>
                <p>{t('shortcuts.clipboardIntro.p3', { defaultValue: 'History is automatically pruned by configurable expiry (default 7 days) and max item count (default 100). Only plain text is captured — sensitive content is never stored.' })}</p>
                <p>{t('shortcuts.clipboardIntro.p4', { defaultValue: 'Once you get used to it, you will never lose a copied snippet again. Just press the shortcut, find what you need, paste, and go.' })}</p>
              </div>
            </div>
          </div>
        )}

        {/* Launcher tab */}
        {activeTab === 'launcher' && launcherConfig && (
          <div className="space-y-6 p-6">
            {/* Enable switch */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t('shortcuts.launcher', { defaultValue: 'Quick Search' })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('shortcuts.launcherDesc', { defaultValue: 'Search and launch apps from a global shortcut' })}
                </p>
              </div>
              <Switch
                checked={launcherConfig.enabled}
                onCheckedChange={(enabled) => void updateLauncherConfig({ enabled })}
                aria-label={t('shortcuts.launcher', { defaultValue: 'Quick Search' })}
              />
            </div>

            {/* Shortcut editor */}
            <MultiShortcutEditor
              accelerators={launcherConfig.accelerators}
              onChange={(accelerators) => updateLauncherConfig({ accelerators })}
              disabled={!launcherConfig.enabled}
              {...shortcutEditorProps}
            />

            {/* Hint */}
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
              <p className="text-xs text-muted-foreground">{hint}</p>
            </div>

            {/* Introduction */}
            <div className="space-y-3 border-t border-border pt-4">
              <h3 className="text-sm font-medium text-foreground">
                {t('shortcuts.launcherIntroTitle', { defaultValue: 'About Quick Search' })}
              </h3>
              <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
                <p>{t('shortcuts.launcherIntro.p1', { defaultValue: 'Quick Search is a spotlight-style application launcher. Press the global shortcut (default Alt+Space) to bring up the search bar, type a few characters, and launch any installed program instantly.' })}</p>
                <p>{t('shortcuts.launcherIntro.p2', { defaultValue: 'It supports searching by app name, English camelCase, Chinese pinyin, and pinyin initials. As long as you remember roughly what the app is called, typing it will find it.' })}</p>
                <p>{t('shortcuts.launcherIntro.p3', { defaultValue: 'Beyond Start Menu apps, you can add custom entries for portable or non-installed programs. Every launched app is recorded to history, so next time you can find it without adding it manually.' })}</p>
                <p>{t('shortcuts.launcherIntro.p4', { defaultValue: 'Once you familiarize yourself with it, you will save a significant amount of time. Instant access, no interruption, no distraction — just press, type, launch, and get back to work.' })}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export { ShortcutsPanel }
