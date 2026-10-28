import { useTranslation } from 'react-i18next'
import { Puzzle, Settings2 } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@renderer/components/ui/dropdown-menu'
import { useUIStore } from '@renderer/stores/ui-store'
import type { PluginItem } from './types'

interface PluginsSubmenuProps {
  availablePlugins: PluginItem[]
  menuClassName?: string
  onSelectPlugin?: (pluginId: PluginItem['id']) => void
  setOpen: (open: boolean) => void
}

export function PluginsSubmenu({
  availablePlugins,
  menuClassName,
  onSelectPlugin,
  setOpen
}: PluginsSubmenuProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const openSettingsPage = useUIStore((s) => s.openSettingsPage)

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Puzzle className="mr-2 size-4" />
        <span>{t('skills.pluginsLabel')}</span>
        {availablePlugins.length > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {availablePlugins.length}
          </span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className={cn('w-64 max-h-80 overflow-y-auto', menuClassName)}>
          <DropdownMenuLabel>{t('skills.availablePlugins')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {availablePlugins.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              <p>{t('skills.noPlugins')}</p>
            </div>
          ) : (
            availablePlugins.map((plugin) => (
              <DropdownMenuItem
                key={plugin.id}
                onClick={() => {
                  onSelectPlugin?.(plugin.id)
                  setOpen(false)
                }}
                className="flex flex-col items-start gap-1 py-2"
              >
                <span className="font-medium">{plugin.title}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {plugin.description}
                </span>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setOpen(false)
              openSettingsPage('plugin')
            }}
            className="text-xs"
          >
            <Settings2 className="mr-2 size-3.5" />
            {t('skills.configurePlugins')}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}
