import type { ReleaseManifest } from '../lib/latest-yml'
import { releaseFileUrl } from '../lib/latest-yml'
import { GITHUB_REPO_URL, platforms } from '../content/site'

export type Platform = (typeof platforms)[number]

const box = 'rounded-[10px] px-6 py-3 text-center text-[15px] font-semibold transition-all'
const tag = 'whitespace-nowrap rounded border border-ink-700 px-1.5 py-0.5 text-[11px] text-ink-900/45'

// 单平台入口：清单读到 + 该平台有产物 ⇒ 真下载链接，否则置灰并挂小标签说明状态
// （Windows 置灰 = downloads/latest.yml 没读到；macOS / Linux 置灰 = 安装包本身还没出）
// 按钮正文只留平台名，状态交给标签；不写系统要求备注 —— AOT self-contained 产物不挑环境。
// 2026-09-21：状态标签的位置调过两次，两次都为同一件事 —— 三个平台按钮必须等宽。
//   ① 最初与按钮并排（外层 flex + 按钮 flex-1）⇒ 标签文字长短直接挤压按钮宽度，「直链建设中」与
//      「待发布 · 敬请期待」令三行宽度参差。
//   ② 改到按钮下方（flex-col）⇒ 宽度是齐了，但每个平台多占一行高度。
//   ⇒ 现在：标签绝对定位在按钮内部右侧。按钮 `w-full` 宽度只由容器决定（不参与分配），
//      标签不占任何布局空间（与 Windows 项等高）。摆放用 `right-3` 靠右，按钮正文仍居中，二者不重叠。
export function PlatformButton(props: { platform: Platform; manifest: ReleaseManifest | undefined }) {
  // 唯一产物是 Windows 安装包；地址落在官网的下载目录（同域的 `/downloads`）⇒
  // `download` 属性真正生效（跨域时浏览器会忽略它，早先指 GitHub 直链就是那种情况）。
  const url = props.platform.id === 'windows' && props.manifest ? releaseFileUrl(props.manifest) : ''
  if (url) {
    return (
      <a href={url} download className={`${box} block w-full bg-accent text-white hover:opacity-90`}>
        {props.platform.label}
      </a>
    )
  }
  return (
    <div className="relative">
      <span role="link" aria-disabled="true" className={`${box} block w-full cursor-not-allowed bg-ink-800 text-ink-900/40`}>
        {props.platform.label}
      </span>
      <span className={`absolute top-1/2 right-3 -translate-y-1/2 ${tag}`}>{props.platform.pendingTag}</span>
    </div>
  )
}

// /download 页用：三平台逐行 + GitHub 兜底入口（清单取不到时它仍然点得动）
export function DownloadButtons(props: { manifest: ReleaseManifest | undefined }) {
  return (
    <div className="flex flex-col gap-3">
      {platforms.map((platform) => (
        <PlatformButton key={platform.id} platform={platform} manifest={props.manifest} />
      ))}
      <a
        href={`${GITHUB_REPO_URL}/releases/latest`}
        target="_blank"
        rel="noopener noreferrer"
        className={`${box} border border-ink-700 bg-paper text-ink-950 hover:border-accent hover:text-accent`}
      >
        GitHub Releases
      </a>
    </div>
  )
}
