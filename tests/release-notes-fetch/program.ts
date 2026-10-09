/*
 * 更新说明兜底拉取（iter-38 S-175 ②）。
 *
 * 存在理由：`latest.yml` 不带 `releaseNotes`（electron-builder 的默认行为 —— 只有配了
 * `releaseInfo` / `build/release-notes.md` 才会内联），说明改由官网**同目录**的
 * `release-notes-<版本>.md` 提供，应用侧这份兜底负责把它拉回来。这里钉死三件事：
 *
 *   ① 真源地址只从包内 `app-update.yml` 读，不在代码里手写域名（多一份 URL 就多一处能对不上的）；
 *   ② 文件名带版本 ⇒ 版本对不上就是「没有说明」，绝不显示上一版的说明；
 *   ③ 一切失败（404 / 空文档 / 超时 / 网络错）都返回空串 —— 是空态，不是错误。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEV_UPDATE_CONFIG_FILE,
  PACKAGED_UPDATE_CONFIG_FILE,
  buildReleaseNotesUrl,
  fetchReleaseNotes,
  parsePublishUrl,
  releaseNotesFileName,
  resolvePublishUrl
} from '../../src/main/lib/release-notes'

let checks = 0

function check(condition: boolean, description: string): void {
  checks += 1
  assert.ok(condition, description)
}

const BASE = 'https://wishful-claw.work/downloads/'

// ─── 1. 文件名：版本要当一个路径段用，越界一律拒 ───

check(releaseNotesFileName('0.2.38') === 'release-notes-0.2.38.md', '版本拼成说明文件名')
check(releaseNotesFileName(' 0.2.38 ') === 'release-notes-0.2.38.md', '首尾空白被去掉')
check(releaseNotesFileName('') === null, '空版本拒绝')
check(releaseNotesFileName('../release-notes-0.2.38.md') === null, '路径穿越拒绝')
check(releaseNotesFileName('0.2.38/../../x') === null, '带斜杠的版本拒绝')
check(releaseNotesFileName('0.2.38\nx') === null, '带换行的版本拒绝')

// ─── 2. URL 拼装 ───

check(
  buildReleaseNotesUrl(BASE, '0.2.38') === `${BASE}release-notes-0.2.38.md`,
  '尾部带斜杠的地址不产生双斜杠'
)
check(
  buildReleaseNotesUrl('https://wishful-claw.work/downloads', '0.2.38') ===
    'https://wishful-claw.work/downloads/release-notes-0.2.38.md',
  '尾部不带斜杠的地址补一个'
)
check(buildReleaseNotesUrl('', '0.2.38') === null, '空地址不拼')
check(buildReleaseNotesUrl(BASE, '../x') === null, '非法版本不拼')

// ─── 3. 清单解析：拿仓库里真实的 dev-app-update.yml 当基准 ───

const devConfig = readFileSync(join(process.cwd(), DEV_UPDATE_CONFIG_FILE), 'utf8')
const devUrl = parsePublishUrl(devConfig)
check(typeof devUrl === 'string' && devUrl.startsWith('https://'), '真实 dev-app-update.yml 的 url 取得出来')
check(devUrl?.endsWith('/') === true, '真实地址以斜杠结尾')
check(
  parsePublishUrl('provider: generic\nurl: "https://example.test/d/"\n') === 'https://example.test/d/',
  '引号被剥掉'
)
check(parsePublishUrl('url:   https://example.test/d/  ') === 'https://example.test/d/', '多余空白被去掉')
check(parsePublishUrl('provider: generic\n') === null, '没有 url 行返回 null')
check(parsePublishUrl('url:\n') === null, '空 url 返回 null')

// ─── 4. 地址解析：打包态读包内 app-update.yml，开发态读仓库根那份 ───

let seenPath = ''
const fakeReadFile = (path: string): string => {
  seenPath = path
  return 'provider: generic\nurl: https://example.test/d/\n'
}

check(
  resolvePublishUrl({ isPackaged: true, resourcesPath: '/app/resources', readFile: fakeReadFile }) ===
    'https://example.test/d/',
  '打包态从 resources/app-update.yml 读'
)
check(seenPath === join('/app/resources', PACKAGED_UPDATE_CONFIG_FILE), '打包态读的是包内那份')
check(
  resolvePublishUrl({ isPackaged: false, appRoot: '/repo', readFile: fakeReadFile }) ===
    'https://example.test/d/',
  '开发态从仓库根 dev-app-update.yml 读'
)
check(seenPath === join('/repo', DEV_UPDATE_CONFIG_FILE), '开发态读的是仓库根那份')
check(resolvePublishUrl({ isPackaged: true, readFile: fakeReadFile }) === null, '打包态缺 resourcesPath 返回 null')
check(
  resolvePublishUrl({
    isPackaged: false,
    appRoot: '/repo',
    readFile: () => {
      throw new Error('ENOENT')
    }
  }) === null,
  '文件读不到返回 null（不抛异常）'
)
check(
  resolvePublishUrl({ isPackaged: false, appRoot: process.cwd() }) === devUrl,
  '默认的读盘实现与手工解析一致'
)

// ─── 5. 拉取：命中与各类未命中 ───

function stubFetch(
  response: { ok: boolean; url: string; text: () => Promise<string> },
  onInit?: (init: RequestInit | undefined) => void
): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = []
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    urls.push(String(input))
    onInit?.(init)
    return response as unknown as Response
  }) as unknown as typeof fetch
  return { fetchImpl, urls }
}

function responseFor(body: string, url: string, ok = true): { ok: boolean; url: string; text: () => Promise<string> } {
  return { ok, url, text: async () => body }
}

async function main(): Promise<void> {
  const hit = stubFetch(responseFor('## 修复\n\n- 一条\n', `${BASE}release-notes-0.2.38.md`))
  check(
    (await fetchReleaseNotes({ publishUrl: BASE, version: '0.2.38', fetchImpl: hit.fetchImpl })) ===
      '## 修复\n\n- 一条',
    '命中：正文返回，首尾空白去掉'
  )
  check(
    hit.urls.length === 1 && hit.urls[0] === `${BASE}release-notes-0.2.38.md`,
    '请求的就是本版本那份文档'
  )

  const missing = stubFetch(responseFor('404: Not Found', `${BASE}release-notes-0.2.38.md`, false))
  check(
    (await fetchReleaseNotes({ publishUrl: BASE, version: '0.2.38', fetchImpl: missing.fetchImpl })) === '',
    '404 返回空串'
  )

  const redirected = stubFetch(responseFor('## 上一版', `${BASE}release-notes-0.2.37.md`))
  check(
    (await fetchReleaseNotes({ publishUrl: BASE, version: '0.2.38', fetchImpl: redirected.fetchImpl })) === '',
    '重定向到别的版本 ⇒ 未命中，绝不显示上一版说明'
  )

  const indexPage = stubFetch(responseFor('<html></html>', `${BASE}index.html`))
  check(
    (await fetchReleaseNotes({ publishUrl: BASE, version: '0.2.38', fetchImpl: indexPage.fetchImpl })) === '',
    '兜底页面（文件名不符）⇒ 未命中'
  )

  const empty = stubFetch(responseFor('  \n\n', `${BASE}release-notes-0.2.38.md`))
  check(
    (await fetchReleaseNotes({ publishUrl: BASE, version: '0.2.38', fetchImpl: empty.fetchImpl })) === '',
    '空文档返回空串'
  )

  const broken = stubFetch(responseFor('', '') ).fetchImpl
  const networkError = (async () => {
    throw new Error('ECONNREFUSED')
  }) as unknown as typeof fetch
  check(
    (await fetchReleaseNotes({ publishUrl: BASE, version: '0.2.38', fetchImpl: networkError })) === '',
    '网络错返回空串'
  )
  check(
    (await fetchReleaseNotes({ publishUrl: BASE, version: '0.2.38', fetchImpl: broken })) === '',
    '响应缺 url 字段 ⇒ 未命中'
  )

  let sawSignal = false
  const capture = stubFetch(responseFor('x', `${BASE}release-notes-0.2.38.md`), (init) => {
    sawSignal = init?.signal instanceof AbortSignal
  })
  await fetchReleaseNotes({ publishUrl: BASE, version: '0.2.38', fetchImpl: capture.fetchImpl })
  check(sawSignal, '请求带 AbortSignal（超时可中断）')

  const hanging = (async (_input: unknown, init?: RequestInit) =>
    await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })) as unknown as typeof fetch
  check(
    (await fetchReleaseNotes({ publishUrl: BASE, version: '0.2.38', fetchImpl: hanging, timeoutMs: 5 })) === '',
    '超时返回空串'
  )

  const neverCalled = stubFetch(responseFor('x', `${BASE}release-notes-0.2.38.md`))
  check(
    (await fetchReleaseNotes({ publishUrl: BASE, version: '../x', fetchImpl: neverCalled.fetchImpl })) === '',
    '非法版本返回空串'
  )
  const noBase = stubFetch(responseFor('x', `${BASE}release-notes-0.2.38.md`))
  check(
    (await fetchReleaseNotes({ publishUrl: '', version: '0.2.38', fetchImpl: noBase.fetchImpl })) === '',
    '空地址返回空串'
  )
  check(neverCalled.urls.length === 0 && noBase.urls.length === 0, '拼不出 URL 时不发请求')

  console.log(`release-notes-fetch: ${checks} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
