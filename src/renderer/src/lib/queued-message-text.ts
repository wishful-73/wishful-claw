// 排队消息的文本变换（S-57）。
//
// 列表行只放得下一两行字，悬停提示要给全文，两者必须对同一份原文做同样的
// 标签处理，否则「摘要里有、悬停里没有」这种事会悄悄发生，所以放在一起。
// 独立成模块而不是留在 InputArea/utils：那一层会牵连聊天组件与 store，
// 这里保持纯函数，node 侧可以直接测。

import { expandPastedBlocks, selectFileTextToPlainText } from './select-file-tags'

/** 行内摘要：压平空白、截到 72 字符。 */
export function summarizeQueuedMessage(text: string): string {
  const normalized = selectFileTextToPlainText(text).replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > 72 ? `${normalized.slice(0, 72)}…` : normalized
}

/**
 * 悬停全文：与摘要同源，但**不截断**。
 *
 * 折叠的粘贴块要展开回原文 —— 标签里只有 chip 标题，不展开就等于用户看不到
 * 自己实际粘贴的内容。`<select-file>` 一类标签去掉标签本身、保留文字，
 * 只做首尾空白修剪。
 */
export function queuedMessageFullText(text: string): string {
  return selectFileTextToPlainText(expandPastedBlocks(text)).trim()
}
