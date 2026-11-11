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
import {
  buildMediaFallbackText,
  sendMediaOrText,
  supportsMediaKind
} from '../../src/main/channels/channel-media'
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

  console.log('channel media regression passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
