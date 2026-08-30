import { BrowserWindow } from 'electron'

interface QrElementBounds {
  x: number
  y: number
  width: number
  height: number
}

const QR_ELEMENT_SCRIPT = String.raw`
(() => {
  const candidates = Array.from(document.querySelectorAll('canvas, img, svg'))
  const scored = []

  for (const element of candidates) {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    if (
      rect.width < 72 ||
      rect.height < 72 ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number(style.opacity) === 0
    ) {
      continue
    }

    const ratio = rect.width / rect.height
    if (ratio < 0.65 || ratio > 1.55) continue

    const descriptor = [
      element.tagName,
      element.id,
      element.className?.baseVal ?? element.className,
      element.getAttribute('alt'),
      element.getAttribute('src'),
      element.getAttribute('data-src'),
      element.getAttribute('aria-label'),
      element.parentElement?.id,
      element.parentElement?.className,
      element.parentElement?.parentElement?.id,
      element.parentElement?.parentElement?.className,
      element.closest('[id*="qr" i], [class*="qr" i], [data-testid*="qr" i]')?.outerHTML.slice(0, 300)
    ].filter(Boolean).join(' ').toLowerCase()

    let score = 0
    if (/qrcode|qr-code|qr_code|wxqr|wechat-qr/.test(descriptor)) score += 500
    else if (/\bqr\b|二维码|scan/.test(descriptor)) score += 260
    if (element.tagName === 'CANVAS') score += 180
    else if (element.tagName === 'SVG') score += 100
    else if (element.tagName === 'IMG') score += 80

    const squareDistance = Math.abs(1 - ratio)
    score += Math.max(0, 160 - squareDistance * 400)
    if (rect.width >= 100 && rect.width <= 480 && rect.height >= 100 && rect.height <= 480) {
      score += 100
    }
    if (rect.width > 600 || rect.height > 600) score -= 300
    if (/logo|avatar|icon|banner|background/.test(descriptor)) score -= 400

    const childCount = element.querySelectorAll?.('*').length ?? 0
    if (childCount > 20) score -= 150

    scored.push({ element, score, area: rect.width * rect.height })
  }

  scored.sort((left, right) => right.score - left.score || right.area - left.area)
  const selectedCandidate = scored[0]
  if (!selectedCandidate || selectedCandidate.score < 400) return null

  const selected = selectedCandidate.element
  selected.scrollIntoView({ block: 'center', inline: 'center' })
  const rect = selected.getBoundingClientRect()
  const padding = 6
  const x = Math.max(0, Math.floor(rect.left - padding))
  const y = Math.max(0, Math.floor(rect.top - padding))
  const right = Math.min(window.innerWidth, Math.ceil(rect.right + padding))
  const bottom = Math.min(window.innerHeight, Math.ceil(rect.bottom + padding))

  if (right - x < 72 || bottom - y < 72) return null
  return { x, y, width: right - x, height: bottom - y }
})()
`

function isQrElementBounds(value: unknown): value is QrElementBounds {
  if (!value || typeof value !== 'object') return false
  const bounds = value as Partial<QrElementBounds>
  return (
    typeof bounds.x === 'number' &&
    typeof bounds.y === 'number' &&
    typeof bounds.width === 'number' &&
    typeof bounds.height === 'number' &&
    bounds.width >= 72 &&
    bounds.height >= 72
  )
}

async function waitForQrElement(win: BrowserWindow): Promise<QrElementBounds | undefined> {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const bounds = await win.webContents.executeJavaScript(QR_ELEMENT_SCRIPT, true)
    if (isQrElementBounds(bounds)) return bounds
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return undefined
}

export async function captureQrElementAsDataUrl(url: string): Promise<string | undefined> {
  const win = new BrowserWindow({
    show: false,
    width: 720,
    height: 960,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: false
    }
  })

  try {
    await win.loadURL(url)
    const bounds = await waitForQrElement(win)
    if (!bounds) return undefined

    await new Promise((resolve) => setTimeout(resolve, 100))
    const image = await win.webContents.capturePage(bounds)
    if (image.isEmpty()) return undefined

    return `data:image/png;base64,${image.toPNG().toString('base64')}`
  } catch {
    return undefined
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
