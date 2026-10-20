// S-212 回归：QQ 入站图片的地址提取与下载前处理。
//
// 原先解析层只读 `attachments[0].content_type` 挑了句占位符，`url` 直接扔掉，
// 于是 QQ 收图永远只有一个 `[User sent an image]`。这里钉住三件事：
//   ① 解析层把图片地址带出来（纯同步、不联网）
//   ② 地址规整不放行内网 / 非 http（外部事件不能当可信输入）
//   ③ mediaType 声明不可信时按魔数嗅探

import assert from 'node:assert/strict'
import {
  collectQQImageRefs,
  parseQQWsMessage,
  QQ_MAX_INBOUND_IMAGES
} from '../../src/main/channels/providers/qq/parse-ws-message'
import {
  normalizeQQMediaUrl,
  resolveImageMediaType,
  sniffImageMediaType
} from '../../src/main/channels/providers/qq/download-media'

function c2cEvent(attachments: unknown): string {
  return JSON.stringify({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'msg-1',
      content: '',
      timestamp: 1_760_000_000_000,
      author: { user_openid: 'user-1' },
      attachments
    }
  })
}

// ── 1. 图片附件：地址被带出来，占位符照旧 ──

{
  const parsed = parseQQWsMessage(
    c2cEvent([{ url: 'https://multimedia.nt.qq.com/download?fileid=abc', content_type: 'image/png' }])
  )

  assert.ok(parsed, '带图片的消息不能被当成空消息丢掉')
  assert.equal(parsed.content, '[User sent an image]')
  assert.equal(parsed.mediaRefs?.length, 1)
  assert.equal(parsed.mediaRefs?.[0].url, 'https://multimedia.nt.qq.com/download?fileid=abc')
  assert.equal(parsed.mediaRefs?.[0].contentType, 'image/png')
  assert.equal(parsed.images, undefined, '解析层不下载，images 必须留空')
}

// ── 2. 没有 url：不产出 mediaRefs（历史行为保持） ──

{
  const parsed = parseQQWsMessage(c2cEvent([{ content_type: 'image/png' }]))
  assert.ok(parsed)
  assert.equal(parsed.content, '[User sent an image]')
  assert.equal(parsed.mediaRefs, undefined)
}

// ── 3. 非图片附件不进 mediaRefs，占位符文案不变 ──

{
  const video = parseQQWsMessage(c2cEvent([{ url: 'https://x.qq.com/a.mp4', content_type: 'video/mp4' }]))
  assert.ok(video)
  assert.equal(video.content, '[User sent a video]')
  assert.equal(video.mediaRefs, undefined, '音频 / 视频 / 文件不在本条范围')

  const audio = parseQQWsMessage(c2cEvent([{ url: 'https://x.qq.com/a.amr', content_type: 'audio/amr' }]))
  assert.ok(audio)
  assert.equal(audio.mediaRefs, undefined)

  const file = parseQQWsMessage(c2cEvent([{ url: 'https://x.qq.com/a.pdf', content_type: 'application/pdf' }]))
  assert.ok(file)
  assert.equal(file.mediaRefs, undefined)
}

// ── 4. content_type 缺失：按文件名兜底，判不出就不猜 ──

{
  const byName = collectQQImageRefs([{ url: 'https://x.qq.com/a', filename: 'a.JPG' }])
  assert.equal(byName?.length, 1, '扩展名能判定就收')

  const unknown = collectQQImageRefs([{ url: 'https://x.qq.com/a.bin' }])
  assert.equal(unknown, undefined, '既无类型又无非图片扩展名 ⇒ 不猜')
}

// ── 5. 多附件：最多前 N 张，顺序不乱 ──

{
  const many = Array.from({ length: 8 }, (_, i) => ({
    url: `https://x.qq.com/${i}.png`,
    content_type: 'image/png'
  }))
  const refs = collectQQImageRefs(many)
  assert.equal(refs?.length, QQ_MAX_INBOUND_IMAGES)
  assert.equal(refs?.[0].url, 'https://x.qq.com/0.png')
  assert.equal(refs?.[QQ_MAX_INBOUND_IMAGES - 1].url, `https://x.qq.com/${QQ_MAX_INBOUND_IMAGES - 1}.png`)
}

