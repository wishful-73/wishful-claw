import { IPC } from '@renderer/lib/ipc/channels'

/**
 * 把图片写进系统剪贴板。
 *
 * 渲染端没有直接写剪贴板的能力，真正的写入统一交给主进程的
 * `clipboard:write-image` 通道（见 src/main/clipboard-enhancer.ts）。
 * 系统剪贴板只认位图，所以经由 data URL / SVG 进来的内容都先转成 PNG 再写。
 */

/** 写入纯 base64（不含 data URL 前缀）。上抛错误 —— 调用方负责提示失败。 */
export async function writeBase64ImageToClipboard(base64: string): Promise<void> {
  const result = await window.api.invoke<{ error?: string }>(IPC.CLIPBOARD_WRITE_IMAGE, {
    data: base64
  })
  if (result?.error) {
    throw new Error(result.error)
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read image data'))
        return
      }
      const base64 = reader.result.split(',')[1]
      if (!base64) {
        reject(new Error('Failed to encode image data'))
        return
      }
      resolve(base64)
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read image data'))
    }
    reader.readAsDataURL(blob)
  })
}

export async function writeImageBlobToClipboard(blob: Blob): Promise<void> {
  await writeBase64ImageToClipboard(await blobToBase64(blob))
}

export async function writeImageDataUrlToClipboard(dataUrl: string): Promise<void> {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) {
    throw new Error('Invalid image data URL')
  }
  const header = dataUrl.slice(0, comma)
  // 非 base64 的 data URL（例如内联的 SVG）取回 Blob 后走同一条路
  if (!/;base64$/i.test(header)) {
    const response = await fetch(dataUrl)
    if (!response.ok) {
      throw new Error(`Failed to load image: ${response.status}`)
    }
    await writeImageBlobToClipboard(await response.blob())
    return
  }
  await writeBase64ImageToClipboard(dataUrl.slice(comma + 1))
}

export async function writeSvgStringToClipboard(svg: string): Promise<void> {
  await writeImageBlobToClipboard(await rasterizeSvgToPngBlob(svg))
}

/** SVG 字符串没有天然的像素尺寸，靠浏览器渲染一次拿到 naturalWidth/Height。 */
async function rasterizeSvgToPngBlob(svg: string): Promise<Blob> {
  // 缺 xmlns 的 SVG 在 <img> 里不会被渲染
  const normalized = /<svg[^>]*\sxmlns=/i.test(svg)
    ? svg
    : svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  const objectUrl = URL.createObjectURL(new Blob([normalized], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = await loadImageElement(objectUrl)
    const width = image.naturalWidth || image.width || 1024
    const height = image.naturalHeight || image.height || 1024
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas context unavailable')
    }
    context.drawImage(image, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) {
          resolve(value)
          return
        }
        reject(new Error('Failed to rasterize SVG'))
      }, 'image/png')
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load image'))
    image.src = src
  })
}
