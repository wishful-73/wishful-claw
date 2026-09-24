import { BRAND, footer } from '../content/site'

export function SiteFooter() {
  return (
    <footer className="border-t border-ink-700 bg-paper-soft py-12">
      <div className="flex w-full flex-col gap-4 px-6 text-sm text-ink-900/55 sm:flex-row sm:items-center sm:justify-between sm:px-10 lg:px-14">
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
