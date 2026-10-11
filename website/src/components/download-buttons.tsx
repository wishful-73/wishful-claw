import { useEffect, useRef, useState } from 'react'
import type { ReleaseManifest } from '../lib/latest-yml'
import { goUrl, releaseFileUrl } from '../lib/latest-yml'
import { downloadSources, platforms } from '../content/site'
import { PlatformIcon } from './platform-icons'

export type Platform = (typeof platforms)[number]

// 胶囊按钮基类（2026-09-24 老大：抄 mimo.xiaomimimo.com/desktop 的 .hero-download）——
// 高 56px、全圆角、图标 + 平台名水平居中、间距 12px。
// 光效（旋转描边环 + 扫光）在 index.css 的 .dl-current / .dl-shine 里，只有真能下的平台挂。
const box = 'flex h-14 items-center justify-center gap-3 rounded-full px-6 text-[15px] font-semibold transition-transform'
const tag = 'whitespace-nowrap rounded border border-ink-700 px-1.5 py-0.5 text-[11px] text-ink-900/45'

// 下拉菜单项：左源名、右一行小字说明；整行可点。
const menuItem = 'flex items-center justify-between gap-3 px-3.5 py-2 text-sm text-ink-900 hover:bg-paper-soft'
const menuNote = 'shrink-0 text-xs text-ink-900/45'

// Windows 下载项（S-186，2026-10-10 老大）：主按钮 + 源菜单。
//
// 起因：服务器 1M 带宽，实测下载只有约 128 KB/s ⇒ 安装包改从 GitHub Releases 取，
// 经国内公益加速站下载；软件内的自动更新链路（`latest.yml` / blockmap / 差分）**不调整**。
//
// 形态（2026-10-11 老大：下拉与按钮合并，别单独挂一个圆钮）：
//   · 一条分体胶囊 —— 左侧主下载区 = 默认源（第一个实测可用的加速站），一次点击直接下，不多一步；
//   · 右侧箭头区（同一条胶囊内，1px 分隔线）展开菜单换源（少数情况）；
//   · 所有下载入口一律 `target="_blank"` **新开选项卡**（2026-10-11 老大）—— 下载页是本站，
//     不能被这次下载顶掉：原先当前页跳到 `/go` 再跳加速站，地址栏一换本站就「没了」，
//     用户想换个源还得先按返回。新开选项卡后本站原地不动，下载在另一个选项卡里走完。
//   · 每个源都先到官网自己的中转页 `/go`（S-186 §六）—— 页面请求本身就被 nginx 记下，
//     中转页里不用写任何上报代码；「本站直链」那一项除外，它不经 `/go`，直接指自己服务器。
//     href 只带源名（`goUrl`），加速站前缀与 GitHub 直链由中转页自己按 `latest.yml` 拼 ——
//     地址里不再出现目标 URL（2026-10-11 收紧，原先整条直链放在 `u` 参数里）。
//
// 光效挂整条胶囊容器（不再只挂主按钮）：`.dl-current` 的负 z-index 光环靠 `isolation: isolate`
// 圈在容器自身范围内。
// ⚠️ 容器里的箭头必须自己提层级（`absolute z-10`）—— `::after` 是铺满容器的实心层（`z-index: -1`），
//    不提会被它盖住；主下载区在正常流里，天然落在 `::after` 之上，不用特殊处理。
function WindowsDownload(props: { platform: Platform; manifest: ReleaseManifest }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // 点别处 / 按 Esc 收起菜单。只认 mousedown：click 要留给菜单项自己的跳转。
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const local = releaseFileUrl(props.manifest)
  const primary = downloadSources[0]

  return (
    <div ref={rootRef} className="relative w-full">
      {/* 分体胶囊（2026-10-11 老大：下拉不要单独挂一个圆钮）：主下载区与右侧箭头同处一个圆角容器
          —— 下载页三平台并排时，与 macOS / Linux 的素胶囊同宽同形。 */}
      <div className="dl-current flex h-14 w-full items-center overflow-hidden rounded-full bg-accent text-white transition-transform hover:scale-[1.04]">
        <span className="dl-shine" aria-hidden="true" />
        {/* 主下载区：默认源，一次点击直接下。`px-12` 两侧对称 —— 右侧 48px 正好让给箭头区，
            文字因此仍居中于整条胶囊，也不会被箭头压住。
            不再挂 `download` 属性 —— 跨域时浏览器本就忽略它（见下），文件名改由加速站 / GitHub
            的 `Content-Disposition` 决定。 */}
        <a
          href={goUrl(primary.id)}
          target="_blank"
          rel="noopener"
          className="flex h-full w-full items-center justify-center gap-3 px-12 text-[15px] font-semibold"
        >
          <PlatformIcon id={props.platform.id} />
          {props.platform.label}
        </a>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="选择下载源"
          onClick={() => setOpen((value) => !value)}
          className="absolute top-0 right-0 z-10 flex h-full w-12 cursor-pointer items-center justify-center border-l border-white/25"
        >
          <svg viewBox="0 0 24 24" fill="none" className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open && (
        <div
          role="menu"
          className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-ink-700 bg-paper py-1 shadow-lg"
        >
          {downloadSources.map((source) => (
            <a
              key={source.id}
              role="menuitem"
              href={goUrl(source.id)}
              target="_blank"
              rel="noopener"
              className={menuItem}
            >
              <span className="truncate">{source.label}</span>
              {source.note && <span className={menuNote}>{source.note}</span>}
            </a>
          ))}
          <div className="my-1 h-px bg-ink-700" />
          {/* 本站直链：不走 /go（它自己就是 nginx 数得到的那个来源），保留 `download`
              —— 同域请求下这个属性真正生效。 */}
          <a role="menuitem" href={local} download target="_blank" rel="noopener" className={menuItem}>
            <span className="truncate">本站直链</span>
            <span className={menuNote}>服务器带宽小，较慢</span>
          </a>
        </div>
      )}
    </div>
  )
}

