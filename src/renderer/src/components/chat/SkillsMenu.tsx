import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Paperclip, Plus } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { cn } from '@renderer/lib/utils'
import { useSkillsStore } from '@renderer/stores/skills-store'
import { useChannelStore } from '@renderer/stores/channel-store'
import { resolveConfiguredActiveMcpIds, useMcpStore } from '@renderer/stores/mcp-store'
import { listCommands, type CommandCatalogItem } from '@renderer/lib/commands/command-loader'
import { resolvePluginsForProject, useAppPluginStore } from '@renderer/stores/app-plugin-store'
import { APP_PLUGIN_DESCRIPTORS, type AppPluginId } from '@renderer/lib/app-plugin/types'
import {
  resolveEffectiveActiveExtensionIds,
  useExtensionStore
} from '@renderer/stores/extension-store'
import { CommandsSubmenu } from './skills-menu/commands-submenu'
import { SkillsSubmenu } from './skills-menu/skills-submenu'
import { ChannelsSubmenu } from './skills-menu/channels-submenu'
import { PluginsSubmenu } from './skills-menu/plugins-submenu'
import { ExtensionsSubmenu } from './skills-menu/extensions-submenu'
import { McpSubmenu } from './skills-menu/mcp-submenu'
import { ModeToggleSection } from './skills-menu/mode-toggle-section'
import type { SkillItem, SkillsMenuProps } from './skills-menu/types'

export function SkillsMenu({
  onSelectSkill,
  onSelectCommand,
  onSelectPlugin,
  onAttachMedia,
  disabled = false,
  projectId,
  showChannels = true,
  triggerClassName,
  menuClassName,
  showModeToggles = true,
  planModeEnabled = false,
  goalModeEnabled = false,
  planModeDisabled = false,
  goalModeDisabled = false,
  onPlanModeChange,
  onGoalModeChange
}: SkillsMenuProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [open, setOpen] = React.useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          data-tour="composer-plus"
          variant="ghost"
          size="icon-sm"
          className={cn('size-8 shrink-0 rounded-lg', triggerClassName)}
          disabled={disabled}
          aria-label={t('skills.addActions')}
          title={t('skills.addActions')}
        >
          <Plus className="size-4" />
        </Button>
      </DropdownMenuTrigger>

      {open && (
        <SkillsMenuContent
          onSelectSkill={onSelectSkill}
          onSelectCommand={onSelectCommand}
          onSelectPlugin={onSelectPlugin}
          onAttachMedia={onAttachMedia}
          projectId={projectId}
          showChannels={showChannels}
          menuClassName={menuClassName}
          showModeToggles={showModeToggles}
          planModeEnabled={planModeEnabled}
          goalModeEnabled={goalModeEnabled}
          planModeDisabled={planModeDisabled}
          goalModeDisabled={goalModeDisabled}
          onPlanModeChange={onPlanModeChange}
          onGoalModeChange={onGoalModeChange}
          setOpen={setOpen}
        />
      )}
    </DropdownMenu>
  )
}

