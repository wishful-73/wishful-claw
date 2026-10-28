/**
 * es.exe 取数（S-155）：探测、串行取数、Everything 未运行时的自动拉起。
 *
 * S-249 从 `quick-launcher.ts` 搬出。相对原文件只改了 `config.` → `getConfig().` 与几处 `export`；
 * 档位、缓存窗口、冷却窗口、串行队列、三个踩坑点的处理全部原样平移。
 *
 * S-151 的口径是「把关键词投给 Everything，剩下的跟我们没关系」；S-155 改成**我们取数、我们渲染**：
 * 走官方命令行版 es.exe 把命中结果导成 JSON，解析成列表交给渲染端。调整⑤ 之后只有一档：
 * **文件搜索独立窗**（`file-search:query`）。
 */

import { app } from 'electron'
import { execFile, spawn } from 'child_process'
import { join } from 'path'
import * as fs from 'fs'
import { resolveDataDir } from '../lib/data-dir'
import { isThirdPartyPrivateEverythingPath } from '../lib/everything-search'
import {
  ES_EXE_BASENAME,
  ES_PAGE_SIZE,
  ES_PROCESS_TIMEOUT_MS,
  buildEsArgs,
  classifyEsFailure,
  getEsAlongsideCandidates,
  getEsBuiltinPath,
  getEsKnownDirCandidates,
  isEsExecutableName,
  isEsVersionInfoHit,
  parseEsJson,
  parseEsPathLines,
  pickEsCandidate,
  type EsExeMatch
} from '../lib/es-search'
import { getConfig } from './config'
import {
  EVERYTHING_SCAN_TIMEOUT_MS,
  collectScanCandidates,
  getEverythingStatus,
  runProbeCommand,
  verifyDiscoveredCandidates
} from './everything-probe'
import type { EsQueryRequest, EsSearchResult, EsStatus } from './types'

// ── es.exe 取数（S-155）──
//
// S-151 的口径是「把关键词投给 Everything，剩下的跟我们没关系」；S-155 改成**我们取数、我们渲染**：
// 走官方命令行版 es.exe 把命中结果导成 JSON，解析成列表交给渲染端。
//
// 调整⑤ 之后只有一档：**文件搜索独立窗**（`file-search:query`）。原来那套「Everything 在、es 不在
// 就退回投递式」的降级连同原窗的窄条面板一起删了 —— es.exe 是内置的（调整①），拿不到它属于异常，
// 该修的是异常本身，不是再养一条没人走的分支。

const ES_NOT_READY: EsStatus = {
  supported: true,
  ready: false,
  exePath: null,
  source: null,
  detected: false
}

/** 轻探的缓存窗口。 */
const ES_PROBE_TTL_MS = 30 * 1000
/** 重探（含扫盘）的缓存窗口：扫盘贵，绑上了别反复扫。 */
const ES_DEEP_PROBE_TTL_MS = 5 * 60 * 1000
/** 取数落盘的临时 JSON —— 读完就删，不常驻（见 `runEsSearch`）。 */
const ES_OUT_FILENAME = 'es-search-out.json'

/**
 * Everything 未运行时的自动拉起（S-155 调整②）：起进程后**等 IPC 上线**的总预算与轮询间隔。
 *
 * 冷启动 Everything 要读索引，几百毫秒到两三秒是正常的；轮询直接拿用户那次搜索重试，不额外探测
 * （省一次无用查询，命中那一次的结果本身就是最终结果）。
 */
const EVERYTHING_AUTOSTART_WAIT_MS = 3000
const EVERYTHING_AUTOSTART_POLL_MS = 250

/**
 * 自动拉起的冷却窗口。
 *
 * 连打关键词会连着好几次搜索、每次都会看到 `not-running` —— 没有冷却就会一秒起一堆 Everything。
 * 窗口内只起一次，后面的搜索靠轮询等它上线。
 */
const EVERYTHING_AUTOSTART_COOLDOWN_MS = 10 * 1000

let esProbeCache: { at: number; status: EsStatus; deep: boolean } | null = null

