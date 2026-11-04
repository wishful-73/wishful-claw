import { useEffect, useState } from 'react'
import { sectionRail } from '../content/site'

// 首页右侧悬浮联动导航（S-221，2026-10-23）。
// 形态：竖排文字块，`lg`（1024px）以下隐藏；每项是真 `<a href="#id">`，不依赖 JS 跳转，
// 平滑滚动沿用 `index.css:24-25` 的全局 `scroll-behavior: smooth`。
//
// 联动为什么不用 IntersectionObserver：observer 回调只交付**本次变化**的 entries，
// 上滚时某节离开窄带，本轮 entries 里只有 `isIntersecting: false` ⇒ 按「当前相交集合」实现会得到空集合
// ⇒ 保持上一个 ⇒ 用户已滚回上一块、高亮还挂在下面的块上。
// 改成 scroll(passive) + rAF 合并，每帧**全量**重算「阈值线以上最后一个 section」，天然没有这个状态残影；
// 7 个元素同帧批量读 getBoundingClientRect（只读不写，不触发重排），成本可忽略。
// 判定模型与站内既有实现 `lib/use-active-heading.ts` 同源（那条用于 /guide 的目录栏）。
const LINE_RATIO = 0.3
// 超高视口保护：阈值线 = min(innerHeight * 30%, 420)。
// 真正的约束是**首块**高度 —— Hero 实测约 490px，线一旦 ≥ 490，页顶时 Hero 与下一块都越过线，
// 会选中第二项。420 留 71px 余量；下方另有 `scrollY <= 0` 短路兜住文案被删减的情况。
const LINE_MAX = 420
const firstId = sectionRail[0].id
const lastId = sectionRail[sectionRail.length - 1].id

export function SectionRail() {
  const [active, setActive] = useState<string>(firstId)

  useEffect(() => {
    let frame = 0

    const compute = () => {
      // 必须复位：漏这行，首次滚动后 `if (!frame)` 永假，rAF 不再排队，高亮会冻在第一帧
      frame = 0

      // 页顶直接给第一项（4K 屏 innerHeight 大、阈值线被抬到 420，不短路也能算对，但短路更省事且兜文案被删）
      if (window.scrollY <= 0) {
        setActive(firstId)
        return
      }

      const line = Math.min(window.innerHeight * LINE_RATIO, LINE_MAX)
      // 文末兜底：页脚高度会让最后一块永远够不到阈值线，不加这条最后一项永远选不上
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        setActive(lastId)
        return
      }

      // 显式 string：`sectionRail` 是 `as const`，不收宽的话 `current = item.id` 会触发 TS2322
      let current: string = firstId
      for (const item of sectionRail) {
        const el = document.getElementById(item.id)
        if (!el) continue
        if (el.getBoundingClientRect().top > line) break
        current = item.id
      }
      setActive(current)
    }

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(compute)
    }

    // 布局变化不发 scroll 事件：features 换 banner、quick-start 手风琴展开、图片加载完成都会推移
    // 后面板块的边界，只订阅 scroll 的话高亮会停在旧值，直到用户自己滚一下才纠正。
    // 观察 body：内容高于视口时 body 高 = 内容高，任一块变高变矮都会触发；内容不足一屏时页面本就不可滚，高亮恒为第一项。
    const ro = new ResizeObserver(onScroll)
    ro.observe(document.body)

    // 挂载即算一次：直接带锚点进来（如 /#faq）时，不用等用户滚动就该高亮正确项
    compute()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      ro.disconnect()
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    <nav
      aria-label="页内导航"
      className="fixed top-1/2 right-4 z-40 hidden -translate-y-1/2 [writing-mode:vertical-rl] lg:block xl:right-6"
    >
      {/* 竖排下块流是右→左，裸 `<li>` 会排成 7 列「书脊」（条宽 ≈110px，压进正文）；
          显式 `flex` 才能沿 inline 轴（上→下）堆叠。**不要 `flex-col`** —— 那还是块轴，仍旧右→左。 */}
      <ul className="flex gap-4">
        {sectionRail.map((item) => {
          const isActive = item.id === active
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={isActive ? 'true' : undefined}
                className={`block border-r-2 pr-2 text-xs transition-colors motion-reduce:transition-none ${
                  isActive
                    ? 'border-accent font-semibold text-ink-950'
                    : 'border-transparent text-ink-900/75 hover:text-ink-950'
                }`}
              >
                {item.label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
