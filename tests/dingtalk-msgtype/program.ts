// S-213 回归：钉钉入站消息按 msgtype 分派。
//
// 原先只解 `payload.text.content`，图片 / 文件 / 富文本消息解析出空串就被
// `if (!content) return` 静默丢掉。这里钉住「任何已知 / 未知类型都必须产出正文」，
// 以及「结构化 JSON 不许原样甩给模型」。

import assert from 'node:assert/strict'
import { resolveDingTalkIncomingContent } from '../../src/main/channels/providers/dingtalk/parse-message'

// ── 1. 纯文本：行为与改动前一致 ──

{
  const plain = resolveDingTalkIncomingContent({ msgtype: 'text', text: { content: '早上好' } })
  assert.deepEqual(plain, { content: '早上好', msgType: 'text' })

  const noType = resolveDingTalkIncomingContent({ text: { content: '没标类型' } })
  assert.deepEqual(noType, { content: '没标类型', msgType: 'text' }, '没 msgtype 按 text 处理')
}

// ── 2. 老版把结构化载荷塞进 text.content：能认出类型就转占位符 ──

{
  const nested = resolveDingTalkIncomingContent({ text: { content: '{"content":"嵌套文本"}' } })
  assert.deepEqual(nested, { content: '嵌套文本', msgType: 'text' })

  const picture = resolveDingTalkIncomingContent({
    msgtype: 'text',
    text: { content: '{"downloadCode":"abc","pictureDownloadCode":"def"}' }
  })
  assert.deepEqual(picture, { content: '[User sent an image]', msgType: 'picture' })

  const file = resolveDingTalkIncomingContent({
    msgtype: 'text',
    text: { content: '{"downloadCode":"abc","fileName":"季度报表.pdf"}' }
  })
  assert.deepEqual(file, { content: '[File: 季度报表.pdf]', msgType: 'file' }, 'fileName 优先于 downloadCode')

  const unknownJson = resolveDingTalkIncomingContent({ text: { content: '{"foo":"bar"}' } })
  assert.equal(unknownJson?.content, '[User sent an attachment]', '认不出的 JSON 不能原样当正文')
  assert.notEqual(unknownJson?.content, '{"foo":"bar"}')
}

// ── 3. 真空白才丢；非文本消息一条都不许消失 ──

{
  assert.equal(resolveDingTalkIncomingContent({ msgtype: 'text', text: { content: '' } }), null)
  assert.equal(resolveDingTalkIncomingContent({ msgtype: 'text', text: { content: '   ' } }), null)
  assert.equal(resolveDingTalkIncomingContent({ msgtype: 'text' }), null)
}

// ── 4. picture / file ──

{
  assert.deepEqual(resolveDingTalkIncomingContent({ msgtype: 'picture' }), {
    content: '[User sent an image]',
    msgType: 'picture'
  })

  assert.deepEqual(
    resolveDingTalkIncomingContent({ msgtype: 'file', content: { fileName: '合同.docx' } }),
    { content: '[File: 合同.docx]', msgType: 'file' }
  )

  assert.deepEqual(resolveDingTalkIncomingContent({ msgtype: 'file' }), {
    content: '[User sent a file]',
    msgType: 'file'
  })
}

// ── 5. voice：自带识别文字就用文字，没有才占位符 ──

{
  assert.deepEqual(
    resolveDingTalkIncomingContent({ msgtype: 'voice', voice: { recognition: '明天上午开会' } }),
    { content: '明天上午开会', msgType: 'voice' }
  )

  assert.deepEqual(resolveDingTalkIncomingContent({ msgtype: 'voice' }), {
    content: '[User sent a voice message]',
    msgType: 'voice'
  })
}

// ── 6. richText：文本段拼起来，纯图给图片占位符 ──

{
  const mixed = resolveDingTalkIncomingContent({
    msgtype: 'richText',
    content: { richText: [{ text: '看这个' }, { downloadCode: 'abc' }, { text: '还有这个' }] }
  })
  assert.equal(mixed?.content, '看这个 还有这个')
  assert.equal(mixed?.msgType, 'richText')

  const imageOnly = resolveDingTalkIncomingContent({
    msgtype: 'richText',
    content: { richText: [{ downloadCode: 'abc' }] }
  })
  assert.equal(imageOnly?.content, '[User sent an image]')

  const empty = resolveDingTalkIncomingContent({ msgtype: 'richText' })
  assert.equal(empty?.content, '[User sent a rich text message]')
}

// ── 7. 未知类型：占位符，不静默丢弃（这是本条 bug 的核心） ──

{
  const unknown = resolveDingTalkIncomingContent({ msgtype: 'interactiveCard', content: {} })
  assert.ok(unknown, '未知类型不能被丢掉')
  assert.equal(unknown?.content, '[User sent an attachment]')
  assert.equal(unknown?.msgType, 'interactiveCard')
}

// ── 8. 不改动入参 ──

{
  const payload = { msgtype: 'text', text: { content: '  原样  ' } }
  const result = resolveDingTalkIncomingContent(payload)
  assert.equal(result?.content, '原样', '去掉首尾空白')
  assert.equal(payload.text.content, '  原样  ', '入参不被就地改写')
}

console.log('dingtalk msgtype regression passed')
