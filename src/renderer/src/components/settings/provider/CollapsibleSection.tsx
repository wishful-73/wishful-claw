import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

export interface CollapsibleSectionProps {
  title: string
  /** Rendered at the right of the title row — a count or the current value. */
  badge?: React.ReactNode
  /** Sections that hold settings most people never touch open collapsed. */
  defaultOpen?: boolean
  children: React.ReactNode
}

/**
 * A hand-rolled disclosure section.
 *
 * Not built on `components/ui/collapsible`: that primitive hides its children
 * wholesale when closed, so the trigger would have to live outside it anyway and
 * the component would add a layer without carrying any of the behaviour.
 *
 * The trigger stays visible while collapsed and `badge` is the only affordance
 * that something is inside — use it for a header count or the current value.
 */
export function CollapsibleSection({
  title,
  badge,
  defaultOpen = false,
  children
}: CollapsibleSectionProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="mt-5 shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-sm font-medium"
      >
        <span>{title}</span>
        <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
          {badge ?? null}
          <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
        </span>
      </button>
      {open ? <div className="mt-2">{children}</div> : null}
    </div>
  )
}
