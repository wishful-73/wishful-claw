import { BRAND, footer, platforms } from '../content/site'
import { PlatformButton } from '../components/download-buttons'
import { useLatestInfo } from '../lib/site-data'
import { Reveal, Section } from '../components/ui'

// 双卡并排布局参考 Reasonix 首屏下载区：左卡官网直链（逐平台），右卡 GitHub
export function DownloadCta() {
  const info = useLatestInfo()
  return (
    <Section id="download" eyebrow="Download" title={`下载${BRAND.name}`}>
      <Reveal>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="rounded-[13px] border border-accent/45 bg-accent/[0.04] p-8">
            <p className="text-xs font-semibold text-accent">直接下载</p>
            <h3 className="mt-2 text-lg font-semibold text-ink-950">当前版本 v{info?.version ?? '—'}</h3>
            <ul className="mt-6 flex flex-col gap-3">
              {platforms.map((platform) => (
                <li key={platform.id}>
                  <PlatformButton platform={platform} info={info} />
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[13px] border border-ink-700 bg-paper p-8">
            {/* 小标题原为「官网直链」，「当前可用」chip 也是为对照「官网通道建设中」而挂的 ——
                2026-09-21 左卡改叫「直接下载」、Windows 直链已可用，那层对照不存在了，chip 一并去掉。 */}
            <p className="text-xs font-semibold text-ink-900/55">GitHub Releases</p>
            <h3 className="mt-2 text-lg font-semibold text-ink-950">全部版本与更新日志</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-900/55">
              每个迭代改了什么、需要旧版本时去哪找，都在这里。
            </p>
            <a
              href={info?.downloads.github ?? footer.github}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-block rounded-[10px] border border-ink-700 bg-paper px-6 py-3 text-center text-[15px] font-semibold text-ink-950 transition-colors hover:border-accent hover:text-accent"
            >
              GitHub Releases →
            </a>
          </div>
        </div>
      </Reveal>
    </Section>
  )
}
