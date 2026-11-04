/*
 * S-291：渠道回执的兜底只在**本次运行区间**里找。
 *
 * 现场：定时任务 15 轮掐断 ⇒ 本次零文本 ⇒ `sentReplyCount === 0` ⇒ 兜底倒序扫
 * 整条会话历史 ⇒ 捞到昨晚那条 assistant 消息推给微信。用户看到「昨晚收到一条、
 * 早上又收到一条，两个内容重复」。
 *
 * 判据全在纯函数 `pickRunReplyText` 上 —— hook 依赖 electron IPC，node 下起不来。
 */

import assert from 'node:assert/strict'
import { pickRunReplyText, type RunReplyMessage } from '../../src/renderer/src/lib/channel/run-reply-window'

let checks = 0

function check(condition: boolean, description: string): void {
  checks += 1
  assert.ok(condition, description)
}

const user = (text: string): RunReplyMessage => ({ role: 'user', text })
const assistant = (text: string, extra: Partial<RunReplyMessage> = {}): RunReplyMessage => ({
  role: 'assistant',
  text,
  ...extra
})

// 1. 基线之后有文本 ⇒ 取它（正常路径，行为与改动前一致）
const normal: RunReplyMessage[] = [
  user('昨天的问题'),
  assistant('昨天的回答'),
  user('今天的问题'),
  assistant('今天的回答')
]
check(pickRunReplyText(normal, 2) === '今天的回答', '基线之后有文本时必须取本次的')

// 2. 核心判据：基线之后没有 assistant 文本 ⇒ 返回空串，绝不回退到历史
const emptyRun: RunReplyMessage[] = [
  user('昨天的问题'),
  assistant('昨天的回答'),
  user('今天的问题'),
  assistant('')  // 本轮只跑了工具，没产出文本
]
check(
  pickRunReplyText(emptyRun, 2) === '',
  '本次区间无文本时必须返回空串 —— 回退到历史就是「早上又收到昨晚那条」'
)

// 3. 基线之后连 assistant 消息都没有（纯工具调用被打断）⇒ 同样是空串
const noAssistant: RunReplyMessage[] = [user('昨天的问题'), assistant('昨天的回答'), user('今天的问题')]
check(pickRunReplyText(noAssistant, 2) === '', '本次区间连 assistant 都没有时必须返回空串')

// 4. 基线 = 长度（本轮一条消息都没进来）⇒ 空串
check(pickRunReplyText(normal, normal.length) === '', '基线等于长度时必须返回空串')

// 5. 正在流式的那条不算（还没收尾，不能当最终结果）
const streaming: RunReplyMessage[] = [user('问题'), assistant('半截', { isStreaming: true })]
check(pickRunReplyText(streaming, 0) === '', '流式中的消息不能当最终结果')

// 6. 基线之后有多条 assistant ⇒ 取最后一条有文本的（中间的空消息跳过）
const multi: RunReplyMessage[] = [
  user('问题'),
  assistant(''),
  assistant('真正的回答')
]
check(pickRunReplyText(multi, 0) === '真正的回答', '必须跳过空消息取最后一条有文本的')

// 7. content 是块数组时同样能取到文本（消息落库后的形态）
const blocks: RunReplyMessage[] = [
  user('问题'),
  { role: 'assistant', content: [{ type: 'text', text: '块里的文本' }] }
]
check(pickRunReplyText(blocks, 0) === '块里的文本', '块数组 content 必须能取出文本')

// 8. 基线陈旧（超出当前长度，例如消息被清空过）⇒ 当空区间处理，返回空串。
//    刻意保守：宁可这一轮少推一条，也不把历史当本次结果 —— 后者就是「早上收到昨晚那条」。
check(
  pickRunReplyText(normal, 999) === '',
  '基线超出长度时必须当空区间（宁可不推，也不推历史）'
)

// 9. 负基线不能让循环越界
check(pickRunReplyText(normal, -5) === '今天的回答', '负基线必须夹到 0')

console.log(`run-reply-window: ${checks} checks passed`)
