/*
 * oc-media:// 解析与白名单（S-224）。
 *
 * 存在理由：这条协议对渲染端开放了「按路径读任意文件」的能力，解析规则一旦放宽
 * （host 不校验、扩展名不白名单），就等于给页面一个无限制的文件读取通道。
 * 纯函数拆出来的唯一目的就是让这些边界能被钉住。
 *
 * 钉死四组：
 *   ① 正常解析 + 编码还原（含 Windows 反斜杠、空格、中文路径）；
 *   ② 协议名 / host / 空路径 / 解码失败一律返回 null；
 *   ③ 扩展名白名单只放媒体类型；
 *   ④ 与渲染端 filePathToMediaUrl 的编码格式对齐（往返一致）。
 */

import assert from 'node:assert/strict'
import {
  ALLOWED_MEDIA_EXTENSIONS,
  LOCAL_MEDIA_HOST,
  LOCAL_MEDIA_SCHEME,
  guessMediaTypeFromPath,
  isAllowedMediaPath,
  parseMediaUrlPath
} from '../../src/main/lib/local-media-url'
import { filePathToMediaUrl } from '../../src/renderer/src/lib/local-media-url'

let checks = 0

function checkEqual<T>(actual: T, expected: T, description: string): void {
  checks += 1
  assert.equal(actual, expected, `${description}（期望 ${String(expected)}，实得 ${String(actual)}）`)
}

// 必须直接用渲染端那个函数，不许在这里复刻编码模板 ——
// 否则「渲染端换了编码格式 → 重启后图片全裂」这类回归，测试照样全绿。
const mediaUrl = filePathToMediaUrl

// ─── 1. 正常解析与还原 ───

const windowsPath = 'C:\\Users\\me\\.wishful-claw\\images\\2026-10\\9f2c1a7b3e5d4c60.png'
checkEqual(parseMediaUrlPath(mediaUrl(windowsPath)), windowsPath, 'Windows 路径往返一致')

const spacedPath = '/home/me/My Pictures/a b.png'
checkEqual(parseMediaUrlPath(mediaUrl(spacedPath)), spacedPath, '含空格路径往返一致')

const cjkPath = '/home/me/图片/截图.png'
checkEqual(parseMediaUrlPath(mediaUrl(cjkPath)), cjkPath, '含中文路径往返一致')

// ─── 2. 非法输入一律 null ───

checkEqual(parseMediaUrlPath('https://example.com/a.png'), null, '外部协议不认')
checkEqual(parseMediaUrlPath('file:///tmp/a.png'), null, 'file 协议不认')
checkEqual(parseMediaUrlPath('not a url'), null, '非 URL 字符串不认')
checkEqual(
  parseMediaUrlPath(`${LOCAL_MEDIA_SCHEME}://evil/${encodeURIComponent('/etc/passwd')}`),
  null,
  'host 不是 local 时拒绝'
)
checkEqual(parseMediaUrlPath(`${LOCAL_MEDIA_SCHEME}://local/`), null, '空路径拒绝')
checkEqual(parseMediaUrlPath(`${LOCAL_MEDIA_SCHEME}://local/%E0%A4%A`), null, '解码失败的百分号序列拒绝')

// ─── 2b. 路径形态约束（协议不该比既有 IPC 更宽松） ───

checkEqual(parseMediaUrlPath(mediaUrl('a.png')), null, '相对路径拒绝')
checkEqual(parseMediaUrlPath(mediaUrl('images/a.png')), null, '相对多段路径拒绝')
checkEqual(
  parseMediaUrlPath(`${LOCAL_MEDIA_SCHEME}://local/${encodeURIComponent('/a/../b.png')}`),
  null,
  '含 .. 段拒绝'
)
checkEqual(
  parseMediaUrlPath(`${LOCAL_MEDIA_SCHEME}://local/${encodeURIComponent('C:\\a\\..\\b.png')}`),
  null,
  'Windows 反斜杠 .. 段同样拒绝'
)
checkEqual(parseMediaUrlPath(mediaUrl('\\\\server\\share\\a.png')), null, 'UNC 路径拒绝')
checkEqual(parseMediaUrlPath(mediaUrl('//server/share/a.png')), null, '正斜杠 UNC 也拒绝')

// ─── 3. 扩展名白名单 ───

for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.mp4', '.webm']) {
  checkEqual(isAllowedMediaPath(`/tmp/a${ext}`), true, `${ext} 允许`)
}
for (const ext of ['.exe', '.txt', '.dll', '.json', '.zip']) {
  checkEqual(isAllowedMediaPath(`/tmp/a${ext}`), false, `${ext} 拒绝`)
}
checkEqual(isAllowedMediaPath('/tmp/a'), false, '无扩展名拒绝')
checkEqual(isAllowedMediaPath('/tmp/A.PNG'), true, '大小写不敏感')

// ─── 4. 白名单本身不含可执行类型（防后来者手滑扩充） ───

for (const forbidden of ['.exe', '.dll', '.bat', '.cmd', '.ps1', '.sh', '.js']) {
  checkEqual(
    (ALLOWED_MEDIA_EXTENSIONS as readonly string[]).includes(forbidden),
    false,
    `白名单不得包含 ${forbidden}`
  )
}

// ─── 5. 兜底分支的 Content-Type 映射 ───

checkEqual(guessMediaTypeFromPath('C:\\a\\b.png'), 'image/png', 'png → image/png')
checkEqual(guessMediaTypeFromPath('/tmp/a.JPG'), 'image/jpeg', '大写 JPG 仍是 image/jpeg')
checkEqual(guessMediaTypeFromPath('/tmp/a.jpeg'), 'image/jpeg', 'jpeg → image/jpeg')
checkEqual(guessMediaTypeFromPath('/tmp/a.webp'), 'image/webp', 'webp → image/webp')
checkEqual(guessMediaTypeFromPath('/tmp/a.mp4'), 'video/mp4', 'mp4 → video/mp4')
checkEqual(
  guessMediaTypeFromPath('/tmp/a.unknown'),
  'application/octet-stream',
  '未知扩展名按二进制流'
)
checkEqual(guessMediaTypeFromPath('/tmp/a'), 'application/octet-stream', '无扩展名按二进制流')

console.log(`oc-media 解析与白名单检查通过（${checks} 项断言）。`)
