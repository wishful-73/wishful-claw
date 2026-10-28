import type { AppPluginId } from '@renderer/lib/app-plugin/types'

export interface SkillsMenuProps {
  onSelectSkill: (skillName: string) => void
  onSelectCommand?: (commandName: string) => void
  onSelectPlugin?: (pluginId: AppPluginId) => void
  onAttachMedia?: () => void
  disabled?: boolean
  projectId?: string | null
  showChannels?: boolean
  triggerClassName?: string
  menuClassName?: string
  showModeToggles?: boolean
  planModeEnabled?: boolean
  goalModeEnabled?: boolean
  planModeDisabled?: boolean
  goalModeDisabled?: boolean
  onPlanModeChange?: (enabled: boolean) => void
  onGoalModeChange?: (enabled: boolean) => void
}

export interface SkillItem {
  name: string
  description: string
}

export interface PluginItem {
  id: AppPluginId
  title: string
  description: string
}
