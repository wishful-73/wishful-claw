import { useEffect, useRef, useState } from 'react'
import { viewerText } from '../viewer-text'

interface MermaidBlockProps {
  code: string
}

/**
 * Simple Mermaid diagram renderer.
 * Uses dynamic import of mermaid to avoid bundling it for non-diagram content.
 */
export function MermaidBlock({ code }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function render() {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          theme: window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'default',
          securityLevel: 'loose'
        })
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const result = await mermaid.render(id, code)
        if (!cancelled) {
          setSvg(result.svg)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    }

    void render()
    return () => {
      cancelled = true
    }
  }, [code])

  if (error) {
    return (
      <pre className="not-prose my-3 overflow-x-auto rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive">
        <code className="font-mono">{code}</code>
        <div className="mt-2 text-destructive/80">{viewerText('mermaidRenderFailed')}: {error}</div>
      </pre>
    )
  }

  if (!svg) {
    return (
      <div className="my-3 flex items-center justify-center rounded-md border border-border/50 bg-muted/60 p-8 text-xs text-muted-foreground">
        {viewerText('loadingDiagram')}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="my-3 flex justify-center overflow-x-auto rounded-md border border-border/50 bg-background p-4"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
