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

// 真机素材映射：键＝素材编号（与 content/site.ts 里各处的 assetNo 一一对应，也对应官网方案第四节素材清单）。
// 已就绪的位在这里登记路径 —— 相对 public/ 的站点根路径，站点是相对路径部署（同 logo.png 的写法）。
// 未登记的位自动回落到下面的占位框，所以素材是「到位一张、登记一行」，页面无需改动。
// 目录刻意不叫 assets：Vite 的构建产物就落在 dist/assets/，同名会把真图和 hash 后的 js/css 混作一团。
// 2026-09-23（老大）：素材统一走静态截图，不再用 GIF；本轮到位 1 / 2 / 3 / 9 / 10。
const assetSources: Record<number, string> = {
  1: './screenshots/home1.png', // 主界面（聊天 + 侧栏）
  2: './screenshots/models.png', // 服务商设置页
  3: './screenshots/statistics.png', // 用量统计页
  9: './screenshots/run1.png', // 界面大图（样式展示）
  10: './screenshots/scheduled-task.png' // 定时任务页
}

// 素材位：有真图渲染真图，没有则渲染占位框（阶段 2 替换用，编号对应官网方案第四节素材清单）
export function AssetPlaceholder(props: { label: string; assetNo: number; aspect?: string }) {
  const src = assetSources[props.assetNo]
  if (src) {
    // 不套 aspectRatio：截图本身是统一尺寸的真机画面，按自身比例铺满即可，
    // 强套 4/3 之类会把侧栏或右侧内容裁掉。
    return (
      <img
        src={src}
        alt={props.label}
        className="w-full rounded-[13px] border border-ink-700 bg-paper-soft"
      />
    )
  }
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
