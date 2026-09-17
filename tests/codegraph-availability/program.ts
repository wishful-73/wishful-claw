// codegraph-availability 单测。
//
// 这套断言守的是「什么时候去问索引状态」而不是 RPC 本身：问早了（插件没开还去问）
// 是白花一次跨进程序调用，缓存写错了（失败也缓存）会让一次启动抖动钉住整个 TTL。

import { WISHFUL_CLAW_DATA_DIR_NAME } from '@shared/data-dir'
import {
  CODEGRAPH_AVAILABILITY_TTL_MS,
  resolveCodegraphDataRoot,
  resolveCodegraphEnabled,
  resetCodegraphAvailabilityCache,
  shouldProbeCodegraphIndex,
  type CodegraphIndexProbe
} from '@renderer/lib/agent/codegraph-availability'

let passed = 0
const failures: string[] = []

function check(condition: boolean, label: string): void {
  if (condition) {
    passed++
  } else {
    failures.push(label)
  }
}

async function main(): Promise<void> {
  // --- 是否值得探测 -------------------------------------------------------
  check(shouldProbeCodegraphIndex(true, 'D:/repo'), 'plugin on + folder → probe')
  check(!shouldProbeCodegraphIndex(false, 'D:/repo'), 'plugin off → no probe')
  check(!shouldProbeCodegraphIndex(true, undefined), 'no working folder → no probe')
  check(!shouldProbeCodegraphIndex(true, null), 'null working folder → no probe')
  check(!shouldProbeCodegraphIndex(true, ''), 'empty working folder → no probe')

  // --- SSH 项目的 dataRoot 推导 -------------------------------------------
  const sshRoot = `${WISHFUL_CLAW_DATA_DIR_NAME}/projects/p1/codegraph`
  check(resolveCodegraphDataRoot('p1', 'ssh1') === sshRoot, 'ssh project → dataRoot under data dir')
  check(resolveCodegraphDataRoot('p1', undefined) === undefined, 'local project → no dataRoot')
  check(resolveCodegraphDataRoot(undefined, 'ssh1') === undefined, 'no project id → no dataRoot')
  check(resolveCodegraphDataRoot(null, null) === undefined, 'nulls → no dataRoot')

  // --- 插件关：一次也不问 -------------------------------------------------
  resetCodegraphAvailabilityCache()
  let offCalls = 0
  const offResult = await resolveCodegraphEnabled({
    pluginEnabled: false,
    workingFolder: 'D:/off',
    probe: async () => {
      offCalls++
      return true
    }
  })
  check(offResult === false, 'plugin off → false')
  check(offCalls === 0, 'plugin off → probe never called')

  // --- 命中后缓存 ---------------------------------------------------------
  resetCodegraphAvailabilityCache()
  let calls = 0
  const probe: CodegraphIndexProbe = async () => {
    calls++
    return true
  }

  const first = await resolveCodegraphEnabled({
    pluginEnabled: true,
    workingFolder: 'D:/r1',
    probe,
    now: () => 1_000
  })
  check(first === true, 'indexed → true')

  const cached = await resolveCodegraphEnabled({
    pluginEnabled: true,
    workingFolder: 'D:/r1',
    probe,
    now: () => 1_000 + CODEGRAPH_AVAILABILITY_TTL_MS - 1
  })
  check(cached === true, 'within TTL → still true')
  check(calls === 1, 'within TTL → served from cache')

  // --- TTL 过期后重查 -----------------------------------------------------
  await resolveCodegraphEnabled({
    pluginEnabled: true,
    workingFolder: 'D:/r1',
    probe,
    now: () => 1_000 + CODEGRAPH_AVAILABILITY_TTL_MS
  })
  check(calls === 2, 'past TTL → probes again')

  // --- 不同项目各自缓存 ---------------------------------------------------
  await resolveCodegraphEnabled({ pluginEnabled: true, workingFolder: 'D:/r2', probe, now: () => 1_000 })
  check(calls === 3, 'different working folder → separate probe')

  // --- 探测失败不缓存 -----------------------------------------------------
  resetCodegraphAvailabilityCache()
  let failCalls = 0
  const failing: CodegraphIndexProbe = async () => {
    failCalls++
    throw new Error('codegraph worker down')
  }
  const failedOnce = await resolveCodegraphEnabled({
    pluginEnabled: true,
    workingFolder: 'D:/r3',
    probe: failing,
    now: () => 5_000
  })
  const failedTwice = await resolveCodegraphEnabled({
    pluginEnabled: true,
    workingFolder: 'D:/r3',
    probe: failing,
    now: () => 5_000
  })
  check(failedOnce === false && failedTwice === false, 'probe failure → false')
  check(failCalls === 2, 'probe failure → not cached')

  // --- 成功探到的 false 要缓存（它是个结论，不是失败） ---------------------
  resetCodegraphAvailabilityCache()
  let notIndexedCalls = 0
  const notIndexed: CodegraphIndexProbe = async () => {
    notIndexedCalls++
    return false
  }
  await resolveCodegraphEnabled({
    pluginEnabled: true,
    workingFolder: 'D:/r4',
    probe: notIndexed,
    now: () => 9_000
  })
  const notIndexedAgain = await resolveCodegraphEnabled({
    pluginEnabled: true,
    workingFolder: 'D:/r4',
    probe: notIndexed,
    now: () => 9_100
  })
  check(notIndexedAgain === false, 'not indexed → false')
  check(notIndexedCalls === 1, 'successful false is cached')

  // --- 请求形状：SSH 带 dataRoot，本地不带 --------------------------------
  resetCodegraphAvailabilityCache()
  const captured: Array<{ workingFolder: string; dataRoot?: string }> = []
  const captureProbe: CodegraphIndexProbe = async (request) => {
    captured.push(request)
    return true
  }

  await resolveCodegraphEnabled({
    pluginEnabled: true,
    workingFolder: 'D:/remote',
    projectId: 'p9',
    sshConnectionId: 'ssh9',
    probe: captureProbe
  })
  check(captured[0]?.workingFolder === 'D:/remote', 'ssh probe carries the working folder')
  check(
    captured[0]?.dataRoot === `${WISHFUL_CLAW_DATA_DIR_NAME}/projects/p9/codegraph`,
    'ssh probe carries the data root'
  )

  await resolveCodegraphEnabled({
    pluginEnabled: true,
    workingFolder: 'D:/local',
    projectId: 'p9',
    probe: captureProbe
  })
  check(captured[1]?.dataRoot === undefined, 'local probe omits the data root')

  if (failures.length > 0) {
    console.error(
      `codegraph-availability: ${failures.length} FAILED\n` +
        failures.map((item) => `  - ${item}`).join('\n')
    )
    process.exit(1)
  }

  console.log(`codegraph-availability: ${passed} assertions passed`)
}

void main()
