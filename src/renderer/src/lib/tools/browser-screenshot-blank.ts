import type { NativeImageLike } from './browser-webview-helpers'

/**
 * 截图「白图」检测（缺陷 A）。
 *
 * **要解决的不是截图失败，是截图成功但什么都没画出来。**
 * 未构建的 Vite 外壳（`<div id="root"></div>` + `<script type="module" src="./src/*.tsx">`）
 * 用 `file://` 打开时 `.tsx` 不转译，页面纯白。此时：
 *   · `capturePage()` 成功，返回一张干净的白 PNG；
 *   · `BrowserGetContent` 还能拿回 `<title>`（静态 HTML 里就有）；
 *   · 加载失败只落在 subresource 上，`did-fail-load` 不触发。
 * 结果是 agent 拿到白图、以为看到了、然后照着白图去改 —— 全程零报错。
 *
 * **不改 `isError`，只在结果文本里加一句警告。** 截图本身确实成功了，把工具报成失败会让
 * 模型误以为要重试；它需要的是一条「你看到的是空的，别据此判断」。
 *
 * 判据刻意收窄成两个条件同时成立，宁可漏报也不误报：
 *   1. 视口抽样近全白（空白页本身可以是正常的，用户就要一张白底）；
 *   2. 且 DOM 里几乎没有元素、没有可见文本（壳在、内容没渲染）。
 */

/** 抽样点上限。一张 2K 截图是 800 万像素，逐点扫会卡住渲染进程。 */
const SAMPLE_BUDGET = 512

/** 近白阈值：每通道都要到这一档以上才算「白」。留 5 档余量给抗锯齿和滚动条阴影。 */
const NEAR_WHITE = 250

/** DOM 元素数上限：未渲染的外壳通常只剩 html / head / script / body / #root 这几个。 */
const UNRENDERED_ELEMENT_LIMIT = 12

/**
 * 视口是不是近全白。`toBitmap()` 给的是 BGRA、每像素 4 字节。
 *
 * 全透明像素按空白算 —— webview 还没绘制的区域就是透明的，它和白一样代表「这里什么都没有」。
 * 取不到像素时返回 false（不报），与后端「读不到就不拦」同一个取舍。
 */
function isViewportNearlyBlank(nativeImage: NativeImageLike): boolean {
  let bitmap: Uint8Array
  try {
    bitmap = nativeImage.toBitmap()
  } catch {
    return false
  }

  const pixelCount = Math.floor(bitmap.length / 4)
  if (pixelCount === 0) return false

  const stride = Math.max(1, Math.floor(pixelCount / SAMPLE_BUDGET))
  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4
    const alpha = bitmap[offset + 3] ?? 255
    if (alpha === 0) continue
    const blue = bitmap[offset] ?? 255
    const green = bitmap[offset + 1] ?? 255
    const red = bitmap[offset + 2] ?? 255
    if (blue < NEAR_WHITE || green < NEAR_WHITE || red < NEAR_WHITE) {
      return false
    }
  }

  return true
}

/**
 * 页面是不是「壳在、内容没渲染」：没有可见文本，DOM 元素数也少得可怜。
 * 在页面里跑，所以要保持 ES5 友好、不依赖外部变量。
 */
const UNRENDERED_DOCUMENT_PROBE = `(() => {
  const body = document.body
  if (!body) return { textLength: 0, elementCount: 0 }
  const text = (body.innerText || '').replace(/\\s+/g, '')
  return { textLength: text.length, elementCount: body.querySelectorAll('*').length }
})()`

/**
 * 截图是白图时返回要附加给模型的那段警告，正常截图返回 null。
 *
 * 调用点只有 `executeBrowserScreenshot` 一处，失败一律静默返回 null ——
 * 这是个诊断增强，不能让它自己变成新的报错源。
 */
export async function detectBlankScreenshotWarning(
  webview: Electron.WebviewTag,
  nativeImage: NativeImageLike
): Promise<string | null> {
  if (!isViewportNearlyBlank(nativeImage)) return null

  let probe: { textLength?: number; elementCount?: number } | null = null
  try {
    probe = (await webview.executeJavaScript(UNRENDERED_DOCUMENT_PROBE)) ?? null
  } catch {
    return null
  }
  if (!probe) return null

  const textLength = probe.textLength ?? 0
  const elementCount = probe.elementCount ?? 0
  if (textLength > 0 || elementCount > UNRENDERED_ELEMENT_LIMIT) return null

  return (
    'WARNING: this screenshot is blank white and the document rendered no content ' +
    `(${elementCount} DOM element(s), 0 characters of visible text). ` +
    'The page almost certainly was not built or served: opening a Vite shell as a file:// URL ' +
    'never transpiles its .tsx entry, so nothing is drawn — while the <title> still looks fine. ' +
    'Do not judge or edit the UI from this image. Serve the page through its dev or preview ' +
    'server (http://localhost:<port>) and capture again.'
  )
}
