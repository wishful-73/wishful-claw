import { useEffect, useState } from 'react'
import { BRAND, downloadSources } from './content/site'
import { acceleratedUrl, githubDirectUrl } from './lib/latest-yml'
import { loadReleaseManifest } from './lib/site-data'

// 下载中转页（S-186 §六）：官网下载按钮的 href 指这里（`/go?src=<源名>`），页面立刻跳到目标；
// **这一跳的请求本身就被 nginx 记下**，所以本页一行上报代码都不写。
//
// 为什么不裸 302：多一层页面能显示「正在前往下载…」、能放兜底链接（自动跳转被拦时用户可手点），
// 也不怕跳转失败变白屏 —— 计数口径与 302 完全一样。
//
// 2026-10-11 收紧：地址里**只允许出现源名**，目标直链由本页读 `latest.yml` 自己拼。
// 此前目标直链整个放在 `u` 参数里，等于让 URL 决定跳去哪（拿官网域名当跳板的开放重定向）；
// 现在即便 `src` 是瞎填的，也只是回落到默认源 —— 跳的永远是我们自己清单里的产物。
// 计数不受影响：nginx 记的是本页这条 `/go?src=…` 请求，`src` 仍用于分源。
type Jump = { target: string; label: string } | null

export default function GoPage() {
  const source = new URLSearchParams(window.location.search).get('src') ?? ''
  // undefined = 正在读清单；null = 清单读不到；否则 = 目标已拼好
  const [jump, setJump] = useState<Jump | undefined>(undefined)

  useEffect(() => {
    let alive = true
    loadReleaseManifest().then((manifest) => {
      if (!alive) return
      if (!manifest) {
        setJump(null)
        return
      }
      // 查不到源名就回落默认源：参数怎么填都跳不出我们自己的产物。
      const picked = downloadSources.find((item) => item.id === source) ?? downloadSources[0]
      setJump({
        target: acceleratedUrl(picked.prefix, githubDirectUrl(manifest)),
        label: picked.label
      })
    })
    return () => {
      alive = false
    }
  }, [source])

  // 不加人为延迟：无感最好；兜底链接常驻，不靠它兜。
  useEffect(() => {
    if (jump) window.location.replace(jump.target)
  }, [jump])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <img src="./logo.png" alt={BRAND.fullName} className="size-14 rounded-2xl" />
      {jump === undefined && <h1 className="text-lg font-semibold text-ink-950">正在准备下载…</h1>}
      {jump === null && (
        <>
          <h1 className="text-lg font-semibold text-ink-950">暂时读不到下载信息</h1>
          <p className="text-sm text-ink-900/65">
            请回
            <a href="./download" className="mx-1 font-medium text-accent hover:underline">
              下载页
            </a>
            重试。
          </p>
        </>
      )}
      {jump && (
        <>
          <h1 className="text-lg font-semibold text-ink-950">正在前往下载…</h1>
          <p className="text-sm text-ink-900/65">下载源：{jump.label}</p>
          <p className="text-sm text-ink-900/45">
            没有自动跳转？
            <a href={jump.target} className="ml-1 font-medium text-accent hover:underline">
              点这里继续
            </a>
          </p>
        </>
      )}
    </main>
  )
}
