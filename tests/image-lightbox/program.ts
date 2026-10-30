/*
 * S-288 回归：聊天窗图片浮层「点开了能不能放大」。
 *
 * 为什么是源码闸而不是纯函数：这两条缺陷都住在 className 里，没有可抽的计算 ——
 * 抽一个 `shouldShowBig()` 出来只会造一次性导出。项目里已有同类先例
 * （`tests/data-dir` 的源码行序闸、`tests/right-panel-scope`）。
 *
 * 钉的是最容易悄悄退回去的两处：
 *   1. `DialogContent` 自带 `sm:max-w-lg`，Tailwind 变体优先级高于裸 `max-w-[95vw]`，
 *      少写 `sm:max-w-[95vw]` 就会在 ≥640px 视口上被压回 512px 宽 —— 图还是放不大；
 *   2. 缩略只有 `max-w-lg` 没有高度上限时，竖图算出 ~910px 高，一条消息吃掉大半屏。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// 产物在 tests/image-lightbox/out/program.cjs —— 回到仓库根需要三级
const ROOT = join(__dirname, '..', '..', '..')
const CHAT = join(ROOT, 'src', 'renderer', 'src', 'components', 'chat')

function read(name: string): string {
  return readFileSync(join(CHAT, name), 'utf8')
}

let checks = 0
function check(condition: boolean, description: string): void {
  assert.ok(condition, description)
  checks++
}

const lightbox = read('ImageLightbox.tsx')
const preview = read('ImagePreview.tsx')
const localDialog = read('LocalImagePreviewDialog.tsx')

// —— 1. DialogContent 必须显式压掉内置的 `sm:max-w-lg` ——
for (const [name, source] of [
  ['ImageLightbox.tsx', lightbox],
  ['LocalImagePreviewDialog.tsx', localDialog]
] as const) {
  const contents = source.match(/<DialogContent[\s\S]*?>/g) ?? []
  check(contents.length === 1, `${name} 里应当只有一个 DialogContent（实得 ${contents.length}）`)
  check(
    contents[0].includes('sm:max-w-[95vw]'),
    `${name} 的 DialogContent 必须写 sm:max-w-[95vw] —— 否则内置 sm:max-w-lg 会在 ≥640px 视口把浮层压回 512px`
  )
}

// —— 2. 有 filePath 就走 ImageViewer（缩放 0.25~5 / 旋转 / 拖拽），这是本条的全部意义 ——
check(lightbox.includes("from '@renderer/lib/preview/viewers/image-viewer'"), '浮层必须复用 ImageViewer')
check(
  /if \(filePath\)[\s\S]*?<ImageViewer/.test(lightbox),
  '有 filePath 时必须渲染 ImageViewer，而不是继续 object-contain'
)
check(
  lightbox.includes('content=""') && lightbox.includes('viewMode="preview"'),
  'ImageViewer 的必填入参 content / viewMode 不能漏'
)
check(lightbox.includes('onDownload'), 'ImageViewer 不带下载，浮层必须自己补 —— 验收要求四个入口能力一致')

// —— 3. 无 filePath 的图（data: / blob: / http:）退回等比塞满，不许报错 ——
check(
  /object-contain/.test(lightbox) && /motion\.img/.test(lightbox),
  '没有盘上路径时必须保留原 object-contain 浮层作为回退'
)

// —— 4. 缩略宽高都限 ——
check(preview.includes('max-h-[320px]'), '缩略必须有高度上限（竖图不加上限会到 ~910px）')
check(preview.includes('max-w-lg'), '缩略的宽度上限不能丢')
check(
  /<div[\s\S]{0,400}max-h-\[320px\][\s\S]{0,400}aspectRatio/.test(preview),
  '缩略容器必须同时保留 aspectRatio —— 去掉它，图加载前后高度不一致会抖（S-233）'
)

// —— 5. 拆分没把薄壳留下 ——
check(
  !preview.includes('AnimatePresence'),
  'ImagePreview 里不该再有浮层动画 —— 已拆进 ImageLightbox.tsx'
)

console.log(`image lightbox regression checks passed (${checks} assertions).`)
