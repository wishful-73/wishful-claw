import { BRAND, footer } from '../content/site'
import { formatCount, MIN_VISIBLE_COUNT, useSiteStats } from '../lib/site-stats'
import { shellPadding } from '../components/ui'

export function SiteFooter() {
  const visits = useSiteStats()?.visits
  return (
    // 页脚背景改透明（2026-11-13 老大：「底部有背景色，导致跟主页和其它页面的宽度看起来都别扭，
    // 要不底部的也搞成背景透明」）：内容按 `shellPadding` 收进 224 留白后，通栏的浅灰色块
    // 就成了一条比内容宽出一大截的横带，边界跟上面的内容对不上。去掉色块，只留 `border-t`
    // 一条通栏分隔线 —— 分隔线通栏、内容留白，这是常规做法，不会再产生「谁比谁宽」的错觉。
    <footer className="border-t border-ink-700 py-12">
      <div className={`flex w-full flex-col gap-4 text-sm text-ink-900/55 sm:flex-row sm:items-center sm:justify-between ${shellPadding}`}>
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 font-semibold text-ink-950">
            <img src="./logo.png" alt={`${BRAND.name} Logo`} className="h-5 w-5 rounded" />
            {BRAND.name} <span className="text-xs font-normal text-ink-900/45">{BRAND.category} · {BRAND.latin}</span>
          </p>
          <p className="text-xs tracking-[0.16em] text-ink-900/45">{BRAND.vision}</p>
          <p className="flex flex-wrap gap-x-6 gap-y-2">
            <a href={footer.github} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
              GitHub
            </a>
            <a href={footer.feedback} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
              问题反馈
            </a>
            {/* 访问次数（S-182）：全站 footer 展示，与下载次数同一条口径（不足 100 次不显示）。 */}
            {visits !== undefined && visits >= MIN_VISIBLE_COUNT && <span>访问 {formatCount(visits)} 次</span>}
          </p>
        </div>
        <p className="text-xs text-ink-900/35">
          © {new Date().getFullYear()} WishfulClaw ·{' '}
          <a
            href={footer.icpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-900/45 hover:text-accent"
          >
            {footer.icp}
          </a>
          {' · '}
          <a
            href={footer.policeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 align-middle text-ink-900/45 hover:text-accent"
          >
            <img src="./police-badge.png" alt="" className="h-3.5 w-auto" />
            {footer.police}
          </a>
        </p>
      </div>
    </footer>
  )
}
