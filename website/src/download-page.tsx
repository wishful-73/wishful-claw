import { SiteHeader } from './components/site-header'
import { SiteFooter } from './sections/site-footer'
import { DownloadButtons } from './components/download-buttons'
import { useLatestInfo } from './lib/site-data'
import { footer, quickStart } from './content/site'

export default function DownloadPage() {
  const info = useLatestInfo()
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-6 py-20">
        <h1 className="text-4xl font-semibold tracking-tight text-ink-950">
          下载<span className="text-accent">心相龙虾</span>
        </h1>
        <p className="mt-4 leading-relaxed text-ink-900/65">
          key 自己带，渠道随便接。在你电脑上真干活的桌面 AI Agent，软件免费。
        </p>

        <div className="mt-10 rounded-[13px] border border-ink-700 bg-paper p-8 shadow-[0_1px_2px_rgba(27,30,36,0.06),0_12px_32px_-16px_rgba(27,30,36,0.24)]">
          <p className="text-sm text-ink-900/65">
            当前版本：
            <span className="font-semibold text-ink-950">v{info?.version ?? '—'}</span>
            <span className="ml-2 rounded border border-accent/40 px-1.5 py-0.5 text-[11px] text-accent">非正式版</span>
          </p>
          <p className="mt-2 text-sm text-ink-900/55">系统要求：{info?.systemRequirements ?? 'Windows 10/11（64 位）'}</p>
          <div className="mt-7">
            <DownloadButtons info={info} />
          </div>
          <p className="mt-5 text-sm text-ink-900/45">
            官网直链通道（COS）建设中，当前请走 GitHub Releases；
            <a href={footer.github} target="_blank" rel="noopener noreferrer" className="ml-1 font-medium text-accent hover:underline">
              查看全部版本 →
            </a>
          </p>
        </div>

        <h2 className="mt-14 mb-6 text-xl font-semibold text-ink-950">装好之后，三步开始</h2>
        <ol className="flex flex-col gap-3">
          {quickStart.steps.map((step, i) => (
            <li key={step.name} className="flex items-baseline gap-3 rounded-[13px] border border-ink-700 bg-paper p-5 text-sm">
              <span className="font-semibold text-accent">{i + 1}</span>
              <span className="font-medium text-ink-950">{step.name}</span>
              <span className="text-ink-900/55">— {step.desc}</span>
            </li>
          ))}
        </ol>

        <p className="mt-10 text-sm text-ink-900/45">
          回到 <a href="./index.html" className="font-medium text-accent hover:underline">首页</a>
        </p>
      </main>
      <SiteFooter />
    </>
  )
}
