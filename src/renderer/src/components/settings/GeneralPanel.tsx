import { useTranslation } from 'react-i18next'
import { Monitor, MoonStar, SunMedium } from 'lucide-react'
import { useTheme } from 'next-themes'
import {
  APP_THEME_PRESETS,
  resolveAppThemeMode,
  type AppThemePreset
} from '@renderer/lib/theme-presets'
import { cn } from '@renderer/lib/utils'
import {
  useSettingsStore,
  type ThemeMode
} from '@renderer/stores/settings-store'
import { LANGUAGE_OPTIONS } from '@renderer/lib/i18n-language'
import { changeI18nLanguage } from '@renderer/locales'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { PresetCard } from './general-preset-card'
import { SettingsSection } from './settings-primitives'

const FONT_OPTIONS = [
  { label: '__default__', value: '__default__' },
  { label: 'Inter', value: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { label: 'Segoe UI', value: "'Segoe UI', system-ui, -apple-system, sans-serif" },
  { label: 'Noto Sans', value: "'Noto Sans', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif" },
  { label: 'Source Sans 3', value: "'Source Sans 3', system-ui, sans-serif" },
  { label: 'Monospace', value: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace" }
]

function GeneralPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore()
  const { resolvedTheme } = useTheme()
  const resolvedMode = resolveAppThemeMode(
    settings.theme === 'system' ? resolvedTheme : settings.theme
  )

  const MODE_OPTIONS: Array<{ value: ThemeMode; icon: typeof SunMedium; label: string }> = [
    { value: 'light', icon: SunMedium, label: t('general.theme.light') },
    { value: 'dark', icon: MoonStar, label: t('general.theme.dark') },
    { value: 'system', icon: Monitor, label: t('general.theme.system') }
  ]

  const clampFontSize = (value: number): number => Math.min(20, Math.max(12, value))

  const handleLanguageChange = (value: string): void => {
    settings.updateSettings({ language: value as typeof settings.language })
    changeI18nLanguage(value)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-8 pb-16 pt-10">
      {/* Title */}
      <div>
        <h2 className="text-lg font-semibold">{t('general.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('general.subtitle')}</p>
      </div>

      {/* Language */}
      <SettingsSection id="sec-general-language" title={t('general.language.label')} description={t('general.language.desc')}>
        <Select value={settings.language} onValueChange={handleLanguageChange}>
          <SelectTrigger className="w-60 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsSection>

      {/* Theme mode */}
      <SettingsSection id="sec-general-theme" title={t('general.theme.label')} description={t('general.theme.desc')}>
        <div className="grid grid-cols-3 gap-2">
          {MODE_OPTIONS.map((option) => {
            const active = settings.theme === option.value
            const Icon = option.icon
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => settings.updateSettings({ theme: option.value })}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-[16px] border px-3 py-3 text-sm transition-all',
                  active
                    ? 'border-primary bg-primary text-primary-foreground shadow-[0_16px_32px_-24px_color-mix(in_srgb,var(--primary)_75%,transparent)]'
                    : 'border-border bg-card text-foreground hover:border-foreground/15 hover:bg-accent'
                )}
              >
                <Icon className="size-4" />
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      </SettingsSection>

      {/* Theme preset */}
      <SettingsSection id="sec-general-preset" title={t('general.preset.label')} description={t('general.preset.desc')}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {APP_THEME_PRESETS.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              active={settings.themePreset === preset.id}
              mode={resolvedMode}
              onClick={() => settings.updateSettings({ themePreset: preset.id as AppThemePreset })}
              label={t(`general.preset.presets.${preset.id}.label`)}
              description={t(`general.preset.presets.${preset.id}.desc`)}
              currentLabel={t('general.preset.current')}
              globalLabel={t('general.preset.global')}
            />
          ))}
        </div>
      </SettingsSection>

      {/* Appearance */}
      <SettingsSection id="sec-general-appearance" title={t('general.appearance.label')} description={t('general.appearance.desc')}>
        <div>
          <label className="text-sm font-medium">{t('general.appearance.label')}</label>
          <p className="text-xs text-muted-foreground">{t('general.appearance.desc')}</p>
        </div>

        {/* Font family */}
        <div className="space-y-2">
          <div>
            <label className="text-xs font-medium">{t('general.appearance.font.label')}</label>
            <p className="text-xs text-muted-foreground">{t('general.appearance.font.desc')}</p>
          </div>
          <Select
            value={settings.fontFamily || '__default__'}
            onValueChange={(value) =>
              settings.updateSettings({ fontFamily: value === '__default__' ? '' : value })
            }
          >
            <SelectTrigger className="w-80 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_OPTIONS.map((option) => (
                <SelectItem key={option.label} value={option.value} className="text-xs">
                  {option.label === '__default__' ? t('general.appearance.fontOptions.default') : option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Font size */}
        <div className="space-y-2">
          <div className="flex items-center justify-between max-w-lg">
            <div>
              <label className="text-xs font-medium">{t('general.appearance.fontSize.label')}</label>
              <p className="text-xs text-muted-foreground">{t('general.appearance.fontSize.desc')}</p>
            </div>
            <span className="text-xs text-muted-foreground">{settings.fontSize}px</span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={12}
              max={20}
              step={1}
              value={settings.fontSize}
              onChange={(e) => settings.updateSettings({ fontSize: clampFontSize(parseInt(e.target.value)) })}
              className="flex-1 max-w-lg accent-primary"
            />
            <Input
              type="number"
              min={12}
              max={20}
              value={settings.fontSize}
              onChange={(e) => {
                const next = clampFontSize(parseInt(e.target.value, 10) || 14)
                settings.updateSettings({ fontSize: next })
              }}
              className="max-w-24 text-xs"
            />
          </div>
        </div>

        {/* Background color */}
        <div className="space-y-2">
          <div>
            <label className="text-xs font-medium">{t('general.appearance.backgroundColor.label')}</label>
            <p className="text-xs text-muted-foreground">{t('general.appearance.backgroundColor.desc')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="color"
              value={settings.backgroundColor || '#111111'}
              onChange={(e) => settings.updateSettings({ backgroundColor: e.target.value })}
              className="h-8 w-12 cursor-pointer p-1"
            />
            <Input
              type="text"
              value={settings.backgroundColor}
              onChange={(e) => settings.updateSettings({ backgroundColor: e.target.value.trim() })}
              placeholder=""
              className="max-w-40 text-xs"
            />
            <button
              type="button"
              className="h-8 rounded-md border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent"
              onClick={() => settings.updateSettings({ backgroundColor: '' })}
            >
              {t('general.reset')}
            </button>
          </div>
        </div>
      </SettingsSection>

    </div>
  )
}

export { GeneralPanel }
