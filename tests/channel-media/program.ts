// S-354 D-5 回归：渠道出站媒体这条线的纯函数。
//
// 本迭代新增约 500 行媒体代码，此前 `tests/**` 零断言 —— `npm test` 全绿是因为它统计
// 的是**已有用例数**，不是覆盖率。这里钉两件事：
//
//   1. `inferVoiceEncodeType` 的后缀映射。微信侧拿它填 `voice_item.encode_type`，
//      填错了**上传照样成功、对方解不出声**。`weixin-outbound-media.ts:25-26` 自己
//      承认「opus → OGG_SPEEX 是推断」，这是唯一能钉住它的地方。
//   2. `sendMediaOrText` 的降级分支。老大 2026-11-09 10:46 的裁定是「发不了就只能
//      退避发文字」—— 不钉住，下次又会被写成 `throw`（D-1 就是这么丢的）。

import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildMediaFallbackText,
  sendMediaOrText,
  supportsMediaKind
} from '../../src/main/channels/channel-media'
import {
  MAX_OUTBOUND_MEDIA_BYTES,
  readBinarySource
} from '../../src/main/channels/channel-media-source'
import { inferVoiceEncodeType } from '../../src/main/channels/providers/weixin/weixin-outbound-media'
import { WeixinVoiceEncodeType } from '../../src/main/channels/providers/weixin/weixin-types'
import type {
  ChannelMediaKind,
  ChannelMediaPayload,
  MessagingChannelService
} from '../../src/main/channels/channel-types'

// ── 1. inferVoiceEncodeType：后缀 → 微信 encode_type ──

{
  const cases: Array<[string, number, string]> = [
    ['voice.silk', WeixinVoiceEncodeType.SILK, 'silk 是协议基准格式'],
    ['a.amr', WeixinVoiceEncodeType.AMR, 'amr'],
    ['talk.mp3', WeixinVoiceEncodeType.MP3, 'mp3'],
    ['x.speex', WeixinVoiceEncodeType.SPEEX, 'speex'],
    ['rec.pcm', WeixinVoiceEncodeType.PCM, 'pcm'],
    ['rec.wav', WeixinVoiceEncodeType.PCM, 'wav 与 pcm 同码'],
    ['memo.ogg', WeixinVoiceEncodeType.OGG_SPEEX, 'ogg'],
    ['memo.opus', WeixinVoiceEncodeType.OGG_SPEEX, '官方枚举没有独立 opus，取最接近的']
  ]
  for (const [fileName, expected, why] of cases) {
    assert.equal(inferVoiceEncodeType(fileName), expected, `${fileName} → ${why}`)
  }
}

// ── 2. 认不出的后缀回落 SILK，不抛错 ──

{
  assert.equal(inferVoiceEncodeType('memo.bin'), WeixinVoiceEncodeType.SILK)
  assert.equal(inferVoiceEncodeType('noext'), WeixinVoiceEncodeType.SILK, '无后缀不能崩')
  assert.equal(inferVoiceEncodeType(''), WeixinVoiceEncodeType.SILK)
}

// ── 3. 大小写不敏感（用户传的文件名什么写法都有） ──

{
  assert.equal(inferVoiceEncodeType('MEMO.MP3'), WeixinVoiceEncodeType.MP3)
  assert.equal(inferVoiceEncodeType('A.OPUS'), WeixinVoiceEncodeType.OGG_SPEEX)
}

// ── 4. buildMediaFallbackText：原消息正文 + 一句说明 ──

{
  const withCaption = buildMediaFallbackText('audio', '  会议录音  ')
  assert.equal(withCaption, '会议录音\n（当前渠道不支持发送语音，已改为文字发送）')

  const noCaption = buildMediaFallbackText('image')
  assert.equal(noCaption, '（当前渠道不支持发送图片，已改为文字发送）')

  assert.ok(buildMediaFallbackText('file', '   ').includes('不支持发送文件'), '空白正文当没有正文')
}

// ── 5. 桩：记录每次出站，用来判断到底走了哪条路 ──

function makeStub(supported: readonly ChannelMediaKind[] | undefined): {
  service: MessagingChannelService
  calls: string[]
} {
  const calls: string[] = []
  const service = {
    pluginId: 'stub',
    pluginType: 'stub',
    start: async () => {},
    stop: async () => {},
    isRunning: () => true,
    sendMessage: async (chatId: string, content: string) => {
      calls.push(`text:${chatId}:${content}`)
      return { messageId: 'm-text' }
    },
    replyMessage: async () => ({ messageId: 'm-reply' }),
    getGroupMessages: async () => [],
    listGroups: async () => [],
    supportedMediaKinds: supported,
    sendMedia: async (chatId: string, media: ChannelMediaPayload) => {
      calls.push(`media:${chatId}:${media.kind}:${media.source}`)
      return { messageId: 'm-media' }
    }
  } as unknown as MessagingChannelService
  return { service, calls }
}

