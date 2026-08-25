'use client'

import * as React from 'react'
import { Slider as SliderPrimitive } from 'radix-ui'
import { cn } from '@renderer/lib/utils'

export interface SliderProps extends Omit<
  React.ComponentProps<typeof SliderPrimitive.Root>,
  'value' | 'defaultValue'
> {
  value?: number[]
  onValueChange?: (value: number[]) => void
}

/**
 * Radix-based slider (style ported from OpenCowork): thin muted track with a
 * primary-colored filled range and a white circular thumb with hover/focus ring.
 */
function Slider({ className, value, min = 0, max = 100, ...props }: SliderProps) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      value={value}
      min={min}
      max={max}
      className={cn(
        'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        className="bg-muted relative h-1.5 w-full grow overflow-hidden rounded-full"
      >
        <SliderPrimitive.Range className="bg-primary absolute h-full" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="border-primary ring-ring/50 block size-4 shrink-0 rounded-full border bg-white shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50" />
    </SliderPrimitive.Root>
  )
}

Slider.displayName = 'Slider'

export { Slider }
