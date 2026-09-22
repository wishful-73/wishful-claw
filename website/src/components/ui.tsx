import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

// 滚动进入视口时渐显（参考 Reasonix 的 section reveal 节奏）
export function Reveal(props: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -12% 0px' }
    )
    io.observe(el)
    // 兜底：IO 因窗口隐藏/不支持等原因不触发时，内容也必须最终可见
    const failsafe = setTimeout(() => setShown(true), 1500)
    return () => {
      clearTimeout(failsafe)
      io.disconnect()
    }
  }, [])
  return (
    <div ref={ref} className={`${shown ? 'reveal' : 'opacity-0'} ${props.className ?? ''}`}>
      {props.children}
    </div>
  )
}

export function Section(props: { id?: string; eyebrow?: string; title?: string; children: ReactNode }) {
  return (
    <section id={props.id} className="scroll-mt-24 py-24">
      <div className="mx-auto w-full max-w-5xl px-6">
        {props.title && (
          <div className="mb-12">
            {props.eyebrow && (
              <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-accent uppercase">{props.eyebrow}</p>
            )}
            <h2 className="text-3xl font-semibold tracking-tight text-ink-950 sm:text-4xl">{props.title}</h2>
          </div>
        )}
        {props.children}
      </div>
    </section>
  )
}

// 素材占位框：阶段 2 用真机截图/GIF 替换（编号对应官网方案第四节素材清单）
export function AssetPlaceholder(props: { label: string; assetNo: number; aspect?: string }) {
  return (
    <div
      className="flex w-full items-center justify-center rounded-[13px] border border-dashed border-ink-700 bg-paper-soft text-center text-sm text-ink-900/55"
      style={{ aspectRatio: props.aspect ?? '16 / 9' }}
    >
      <span>
        素材 #{props.assetNo} · {props.label}
        <span className="mt-1 block text-xs text-ink-900/40">（占位，真机素材就绪后替换）</span>
      </span>
    </div>
  )
}
