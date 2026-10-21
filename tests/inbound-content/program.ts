// S-211 回归：渠道入站图片拼进 sendMessage 的 content。
//
// 断点原先在渲染端边界 —— 微信 / 飞书已经把图片下载成 base64 放在 `images` 上，
// 这里却只把占位符字符串交出去。纯函数直接钉行为，不启动 Electron。

import assert from 'node:assert/strict'
import { buildInboundUserContent } from '../../src/renderer/src/lib/channel/inbound-content'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const JPG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='

// ── 1. 没有图片：行为与改动前逐字节一致 ──

assert.equal(buildInboundUserContent('[User sent an image]'), '[User sent an image]', '无图必须原样返回字符串')
assert.equal(buildInboundUserContent('早上好'), '早上好')
assert.equal(buildInboundUserContent('hi', []), 'hi', '空数组等同无图')
assert.equal(buildInboundUserContent('hi', null), 'hi')
assert.equal(buildInboundUserContent('hi', undefined), 'hi')

// 微信下载失败会改写 content（`…but download failed`），此时 images 为空 ⇒ 保持字符串，
// 模型至少能看到失败原因，不能因为"有图字段"就把文案吞掉。
assert.equal(
  buildInboundUserContent('[User sent an image but download failed: 403]', []),
  '[User sent an image but download failed: 403]'
)

// 空 base64 是脏数据，按无图处理，不能拼出空图片块把请求打坏
assert.equal(buildInboundUserContent('hi', [{ base64: '' }]), 'hi')
assert.equal(buildInboundUserContent('hi', [{ base64: '', mediaType: 'image/png' }]), 'hi')

// ── 2. 一张图：文本块在前、图片块在后 ──

const one = buildInboundUserContent('[User sent an image]', [{ base64: PNG, mediaType: 'image/png' }])
assert.ok(Array.isArray(one), '有图必须返回块数组')
assert.equal(one.length, 2)
assert.deepEqual(one[0], { type: 'text', text: '[User sent an image]' })
assert.deepEqual(one[1], {
  type: 'image',
  source: { type: 'base64', mediaType: 'image/png', data: PNG }
})

// ── 3. mediaType 缺失 / 空白：兜底 image/png ──

const noType = buildInboundUserContent('看图', [{ base64: JPG }])
assert.ok(Array.isArray(noType))
assert.equal((noType[1] as { source: { mediaType?: string } }).source.mediaType, 'image/png')

const blankType = buildInboundUserContent('看图', [{ base64: JPG, mediaType: '  ' }])
assert.ok(Array.isArray(blankType))
assert.equal((blankType[1] as { source: { mediaType?: string } }).source.mediaType, 'image/png')

// ── 4. 多张图：按到达顺序，一张不落 ──

const many = buildInboundUserContent('两张', [
  { base64: PNG, mediaType: 'image/png' },
  { base64: JPG, mediaType: 'image/jpeg' }
])
assert.ok(Array.isArray(many))
assert.equal(many.length, 3)
assert.equal((many[1] as { source: { data?: string } }).source.data, PNG)
assert.equal((many[2] as { source: { data?: string } }).source.data, JPG)
assert.equal((many[2] as { source: { mediaType?: string } }).source.mediaType, 'image/jpeg')

// ── 5. 纯图片消息（text 为空 / 全空白）：不补空 text 块 ──

const noText = buildInboundUserContent('', [{ base64: PNG, mediaType: 'image/png' }])
assert.ok(Array.isArray(noText))
assert.equal(noText.length, 1, '空文本不补空 block')
assert.equal(noText[0].type, 'image')

const blankText = buildInboundUserContent('   ', [{ base64: PNG }])
assert.ok(Array.isArray(blankText))
assert.equal(blankText.length, 1)

// ── 6. 不改动入参 ──

const images = [{ base64: PNG, mediaType: 'image/png' }]
buildInboundUserContent('hi', images)
assert.equal(images.length, 1, '入参数组不能被就地改写')

console.log('inbound content regression passed')
