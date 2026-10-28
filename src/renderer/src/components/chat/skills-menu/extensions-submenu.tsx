import { useTranslation } from 'react-i18next'
import { Check, Settings2, Shapes } from 'lucide-react'
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
import { useExtensionStore } from '@renderer/stores/extension-store'
import { refreshExtensionTools } from '@renderer/lib/extensions/extension-tools'
import { useUIStore } from '@renderer/stores/ui-store'

export interface ExtensionItem {
  id: string
  manifest: {
    name: string
    tools: unknown[]
  }
}

interface ExtensionsSubmenuProps {
  availableExtensions: ExtensionItem[]
  activeExtensionIds: string[]
  menuClassName?: string
  projectId?: string | null
  setOpen: (open: boolean) => void
}

export function ExtensionsSubmenu({
  availableExtensions,
  activeExtensionIds,
  menuClassName,
  projectId,
  setOpen
}: ExtensionsSubmenuProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const toggleActiveExtension = useExtensionStore((s) => s.toggleActiveExtension)
  const openSettingsPage = useUIStore((s) => s.openSettingsPage)

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Shapes className="mr-2 size-4" />
        <span>{t('skills.customExtensionsLabel')}</span>
        {activeExtensionIds.length > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {activeExtensionIds.length}
          </span>
        )}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className={cn('w-64 max-h-80 overflow-y-auto', menuClassName)}>
          <DropdownMenuLabel>{t('skills.availableCustomExtensions')}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {availableExtensions.length === 0 ? (
            <div className="px-2 py-4 text-center text-xs text-muted-foreground">
              <p>{t('skills.noCustomExtensions')}</p>
              <p className="mt-1 text-[10px] opacity-70">
                {t('skills.configureCustomExtensions')}
              </p>
            </div>
          ) : (
            availableExtensions.map((extension) => {
              const isActive = activeExtensionIds.includes(extension.id)
              const toolCount = extension.manifest.tools.length
              return (
                <DropdownMenuItem
                  key={extension.id}
                  onSelect={(event) => {
                    event.preventDefault()
                    toggleActiveExtension(extension.id, projectId)
                    void refreshExtensionTools()
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
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {extension.manifest.name}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {extension.id}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {t('skills.extensionToolCount', { count: toolCount })}
                  </span>
                </DropdownMenuItem>
              )
            })
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setOpen(false)
              openSettingsPage('extension')
            }}
            className="text-xs"
          >
            <Settings2 className="mr-2 size-3.5" />
            {t('skills.configureCustomExtensionSettings')}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}
