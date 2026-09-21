import { BRAND, nav } from '../content/site'

// shrink-0 + whitespace-nowrap：中文在 flex 里会被压到任意字后换行（品牌名从四字改两字后顶栏竖排），
// 顶栏所有文本项都不许折行。
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-ink-700 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-6">
        <a href="./" className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[15px] font-semibold text-ink-950">
          <img src="./logo.png" alt={`${BRAND.name} Logo`} className="h-6 w-6 rounded" />
          {BRAND.name}
          <span className="text-xs font-normal text-ink-900/45">
            {BRAND.category} · {BRAND.latin}
          </span>
        </a>
        <nav className="hidden items-center gap-6 whitespace-nowrap text-sm text-ink-900/65 sm:flex">
          {nav.map((item) => (
            <a key={item.href} href={item.href} className="shrink-0 transition-colors hover:text-ink-950">
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
