import { normalizeSettingsTab, type SettingsTab } from '@renderer/stores/ui-types'

export const DEFAULT_SETTINGS_TAB: SettingsTab = 'provider'

export function parseSettingsRoute(rawTab: unknown = DEFAULT_SETTINGS_TAB): { tab: SettingsTab } {
  return { tab: normalizeSettingsTab(rawTab) }
}

export function replaceSettingsRoute(rawTab: unknown): void {
  normalizeSettingsTab(rawTab)
  // Placeholder: there is no URL routing for settings yet.
}

export type { SettingsTab }
