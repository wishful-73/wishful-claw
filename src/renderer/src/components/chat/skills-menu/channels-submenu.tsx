import { useTranslation } from 'react-i18next'
import { Check, MessageSquare, Settings2 } from 'lucide-react'
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
import { useChannelStore } from '@renderer/stores/channel-store'
import { useUIStore } from '@renderer/stores/ui-store'

export interface ChannelItem {
  id: string
  name: string
  type: string
}

interface ChannelsSubmenuProps {
  configuredChannels: ChannelItem[]
  activeChannelIds: string[]
  menuClassName?: string
  projectId?: string | null
  setOpen: (open: boolean) => void
}

export function ChannelsSubmenu({
  configuredChannels,
  activeChannelIds,
  menuClassName,
  projectId,
  setOpen
}: ChannelsSubmenuProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const toggleActiveChannel =
    (useChannelStore as any)((s: any) => s.toggleActiveChannel) ?? (() => {})
  const openSettingsPage = useUIStore((s) => s.openSettingsPage)

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <MessageSquare className="mr-2 size-4" />
        <span>{t('skills.channelsLabel')}</span>
        {activeChannelIds.length > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {activeChannelIds.length}
          </span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className={cn('w-56 max-h-80 overflow-y-auto', menuClassName)}>
          <DropdownMenuLabel>{t('skills.availableChannels')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {configuredChannels.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              <p>{t('skills.noChannels')}</p>
              <p className="mt-1 text-[10px] opacity-70">{t('skills.configureInSettings')}</p>
            </div>
          ) : (
            configuredChannels.map((channel) => {
              const isActive = activeChannelIds.includes(channel.id)
              return (
                <DropdownMenuItem
                  key={channel.id}
                  onSelect={(event) => {
                    event.preventDefault()
                    toggleActiveChannel(projectId ?? '', channel.id)
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
                  <span className="flex-1 truncate text-xs">{channel.name}</span>
                  <span className="text-[10px] text-muted-foreground">{channel.type}</span>
                </DropdownMenuItem>
              )
            })
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setOpen(false)
              openSettingsPage('channel')
            }}
            className="text-xs"
          >
            <Settings2 className="mr-2 size-3.5" />
            {t('skills.configureChannels')}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}