// ── 6. 混排附件：只挑图片，跳到下一张继续凑数 ──

{
  const mixed = collectQQImageRefs([
    { url: 'https://x.qq.com/a.mp4', content_type: 'video/mp4' },
    { url: 'https://x.qq.com/b.png', content_type: 'image/png' },
    { url: 'https://x.qq.com/c.jpg', content_type: 'image/jpeg' }
  ])
  assert.equal(mixed?.length, 2)
  assert.equal(mixed?.[0].url, 'https://x.qq.com/b.png')
  assert.equal(mixed?.[1].url, 'https://x.qq.com/c.jpg')
}

// ── 7. 地址规整：协议相对补 https，非 http 与内网一律拒 ──

{
  assert.equal(
    normalizeQQMediaUrl('//multimedia.nt.qq.com/download?fileid=abc'),
    'https://multimedia.nt.qq.com/download?fileid=abc'
  )
  assert.equal(normalizeQQMediaUrl('  https://x.qq.com/a.png  '), 'https://x.qq.com/a.png')
  assert.equal(normalizeQQMediaUrl('http://x.qq.com/a.png'), 'http://x.qq.com/a.png')

  assert.equal(normalizeQQMediaUrl(''), null)
  assert.equal(normalizeQQMediaUrl(undefined), null)
  assert.equal(normalizeQQMediaUrl('file:///C:/secret.png'), null)
  assert.equal(normalizeQQMediaUrl('not a url'), null)
  assert.equal(normalizeQQMediaUrl('http://127.0.0.1:8080/a.png'), null)
  assert.equal(normalizeQQMediaUrl('http://localhost/a.png'), null)
  assert.equal(normalizeQQMediaUrl('http://192.168.1.10/a.png'), null)
  assert.equal(normalizeQQMediaUrl('http://172.20.0.1/a.png'), null)
  assert.equal(normalizeQQMediaUrl('http://169.254.169.254/latest/meta-data'), null)
  assert.equal(normalizeQQMediaUrl('http://10.0.0.5/a.png'), null)
  assert.equal(normalizeQQMediaUrl('http://172.32.0.1/a.png'), 'http://172.32.0.1/a.png')
}

// ── 8. mediaType：声明的能用就用，用不了嗅探，再不行兜底 png ──

{
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
  const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])
  const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])

  assert.equal(sniffImageMediaType(png), 'image/png')
  assert.equal(sniffImageMediaType(jpeg), 'image/jpeg')
  assert.equal(sniffImageMediaType(gif), 'image/gif')
  assert.equal(sniffImageMediaType(webp), 'image/webp')
  assert.equal(sniffImageMediaType(Buffer.from([1, 2, 3])), null, '短数据不嗅探')

  assert.equal(resolveImageMediaType('image/jpeg', png), 'image/jpeg', '声明可信就用声明')
  assert.equal(resolveImageMediaType('application/octet-stream', png), 'image/png', '声明不可信转嗅探')
  assert.equal(resolveImageMediaType(undefined, jpeg), 'image/jpeg')
  assert.equal(resolveImageMediaType(undefined, Buffer.from([1, 2, 3])), 'image/png', '全都没给兜底 png')
}

// ── 9. 纯图片消息（无文本）不能被 buildIncomingMessage 判空 ──

{
  const onlyImage = parseQQWsMessage(
    c2cEvent([{ url: 'https://x.qq.com/a.png', content_type: 'image/png' }])
  )
  assert.ok(onlyImage, '只有附件的消息必须放行')
}

// ── 10. 解析层不改动入参以外的东西：文本消息照旧 ──

{
  const text = parseQQWsMessage(
    JSON.stringify({
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: {
        id: 'msg-2',
        content: '你好',
        timestamp: 1_760_000_000_000,
        author: { user_openid: 'user-1' }
      }
    })
  )
  assert.ok(text)
  assert.equal(text.content, '你好')
  assert.equal(text.mediaRefs, undefined)
  assert.equal(text.images, undefined)
}

console.log('qq attachments regression passed')
