import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { features } from '../content/site'
import { AssetPlaceholder, Reveal, Section } from '../components/ui'

// 2026-09-23（老大）：这个板块要三条互相拉扯的需求 ——
// ① 画面得占满整行：截图是 2520×1608 的宽幅真机画面，排三列时只剩三百来像素，细节全糊；
// ② 九条竖排会把区块撑到六千像素高，太占篇幅 ⇒ 选项卡：左侧功能名，右侧只渲染当前这条的画面；
// ③ 「能自动轮播切换」⇒ 没人动的时候自己往下翻，五秒一条。
// ④ 「增加 hover 就切换，点击也保留」（2026-09-23 老大）⇒ tab 上 mouseenter 与 click 并存。
const PANEL_ASPECT = '2520 / 1608' // 与真机截图同比例：有图 / 无图的条目切换时，面板高度不跳
const AUTOPLAY_MS = 3500 // 2026-09-23 老大「切换有点慢」：5s → 3.5s。够扫一眼说明和画面，又不至于干等
const HOVER_DELAY_MS = 90 // hover 切换的防抖窗口，见 hoverPick
const TAB_ID = 'feature-tab'
const PANEL_ID = 'feature-panel'

export function Features() {
  const items = features.items
  const [active, setActive] = useState(0)
  // 自动轮播的三个刹车：鼠标停在区块里、键盘焦点在区块里、区块不在视口内。
  // 前两个是「用户正在看，别抢屏」，第三个是「看不到的地方翻页没意义」。
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [inView, setInView] = useState(false)
  // 手动选过之后重新计这一轮的五秒，否则刚点完就被轮播抢走
  const [cycle, setCycle] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const hoverTimer = useRef<number | null>(null)
  const item = items[active]

  // 区块滚出视口就停轮播
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.4 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (hovered || focused || !inView) return
    // 系统开了「减少动态效果」就不自动翻页，交给用户自己点
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setActive((prev) => (prev + 1) % items.length), AUTOPLAY_MS)
    return () => window.clearInterval(timer)
  }, [hovered, focused, inView, cycle, items.length])

  // 窄屏 tab 是横向滚动的：轮到看不见的那条时，把它带进可视区。
  // 竖排（宽屏）下没有横向溢出，直接跳过 —— 否则会误滚整页。
  useEffect(() => {
    const list = listRef.current
    const btn = tabRefs.current[active]
    if (!list || !btn || list.scrollWidth <= list.clientWidth) return
    list.scrollTo({ left: btn.offsetLeft - (list.clientWidth - btn.offsetWidth) / 2, behavior: 'smooth' })
  }, [active])

  const pick = (i: number): void => {
    setActive(i)
    setCycle((c) => c + 1)
  }

  const cancelHover = (): void => {
    if (hoverTimer.current === null) return
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = null
  }

  // 鼠标移上去就切（2026-09-23 老大）。点击照旧保留 —— 触屏没有 hover，
  // 键盘用户也还是靠 Enter / Space 触发 click。
  // 90ms 防抖是必须的：鼠标横穿这一列 tab 时会一路 enter 好几个，
  // 不拦的话面板会连闪几下才停在真正想停的那条上；90ms 在感知阈值以下，不会觉得"迟钝"。
  const hoverPick = (i: number): void => {
    cancelHover()
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null
      pick(i)
    }, HOVER_DELAY_MS)
  }

  // 卸载时把没落地的 hover 定时器清掉，否则会对着已经卸载的组件 setState
  useEffect(() => cancelHover, [])

  // roving tabindex + 方向键（tablist 的键盘约定）：鼠标用户不受影响，键盘用户不必逐个 Tab；
  // 焦点要跟着选中项一起走，否则焦点停在刚被置成 tabIndex=-1 的那个按钮上、与高亮项对不上
  const move = (step: number): void => {
    const next = (active + step + items.length) % items.length
    setActive(next)
    setCycle((c) => c + 1)
    tabRefs.current[next]?.focus()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft'
    const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight'
    if (!back && !forward) return
    e.preventDefault()
    move(forward ? 1 : -1)
  }

  return (
    <Section id="features" eyebrow="What it does" title={features.title} paddingTopClass="pt-5">
      <Reveal>
        <div
          ref={wrapRef}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="grid gap-6 lg:grid-cols-[minmax(0,176px)_minmax(0,1fr)] lg:gap-8"
        >
          <div
            ref={listRef}
            role="tablist"
            aria-label={features.title}
            onKeyDown={onKeyDown}
            className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1.5 lg:overflow-visible lg:pb-0"
          >
            {items.map((it, i) => {
              const on = i === active
              return (
                <button
                  key={it.name}
                  id={`${TAB_ID}-${i}`}
                  ref={(el) => {
                    tabRefs.current[i] = el
                  }}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls={PANEL_ID}
                  tabIndex={on ? 0 : -1}
                  onClick={() => pick(i)}
                  onMouseEnter={() => hoverPick(i)}
                  onMouseLeave={cancelHover}
                  className={`shrink-0 cursor-pointer rounded-[11px] px-4 py-2.5 text-sm transition-colors lg:text-left ${
                    on
                      ? 'bg-accent/10 font-semibold text-accent'
                      : 'text-ink-900/70 hover:bg-paper-soft hover:text-ink-950'
                  }`}
                >
                  {it.name}
                </button>
              )
            })}
          </div>

          <div
            id={PANEL_ID}
            role="tabpanel"
            aria-labelledby={`${TAB_ID}-${active}`}
            tabIndex={0}
            className="rounded-[13px] border border-ink-700 bg-paper p-6"
          >
            {/* key 让每次换条都重新挂载，`reveal` 的淡入就跟着重放一遍 —— 硬切太生硬 */}
            <div key={active} className="reveal">
              <p className="text-[15px] leading-relaxed text-ink-900/65">{item.desc}</p>
              {'image' in item && item.image && (
                <div className="mt-5">
                  <AssetPlaceholder label={item.image.label} assetNo={item.image.assetNo} aspect={PANEL_ASPECT} />
                </div>
              )}
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  )
}
