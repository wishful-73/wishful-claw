import { useEffect, useState } from 'react'

// 回到顶部浮动按钮（S-228，2026-10-26 老大定：右下角独立浮动按钮）。
//
// 为什么不复用 section-rail 第一项「开始」（2026-10-26 10:19 已从「概览」改名）：
// 那是板块锚点、竖排文字项，语义是「跳到首页顶部这一块」而不是「回到顶部」，
// 用户不会把它读成回顶入口；且整栏 `hidden lg:block`，1024px 以下完全不存在。
//
// 阈值 480px：Hero 实测约 490px（见 section-rail.tsx 的阈值线注释）。
// 滚过首屏才出现 ⇒ 短页面自然不触发，组件可安全挂在任何页面。
const SHOW_AFTER_PX = 480
// 隐藏阈值比显示低 40px：单一阈值时用户停在 480 附近微调，按钮会反复淡入淡出
const HIDE_BELOW_PX = 440

export function BackToTop() {
  // 惰性初始化：刷新后浏览器的滚动位置恢复发生在首次渲染之前，这里能直接对上，
  // 免得「已经在页面中部」时先藏一帧。effect 里的 onScroll() 仍要跑 —— 带 #hash
  // 直达时位置恢复可能晚于首次渲染。
  const [visible, setVisible] = useState(() => window.scrollY > SHOW_AFTER_PX)

  useEffect(() => {
    const onScroll = (): void => {
      const y = window.scrollY
      setVisible((prev) => (prev ? y > HIDE_BELOW_PX : y > SHOW_AFTER_PX))
    }
    // 立即跑一次：刷新 / 带锚点直达时可能已经在页面中部，不跑会先藏一下再冒出来
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // 平滑还是瞬间由 index.css 的 `html { scroll-behavior }` 决定（含 prefers-reduced-motion
  // 覆盖）。这里绝不能传 behavior: 'auto' —— 它的语义是「按 CSS 走」，等于没写。
  const toTop = (): void => {
    window.scrollTo(0, 0)
  }

  return (
    <button
      type="button"
      onClick={toTop}
      aria-label="回到顶部"
      // inert：隐藏时移出无障碍树、不可聚焦、不吃指针事件，三件事一次解决
      // （只给 tabIndex={-1} 挡不住「已经聚焦后按钮变隐藏」的焦点滞留）
      inert={!visible}
      className={`fixed right-5 bottom-5 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-ink-700 bg-paper/90 text-ink-900/70 shadow-sm backdrop-blur transition duration-200 hover:border-accent/40 hover:text-accent motion-reduce:transition-none sm:right-6 sm:bottom-6 ${
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
      </svg>
    </button>
  )
}
