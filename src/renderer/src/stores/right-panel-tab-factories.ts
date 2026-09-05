// Extracted from ui-store.ts — Right panel tab factory functions and constants

import type { RightPanelTabInstance } from './ui-types'





export function ensureRightPanelTabs(
  tabs: RightPanelTabInstance[] | null | undefined
): RightPanelTabInstance[] {
  return tabs ?? []
}

export function getDefaultRightPanelTabs(): RightPanelTabInstance[] {
  return []
}

export function closeRightSidePanels(): { rightPanelOpen: false } {
  return { rightPanelOpen: false }
}

export const CHAT_SURFACE_NAV_RESET = {
  settingsPageOpen: false,
  skillsPageOpen: false,
  soulsPageOpen: false,
  syncPageOpen: false,
  resourcesPageOpen: false,
  translatePageOpen: false,
  drawPageOpen: false,
  tasksPageOpen: false,
  codeGraphPageOpen: false
} as const