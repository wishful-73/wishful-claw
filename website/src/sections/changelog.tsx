import { footer } from '../content/site'
import { useRecentReleases } from '../lib/site-data'
import { Reveal, Section } from '../components/ui'

// 最近 5 个版本的变更摘要，取不到就整块隐藏（GitHub API 限流时不让页面留破洞）
export function Changelog() {
  const releases = useRecentReleases()
  if (!releases || releases.length === 0) return null

  return (
    <Section id="changelog" eyebrow="Changelog" title="更新日志">
      <Reveal>
        <ul className="flex flex-col divide-y divide-ink-700 rounded-[13px] border border-ink-700 bg-paper">
          {releases.map((item) => (
            <li key={item.tag_name} className="p-6">
              <div className="flex flex-wrap items-baseline gap-3">
                <a
                  href={item.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-ink-950 hover:text-accent"
                >
                  {item.name || item.tag_name}
                </a>
                <span className="text-xs text-ink-900/40">{item.published_at.slice(0, 10)}</span>
              </div>
              <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-ink-900/60">
                {item.body?.slice(0, 240)}
              </p>
            </li>
          ))}
        </ul>
        <a href={footer.github} target="_blank" rel="noopener noreferrer" className="mt-5 inline-block text-sm font-medium text-accent hover:underline">
          完整历史见 GitHub Releases →
        </a>
      </Reveal>
    </Section>
  )
}
