/**
 * 在截图的原始位图上画参照网格（S-272 第二段 · C）。
 *
 * **为什么自己画像素、不建离屏窗口用 canvas**：crash 面完全不同。离屏 `BrowserWindow`
 * 要走 GPU、要处理 DPI 与 `capturePage()` 的尺寸语义（`getSize()` 到底是 DIP 还是物理像素
 * 至今没定论），为了画几条线和几个数字去开一个窗口不值。这里只做一件事：把一段 BGRA/RGBA
 * 循环里该变灰的字节改成灰。
 *
 * **通道序无关**：灰是「三通道同权」，混合后各通道比例不变 ⇒ `toBitmap()` 在 Windows 给
 * BGRA、在别的平台给 RGBA，对结果没有影响，所以不需要判断平台。
 *
 * 纯函数、不 import electron ⇒ 能直接在 node 里跑回归（见 `tests/screenshot-grid`）。
 */

export interface ScreenshotGridOptions {
  /** 网格间距（像素），默认 200。 */
  step?: number
  /** 网格线与背景的混合比例，0~1，默认 0.45。越大越显眼、越挡内容。 */
  lineAlpha?: number
  /** 每隔几条线标一次刻度数字，默认 1（每条都标）。 */
  labelEvery?: number
  /** 刻度数字的放大倍数，默认 2（点阵 5x7 ⇒ 实际 10x14 像素）。 */
  labelScale?: number
}

const DEFAULT_STEP = 200
const DEFAULT_LINE_ALPHA = 0.45
const DEFAULT_LABEL_EVERY = 1
const DEFAULT_LABEL_SCALE = 2

/** 网格灰度值 —— 落在深底和浅底之间，两边都能看出来。 */
const GRID_GRAY = 128

/**
 * 5×7 点阵数字。每行 5 位，'1' 点亮。
 * 只做数字：刻度是坐标值，一位符号都不用。
 */
const DIGIT_GLYPHS: readonly string[][] = [
  ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], // 0
  ['00100', '01100', '00100', '00100', '00100', '00100', '01110'], // 1
  ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], // 2
  ['11111', '00010', '00100', '00010', '00001', '10001', '01110'], // 3
  ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], // 4
  ['11111', '10000', '11110', '00001', '00001', '10001', '01110'], // 5
  ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], // 6
  ['11111', '00001', '00010', '00100', '01000', '01000', '01000'], // 7
  ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], // 8
  ['01110', '10001', '10001', '01111', '00001', '00010', '01100']  // 9
]

const GLYPH_WIDTH = 5
const GLYPH_HEIGHT = 7
const GLYPH_GAP = 1

/**
 * 把一张位图副本画上网格 + 刻度，返回新 buffer（不改入参）。
 *
 * 尺寸非法（0、负数、buffer 比 `width*height*4` 小）时原样返回入参 —— 画不上网格是
 * 遗憾，把图弄坏是事故。
 */
export function paintScreenshotGrid(
  buffer: Buffer,
  width: number,
  height: number,
  options: ScreenshotGridOptions = {}
): Buffer {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return buffer
  }
  if (buffer.length < width * height * 4) {
    return buffer
  }

  const step = resolvePositiveInt(options.step, DEFAULT_STEP)
  const labelEvery = resolvePositiveInt(options.labelEvery, DEFAULT_LABEL_EVERY)
  const labelScale = resolvePositiveInt(options.labelScale, DEFAULT_LABEL_SCALE)
  const lineAlpha = typeof options.lineAlpha === 'number' && Number.isFinite(options.lineAlpha)
    ? Math.min(1, Math.max(0, options.lineAlpha))
    : DEFAULT_LINE_ALPHA

  const pixels = Buffer.from(buffer.subarray(0, width * height * 4))

  for (let x = step; x < width; x += step) {
    blendVerticalLine(pixels, width, height, x, lineAlpha)
  }
  for (let y = step; y < height; y += step) {
    blendHorizontalLine(pixels, width, height, y, lineAlpha)
  }

  // 刻度：竖线标 x 值（顶部）、横线标 y 值（左侧）。标在线的**右下**侧，避免压到线上。
  let index = 1
  for (let x = step; x < width; x += step, index += 1) {
    if (index % labelEvery !== 0) continue
    drawLabel(pixels, width, height, String(x), x + 2, 2, labelScale)
  }
  index = 1
  for (let y = step; y < height; y += step, index += 1) {
    if (index % labelEvery !== 0) continue
    drawLabel(pixels, width, height, String(y), 2, y + 2, labelScale)
  }

  return pixels
}

function resolvePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.round(value)
}

/**
 * 一列像素向灰度混合。只改 RGB 三通道，alpha 原样 —— 截图本身是不透明的，
 * 真遇到带 alpha 的图也不该由网格决定透明度。
 */
function blendVerticalLine(
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  alpha: number
): void {
  if (x < 0 || x >= width) return
  for (let y = 0; y < height; y += 1) {
    blendPixel(pixels, (y * width + x) * 4, alpha)
  }
}

function blendHorizontalLine(
  pixels: Buffer,
  width: number,
  height: number,
  y: number,
  alpha: number
): void {
  if (y < 0 || y >= height) return
  const rowStart = y * width * 4
  for (let x = 0; x < width; x += 1) {
    blendPixel(pixels, rowStart + x * 4, alpha)
  }
}

function blendPixel(pixels: Buffer, offset: number, alpha: number): void {
  for (let channel = 0; channel < 3; channel += 1) {
    const current = pixels[offset + channel]
    pixels[offset + channel] = Math.round(current * (1 - alpha) + GRID_GRAY * alpha)
  }
}

/**
 * 画一串数字。先铺一层深色底再写亮字 —— 深底浅底上都读得出来，否则亮背景上的白字等于没画。
 * 出界部分剪掉，不越界写内存。
 */
function drawLabel(
  pixels: Buffer,
  width: number,
  height: number,
  text: string,
  left: number,
  top: number,
  scale: number
): void {
  const textWidth = text.length * (GLYPH_WIDTH + GLYPH_GAP) * scale
  const textHeight = GLYPH_HEIGHT * scale

  fillRect(pixels, width, height, left - scale, top - scale, textWidth + scale * 2, textHeight + scale * 2, 0.6, 0)

  for (let charIndex = 0; charIndex < text.length; charIndex += 1) {
    const digit = text.charCodeAt(charIndex) - 48
    if (digit < 0 || digit > 9) continue
    const glyph = DIGIT_GLYPHS[digit]
    const originX = left + charIndex * (GLYPH_WIDTH + GLYPH_GAP) * scale
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      const line = glyph[row]
      for (let column = 0; column < GLYPH_WIDTH; column += 1) {
        if (line[column] !== '1') continue
        fillRect(
          pixels,
          width,
          height,
          originX + column * scale,
          top + row * scale,
          scale,
          scale,
          1,
          235
        )
      }
    }
  }
}

/**
 * 铺一块纯色或混合色。`alpha` 是混合强度，`value` 是目标灰度。
 */
function fillRect(
  pixels: Buffer,
  width: number,
  height: number,
  left: number,
  top: number,
  rectWidth: number,
  rectHeight: number,
  alpha: number,
  value: number
): void {
  const startX = Math.max(0, left)
  const endX = Math.min(width, left + rectWidth)
  const startY = Math.max(0, top)
  const endY = Math.min(height, top + rectHeight)
  for (let y = startY; y < endY; y += 1) {
    const rowStart = y * width * 4
    for (let x = startX; x < endX; x += 1) {
      const offset = rowStart + x * 4
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(pixels[offset + channel] * (1 - alpha) + value * alpha)
      }
    }
  }
}