/** 上次自动拉起 Everything 的时刻（0 = 从没起过），用于 `EVERYTHING_AUTOSTART_COOLDOWN_MS` 冷却。 */
let everythingAutostartAt = 0

export function invalidateEsProbe(): void {
  esProbeCache = null
}

/** 去重 + 剔第三方私有副本 + 只留 `es.exe`（常见安装位 / 扫盘的输出都过这道）。 */
export function sanitizeEsCandidates(paths: readonly string[]): string[] {
  const found: string[] = []
  for (const raw of paths ?? []) {
    const candidate = (raw ?? '').trim()
    if (!candidate) continue
    const base = candidate.split(/[\\/]/).pop() ?? ''
    if (!isEsExecutableName(base)) continue
    if (isThirdPartyPrivateEverythingPath(candidate)) continue
    if (!found.includes(candidate)) found.push(candidate)
  }
  return found
}

/** `where es.exe`。 */
async function collectEsPathCandidates(): Promise<string[]> {
  const stdout = await runProbeCommand('where', [ES_EXE_BASENAME], 3000)
  return sanitizeEsCandidates(parseEsPathLines(stdout))
}

/**
 * 内置 es.exe 的可能落点（S-155 调整①：不再引导用户去装 es.exe）。
 *
 * 三个 root 都算一遍、交给 `pickEsCandidate` 的 `exists` 筛 —— 不在这里判存在，省得两处判断漂移：
 *   - dev：`<repo>/resources/es/es.exe`（`process.cwd()` = 仓库根）；
 *   - 打包：`<resources>/es/es.exe`（electron-builder `extraResources` 的落点）；
 *   - 兜底：`<app>/resources/es/es.exe`（asar 外挂路径的另一种摆法）。
 *
 * process.resourcesPath 在 dev 下指向 `node_modules/electron/dist/resources`，所以 dev 命中的是
 * 第一条而不是它 —— 三条并列扫一遍，谁真存在算谁。
 */
function getEsBuiltinCandidates(): string[] {
  const roots = [
    join(process.cwd(), 'resources'),
    process.resourcesPath ?? '',
    join(app.getAppPath(), 'resources')
  ]
  const found: string[] = []
  for (const root of roots) {
    const candidate = getEsBuiltinPath(root)
    if (candidate && !found.includes(candidate)) found.push(candidate)
  }
  return found
}

/**
 * 分级探测 —— 档位按**代价**排：手动指定 → 内置件 → Everything 同目录 / 常见安装位 / PATH → 扫盘（仅重探）。
 *
 * 比 S-151 少四档（注册表 / 服务 / 快捷方式 / 进程）：es.exe 是**单文件**，不装、不跑、不当快捷
 * 方式目标，那四档没有对应物（理由写在 `lib/es-search.ts` 的 `EsExeSource` 上）。
 */
export async function probeEs(deep: boolean): Promise<EsStatus> {
  if (process.platform !== 'win32') return { ...ES_NOT_READY, supported: false }

  const toStatus = (match: EsExeMatch | null): EsStatus => ({
    supported: true,
    ready: match !== null,
    exePath: match?.path ?? null,
    source: match?.source ?? null,
    detected: match?.source === 'manual' && getConfig().esExePathAuto
  })
  const exists = (candidate: string): boolean => fs.existsSync(candidate)

  // ① 手动指定（含「本机检测」自动绑定的）—— 用户自己的选择，直接认。
  const manual = (getConfig().esExePath ?? '').trim()
  if (manual && exists(manual)) return toStatus({ path: manual, source: 'manual' })

  // ② 便宜档。内置件排最前（默认落点，零外部依赖）；「与 Everything 同目录」要拿本体的路径，
  //    先问一句本体（它有缓存，通常零成本）。内置路径不过 `sanitizeEsCandidates` —— 那是我们自己
  //    打包的确定落点，多一道「第三方私有路径」过滤反而可能误伤。
  const everything = await getEverythingStatus()
  const fromPath = await collectEsPathCandidates()
  const cheap = pickEsCandidate(
    {
      builtin: getEsBuiltinCandidates(),
      alongside: sanitizeEsCandidates(getEsAlongsideCandidates(everything.exePath)),
      'program-files': sanitizeEsCandidates(getEsKnownDirCandidates(process.env)),
      path: fromPath
    },
    exists
  )
  if (cheap) return toStatus(cheap)

  if (!deep) return toStatus(null)

  // ③ 扫盘（仅重探）。猜出来的必须过版本检测 —— 叫 es.exe 的杂鱼不少（它的版本信息就是 `es`）。
  const scanned = pickEsCandidate(
    {
      scan: await verifyDiscoveredCandidates(
        await collectScanCandidates(
          EVERYTHING_SCAN_TIMEOUT_MS,
          isEsExecutableName,
          sanitizeEsCandidates
        ),
        isEsVersionInfoHit
      )
    },
    exists
  )
  return toStatus(scanned)
}

