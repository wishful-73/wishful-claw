// S-35 (iter-30) — 目录引用不能被报成「读取失败」。
//
// buildSelectedFileContext 是「消息文本 → 注入块」的唯一装配点：文件树右键、
// @ 搜索、手打路径最后都汇到这里。目录必须按 skipped（路径引用）处理，而不是
// error（读取失败）——把文件夹发送到会话，消息下面不该挂一条红色「Read failed」。
//
// 同时锁住反向：真正的读失败（文件不存在）必须仍然是 error，别一起被吞掉。

import assert from 'node:assert/strict'
import {
  decodeMessagePackPayload,
  encodeMessagePackPayload
} from '../../src/shared/messagepack/binary-ipc'
import { buildSelectedFileContext } from '../../src/renderer/src/lib/agent/selected-file-context'
import { createSelectFileTag } from '../../src/renderer/src/lib/select-file-tags'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

// ── Fake IPC bridge ────────────────────────────────────────────────────────
// `fs:stat-path` / `fs:read-file` 都登记在 msgpack 通道表里，payload 与响应
// 都是编过码的字节。假桥必须同进同出地编解码，否则测的就不是真实路径。

type StatResult = { exists?: boolean; isDirectory?: boolean; error?: string } | null

const stats = new Map<string, StatResult>()
const reads = new Map<string, string>()
const readCalls: string[] = []

const ipcRenderer = {
  invoke: async (channel: string, encoded: unknown): Promise<unknown> => {
    const payload = decodeMessagePackPayload<{ path?: string }>(encoded as ArrayBufferView)
    const path = payload?.path ?? ''
    if (channel.includes('stat-path')) {
      return encodeMessagePackPayload(stats.get(path) ?? null)
    }
    if (channel.includes('read-file')) {
      readCalls.push(path)
      return encodeMessagePackPayload(reads.get(path) ?? '')
    }
    throw new Error(`unexpected channel: ${channel}`)
  }
}

;(globalThis as unknown as { window: unknown }).window = { electron: { ipcRenderer } }

const WORKING_FOLDER = 'D:/demo'
const DIR_PATH = 'D:/demo/src'
const FILE_PATH = 'D:/demo/readme.md'
const MISSING_PATH = 'D:/demo/gone.txt'

stats.set(DIR_PATH, { exists: true, isDirectory: true })
stats.set(FILE_PATH, { exists: true, isDirectory: false })
stats.set(MISSING_PATH, null)
reads.set(FILE_PATH, 'alpha\nbeta\ngamma')

async function main(): Promise<void> {
  // ── 目录：是「路径引用」，不是「读取失败」 ──────────────────────────────
  const dirResult = await buildSelectedFileContext({
    text: createSelectFileTag('src'),
    workingFolder: WORKING_FOLDER
  })

  const dirMeta = dirResult.meta?.files ?? []
  eq(dirMeta.length, 1, 'directory reference produces exactly one meta entry')
  eq(dirMeta[0]?.skipped, true, 'directory is skipped')
  eq(dirMeta[0]?.skipReason, 'directory', 'directory carries its own skip reason')
  eq(dirMeta[0]?.error, undefined, 'directory is NOT reported as a read failure')
  eq(readCalls.includes(DIR_PATH), false, 'directory content is never read')
  eq(dirResult.contextText, undefined, 'directory injects no content block')

  // ── 文件：仍然照常读取并注入（回归护栏） ────────────────────────────────
  const fileResult = await buildSelectedFileContext({
    text: createSelectFileTag('readme.md'),
    workingFolder: WORKING_FOLDER
  })

  const fileMeta = fileResult.meta?.files ?? []
  eq(fileMeta.length, 1, 'file reference produces exactly one meta entry')
  eq(fileMeta[0]?.skipped, undefined, 'file is read, not skipped')
  eq(fileMeta[0]?.error, undefined, 'file read succeeds')
  eq(fileMeta[0]?.lineCount, 3, 'file line count is recorded')
  check(
    fileResult.contextText?.includes('## readme.md') === true,
    'file content is injected under its own heading'
  )
  check(fileResult.contextText?.includes('alpha') === true, 'file body survives into the block')

  // ── 真错误：不能被「目录」这条新分支顺带吞掉 ────────────────────────────
  const missingResult = await buildSelectedFileContext({
    text: createSelectFileTag('gone.txt'),
    workingFolder: WORKING_FOLDER
  })

  const missingMeta = missingResult.meta?.files ?? []
  eq(missingMeta.length, 1, 'missing path still produces a meta entry')
  eq(missingMeta[0]?.error, 'File not found', 'genuine read failure is still an error')
  eq(missingMeta[0]?.skipped, undefined, 'genuine read failure is not silently skipped')

  // ── 目录与文件混在一条消息里：各走各的分支 ──────────────────────────────
  const mixedResult = await buildSelectedFileContext({
    text: `${createSelectFileTag('src')} ${createSelectFileTag('readme.md')}`,
    workingFolder: WORKING_FOLDER
  })

  const mixedMeta = mixedResult.meta?.files ?? []
  eq(mixedMeta.length, 2, 'mixed message keeps both entries')
  const mixedDir = mixedMeta.find((file) => file.path === 'src')
  const mixedFile = mixedMeta.find((file) => file.path === 'readme.md')
  eq(mixedDir?.skipReason, 'directory', 'directory keeps its skip reason next to a file')
  eq(mixedFile?.skipped, undefined, 'file next to a directory still reads')
  check(
    mixedResult.contextText?.includes('## readme.md') === true,
    'only the file is injected when the two are mixed'
  )
  check(
    mixedResult.contextText?.includes('## src') === false,
    'the directory never appears as an injected section'
  )

  console.log(`selected-file-context regression checks passed (${checks} assertions).`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
