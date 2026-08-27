import { cn } from '@renderer/lib/utils'

export interface SegmentedControlOption<T extends string> {
  value: T
  label: string
}

interface SegmentedControlProps<T extends string> {
  value: T
  options: readonly SegmentedControlOption<T>[]
  onValueChange: (value: T) => void
  ariaLabel: string
  className?: string
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onValueChange,
  ariaLabel,
  className
}: SegmentedControlProps<T>): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'flex min-h-9 w-fit max-w-full min-w-0 flex-wrap items-stretch overflow-hidden rounded-lg border border-border/70 bg-muted/30 p-0',
        className
      )}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={cn(
              'min-h-9 min-w-fit max-w-full flex-none whitespace-normal break-words rounded-none border-0 bg-transparent px-2.5 py-2 text-center text-xs font-medium leading-4 text-muted-foreground outline-none transition-[background-color,color,box-shadow] hover:bg-accent/60 hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              index === 0 && 'rounded-l-[7px]',
              index === options.length - 1 && 'rounded-r-[7px]',
              index > 0 && 'border-l border-border/60',
              selected && 'relative z-[1] bg-accent text-accent-foreground shadow-sm ring-1 ring-ring/30'
            )}
            onClick={() => onValueChange(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
