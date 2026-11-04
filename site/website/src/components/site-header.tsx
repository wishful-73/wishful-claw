import { useEffect, useState } from 'react'
import { BRAND, nav } from '../content/site'

// shrink-0 + whitespace-nowrap：中文在 flex 里会被压到任意字后换行（品牌名从四字改两字后顶栏竖排），
// 顶栏所有文本项都不许折行。
//
// 顶栏底色（2026-10-19 老大：背景动画是整页的，顶栏这一条也得让它透出来）：
//   页面顶部：全透明，一点底色都不留，连下边框也一并透明（不然会在动画上横切一道硬线）；
//   往下滚之后：内容会从底下穿过去，必须回到「玻璃底 + 下边框」保证导航可读，否则字压字。
// 边框宽度两态都是 1px，切换不产生位移。阈值 8px 足够，不需要 IntersectionObserver。
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-colors ${
        scrolled ? 'border-ink-700 bg-paper/85 backdrop-blur' : 'border-transparent bg-transparent'
      }`}
    >
      <div className="flex h-14 w-full items-center justify-between gap-4 px-6 sm:px-10 lg:px-14">
        <a href="./" className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[15px] font-semibold text-ink-950">
          <img src="./logo.png" alt={`${BRAND.name} Logo`} className="h-6 w-6 rounded" />
          {BRAND.name}
          <span className="text-xs font-normal text-ink-900/45">
            {BRAND.category} · {BRAND.latin}
          </span>
        </a>
        <nav className="hidden items-center gap-6 whitespace-nowrap text-sm text-ink-900/65 sm:flex">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="shrink-0 transition-colors hover:text-ink-950"
            >
              {item.label}
            </a>
          ))}
          <a
            href="./download"
            className="shrink-0 rounded-[9px] bg-accent px-4 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            下载
          </a>
        </nav>
      </div>
    </header>
  )
}
