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

// 首页内容区容器（2026-11-13 老大：首屏截图宽度固定后，下面元素在宽屏上比图宽很多）。
//
// 起因：首屏主图一直是**唯一**挂了宽度上限的容器（`max-w-6xl`），6 个 Section、价值带、
// 文案区全是通栏 `w-full`。于是 1152 以下两者都通栏、看着对齐；一过 1152 图被夹住、
// 别的继续撑满 —— 1440 差 288px、1920 差 768px。
// 裁定的方向是**把上限加给所有容器，不动那张图**：图是标尺，它 1152（内容宽 1040）不变。
//
// ⚠️ 这条**推翻了 2026-09-23「去掉 max-w-5xl 收束、内容铺满屏宽」** —— 铺满在大屏上确实是
// 问题，收束值从 5xl 的 1024 换成 6xl 的 1152。**范围仅首页**（2026-11-13 老大：「只改首页」）；
// 下载页 / 指引页维持原样，别顺手「统一」。
// 顶栏与页脚**不套这个**：老大要的是「适当增加一点间距，但不用跟这些一样」，
// 所以它们保持通栏、只把断点后的左右内边距加大（见 site-header / site-footer）。
export const container = 'mx-auto w-full max-w-6xl px-6 sm:px-10 lg:px-14'

// 通栏容器的左右内边距 —— 顶栏、页脚、下载页、指引页四处共用（2026-11-13 老大：
// 「下载页和指引页内容区域的左右间距需要跟头尾对齐」）。
//
// ⚠️ 这四条**必须走同一个常量**。它们宽度一致是老大明确要的视觉结果；各写一份类名，
// 下次调一处就又是「宽屏对不齐」——那正是这一轮要解决的问题。
// 与首页的 `container` 是两套：首页收 `max-w-6xl`（跟主图对齐），这几处不收、只加留白。
export const shellPadding = 'px-6 sm:px-10 lg:px-14 xl:px-32 2xl:px-48 min-[1920px]:px-56'

// `paddingTopClass` 可选：默认 `pt-24`。给「上一块是窄带、想让本块标题落进第一屏」的区块用
// （2026-09-23 老大：「它能干什么」跟上面隔了 176px 空白，标题掉出首屏）。
export function Section(props: {
  id?: string
  eyebrow?: string
  title?: string
  paddingTopClass?: string
  children: ReactNode
}) {
  return (
    <section id={props.id} className={`scroll-mt-24 pb-24 ${props.paddingTopClass ?? 'pt-24'}`}>
      {/* 2026-09-23（老大）：去掉 max-w-5xl 的宽度收束，内容直接铺满屏宽，只留内边距。
          2026-11-13 反过来了：收束加回来，值改 6xl（= 首屏主图宽度），见上面 `container` 的说明。 */}
      <div className={container}>
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
// 2026-09-23（老大）：素材统一走静态截图，不再用 GIF；本轮到位 1 / 2 / 3 / 5 / 6 / 9 / 10 / 11 / 12 / 13。
// 1 原在 Hero，2026-09-23 移交给「它能干什么 → 真干活」（首屏大图压着下一块太突兀）。
// 11 / 12 / 13（免费对话 / 快捷启动 / 剪贴板增强）为同日新到位：
// 11 是全屏图，12 / 13 是浮窗/面板类小图（尺寸 1688×1050 / 1842×1251，非 2520×1608 全屏规格）。
//
// 2026-10-26（S-227）：改成 `export` —— 「它能干什么」板块的 banner 形态要自己渲染 `<img>`
// （绝对定位铺满 + object-cover + 按需挂载），塞进下面的 AssetPlaceholder 会把它变成万能组件。
// 占位兜底逻辑仍留在组件里，别的板块照旧用 AssetPlaceholder。
export const assetSources: Record<number, string> = {
  1: './screenshots/home1.png', // 主界面（聊天 + 侧栏）
  2: './screenshots/models.png', // 服务商设置页
  3: './screenshots/statistics.png', // 用量统计页
  5: './screenshots/goal_chat.png', // 全局助理派活（2520×1608，主窗口全貌 + 正在跑的会话）
  6: './screenshots/wechat.png', // 微信遥控（1226×1263，竖版微信对话窗）
  9: './screenshots/run1.png', // 界面大图（样式展示）—— 2026-09-23 优势区撤图后暂无引用，留档待复用
  10: './screenshots/scheduled-task.png', // 定时任务页
  11: './screenshots/freechat.png', // 免费对话（2520×1608，全屏）
  12: './screenshots/search.png', // 快捷启动（1688×1050，热键浮窗小图）
  13: './screenshots/ctrl_cv.png', // 剪贴板增强（1842×1251，面板小图）
  // 2026-11-12（老大）：首屏主图回到 Hero，参照 deepseek.com/harness 的排布。
  // 尺寸 1920×1482（比例 1.2955，非 2520×1608 全屏规格），只给 Hero 用，别塞进「真干活」轮播舞台。
  14: './screenshots/hero-main.png' // 首屏主界面（聊天 + 侧栏，浅色主题）
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