export async function getEsStatus(deep = false): Promise<EsStatus> {
  const now = Date.now()
  const cached = esProbeCache
  if (cached && now - cached.at < (cached.deep ? ES_DEEP_PROBE_TTL_MS : ES_PROBE_TTL_MS)) {
    // 轻探答不了重探（重探多扫一层盘），重探可以答轻探。
    if (cached.deep || !deep) return cached.status
  }
  const status = await probeEs(deep)
  esProbeCache = { at: now, status, deep }
  return status
}

/**
 * 取数串行队列。
 *
 * 所有调用共用同一个输出文件，并发会互踩（A 写 B 读、B 删 A 写），最坏拿到别人关键词的结果。
 * 单次实测 ~130ms，串行完全够。队列吞掉前一个的异常，不让一次失败堵死后续查询。
 */
let esSearchQueue: Promise<unknown> = Promise.resolve()

export function enqueueEsSearch<T>(task: () => Promise<T>): Promise<T> {
  const next = esSearchQueue.then(task, task)
  esSearchQueue = next.catch(() => undefined)
  return next
}

export function resolveEsOutFile(): string {
  return join(resolveDataDir(), ES_OUT_FILENAME)
}

/**
 * 跑一次 es.exe 取数。
 *
 * 三个实测踩坑点（原文在 `lib/es-search.ts` 头注，这里是对应的处理）：
 *   - 输出文件**先删**：es.exe 失败时照样会建它（实测 exit 8 也建），不删会把上一轮的陈旧结果
 *     当成这次的结果；
 *   - 失败分类**看退出码**（exit 8 = Everything 没在跑），不能只看文件在不在；
 *   - 空结果文件只有 3 字节 BOM，`parseEsJson` 已把它当空数组，不算错误。
 *
 * 临时文件**用完即删**，不常驻 —— 别在用户数据目录里留一堆没人清理的中间产物。
 */
