// CodeGraph 对当前项目是否可用 —— 「插件开关开 ∧ 项目已有索引」。
//
// 这个判据只能在渲染端算：索引位置由这里推导（本地项目是
// {workingFolder}/.wishful-claw/codegraph，SSH 项目是 data-dir 下的
// projects/<id>/codegraph），Agent worker 看不到那份路径规则，也不该去猜。
// 算出来的值随 run 参数下发，Worker 侧只读它 —— 直连注入与 use_capability
// 代理共用同一条门控，所以被关掉的功能不会从另一条路漏出去。
//
// 本模块刻意不 import agentBridge：探测函数由调用方注入，纯逻辑才能单测。

import { WISHFUL_CLAW_DATA_DIR_NAME } from '@shared/data-dir'

/** CodeGraph worker 的索引状态查询。 */
export const CODEGRAPH_INDEX_STATUS_METHOD = 'codegraph/index-status'

// 发送路径要等这个结果才能定下工具清单，所以超时设短：拿不到就当没有索引，
// 下一轮发送会重新问。宁可这一轮不给工具，也不让一次发送挂在 RPC 上。
export const CODEGRAPH_INDEX_PROBE_TIMEOUT_MS = 5_000

// 命中后的缓存窗口。建索引/删索引是分钟级动作，30 秒远小于它，
// 不会出现「刚建好索引还要等很久」的观感，又能挡住连续发送的重复查询。
export const CODEGRAPH_AVAILABILITY_TTL_MS = 30_000

/** 一次索引探测：命中返回 true，失败由实现方抛出或返回 false。 */
export type CodegraphIndexProbe = (request: {
  workingFolder: string
  dataRoot?: string
}) => Promise<boolean>

/**
 * SSH 项目的索引落在 data-dir 里（远端仓库写不进去），路径由项目 id 决定；
 * 与 codegraph-project-index.tsx 传给主进程的 dataRoot 是同一个值。
 * 本地项目返回 undefined，主进程自己解析成 {workingFolder}/.wishful-claw/codegraph。
 */
export function resolveCodegraphDataRoot(
  projectId?: string | null,
  sshConnectionId?: string | null
): string | undefined {
  if (!projectId || !sshConnectionId) return undefined
  return `${WISHFUL_CLAW_DATA_DIR_NAME}/projects/${projectId}/codegraph`
}

/** 插件没开、或这次运行根本没有项目根时，都不必去问索引状态。 */
export function shouldProbeCodegraphIndex(
  pluginEnabled: boolean,
  workingFolder?: string | null
): boolean {
  return pluginEnabled && Boolean(workingFolder)
}

type CodegraphIndexCacheEntry = { indexed: boolean; at: number }

const indexCache = new Map<string, CodegraphIndexCacheEntry>()

/** 清空进程内缓存（测试用；生产没有第二个写入方）。 */
export function resetCodegraphAvailabilityCache(): void {
  indexCache.clear()
}

export interface CodegraphAvailabilityInput {
  pluginEnabled: boolean
  workingFolder?: string | null
  projectId?: string | null
  sshConnectionId?: string | null
  probe: CodegraphIndexProbe
  now?: () => number
}

/**
 * 解析一次运行该不该拿到 CodeGraph 工具。
 *
 * 只在探测**成功**时写缓存：失败（worker 没起来、超时）会让下一轮重新问，
 * 否则一次启动期的抖动会钉住整整一个 TTL。
 */
export async function resolveCodegraphEnabled(
  input: CodegraphAvailabilityInput
): Promise<boolean> {
  const { pluginEnabled, workingFolder, projectId, sshConnectionId, probe } = input
  if (!shouldProbeCodegraphIndex(pluginEnabled, workingFolder)) return false

  const working = workingFolder as string
  const dataRoot = resolveCodegraphDataRoot(projectId, sshConnectionId)
  const cacheKey = `${working}\u0000${dataRoot ?? ''}`
  const now = (input.now ?? Date.now)()

  const cached = indexCache.get(cacheKey)
  if (cached && now - cached.at < CODEGRAPH_AVAILABILITY_TTL_MS) return cached.indexed

  let indexed: boolean
  try {
    indexed = await probe(
      dataRoot ? { workingFolder: working, dataRoot } : { workingFolder: working }
    )
  } catch {
    return false
  }

  indexCache.set(cacheKey, { indexed, at: now })
  return indexed
}
