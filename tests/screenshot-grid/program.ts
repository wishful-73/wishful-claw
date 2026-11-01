/*
 * 截图参照网格 + 相对坐标换算（v3-iter-5 S-272 第二段）。
 *
 * 存在理由：模型「不知道怎么点坐标」的根因不是点击坏了，是看图数不准像素。两条修法都是
 * 纯计算，出错也只会表现为「点偏了一点」——这种错在日志里查不出来，只能靠回归钉死。
 *
 * 两个模块都不 import electron：`paintScreenshotGrid` 只吃 Buffer，
 * `resolveCoordinatePair` 只吃数字 ⇒ 能直接在 node 下跑。
 *
 * ⚠️ 第 3 / 4 条是「防改动退化」的闸：
 *   - 网格不能污染入参（buffer 是截图原件的引用，改它等于把原件涂了）；
 *   - `{x:0, y:0.5}` 必须走相对分支（这是最自然的「左边中点」写法，判据写成
 *     `Number.isInteger(x) && Number.isInteger(y)` 以外的形式就会退回屏幕左上角。
 */

import assert from 'node:assert/strict'
import { paintScreenshotGrid } from '../../src/main/lib/screenshot-grid'
import { resolveCoordinatePair } from '../../src/main/lib/desktop-coordinate'

let checks = 0

function check(condition: boolean, description: string): void {
  checks += 1
  assert.ok(condition, description)
}

function makeBitmap(width: number, height: number, value = 255): Buffer {
  const buffer = Buffer.alloc(width * height * 4, value)
  for (let index = 3; index < buffer.length; index += 4) buffer[index] = 255
  return buffer
}

function pixelAt(buffer: Buffer, width: number, x: number, y: number): number {
  return buffer[(y * width + x) * 4]
}

// ── 网格 ──────────────────────────────────────────────────────────────

// 1. 网格线位置必须真的被压暗：距左 200px 的整列、距顶 200px 的整行
const flat = makeBitmap(600, 600)
const painted = paintScreenshotGrid(flat, 600, 600, { lineAlpha: 0.45 })

check(pixelAt(painted, 600, 200, 400) < 200, 'x=200 的竖线必须压暗（原本 255）')
check(pixelAt(painted, 600, 400, 200) < 200, 'y=200 的横线必须压暗')
check(pixelAt(painted, 600, 100, 100) === 255, '不在线上的像素必须原样保留')

// 2. 间距可配；步长非法回退默认 200（不然整张图被涂成灰）
const coarse = paintScreenshotGrid(makeBitmap(600, 600), 600, 600, { step: 300 })
check(pixelAt(coarse, 600, 300, 550) < 200, 'step=300 时 x=300 必须有线')
check(pixelAt(coarse, 600, 200, 550) === 255, 'step=300 时 x=200 不该有线')

// 3. 入参不被修改 —— 原件是截图 buffer，涂了就等于把截图毁了
check(pixelAt(flat, 600, 200, 400) === 255, 'paintScreenshotGrid 不得修改入参 buffer')

// 4. 尺寸非法时不崩、原样返回（画不上网格是遗憾，把图弄坏是事故）
const tiny = makeBitmap(4, 4)
check(paintScreenshotGrid(tiny, 0, 4) === tiny, 'width=0 必须原样返回')
check(paintScreenshotGrid(tiny, 4, 4, { step: 1 }).length === tiny.length, 'step=1 也不能改变长度')
const shortBuffer = Buffer.alloc(16)
check(paintScreenshotGrid(shortBuffer, 100, 100) === shortBuffer, 'buffer 不够长必须原样返回')

// ── 坐标 ──────────────────────────────────────────────────────────────

const frame = { originX: 100, originY: 50, width: 800, height: 600 }

// 5. 比例坐标按「图片实际尺寸 + 图片原点」换算
const middle = resolveCoordinatePair(0.5, 0.5, frame)
check(middle.ok === true, '0.5/0.5 必须解析成功')
if (middle.ok) {
  check(middle.relative === true, '0.5/0.5 必须判为相对坐标')
  check(middle.x === 500, '0.5 相对 x 必须是 100 + 0.5*800 = 500')
  check(middle.y === 350, '0.5 相对 y 必须是 50 + 0.5*600 = 350')
}

// 6. 「左边中点」这种带整数的写法也必须走相对分支
const leftMiddle = resolveCoordinatePair(0, 0.5, frame)
check(leftMiddle.ok === true && leftMiddle.relative === true, '{x:0, y:0.5} 必须判为相对坐标')
if (leftMiddle.ok) check(leftMiddle.x === 100, 'x=0 相对必须是图片左边缘 100')

// 7. 绝对像素原样透传，不做任何换算
const absolute = resolveCoordinatePair(640, 360, frame)
check(absolute.ok === true, '绝对坐标必须解析成功')
if (absolute.ok) {
  check(absolute.relative === false, '640/360 必须判为绝对坐标')
  check(absolute.x === 640 && absolute.y === 360, '绝对坐标不得被换算')
}

// 8. 两个都是 0 或 1 时按绝对处理（像素世界里 0 和 1 本来就是像素）
const corners = resolveCoordinatePair(0, 0, frame)
check(corners.ok === true && corners.relative === false, '{0,0} 必须按绝对像素处理')

// 9. 没有截图参照时给可执行的指引，而不是算出一个假坐标
const noFrame = resolveCoordinatePair(0.5, 0.5, null)
check(noFrame.ok === false, '没有参照图时相对坐标必须失败')
if (!noFrame.ok) check(noFrame.error.includes('DesktopScreenshot'), '报错必须指向 DesktopScreenshot')

// 10. NaN / Infinity 不许流进点击（会变成 Windows 上的 0 坐标点击）
check(resolveCoordinatePair(Number.NaN, 10, frame).ok === false, 'NaN 必须失败')
check(resolveCoordinatePair(10, Number.POSITIVE_INFINITY, frame).ok === false, 'Infinity 必须失败')

console.log(`screenshot-grid: ${checks} checks passed`)
