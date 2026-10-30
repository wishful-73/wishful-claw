/*
 * 工具调用摘要（v3-iter-5 S-286）。
 *
 * 存在理由：桌面截图的过程行显示过 `8×5` —— 那不是任何屏幕的尺寸，是 base64 字符流
 * 里凑巧的一对数字。当轮 output 是一段字符串化的 content 数组，image 块排在最前、
 * 里面是约 658 KB base64，而摘要用的正则是裸的 `(\d+)x(\d+)`，取第一个命中就撞上了。
 *
 * 本套件钉的就是「尺寸只能从 Captured desktop screenshot 那句里取」这一条。
 */

import assert from 'node:assert/strict'
import { inputSummary } from '../../src/renderer/src/components/chat/tool-call-summary'

let checks = 0

function check(condition: boolean, description: string): void {
  checks += 1
  assert.ok(condition, description)
}

const SCREENSHOT = 'DesktopScreenshot'

/**
 * 造一份和真机同形的 output：字符串化的 content 数组，image 块在最前、里面是 base64。
 *
 * `bait` 是要塞进 base64 里的诱饵 —— 修复前它会先被裸正则抓到，这正是缺陷形态。
 */
function serializedScreenshotOutput(sizeText: string, bait: string): string {
  const base64 = `iVBORw0KGgoAAAANSUhEUg${bait}AAAAOGNhAABJRU5ErkJggg==`
  return JSON.stringify([
    {
      type: 'image',
      source: { type: 'base64', mediaType: 'image/png', data: base64, filePath: 'D:\\x.png' }
    },
    { type: 'text', text: sizeText }
  ])
}

// 1. 核心：真机那次的形状 —— base64 里带 `8x5` 诱饵，真实尺寸 2520×1680
const realCase = serializedScreenshotOutput(
  'Captured desktop screenshot 2520x1680 (origin 0,0, scale 1.5) · saved to D:\\x.png',
  '8x5'
)
check(
  inputSummary(SCREENSHOT, { require_active_window: false }, realCase) === '2520×1680',
  '桌面截图摘要必须取文案里的 2520×1680，不能被 base64 里的 8x5 带跑'
)

// 2. 守卫：诱饵放在最前面（裸正则必然先命中它），结果仍须正确
const baitFirst = serializedScreenshotOutput(
  'Captured desktop screenshot 1920x1080 across 2 display(s).',
  '9x7-1x2-3x4-5x6'
)
check(
  inputSummary(SCREENSHOT, {}, baitFirst) === '1920×1080',
  'base64 里塞再多 `数字x数字` 也不许命中，锚定文案必须压过诱饵'
)

// 3. S-283 之前的老格式同样要认（前缀一致，只是后半句不同）
check(
  inputSummary(SCREENSHOT, {}, 'Captured desktop screenshot 1536x864 across 1 display(s).') ===
    '1536×864',
  '老格式 Captured desktop screenshot 1536x864 across 1 display(s). 必须解析'
)

// 4. 文案大小写不该决定成败
check(
  inputSummary(SCREENSHOT, {}, 'captured desktop screenshot 2560x1440') === '2560×1440',
  '锚定必须大小写不敏感'
)

// 5. 没有那句文案时回退成 desktop，**绝不**回退到随便一个 `数字x数字`
check(
  inputSummary(SCREENSHOT, {}, 'something went wrong: retry after 12x34 ms') === 'desktop',
  '缺锚点文案时必须回退 desktop，不许拿无关数字充数'
)

// 6. output 为空 / 未提供时同样是 desktop（这条顺带证明 5 不是靠「碰巧没匹配上」）
check(inputSummary(SCREENSHOT, {}, undefined) === 'desktop', '没有输出时必须是 desktop')
check(inputSummary(SCREENSHOT, {}, '') === 'desktop', '空输出时必须是 desktop')

// 7. 反向锚点：文案里尺寸和诱饵同时存在时，取的必须是文案里那个
const bothPresent = 'Captured desktop screenshot 3840x2160 (origin 0,0, scale 2.0) 8x5'
check(
  inputSummary(SCREENSHOT, {}, bothPresent) === '3840×2160',
  '文案内外都有数字时，必须取文案紧跟的那个'
)

// 8. 其余桌面动作没被这条改动波及（防止改锚定正则时手滑改到邻居分支）
check(
  inputSummary('DesktopClick', { action: 'left_click', x: 120, y: 340 }, undefined) ===
    'left_click (120, 340)',
  'DesktopClick 摘要格式不能被 S-286 改动带偏'
)

// 9. Bash 走自己的分支：有输出时拼「命令 — 首行」，且**不会被**尺寸样式污染。
//    这一条守的是「改桌面截图的正则时别波及邻居分支」。
check(
  inputSummary('Bash', { command: 'npm test' }, '{"exitCode":0,"stdout":"ok"}') === 'npm test — ok',
  'Bash 摘要仍是「命令 — 首行输出」'
)
check(
  !inputSummary('Bash', { command: 'npm test' }, '{"exitCode":0,"stdout":"build 8x5 done"}').includes(
    '8×5'
  ),
  'Bash 输出里的 `8x5` 不许被渲染成尺寸样式'
)

console.log(`tool-call-summary: ${checks} checks passed`)
