import type { LatestInfo } from '../content/site'
import { GITHUB_REPO_URL, platforms } from '../content/site'

export type Platform = (typeof platforms)[number]

const box = 'rounded-[10px] px-6 py-3 text-center text-[15px] font-semibold transition-all'
const tag = 'whitespace-nowrap rounded border border-ink-700 px-1.5 py-0.5 text-[11px] text-ink-900/45'

// 单平台入口：latest.json 里该平台的 URL 非空即为真下载链接，空则置灰并挂小标签说明状态
// （Windows 空 = latest.json 没读到 / 值还没填；macOS / Linux 空 = 安装包本身还没出）
// 按钮正文只留平台名，状态交给标签；不写系统要求备注 —— AOT self-contained 产物不挑环境。
// 2026-09-21：状态标签的位置调过两次，两次都为同一件事 —— 三个平台按钮必须等宽。
//   ① 最初与按钮并排（外层 flex + 按钮 flex-1）⇒ 标签文字长短直接挤压按钮宽度，「直链建设中」与
//      「待发布 · 敬请期待」令三行宽度参差。
//   ② 改到按钮下方（flex-col）⇒ 宽度是齐了，但每个平台多占一行高度。
//   ⇒ 现在：标签绝对定位在按钮内部右侧。按钮 `w-full` 宽度只由容器决定（不参与分配），
//      标签不占任何布局空间（与 Windows 项等高）。摆放用 `right-3` 靠右，按钮正文仍居中，二者不重叠。
export function PlatformButton(props: { platform: Platform; info: LatestInfo | undefined }) {
  const url = props.info?.downloads[props.platform.urlKey] ?? ''
  // `download` 属性：同域直链时强制下载、并以此为保存文件名；跨域时浏览器会忽略它
  // （当前 GitHub Release 地址就是跨域），但 .exe 本身即触发下载，行为不变。
  // 官网上线换成同域地址后即完全生效 —— 抄 Reasonix 官网的做法。
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

// /download 页用：三平台逐行 + GitHub 兜底入口
export function DownloadButtons(props: { info: LatestInfo | undefined }) {
  const github = props.info?.downloads.github ?? `${GITHUB_REPO_URL}/releases/latest`

  return (
    <div className="flex flex-col gap-3">
      {platforms.map((platform) => (
        <PlatformButton key={platform.id} platform={platform} info={props.info} />
      ))}
      <a
        href={github}
        target="_blank"
        rel="noopener noreferrer"
        className={`${box} border border-ink-700 bg-paper text-ink-950 hover:border-accent hover:text-accent`}
      >
        GitHub Releases
      </a>
    </div>
  )
}
