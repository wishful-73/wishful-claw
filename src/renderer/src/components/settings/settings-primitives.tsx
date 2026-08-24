import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

interface SettingsSectionProps {
  /** Stable id used for anchor navigation and scroll highlighting. */
  id: string
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Card-wrapped settings section (style contract ported from OpenCowork's
 * settings-primitives): rounded border, subtle card background, header row
 * with optional right-side actions (e.g. a Switch).
 */
export function SettingsSection({
  id,
  title,
  description,
  actions,
  children,
  className
}: SettingsSectionProps): React.JSX.Element {
  const hasHeader = Boolean(title || description || actions)

  return (
    <section
      id={id}
      className={cn(
        'scroll-mt-6 rounded-xl border border-border/60 bg-card/40 p-4',
        className
      )}
    >
      {hasHeader ? (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h3 className="text-sm font-semibold">{title}</h3> : null}
            {description ? (
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="space-y-4">{children}</div>
    </section>
  )
}

interface SettingRowProps {
  label: ReactNode
  description?: ReactNode
  control?: ReactNode
  children?: ReactNode
  disabled?: boolean
  className?: string
}

/**
 * A single setting inside a section: label + description on the left,
 * compact control on the right; wide controls stack below via children.
 */
export function SettingRow({
  label,
  description,
  control,
  children,
  disabled = false,
  className
}: SettingRowProps): React.JSX.Element {
  return (
    <div className={cn('space-y-2', disabled && 'opacity-60', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm font-medium leading-5">{label}</div>
          {description ? (
            <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {control ? <div className="shrink-0 pt-0.5">{control}</div> : null}
      </div>
      {children}
    </div>
  )
}

interface SettingHintProps {
  children: ReactNode
  className?: string
}

export function SettingHint({ children, className }: SettingHintProps): React.JSX.Element {
  return <p className={cn('text-xs text-muted-foreground/70', className)}>{children}</p>
}
