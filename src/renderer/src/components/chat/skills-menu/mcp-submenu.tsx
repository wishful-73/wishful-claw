import { useTranslation } from 'react-i18next'
import { Cable, Check, Settings2 } from 'lucide-react'
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
import { useMcpStore } from '@renderer/stores/mcp-store'
import { useUIStore } from '@renderer/stores/ui-store'

export interface McpServerItem {
  id: string
  name: string
}

interface McpSubmenuProps {
  availableMcpServers: McpServerItem[]
  activeMcpIds: string[]
  mcpTools: Record<string, unknown[] | undefined>
  menuClassName?: string
  projectId?: string | null
  setOpen: (open: boolean) => void
}

export function McpSubmenu({
  availableMcpServers,
  activeMcpIds,
  mcpTools,
  menuClassName,
  projectId,
  setOpen
}: McpSubmenuProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const toggleActiveMcp = useMcpStore((s) => s.toggleActiveMcp)
  const openSettingsPage = useUIStore((s) => s.openSettingsPage)

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Cable className="mr-2 size-4" />
        <span>{t('skills.mcpLabel')}</span>
        {activeMcpIds.length > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground">{activeMcpIds.length}</span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className={cn('w-56 max-h-80 overflow-y-auto', menuClassName)}>
          <DropdownMenuLabel>{t('skills.availableMcps')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {availableMcpServers.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              <p>{t('skills.noMcps')}</p>
              <p className="mt-1 text-[10px] opacity-70">{t('skills.configureMcps')}</p>
            </div>
          ) : (
            availableMcpServers.map((server) => {
              const isActive = activeMcpIds.includes(server.id)
              const toolCount = mcpTools[server.id]?.length ?? 0
              return (
                <DropdownMenuItem
                  key={server.id}
                  onSelect={(event) => {
                    event.preventDefault()
                    toggleActiveMcp(server.id, projectId)
                  }}
                  className="flex cursor-pointer items-center gap-2 py-1.5"
                >
                  <span
                    className={`flex size-4 items-center justify-center rounded border ${
                      isActive
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/30'
                    }`}
                  >
                    {isActive && <Check className="size-3" />}
                  </span>
                  <span className="flex-1 truncate text-xs">{server.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {t('skills.mcpToolCount', { count: toolCount })}
                  </span>
                </DropdownMenuItem>
              )
            })
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setOpen(false)
              openSettingsPage('mcp')
            }}
            className="text-xs"
          >
            <Settings2 className="mr-2 size-3.5" />
            {t('skills.configureMcpServers')}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}
