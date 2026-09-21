import { footer } from '../content/site'
import { useLatestInfo } from '../lib/site-data'
import { Reveal, Section } from '../components/ui'

// 双卡并排布局参考 Reasonix 首屏下载区（桌面端 / CLI 两卡）：左卡官网直链，右卡 GitHub
export function DownloadCta() {
  const info = useLatestInfo()
  return (
    <Section id="download" eyebrow="Download" title="下载心相龙虾">
      <Reveal>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="rounded-[13px] border border-accent/45 bg-accent/[0.04] p-8">
            <p className="text-xs font-semibold text-accent">官网直链</p>
            <h3 className="mt-2 text-lg font-semibold text-ink-950">
              下载 v{info?.version ?? '—'}
              <span className="ml-2 rounded border border-accent/40 px-1.5 py-0.5 align-middle text-[11px] font-normal text-accent">
                非正式版
              </span>
            </h3>
            <p className="mt-2 text-sm text-ink-900/55">{info?.systemRequirements ?? 'Windows 10/11（64 位）'}</p>
            <div className="mt-6">
              {info?.downloads.direct ? (
                <a
                  href={info.downloads.direct}
                  className="block rounded-[10px] bg-accent px-6 py-3 text-center text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
                >
                  直接下载（Windows）
                </a>
              ) : (
                <span
                  role="link"
                  aria-disabled="true"
                  title="官网直链通道建设中，当前请走右卡 GitHub"
                  className="block cursor-not-allowed rounded-[10px] bg-ink-800 px-6 py-3 text-center text-[15px] font-semibold text-ink-900/40"
                >
                  直接下载 · 通道建设中
                </span>
              )}
            </div>
          </div>
          <div className="rounded-[13px] border border-ink-700 bg-paper p-8">
            <p className="text-xs font-semibold text-ink-900/55">GitHub Releases</p>
            <h3 className="mt-2 text-lg font-semibold text-ink-950">
              查看全部版本与更新日志
              <span className="ml-2 rounded border border-ink-700 px-1.5 py-0.5 align-middle text-[11px] font-normal text-ink-900/50">
                当前可用
              </span>
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-900/55">
              每个迭代的变更摘要、历史安装包都在这里。官网直链通道（COS）建设中，当前推荐走这里。
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
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-ink-900/40">{footer.disclaimer}</p>
      </Reveal>
    </Section>
  )
}
