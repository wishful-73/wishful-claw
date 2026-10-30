/*
 * Guard: 插件资产下载器的六条硬约束（S-242）。
 *
 * 为什么这些必须有单测 —— 全都是「错了也不报错」的类型：
 * ① 断点续传没续上，用户只看到从 0 开始的百分比，白下第二次；
 * ② 校验失败却落了 ready，投毒文件直接当成官方资产交给插件；
 * ③ 多源回退不生效，主源一挂全国用户都下不动；
 * ④ 取消后把 `.part` 删了，点两次取消等于重下；
 * ⑤ 并发不限，十个资产一起拉，用户以为软件死了；
 * ⑥ status 每次算 sha256，开面板卡三秒。
 *
 * 靠本地 http server 验证，不碰 electron、不碰真网络。
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  PluginAssetManager,
  type PluginAssetProgressEvent
} from '../../src/main/plugins/plugin-assets'
import type { PluginAssetCatalogEntry } from '../../src/main/plugins/plugin-asset-catalog'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

const sha256 = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex')

/** 512 KB 的假资产：够切成十几块，慢速源上有充裕时间窗口点取消。 */
function makePayload(fill: number): Buffer {
  const buffer = Buffer.alloc(512 * 1024)
  for (let i = 0; i < buffer.length; i += 1) buffer[i] = (i * 31 + fill) & 0xff
  return buffer
}

const GOOD = makePayload(7)
const OTHER = makePayload(99)

interface ServeRecord {
  path: string
  range: string | undefined
}

interface Harness {
  origin: string
  requests: ServeRecord[]
  close: () => Promise<void>
}

function sendChunked(
  payload: Buffer,
  res: import('node:http').ServerResponse,
  delayMs: number
): void {
  let offset = 0
  const step = 32 * 1024
  const timer = setInterval(() => {
    if (offset >= payload.length) {
      clearInterval(timer)
      res.end()
      return
    }
    res.write(payload.subarray(offset, offset + step))
    offset += step
  }, delayMs)
  res.on('close', () => clearInterval(timer))
}

async function startHarness(): Promise<Harness> {
  const requests: ServeRecord[] = []

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    const range = req.headers['range']
    requests.push({ path, range: typeof range === 'string' ? range : undefined })

    if (path === '/404') {
      res.writeHead(404)
      res.end('nope')
      return
    }

    // /corrupt 给的字节数一样但内容不同 —— 只有 sha256 能识破
    if (path === '/corrupt') {
      const payload = OTHER
      res.writeHead(200, { 'Content-Length': String(payload.length) })
      res.end(payload)
      return
    }

    const delayMs = path === '/slow' ? 20 : 0
    // /no-range 无视 Range 直接用 200 全量回，模拟不支持续传的源
    const ignoreRange = path === '/no-range'
    let start = 0
    if (range && !ignoreRange) {
      const matched = /bytes=(\d+)-/.exec(range)
      if (matched) start = Number(matched[1])
    }
    if (start >= GOOD.length) {
      res.writeHead(416, { 'Content-Range': `bytes */${GOOD.length}` })
      res.end()
      return
    }

    const slice = GOOD.subarray(start)
    const headers: Record<string, string | number> = {
      'Content-Length': String(slice.length)
    }
    if (start > 0) {
      headers['Content-Range'] = `bytes ${start}-${GOOD.length - 1}/${GOOD.length}`
      res.writeHead(206, headers)
    } else {
      res.writeHead(200, headers)
    }
    if (delayMs > 0) {
      sendChunked(slice, res, delayMs)
    } else {
      res.end(slice)
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
  }
}