// 单平台入口：清单读到 + 该平台有产物 ⇒ 真下载链接，否则置灰并挂小标签说明状态
// （Windows 置灰 = downloads/latest.yml 没读到；macOS / Linux 置灰 = 安装包本身还没出）
// 按钮正文只留平台名，状态交给标签；不写系统要求备注 —— AOT self-contained 产物不挑环境。
// 2026-09-21：状态标签的位置调过两次，两次都为同一件事 —— 三个平台按钮必须等宽。
//   ① 最初与按钮并排（外层 flex + 按钮 flex-1）⇒ 标签文字长短直接挤压按钮宽度，「直链建设中」与
//      「待发布 · 敬请期待」令三行宽度参差。
//   ② 改到按钮下方（flex-col）⇒ 宽度是齐了，但每个平台多占一行高度。
//   ⇒ 现在：标签绝对定位在按钮内部右侧。按钮宽度只由容器决定（不参与分配），
//      标签不占任何布局空间（与 Windows 项等高）。摆放用 `right-3` 靠右，按钮正文仍居中，二者不重叠。
// 2026-09-24：形态改胶囊 + 平台图标（抄 mimo.xiaomimimo.com 的下载按钮）。只有能下的那个平台挂
//   `dl-current` 拿旋转描边环与扫光 —— 三个一起闪就成了霓虹灯，重点也没了（同 .shine 文字闪光的取舍）。
// 2026-10-10（S-186）：Windows 项改「主按钮 + 源菜单」（见 WindowsDownload）；两个占位平台的形态不动。
export function PlatformButton(props: { platform: Platform; manifest: ReleaseManifest | undefined }) {
  if (props.platform.id === 'windows' && props.manifest) {
    return <WindowsDownload platform={props.platform} manifest={props.manifest} />
  }
  return (
    <div className="relative">
      <span role="link" aria-disabled="true" className={`${box} cursor-not-allowed bg-ink-800 text-ink-900/40`}>
        <PlatformIcon id={props.platform.id} />
        {props.platform.label}
      </span>
      <span className={`absolute top-1/2 right-3 -translate-y-1/2 ${tag}`}>{props.platform.pendingTag}</span>
    </div>
  )
}

// /download 页用：桌面宽度下三平台横排一行 —— 下载页是通栏的（上一版把 max-w-3xl 收束去掉了
// 来对齐首页），逐行堆叠会变成三条几乎满屏宽的按钮，看着像三根横条。窄屏退回逐行，各自占满宽度。
// 不再放 GitHub 按钮：同一张卡下方已有「查看全部版本 →」指向同一处，一张卡里挂两个同一链接是冗余。
export function DownloadButtons(props: { manifest: ReleaseManifest | undefined }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        {platforms.map((platform) => (
          <PlatformButton key={platform.id} platform={platform} manifest={props.manifest} />
        ))}
      </div>
      {/* 来源说明（S-186 §五 第 4 条，属实施细节）：加速站是公益服务，随时可能失效 —— 先说清楚，
          用户遇到打不开时知道换一个，而不是以为下载坏了。 */}
      <p className="mt-4 text-xs text-ink-900/45">
        下载由第三方公益加速站提供；若某个源不可用，请点右侧箭头换一个。
      </p>
    </>
  )
}
