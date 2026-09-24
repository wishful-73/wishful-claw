import type { ReleaseManifest } from '../lib/latest-yml'
import { releaseFileUrl } from '../lib/latest-yml'
import { platforms } from '../content/site'
import { PlatformIcon } from './platform-icons'

export type Platform = (typeof platforms)[number]

// 胶囊按钮基类（2026-09-24 老大：抄 mimo.xiaomimimo.com/desktop 的 .hero-download）——
// 高 56px、全圆角、图标 + 平台名水平居中、间距 12px。
// 光效（旋转描边环 + 扫光）在 index.css 的 .dl-current / .dl-shine 里，只有真能下的平台挂。
const box = 'flex h-14 items-center justify-center gap-3 rounded-full px-6 text-[15px] font-semibold transition-transform'
const tag = 'whitespace-nowrap rounded border border-ink-700 px-1.5 py-0.5 text-[11px] text-ink-900/45'

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
export function PlatformButton(props: { platform: Platform; manifest: ReleaseManifest | undefined }) {
  // 唯一产物是 Windows 安装包；地址落在官网的下载目录（同域的 `/downloads`）⇒
  // `download` 属性真正生效（跨域时浏览器会忽略它，早先指 GitHub 直链就是那种情况）。
  const url = props.platform.id === 'windows' && props.manifest ? releaseFileUrl(props.manifest) : ''
  if (url) {
    return (
      <a href={url} download className={`${box} dl-current bg-accent text-white hover:scale-[1.04]`}>
        <span className="dl-shine" aria-hidden="true" />
        <PlatformIcon id={props.platform.id} />
        {props.platform.label}
      </a>
    )
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
    <div className="grid gap-3 sm:grid-cols-3">
      {platforms.map((platform) => (
        <PlatformButton key={platform.id} platform={platform} manifest={props.manifest} />
      ))}
    </div>
  )
}