async function main(): Promise<void> {
  // ── 6. 声明支持 ⇒ 发媒体，且**不**再补一条文字 ──

  {
    const { service, calls } = makeStub(['image', 'file', 'audio'])
    const result = await sendMediaOrText(
      service,
      'chat-1',
      { kind: 'audio', source: '/tmp/a.opus' },
      '不该出现的降级文本'
    )
    assert.equal(result.sentAs, 'audio')
    assert.equal(result.messageId, 'm-media')
    assert.deepEqual(calls, ['media:chat-1:audio:/tmp/a.opus'], '支持时不该再发文字')
  }

  // ── 7. 不支持 ⇒ 退避发文字，不抛错（D-1 的核心判据） ──

  {
    const { service, calls } = makeStub([])
    const result = await sendMediaOrText(
      service,
      'chat-2',
      { kind: 'audio', source: '/tmp/a.opus' },
      '会议录音\n（当前渠道不支持发送语音，已改为文字发送）'
    )
    assert.equal(result.sentAs, 'text', '不支持必须降级')
    assert.equal(result.messageId, 'm-text')
    assert.equal(calls.length, 1, '不能既发媒体又发文字')
    assert.ok(calls[0].startsWith('text:chat-2:'), '走的是 sendMessage')
  }

  // ── 8. 其余六家的实际形态：`supportedMediaKinds` 缺省 ⇒ 按不支持处理 ──

  {
    const { service, calls } = makeStub(undefined)
    assert.equal(supportsMediaKind(service, 'image'), false)
    const result = await sendMediaOrText(
      service,
      'chat-3',
      { kind: 'image', source: '/tmp/a.png' },
      '降级'
    )
    assert.equal(result.sentAs, 'text')
    assert.deepEqual(calls, ['text:chat-3:降级'])
  }

  // ── 9. 声明了但没实现 sendMedia ⇒ 也按不支持处理（宁降级，不运行时炸） ──

  {
    const { service, calls } = makeStub(['audio'])
    ;(service as unknown as { sendMedia?: unknown }).sendMedia = undefined
    assert.equal(supportsMediaKind(service, 'audio'), false)
    const result = await sendMediaOrText(
      service,
      'chat-4',
      { kind: 'audio', source: '/tmp/a.opus' },
      '降级'
    )
    assert.equal(result.sentAs, 'text')
    assert.deepEqual(calls, ['text:chat-4:降级'])
  }

  // ── 10. readBinarySource 的上界与异步读（S-355 D-6） ──
  await runSourceCases()

  console.log('channel media regression passed')
}

// S-355 D-6：`readBinarySource` 此前 URL 无超时无上限、本地 `readFileSync` 同步读。
// 这里钉住「超限必拒、正常必过」；超时（60s）不在此测，跑一次要一分钟，验收走 S-355 §8。
async function runSourceCases(): Promise<void> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wc-media-'))

  try {
    // ── 10.1 空来源 / 不存在 / 不是文件 ──
    await assert.rejects(() => readBinarySource('   ', 'f.bin'), /File path is empty/)
    await assert.rejects(
      () => readBinarySource(path.join(dir, 'missing.png'), 'f.png'),
      /File not found/
    )
    await assert.rejects(() => readBinarySource(dir, 'x.bin'), /Not a file/)

    // ── 10.2 正常文件读通，文件名按 basename 推断 ──
    const small = path.join(dir, 'tiny.png')
    await fs.promises.writeFile(small, Buffer.from('hello'))
    const ok = await readBinarySource(small, 'fallback.png')
    assert.equal(ok.buffer.toString(), 'hello')
    assert.equal(ok.fileName, 'tiny.png', '本地来源的 fileName 取 basename')

    // ── 10.3 超上限的本地文件被拒，且错误里写清实际大小与上限 ──
    const big = path.join(dir, 'big.bin')
    await fs.promises.writeFile(big, Buffer.alloc(MAX_OUTBOUND_MEDIA_BYTES + 1))
    await assert.rejects(
      () => readBinarySource(big, 'big.bin'),
      /Outbound media too large: file is 31457281 bytes, limit is 31457280 bytes \(30\.0 MB\)/
    )

    // ── 10.4 URL 分支：声明值超限，读 body 之前就拒 ──
    const server = http.createServer((req, res) => {
      if (req.url === '/small') {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(Buffer.from('hello'))
        return
      }
      if (req.url === '/declared-big') {
        // 只声明、不真发那么多：验证「先看 content-length」
        res.writeHead(200, { 'content-length': String(MAX_OUTBOUND_MEDIA_BYTES + 1) })
        res.end()
        return
      }
      if (req.url === '/lying-big') {
        // 不声明 content-length（chunked），实发超限：验证「边读边累加」
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.end(Buffer.alloc(MAX_OUTBOUND_MEDIA_BYTES + 64 * 1024))
        return
      }
      res.writeHead(404)
      res.end()
    })
    // 客户端超限后主动断开，服务端会收到 EPIPE —— 不是测试失败
    server.on('clientError', () => undefined)

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port

    try {
      const okUrl = await readBinarySource(`http://127.0.0.1:${port}/small`, 'fallback.png')
      assert.equal(okUrl.buffer.toString(), 'hello')
      assert.equal(okUrl.fileName, 'small', 'URL 来源的 fileName 取 pathname')

      await assert.rejects(
        () => readBinarySource(`http://127.0.0.1:${port}/declared-big`, 'x.bin'),
        /Outbound media too large: remote media/
      )
      await assert.rejects(
        () => readBinarySource(`http://127.0.0.1:${port}/lying-big`, 'x.bin'),
        /Outbound media too large: remote media/
      )
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
