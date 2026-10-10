import { useEffect } from 'react'
import { BRAND } from './content/site'

// 下载中转页（S-186 §六）：官网下载按钮的 href 指这里（`/go?src=<源名>&u=<目标直链>`），
// 页面立刻跳到目标；**这一跳的请求本身就被 nginx 记下**，所以本页一行上报代码都不写。
//
// 为什么不裸 302：多一层页面能显示「正在前往下载…」、能放兜底链接（自动跳转被拦时用户可手点），
// 也不怕跳转失败变白屏 —— 计数口径与 302 完全一样。
export default function GoPage() {
  const params = new URLSearchParams(window.location.search)
  const source = params.get('src') ?? ''
  const rawTarget = params.get('u') ?? ''
  // 只认 https：参数来自 URL，当不可信输入处理（挡掉 `javascript:` / `data:` 之类）。
  const target = rawTarget.startsWith('https://') ? rawTarget : ''

  // 不加人为延迟：无感最好；兜底链接常驻，不靠它兜。
  useEffect(() => {
    if (target) window.location.replace(target)
  }, [target])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <img src="./logo.png" alt={BRAND.fullName} className="size-14 rounded-2xl" />
      {target ? (
        <>
          <h1 className="text-lg font-semibold text-ink-950">正在前往下载…</h1>
          <p className="text-sm text-ink-900/65">下载源：{source || '第三方加速站'}</p>
          <p className="text-sm text-ink-900/45">
            没有自动跳转？
            <a href={target} className="ml-1 font-medium text-accent hover:underline">
              点这里继续
            </a>
          </p>
        </>
      ) : (
        <>
          <h1 className="text-lg font-semibold text-ink-950">下载链接无效</h1>
          <p className="text-sm text-ink-900/65">
            这个中转链接缺少下载地址，请回
            <a href="./download" className="mx-1 font-medium text-accent hover:underline">
              下载页
            </a>
            重新选择。
          </p>
        </>
      )}
    </main>
  )
}