export async function runEsSearch(exePath: string, request: EsQueryRequest): Promise<EsSearchResult> {
  const outFile = resolveEsOutFile()
  const args = buildEsArgs(request.keyword ?? '', outFile, {
    category: request.category ?? 'all',
    sort: request.sort ?? null,
    offset: request.offset ?? 0,
    pageSize: request.pageSize ?? ES_PAGE_SIZE
  })
  // 空查询不启动进程，直接当「没搜到」（es.exe 那边空查询 = 全盘，见 es-search 头注 ⑩）。
  if (!args) return { ok: true, hits: [] }

  try {
    await fs.promises.rm(outFile, { force: true })
  } catch {
    // 删不掉就继续 —— 后面读不到内容会走 bad-output，不会静默错。
  }

  const outcome = await new Promise<{ code: number | null; stderr: string; timedOut: boolean }>(
    (resolve) => {
      try {
        execFile(
          exePath,
          args,
          {
            windowsHide: true,
            timeout: ES_PROCESS_TIMEOUT_MS,
            encoding: 'utf8',
            maxBuffer: 16 * 1024 * 1024,
            cwd: resolveDataDir()
          },
          (error, _stdout, stderr) => {
            resolve({
              code: error ? (typeof error.code === 'number' ? error.code : null) : 0,
              stderr: typeof stderr === 'string' ? stderr : '',
              timedOut: Boolean(error && error.killed)
            })
          }
        )
      } catch (error) {
        resolve({
          code: null,
          stderr: error instanceof Error ? error.message : String(error),
          timedOut: false
        })
      }
    }
  )

  try {
    // 超时杀进程时 code 也是 null，但那是「跑了没在 2s 内回来」，不是「没起来」——
    // 归 search-failed，免得调用方白跑一轮重新探测。
    if (outcome.timedOut && outcome.code === null) {
      return { ok: false, hits: [], failure: 'search-failed', error: 'es.exe timed out' }
    }

    const failure = classifyEsFailure(outcome.code, outcome.stderr)
    if (failure) {
      return { ok: false, hits: [], failure, error: outcome.stderr.trim() || `exit ${outcome.code}` }
    }

    let raw = ''
    try {
      raw = await fs.promises.readFile(outFile, 'utf8')
    } catch {
      return { ok: false, hits: [], failure: 'bad-output', error: 'output file missing' }
    }

    try {
      return { ok: true, hits: parseEsJson(raw) }
    } catch (error) {
      return {
        ok: false,
        hits: [],
        failure: 'bad-output',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  } finally {
    try {
      await fs.promises.rm(outFile, { force: true })
    } catch {
      // 清理失败不该影响结果。
    }
  }
}

/** 等一会儿（`setTimeout` 的 Promise 版）。 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Everything 没在跑 ⇒ 替他拉起来，再重试这次搜索（S-155 调整②）。
 *
 * 老大 2026-09-29 的口径：用户装了 Everything 却没开机自启 / 没手动开，不该让他自己去开 ——
 * 我们替他起。步骤：
 *   ① 问一句本体路径（走缓存）；**没探到就如实回 `not-running`** —— 那是「压根没装」，
 *      交给 UI 走「下载并安装」引导，我们不越权去装东西；
 *   ② `spawn <Everything.exe> -startup`：`-startup` 是官方的「静默启动」开关（已在跑则什么都不做），
 *      detached + 不挂窗口，别弹个主窗口糊用户一脸。冷却窗口内只起一次；
 *   ③ 轮询重试**用户这次搜索本身**，直到失败分类不再是 `not-running`（IPC 上线了）或超预算。
 *
 * 边界（写进 S-155.md 待实测项）：Everything 若配置成需要提权才能索引，这一步会弹 UAC —— 用户
 * 允许即正常；不允许则重试到超时，如实回 `not-running`。
 */
export async function startEverythingAndRetry(
  esExePath: string,
  request: EsQueryRequest,
  firstResult: EsSearchResult
): Promise<EsSearchResult> {
  const everything = await getEverythingStatus()
  const everythingExe = (everything.exePath ?? '').trim()
  if (!everything.ready || !everythingExe) return firstResult

  const now = Date.now()
  if (now - everythingAutostartAt > EVERYTHING_AUTOSTART_COOLDOWN_MS) {
    everythingAutostartAt = now
    try {
      const child = spawn(everythingExe, ['-startup'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      child.on('error', (error) =>
        console.warn(`[QuickLauncher] Failed to start Everything: ${error.message}`)
      )
      child.unref()
    } catch (error) {
      console.warn(`[QuickLauncher] Failed to start Everything: ${String(error)}`)
    }
  }

  const deadline = now + EVERYTHING_AUTOSTART_WAIT_MS
  let result = firstResult
  while (result.failure === 'not-running' && Date.now() < deadline) {
    await delay(EVERYTHING_AUTOSTART_POLL_MS)
    result = await enqueueEsSearch(() => runEsSearch(esExePath, request))
  }
  // 拉过了还是 `not-running`：得让 UI 知道「已经替你起过一次」，能说「拉不起来」而不是无限「正在启动」。
  // 上面那条 `!everything.ready` 的早退（本体没探到 = 多半没装）**不带**这个标记 ——
  // 那是 S-253 的 B 情况，UI 该走下载引导。
  return result.failure === 'not-running' ? { ...result, autostartAttempted: true } : result
}