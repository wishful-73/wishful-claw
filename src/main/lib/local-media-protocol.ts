/**
 * `oc-media://` 协议注册（S-224）。
 *
 * 渲染端 `filePathToMediaUrl()` 一直在生成这个协议地址，但注册端从来没实现过 ——
 * 图片块都带内联 base64 时走不到那条分支，所以没人发现。S-224 开始落库只存
 * `filePath`，显示侧必须靠这条协议读盘。
 *
 * 解析与白名单在 `./local-media-url.ts`（纯函数、可单测），这里只做 electron 绑定。
 */

import { net, protocol } from 'electron'
import { readFile, stat } from 'fs/promises'
import { pathToFileURL } from 'url'
import {
  LOCAL_MEDIA_SCHEME,
  guessMediaTypeFromPath,
  isAllowedMediaPath,
  parseMediaUrlPath
} from './local-media-url'

/** 降级路径（整读进内存）能接受的上限，超过就报 413 而不是把主进程堆打爆。 */
const MAX_FALLBACK_BYTES = 64 * 1024 * 1024

/** 必须在 app ready 之前调用，且只能调用一次。 */
export function prepareLocalMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        // stream: 大视频走原生流式读取，不把整个文件读进内存。
        stream: true
      }
    }
  ])
}

/** 在 app ready 之后、创建窗口之前调用。 */
export function registerLocalMediaProtocol(): void {
  protocol.handle(LOCAL_MEDIA_SCHEME, async (request) => {
    const filePath = parseMediaUrlPath(request.url)
    if (!filePath) {
      return new Response(null, { status: 400 })
    }
    if (!isAllowedMediaPath(filePath)) {
      return new Response(null, { status: 403 })
    }

    try {
      // net.fetch 支持 file: URL 并处理 Range 请求，比 readFile + Response 省内存。
      const response = await net.fetch(pathToFileURL(filePath).toString())
      if (response.ok) {
        return response
      }
      console.warn('[local-media] net.fetch not ok', response.status, filePath)
    } catch (error) {
      console.warn('[local-media] net.fetch failed, falling back to readFile', filePath, error)
    }

    // 兜底：万一某版本 net.fetch 不认 file:，整读一份也要把图显示出来。
    // 只影响降级路径，正常情况走上面的流式分支。
    try {
      const { size } = await stat(filePath)
      if (size > MAX_FALLBACK_BYTES) {
        // 降级路径是一次性 readFile，超大文件会把主进程堆打爆，宁可报错不加载。
        console.warn('[local-media] file too large for fallback read', size, filePath)
        return new Response(null, { status: 413 })
      }
      const data = await readFile(filePath)
      return new Response(data, {
        headers: { 'content-type': guessMediaTypeFromPath(filePath) }
      })
    } catch (error) {
      console.warn('[local-media] failed to read file', filePath, error)
      return new Response(null, { status: 404 })
    }
  })
}
