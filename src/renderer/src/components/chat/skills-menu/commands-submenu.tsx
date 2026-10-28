import { useTranslation } from 'react-i18next'
import { Command, Loader2 } from 'lucide-react'
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
import type { CommandCatalogItem } from '@renderer/lib/commands/command-loader'
import { WISHFUL_CLAW_DATA_DIR_NAME } from '@shared/data-dir'

interface CommandsSubmenuProps {
  commands: CommandCatalogItem[]
  commandsLoading: boolean
  menuClassName?: string
  onSelectCommand?: (commandName: string) => void
  setOpen: (open: boolean) => void
}

export function CommandsSubmenu({
  commands,
  commandsLoading,
  menuClassName,
  onSelectCommand,
  setOpen
}: CommandsSubmenuProps): React.JSX.Element {
  const { t } = useTranslation('chat')

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Command className="mr-2 size-4" />
        <span>{t('skills.commandsLabel')}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className={cn('w-64 max-h-80 overflow-y-auto', menuClassName)}>
          <DropdownMenuLabel>{t('skills.availableCommands')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {commandsLoading ? (
            <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              {t('skills.loadingCommands')}
            </div>
          ) : commands.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              <p>{t('skills.noCommands')}</p>
              <p className="mt-1 text-[10px] opacity-70">{`~/${WISHFUL_CLAW_DATA_DIR_NAME}/commands/`}</p>
            </div>
          ) : (
            commands.map((command) => (
              <DropdownMenuItem
                key={command.name}
                onClick={() => {
                  onSelectCommand?.(command.name)
                  setOpen(false)
                }}
                className="flex flex-col items-start gap-1 py-2"
              >
                <span className="font-medium">/{command.name}</span>
                {command.summary && (
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {command.summary}
                  </span>
                )}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}
