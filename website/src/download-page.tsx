import { SiteHeader } from './components/site-header'
import { SiteFooter } from './sections/site-footer'
import { DownloadButtons } from './components/download-buttons'
import { useLatestInfo } from './lib/site-data'
import { BRAND, footer, quickStart } from './content/site'

export default function DownloadPage() {
  const info = useLatestInfo()
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl px-6 py-20">
        <h1 className="text-4xl font-semibold tracking-tight text-ink-950">
          下载<span className="text-accent">{BRAND.name}</span>
        </h1>
        <p className="mt-4 leading-relaxed text-ink-900/65">
          在你电脑上真干活的 AI 智能助手。模型自己选，渠道随便接。
        </p>

        <div className="mt-10 rounded-[13px] border border-ink-700 bg-paper p-8 shadow-[0_1px_2px_rgba(27,30,36,0.06),0_12px_32px_-16px_rgba(27,30,36,0.24)]">
          <p className="text-sm text-ink-900/65">
            当前版本：
            <span className="font-semibold text-ink-950">v{info?.version ?? '—'}</span>
          </p>
          <div className="mt-7">
            <DownloadButtons info={info} />
          </div>
          <p className="mt-5 text-sm text-ink-900/45">
            想看每个迭代改了什么、或需要旧版本，都在 GitHub Releases：
            <a href={footer.github} target="_blank" rel="noopener noreferrer" className="ml-1 font-medium text-accent hover:underline">
              查看全部版本 →
            </a>
          </p>
        </div>

        <h2 className="mt-14 mb-6 text-xl font-semibold text-ink-950">装好之后，{quickStart.title}</h2>
        <ol className="flex flex-col gap-3">
          {quickStart.steps.map((step, i) => (
            <li key={step.name} className="rounded-[13px] border border-ink-700 bg-paper p-5">
              {/* 序号 + 步骤名独占一行，说明另起一行 —— 与首页「四步开始」的卡内结构一致。
                  原来是三者并排（flex items-baseline），长说明把标题挤成一行里的碎片，读不出层级。
                  并排时的那个连接破折号随之去掉：分行后它不再有连接作用。 */}
              <p className="flex items-baseline gap-3">
                <span className="text-sm font-semibold text-accent">{i + 1}</span>
                <span className="text-sm font-medium text-ink-950">{step.name}</span>
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink-900/55">{step.desc}</p>
            </li>
          ))}
        </ol>

        <p className="mt-10 text-sm text-ink-900/45">
          回到 <a href="./" className="font-medium text-accent hover:underline">首页</a>
        </p>
      </main>
      <SiteFooter />
    </>
  )
}
