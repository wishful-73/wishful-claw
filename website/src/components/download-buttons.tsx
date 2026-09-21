import type { LatestInfo } from '../content/site'
import { GITHUB_REPO_URL } from '../content/site'

// 两个下载入口并列（老大 2026-09-21 拍板）：
// ① 官网直链（主）—— 阶段 1 URL 为空即置灰「建设中」，阶段 4 接 COS 后填 latest.json 即生效
// ② GitHub Releases（次）—— 现在可用
// 独立成件：单页下载区与 /download 页共用，避免两处漂移
export function DownloadButtons(props: { info: LatestInfo | undefined; layout?: 'row' | 'stack' }) {
  const direct = props.info?.downloads.direct ?? ''
  const github = props.info?.downloads.github ?? `${GITHUB_REPO_URL}/releases/latest`
  const box = 'rounded-[10px] px-6 py-3 text-center text-[15px] font-semibold transition-all'
  const wrap = props.layout === 'stack' ? 'flex flex-col gap-3' : 'flex flex-wrap items-center gap-3'

  return (
    <div className={wrap}>
      {direct ? (
        <a href={direct} className={`${box} bg-accent text-white hover:opacity-90`}>
          直接下载（Windows）
        </a>
      ) : (
        <span
          role="link"
          aria-disabled="true"
          title="官网直链通道建设中，当前请走 GitHub Releases"
          className={`${box} cursor-not-allowed bg-ink-800 text-ink-900/40`}
        >
          直接下载 · 通道建设中
        </span>
      )}
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
