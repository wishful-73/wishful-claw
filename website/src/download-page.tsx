import { SiteHeader } from './components/site-header'
import { SiteFooter } from './sections/site-footer'
import { DownloadButtons } from './components/download-buttons'
import { useReleaseManifest } from './lib/site-data'
import { BRAND, footer, quickStart } from './content/site'

export default function DownloadPage() {
  const manifest = useReleaseManifest()
  return (
    <>
      <SiteHeader />
      {/* 下载区拆卡改居中（2026-09-24 方案 A，参考 mimo.xiaomimimo.com/desktop）：
          平台按钮直接居中摆，不再套卡片；版本行与 GitHub 外链并成按钮下方一行注脚。
          原卡片的问题是三行里两行「一句话 + 七百多像素空白」，且卡片居中（x=88）与标题 / 四步（x=56）错位。
          四步区仍是通栏左对齐，与上半的居中英雄区各归各的层级。 */}
      <main className="w-full px-6 py-20 sm:px-10 lg:px-14">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-ink-950">
            下载<span className="text-accent">{BRAND.name}</span>
          </h1>
          <p className="mt-4 leading-relaxed text-ink-900/65">
            在你电脑上真干活的 AI 智能助手。模型自己选，渠道随便接。
          </p>

          <div className="mt-9">
            <DownloadButtons manifest={manifest} />
          </div>
        </div>

        {/* 注脚留在 hero 窄列外面、自己通栏居中：版本号是动态的，`v0.2.35` 比占位符 `v—` 长一截，
            放进 768 的窄列里会由一行折成两行，版本一发布版面就抖一下。 */}
        <p className="mt-5 text-center text-sm text-ink-900/45">
          当前版本 <span className="font-semibold text-ink-950">v{manifest?.version ?? '—'}</span>
          <span className="mx-2 text-ink-900/25">·</span>
          想看每个迭代改了什么、或需要旧版本，都在 GitHub Releases：
          <a href={footer.github} target="_blank" rel="noopener noreferrer" className="ml-1 font-medium text-accent hover:underline">
            查看全部版本 →
          </a>
        </p>

        <h2 className="mt-14 mb-6 text-xl font-semibold text-ink-950">装好之后，{quickStart.title}</h2>
        {/* 四步两列一行（2026-09-24 老大）：四张卡各自通栏太宽，网格排成 2×2。 */}
        <ol className="grid gap-3 sm:grid-cols-2">
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
      </main>
      <SiteFooter />
    </>
  )
}
