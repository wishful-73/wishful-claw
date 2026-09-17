import { useCallback, useRef } from 'react'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'

// ─── Helpers ───


export function ResizeHandle(): React.JSX.Element {
  const setLeftSidebarWidth = useUIStore((s) => s.setLeftSidebarWidth)
  const leftSidebarWidth = useUIStore((s) => s.leftSidebarWidth)
  const isDragging = useRef(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    const startX = e.clientX
    const startWidth = leftSidebarWidth

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return
      const delta = moveEvent.clientX - startX
      setLeftSidebarWidth(startWidth + delta)
    }

    const handleMouseUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [leftSidebarWidth, setLeftSidebarWidth])

  return (
    <div
      onMouseDown={handleMouseDown}
      className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize bg-transparent transition-colors hover:bg-primary/20"
    />
  )
}

// ─── Nav item renderer ───

export interface NavButtonItem {
  key: string
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}

export function renderNavItem(item: NavButtonItem): React.JSX.Element {
  return (
    <button
      key={item.key}
      type="button"
      onClick={item.onClick}
      className={cn(
        'flex h-8 w-full items-center gap-2 px-2 text-[13px] font-medium transition-colors rounded-md',
        item.active
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      )}
    >
      {item.icon}
      <span className="truncate">{item.label}</span>
    </button>
  )
}

/**
 * Split (combo) nav item: "New Chat | Free Chat" rendered as a single segmented
 * control — one rounded container with a border and a divider, the active half
 * filled. Each half on its own had no background or border, so side by side
 * they read as two floating labels; a shared container gives the pair its own
 * shape language. Half width leaves no room for the left-aligned layout used by
 * the full-width items above/below, hence the centred label.
 */
export function renderSplitNavItem(
  primary: NavButtonItem,
  secondary: NavButtonItem
): React.JSX.Element {
  const base =
    'flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 px-2 text-[13px] font-medium transition-colors'
  const idle = 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
  const activeCls = 'bg-accent text-foreground'

  return (
    <div role="group" className="flex h-8 w-full overflow-hidden rounded-md border border-border/60">
      <button
        type="button"
        onClick={primary.onClick}
        className={cn(base, primary.active ? activeCls : idle)}
      >
        {primary.icon}
        <span className="truncate">{primary.label}</span>
      </button>

      <button
        type="button"
        onClick={secondary.onClick}
        title={secondary.label}
        className={cn(base, 'border-l border-border/60', secondary.active ? activeCls : idle)}
      >
        {secondary.icon}
        <span className="truncate">{secondary.label}</span>
      </button>
    </div>
  )
}

// ─── Main WorkspaceSidebar (single column, WishfulClaw-style) ───