async function main(): Promise<void> {
  const harness = await startHarness()
  const rootDir = await mkdtemp(join(tmpdir(), 'wishful-plugin-assets-'))

  const entry = (
    id: string,
    name: string,
    payload: Buffer,
    paths: string[]
  ): PluginAssetCatalogEntry => ({
    id,
    name,
    desc: `test asset ${id}`,
    kind: 'data',
    size: payload.length,
    sha256: sha256(payload),
    urls: paths.map((path) => `${harness.origin}${path}`)
  })

  const catalog: PluginAssetCatalogEntry[] = [
    entry('test/full', '完整资产', GOOD, ['/full']),
    entry('test/resumable', '续传资产', GOOD, ['/full']),
    entry('test/corrupt', '损坏资产', GOOD, ['/corrupt']),
    entry('test/fallback', '多源资产', GOOD, ['/404', '/full']),
    entry('test/cancel', '可取消资产', GOOD, ['/slow']),
    entry('test/no-range', '不支持续传的源', GOOD, ['/no-range']),
    entry('test/concurrent-a', '并发 A', GOOD, ['/slow']),
    entry('test/concurrent-b', '并发 B', GOOD, ['/slow']),
    entry('test/concurrent-c', '并发 C', GOOD, ['/slow']),
    entry('test/unknown-check', '未知检查', GOOD, ['/full'])
  ]

  const events: PluginAssetProgressEvent[] = []

  try {
    const manager = new PluginAssetManager({
      rootDir,
      catalog,
      emit: (event) => events.push(event),
      maxConcurrent: 2
    })

    // ─── ① 全新下载：ready + 内容一致 + 不留 .part ───
    const beforeStates = await manager.status('test/full')
    check(beforeStates.state === 'absent', '未下载时为 absent')

    const fullResult = await manager.download('test/full')
    check(fullResult.state === 'ready', '下载完成应为 ready')
    check(fullResult.receivedBytes === GOOD.length, 'receivedBytes 等于资产大小')
    const fullPath = join(rootDir, 'test', 'full')
    check(fullResult.path === fullPath, '.part 改名为正式文件')
    const onDisk = await readFile(fullPath)
    check(onDisk.equals(GOOD), '落盘内容与源一致')
    await assert.rejects(stat(`${fullPath}.part`), '成功后不得残留 .part')

    const states = events.filter((e) => e.id === 'test/full').map((e) => e.state)
    check(states.includes('downloading'), '推送里出现过 downloading')
    check(states.includes('verifying'), '校验阶段要单独推一次（用户得知道在算哈希）')
    check(states[states.length - 1] === 'ready', '最后一次推送是 ready')

    // ─── ② 断点续传：预置前半段，只请求剩余范围 ───
    const resumablePath = join(rootDir, 'test', 'resumable')
    await mkdir(dirname(resumablePath), { recursive: true })
    const half = Math.floor(GOOD.length / 2)
    await writeFile(`${resumablePath}.part`, GOOD.subarray(0, half))

    const resumeStatus = await manager.status('test/resumable')
    check(resumeStatus.state === 'absent', '只有 .part 时不算就绪')
    check(resumeStatus.receivedBytes === half, 'status 报出已收到的字节，面板才能显示百分比')

    harness.requests.length = 0
    const resumeResult = await manager.download('test/resumable')
    check(resumeResult.state === 'ready', '续传后应为 ready')
    const resumeRequests = harness.requests.filter((r) => r.path === '/full')
    check(resumeRequests.length === 1, '续传只该打一次请求')
    check(resumeRequests[0].range === `bytes=${half}-`, '续传必须带 Range 从断点开始')
    const resumed = await readFile(resumablePath)
    check(resumed.equals(GOOD), '续传拼出来的文件必须逐字节正确')

    // ─── ③ sha256 不符：绝不落 ready ───
    const corruptResult = await manager.download('test/corrupt')
    check(corruptResult.state === 'failed', 'sha256 不符必须报失败')
    const corruptPath = join(rootDir, 'test', 'corrupt')
    await assert.rejects(stat(corruptPath), '校验失败不得留下正式文件')
    await assert.rejects(stat(`${corruptPath}.part`), '校验失败要清掉 .part，别让坏字节留到下次')
    const corruptStatus = await manager.status('test/corrupt')
    check(corruptStatus.state === 'failed', 'status 要能复述失败，而不是回到 absent 装没事')
    check(typeof corruptStatus.error === 'string' && corruptStatus.error.length > 0, '失败要带原因')

    // ─── ④ 多源回退：主源 404 走备源 ───
    const fallbackResult = await manager.download('test/fallback')
    check(fallbackResult.state === 'ready', '主源 404 应回退到备源并成功')
    const fallbackPaths = harness.requests.filter((r) => r.path === '/404' || r.path === '/full')
    check(fallbackPaths.some((r) => r.path === '/404'), '确实先试了主源')

    // ─── ⑤ 取消：保留 .part，再次下载能续 ───
    const cancelPromise = manager.download('test/cancel')
    await new Promise((resolve) => setTimeout(resolve, 120))
    const cancelled = manager.cancel('test/cancel')
    check(cancelled, 'cancel 应返回 true')
    const cancelResult = await cancelPromise
    check(cancelResult.state === 'absent', '取消不是失败：状态回到 absent')
    const cancelPath = join(rootDir, 'test', 'cancel')
    const partial = await stat(`${cancelPath}.part`)
    check(partial.size > 0 && partial.size < GOOD.length, '取消后 .part 保留未完成的部分')
    const afterCancel = await manager.status('test/cancel')
    check(afterCancel.state === 'absent', '取消后不报 failed')
    check(afterCancel.receivedBytes === partial.size, '取消后 status 报出已下字节')

    harness.requests.length = 0
    const redoResult = await manager.download('test/cancel')
    check(redoResult.state === 'ready', '取消后再点能下完')
    const redoRequests = harness.requests.filter((r) => r.path === '/slow')
    check(
      redoRequests.some((r) => typeof r.range === 'string' && r.range.startsWith('bytes=')),
      '再次下载必须从断点续，不是从头再来'
    )

    // ─── ⑥ 并发上限：三个资产同时下，槽位占用最多 2 ───
    // 数服务端的 TCP 连接会把「数据已下完、连接还没 close」的那几十毫秒算进来，
    // 所以直接看闸门自己占了几路
    let peakSlots = 0
    const sampler = setInterval(() => {
      peakSlots = Math.max(peakSlots, manager.runningCount)
    }, 5)
    const started = Date.now()
    const concurrent = await Promise.all([
      manager.download('test/concurrent-a'),
      manager.download('test/concurrent-b'),
      manager.download('test/concurrent-c')
    ])
    clearInterval(sampler)
    check(concurrent.every((item) => item.state === 'ready'), '并发下载全部完成')
    check(peakSlots <= 2, `并发上限未生效（观测到 ${peakSlots} 路）`)
    check(peakSlots === 2, `三路并发时应当真的跑满 2 路（观测到 ${peakSlots}）`)
    check(manager.runningCount === 0, '全部结束后槽位要归零，否则下次下载永远排队')
    check(Date.now() - started > 0, '并发用例确实跑完了')

    // 重复点下载返回同一个 promise，不会开第二条流
    const again = manager.download('test/resumable')
    check((await again).state === 'ready', '已就绪的资产再点下载不该报错')

    // ─── ⑦ status 轻量：同大小篡改不会被 status 抓到（证明没算哈希）──
    await writeFile(resumablePath, OTHER)
    const tamperedStatus = await manager.status('test/resumable')
    check(
      tamperedStatus.state === 'ready',
      'status 只查大小 —— 每次开机都全量算 sha256 会让面板卡住'
    )
    // ─── ⑧ 显式 verify 才抓得住 ───
    const verified = await manager.verify('test/resumable')
    check(verified.state === 'failed', '显式校验必须识破同大小的篡改')

    // —— ⑨ 未知 id ——
    const unknown = await manager.status('does/not/exist')
    check(unknown.state === 'unknown', '目录表外的 id 报 unknown')
    const unknownDownload = await manager.download('does/not/exist')
    check(unknownDownload.state === 'unknown', '未知 id 下载不抛错，只回 unknown')

    // —— ⑩ 服务端不支持 Range：必须从头重下而不是拼出坏文件 ——
    const noRangePath = join(rootDir, 'test', 'no-range')
    await mkdir(dirname(noRangePath), { recursive: true })
    await writeFile(`${noRangePath}.part`, GOOD.subarray(0, 1000))
    const noRangeResult = await manager.download('test/no-range')
    check(noRangeResult.state === 'ready', '不支持续传的源也要能下成功')
    check((await readFile(noRangePath)).equals(GOOD), '不支持 Range 时以 200 全量覆盖，不拼错')

    console.log(`plugin-assets: ${checks} assertions passed`)
  } finally {
    await harness.close()
    await rm(rootDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
