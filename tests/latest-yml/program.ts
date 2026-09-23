/*
 * 发布清单解析（官网下载按钮的数据源，iter-36 S-129）。
 *
 * 锁住四类：
 *   1. 真清单（electron-builder 的真实产物）能取到 version 与安装包文件名；
 *   2. 去掉 YAML 标量的外层引号（builder 给 releaseDate 加引号，version / url 不加）；
 *   3. 形状不对 / 空内容 ⇒ undefined（调用方退化为置灰按钮，不把页面搞挂）；
 *   4. 安装包名只取文件名 —— 清单里出现路径，不能把下载链接带出 releases/ 目录。
 */

import assert from 'node:assert/strict'
import {
  parseReleaseManifest,
  releaseFileUrl
} from '../../website/src/lib/latest-yml'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

// electron-builder 生成的 latest.yml（0.2.35 的真实内容，逐字照抄）
const REAL = `version: 0.2.35
files:
  - url: wishful-claw-0.2.35-setup.exe
    sha512: T5kW+9nP2jA6XrZ/tgz316Rcdej8u0l2vj6yLxt+92Yn/jH5VcQi+sH9YPiDbThLH8SfTfJKRCsyNKPJwKkgcg==
    size: 113334371
path: wishful-claw-0.2.35-setup.exe
sha512: T5kW+9nP2jA6XrZ/tgz316Rcdej8u0l2vj6yLxt+92Yn/jH5VcQi+sH9YPiDbThLH8SfTfJKRCsyNKPJwKkgcg==
releaseDate: '2026-09-23T06:33:00.920Z'
`

// ── 1. 真清单 ─────────────────────────────────────────────────────────────
{
  const manifest = parseReleaseManifest(REAL)
  check(manifest !== undefined, '真清单能解析')
  check(manifest?.version === '0.2.35', `版本号取对（实得 ${manifest?.version}）`)
  check(
    manifest?.setupFile === 'wishful-claw-0.2.35-setup.exe',
    `安装包文件名取对（实得 ${manifest?.setupFile}）`
  )
  check(
    releaseFileUrl(manifest!) === './downloads/wishful-claw-0.2.35-setup.exe',
    `下载地址落在下载目录下（实得 ${releaseFileUrl(manifest!)}）`
  )
}

// ── 2. 引号剥离 ───────────────────────────────────────────────────────────
{
  const manifest = parseReleaseManifest(`version: '0.2.36'\nfiles:\n  - url: "pkg-setup.exe"\n`)
  check(manifest?.version === '0.2.36', "单引号版本号剥掉（实得 '" + manifest?.version + "'）")
  check(manifest?.setupFile === 'pkg-setup.exe', `双引号文件名剥掉（实得 ${manifest?.setupFile}）`)
}

// ── 3. 形状不对 ⇒ undefined ───────────────────────────────────────────────
{
  check(parseReleaseManifest('') === undefined, '空内容 ⇒ undefined')
  check(parseReleaseManifest('<html>404</html>') === undefined, 'HTML（404 页面）⇒ undefined')
  check(parseReleaseManifest('version: 0.2.35\n') === undefined, '只有版本号、没有 files ⇒ undefined')
  check(parseReleaseManifest('files:\n  - url: a.exe\n') === undefined, '只有 files、没有版本号 ⇒ undefined')
  check(parseReleaseManifest('version:\nfiles:\n  - url: a.exe\n') === undefined, '版本号为空 ⇒ undefined')
  check(parseReleaseManifest('version: 0.2.35\nfiles:\n  - url: \n') === undefined, '文件名为空 ⇒ undefined')
}

// ── 4. 路径穿越防护：只取文件名 ───────────────────────────────────────────
{
  const slash = parseReleaseManifest('version: 1.0.0\nfiles:\n  - url: ../../etc/passwd\n')
  check(slash?.setupFile === 'passwd', `正斜杠路径只取文件名（实得 ${slash?.setupFile}）`)
  check(releaseFileUrl(slash!) === './downloads/passwd', '下载地址不出下载目录')

  const backslash = parseReleaseManifest('version: 1.0.0\nfiles:\n  - url: ..\\..\\evil.exe\n')
  check(backslash?.setupFile === 'evil.exe', `反斜杠路径只取文件名（实得 ${backslash?.setupFile}）`)
}

console.log(`release manifest checks passed: ${checks}`)
