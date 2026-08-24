import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'

export interface SectionAnchor {
  id: string
  label: string
}

interface SectionAnchorNavProps {
  /** The scrollable container element that hosts the sections. */
  containerRef: React.RefObject<HTMLDivElement | null>
  anchors: SectionAnchor[]
}

/**
 * Settings section anchor nav: fixed column on the right of the panel
 * content. Clicking an anchor scrolls the section into view; scrolling the
 * container highlights the anchor of the section currently in view.
 */
function SectionAnchorNav({ containerRef, anchors }: SectionAnchorNavProps): React.JSX.Element | null {
  const { t } = useTranslation('settings')
  const [activeId, setActiveId] = useState<string>(anchors[0]?.id ?? '')
  const clickingRef = useRef(false)

  // Scroll-spy: pick the last section whose top is above the container's
  // upper third — that reads as "the section you're looking at".
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onScroll = (): void => {
      if (clickingRef.current) return
      const containerTop = container.getBoundingClientRect().top
      let current = anchors[0]?.id ?? ''
      for (const anchor of anchors) {
        const el = document.getElementById(anchor.id)
        if (el && el.getBoundingClientRect().top - containerTop <= 96) {
          current = anchor.id
        }
      }
      setActiveId(current)
    }

    container.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => container.removeEventListener('scroll', onScroll)
  }, [anchors, containerRef])

  if (anchors.length === 0) return null

  const handleClick = (id: string): void => {
    setActiveId(id)
    clickingRef.current = true
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => {
      clickingRef.current = false
    }, 600)
  }

  return (
    <nav className="sticky top-6 flex w-28 shrink-0 flex-col gap-1 py-2 pr-2">
      {anchors.map((anchor) => (
        <button
          key={anchor.id}
          type="button"
          onClick={() => handleClick(anchor.id)}
          className={cn(
            'truncate rounded-md px-2 py-1 text-left text-[11px] transition-colors',
            activeId === anchor.id
              ? 'font-medium text-foreground bg-accent'
              : 'text-muted-foreground/70 hover:text-foreground hover:bg-accent/50'
          )}
        >
          {t(anchor.label)}
        </button>
      ))}
    </nav>
  )
}

export { SectionAnchorNav }
