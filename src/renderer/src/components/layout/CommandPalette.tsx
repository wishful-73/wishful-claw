import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { useUIStore } from '@renderer/stores/ui-store'
import { useChatStore } from '@renderer/stores/chat-store'

interface CommandItem {
  id: string
  label: string
  shortcut?: string
  action: () => void
}

export function CommandPalette(): React.JSX.Element | null {
  const { t } = useTranslation('layout')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const navigateToHome = useUIStore((s) => s.navigateToHome)
  const openSettingsPage = useUIStore((s) => s.openSettingsPage)
  const toggleLeftSidebar = useUIStore((s) => s.toggleLeftSidebar)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const setShortcutsOpen = useUIStore((s) => s.setShortcutsOpen)
  const createSession = useChatStore((s) => s.createSession)

  // Keyboard shortcut: Ctrl+P or Ctrl+Shift+P
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault()
        setOpen(true)
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Reset query/selection every time the palette opens so a stale highlight
  // from the previous invocation never carries over.
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [open])

  const commands: CommandItem[] = [
    {
      id: 'new-chat',
      label: t('commandPalette.newChat', { defaultValue: 'New Chat' }),
      shortcut: 'Ctrl+N',
      action: () => {
        createSession('chat', null, { preserveProjectless: true })
        navigateToHome()
        setOpen(false)
      }
    },
    {
      id: 'settings',
      label: t('commandPalette.settings', { defaultValue: 'Open Settings' }),
      shortcut: 'Ctrl+,',
      action: () => {
        openSettingsPage()
        setOpen(false)
      }
    },
    {
      id: 'toggle-sidebar',
      label: t('commandPalette.toggleSidebar', { defaultValue: 'Toggle Sidebar' }),
      shortcut: 'Ctrl+B',
      action: () => {
        toggleLeftSidebar()
        setOpen(false)
      }
    },
    {
      id: 'toggle-right-panel',
      label: t('commandPalette.toggleRightPanel', { defaultValue: 'Toggle Right Panel' }),
      shortcut: 'Ctrl+Shift+B',
      action: () => {
        toggleRightPanel()
        setOpen(false)
      }
    },
    {
      id: 'shortcuts',
      label: t('commandPalette.shortcuts', { defaultValue: 'Keyboard Shortcuts' }),
      action: () => {
        setShortcutsOpen(true)
        setOpen(false)
      }
    }
  ]

  const filtered = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(query.toLowerCase())
  )

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // With no results, modulo-by-zero would produce a NaN selection index.
    if (filtered.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault()
      filtered[selectedIndex].action()
    }
  }, [filtered, selectedIndex])

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-[520px]" showCloseButton={false}>
        <div className="flex items-center border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('commandPalette.placeholder', { defaultValue: 'Type a command...' })}
            className="border-0 focus-visible:ring-0"
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('commandPalette.noResults', { defaultValue: 'No results' })}
            </div>
          ) : (
            filtered.map((cmd, index) => (
              <button
                key={cmd.id}
                onClick={cmd.action}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                  index === selectedIndex ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
                }`}
              >
                <span>{cmd.label}</span>
                {cmd.shortcut && (
                  <kbd className="text-[10px] text-muted-foreground/60">{cmd.shortcut}</kbd>
                )}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
