import assert from 'node:assert/strict'
import { isChannelCancelCommand } from '../../src/main/channels/channel-cancel-commands'

for (const command of [
  '取消',
  '取消执行',
  '停止',
  '停止执行',
  '终止',
  '终止执行',
  '中断',
  '中断执行',
  '/cancel',
  '/canel',
  '/stop',
  '/interrupt',
  '@WishfulClaw 取消执行',
  '<@bot> /cancel'
]) {
  assert.equal(isChannelCancelCommand(command), true, `${command} should cancel`)
}

for (const message of [
  '',
  '请取消这个文件的上传',
  '停止后继续分析',
  '取消执行后告诉我结果',
  '/cancel now',
  '这张图片需要中断处理'
]) {
  assert.equal(isChannelCancelCommand(message), false, `${message} should stay a normal message`)
}

console.log('channel cancel command regression passed')
