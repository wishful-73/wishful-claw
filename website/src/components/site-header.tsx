import { nav } from '../content/site'

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-ink-700 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <a href="./index.html" className="flex items-center gap-2 text-[15px] font-semibold text-ink-950">
          <img src="./logo.png" alt="心相龙虾 Logo" className="h-6 w-6 rounded" />
          心相龙虾
          <span className="text-xs font-normal text-ink-900/45">WishfulClaw</span>
        </a>
        <nav className="hidden items-center gap-7 text-sm text-ink-900/65 sm:flex">
          {nav.map((item) => (
            <a key={item.href} href={item.href} className="transition-colors hover:text-ink-950">
              {item.label}
            </a>
          ))}
          <a
            href="./download.html"
            className="rounded-[9px] bg-accent px-4 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            安装
          </a>
        </nav>
      </div>
    </header>
  )
}