function SkillsMenuContent({
  onSelectSkill,
  onSelectCommand,
  onSelectPlugin,
  onAttachMedia,
  projectId,
  showChannels = true,
  menuClassName,
  showModeToggles = true,
  planModeEnabled = false,
  goalModeEnabled = false,
  planModeDisabled = false,
  goalModeDisabled = false,
  onPlanModeChange,
  onGoalModeChange,
  setOpen
}: SkillsMenuProps & { setOpen: (open: boolean) => void }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [commands, setCommands] = React.useState<CommandCatalogItem[]>([])
  const [commandsLoading, setCommandsLoading] = React.useState(false)
  const skills = useSkillsStore((s) => s.skills)
  const loading = useSkillsStore((s) => s.loading)
  const loadSkills = useSkillsStore((s) => s.loadSkills)

  const channels = useChannelStore((s) => s.channels)
  const activeChannelIdsByProject =
    (useChannelStore as any)((s: any) => s.activeChannelIdsByProject) ?? {}
  const activeChannelIds = activeChannelIdsByProject[projectId ?? '__global__'] ?? []
  const loadChannels = useChannelStore((s) => s.loadChannels)
  const loadProviders = useChannelStore((s) => s.loadProviders)
  const configuredChannels = React.useMemo(
    () =>
      channels.filter((item) => item.enabled && (!projectId ? true : item.projectId === projectId)),
    [channels, projectId]
  )

  const mcpServers = useMcpStore((s) => s.servers)
  const activeMcpIdsByProject = useMcpStore((s) => s.activeMcpIdsByProject)
  const activeMcpIds = React.useMemo(
    () =>
      resolveConfiguredActiveMcpIds({
        projectId,
        activeMcpIdsByProject,
        servers: mcpServers
      }),
    [activeMcpIdsByProject, mcpServers, projectId]
  )
  const loadMcpServers = useMcpStore((s) => s.loadServers)
  const refreshAllMcpServers = useMcpStore((s) => s.refreshAllServers)
  const mcpTools = useMcpStore((s) => s.serverTools)
  const pluginsByProject = useAppPluginStore((s) => s.pluginsByProject)
  const availablePlugins = React.useMemo(() => {
    const projectPlugins = resolvePluginsForProject(pluginsByProject, projectId)

    return APP_PLUGIN_DESCRIPTORS.filter((descriptor) => !descriptor.hidden)
      .map((descriptor) => {
        const plugin = projectPlugins.find((item) => item.id === descriptor.id)
        if (!plugin?.enabled) return null

        return {
          id: descriptor.id,
          title: t(`plugin.items.${descriptor.id}.title`, {
            ns: 'settings',
            defaultValue: descriptor.id
          }),
          description: t(`plugin.items.${descriptor.id}.description`, {
            ns: 'settings',
            defaultValue: ''
          })
        }
      })
      .filter((item): item is { id: AppPluginId; title: string; description: string } => item !== null)
  }, [pluginsByProject, projectId, t])
  const pluginBackedSkillNames = React.useMemo(
    () =>
      new Set(
        APP_PLUGIN_DESCRIPTORS.filter((descriptor) => !descriptor.hidden).map(
          (descriptor) => descriptor.id
        )
      ),
    []
  )
  const visibleSkills: SkillItem[] = React.useMemo(
    () => skills.filter((skill) => !pluginBackedSkillNames.has(skill.name as AppPluginId)),
    [pluginBackedSkillNames, skills]
  )
  const availableMcpServers = React.useMemo(
    () =>
      mcpServers.filter(
        (item) =>
          item.enabled && (!projectId ? true : !item.projectId || item.projectId === projectId)
      ),
    [mcpServers, projectId]
  )
  const extensions = useExtensionStore((s) => s.extensions)
  const activeExtensionIdsByProject = useExtensionStore((s) => s.activeExtensionIdsByProject)
  const activeExtensionIds = React.useMemo(
    () =>
      resolveEffectiveActiveExtensionIds({
        projectId,
        activeExtensionIdsByProject,
        extensions
      }),
    [activeExtensionIdsByProject, extensions, projectId]
  )
  const availableExtensions = React.useMemo(
    () => extensions.filter((extension) => extension.enabled),
    [extensions]
  )
  const loadExtensions = useExtensionStore((s) => s.loadExtensions)

  const showModeSection = showModeToggles && Boolean(onPlanModeChange || onGoalModeChange)

  React.useEffect(() => {
    loadSkills()
    loadProviders()
    loadChannels()
    loadMcpServers()
    refreshAllMcpServers()
    loadExtensions()

    let cancelled = false
    setCommandsLoading(true)
    void listCommands()
      .then((items) => {
        if (!cancelled) {
          setCommands(items)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCommandsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    loadSkills,
    loadProviders,
    loadChannels,
    loadMcpServers,
    refreshAllMcpServers,
    loadExtensions
  ])

  return (
    <DropdownMenuContent align="start" className={cn('w-56', menuClassName)}>
      <DropdownMenuLabel>{t('skills.addToChat')}</DropdownMenuLabel>
      <DropdownMenuSeparator />

      {onAttachMedia && (
        <>
          <DropdownMenuItem
            onClick={() => {
              setOpen(false)
              requestAnimationFrame(() => {
                onAttachMedia()
              })
            }}
          >
            <Paperclip className="mr-2 size-4" />
            <span>{t('skills.attachMedia')}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}

      {showModeSection && (
        <ModeToggleSection
          planModeEnabled={planModeEnabled}
          goalModeEnabled={goalModeEnabled}
          planModeDisabled={planModeDisabled}
          goalModeDisabled={goalModeDisabled}
          onPlanModeChange={onPlanModeChange}
          onGoalModeChange={onGoalModeChange}
        />
      )}

      <DropdownMenuGroup>
        <CommandsSubmenu
          commands={commands}
          commandsLoading={commandsLoading}
          menuClassName={menuClassName}
          onSelectCommand={onSelectCommand}
          setOpen={setOpen}
        />
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <SkillsSubmenu
          visibleSkills={visibleSkills}
          loading={loading}
          menuClassName={menuClassName}
          onSelectSkill={onSelectSkill}
          setOpen={setOpen}
        />
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      {showChannels && (
        <>
          <DropdownMenuGroup>
            <ChannelsSubmenu
              configuredChannels={configuredChannels}
              activeChannelIds={activeChannelIds}
              menuClassName={menuClassName}
              projectId={projectId}
              setOpen={setOpen}
            />
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </>
      )}

      {onSelectPlugin && (
        <>
          <DropdownMenuGroup>
            <PluginsSubmenu
              availablePlugins={availablePlugins}
              menuClassName={menuClassName}
              onSelectPlugin={onSelectPlugin}
              setOpen={setOpen}
            />
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </>
      )}

      <DropdownMenuGroup>
        <ExtensionsSubmenu
          availableExtensions={availableExtensions}
          activeExtensionIds={activeExtensionIds}
          menuClassName={menuClassName}
          projectId={projectId}
          setOpen={setOpen}
        />
      </DropdownMenuGroup>
      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <McpSubmenu
          availableMcpServers={availableMcpServers}
          activeMcpIds={activeMcpIds}
          mcpTools={mcpTools}
          menuClassName={menuClassName}
          projectId={projectId}
          setOpen={setOpen}
        />
      </DropdownMenuGroup>
    </DropdownMenuContent>
  )
}
