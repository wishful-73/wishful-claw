/**
 * 点击坐标的相对 / 绝对判定（S-272 第二段 · B）。
 *
 * **要解决的问题**：模型看的是接口层的图，肉眼数的像素和图本身不一定一对一（上游可能缩放）。
 * 让它报 0~1 的相对比例，主进程按**那张图的实际尺寸**换算，缩放多少都不影响。
 *
 * **判据放在这里而不是主进程 IPC 里**：纯函数才能写回归。主进程那层只负责提供「最近一次
 * 截图」的矩形。
 */

export interface CaptureFrame {
  /** 图片左上角在屏幕物理像素坐标系里的位置。窗口截图时是窗口左上角。 */
  originX: number
  originY: number
  /** 图片自身尺寸（像素）。 */
  width: number
  height: number
}

export type CoordinateResolution =
  | { ok: true; x: number; y: number; relative: boolean }
  | { ok: false; error: string }

/**
 * 判定并换算一对坐标。
 *
 * **判定规则（写死，别再改口径）**：两个值都落在 0~1 区间、且至少有一个不是整数 ⇒ 按相对
 * 比例解释，用它乘图片尺寸再加图片原点；否则按绝对屏幕像素解释，原样返回。
 *
 * - `{x: 0.62, y: 0.28}` ⇒ 图内 62% / 28% 处。
 * - `{x: 0, y: 0.5}` ⇒ 左边缘中点 —— **不会**因为 `x` 是整数就退回绝对，那会让「左边中点」
 *   这种最自然的写法突然变成屏幕左上角。
 * - `{x: 640, y: 360}` ⇒ 绝对像素，与改动前完全一致。
 * - `{x: 0, y: 0}` / `{x: 1, y: 1}` ⇒ 绝对值（两点在像素世界里本来就是 0 和 1）。
 */
export function resolveCoordinatePair(
  x: number,
  y: number,
  frame: CaptureFrame | null
): CoordinateResolution {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { ok: false, error: 'Invalid click coordinates.' }
  }

  const inUnitRange = (value: number): boolean => value >= 0 && value <= 1
  const looksRelative =
    inUnitRange(x) && inUnitRange(y) && (!Number.isInteger(x) || !Number.isInteger(y))

  if (!looksRelative) {
    return { ok: true, x, y, relative: false }
  }

  if (!frame || frame.width <= 0 || frame.height <= 0) {
    return {
      ok: false,
      error:
        'Relative coordinates (0~1) need a reference image, but no screenshot has been taken yet. ' +
        'Call DesktopScreenshot first, or pass absolute screen pixels instead.'
    }
  }

  return {
    ok: true,
    x: frame.originX + x * frame.width,
    y: frame.originY + y * frame.height,
    relative: true
  }
}
