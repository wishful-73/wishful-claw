import {
  editorDocumentToPlainText,
  type EditorDocumentNode,
  type SelectedFileItem
} from '@renderer/lib/select-file-editor'

// Windows 部分输入法在 compositionend 之后才把末字符写进 DOM，state 因此落后 DOM
// 一到两个字符。此时按 state 重建 DOM 会吃掉刚上屏的末字符，应改为采纳 DOM。
// 阈值取 2：一次上屏最多一个汉字，留一格余量给「汉字 + 尾随标点」。
const IME_TAIL_MAX_EXTRA_CHARS = 2

function hasSelectionInside(root: HTMLDivElement): boolean {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return false
  return root.contains(selection.getRangeAt(0).startContainer)
}

/**
 * 判定 DOM 是否只比 state 多出一个 IME 末字符。
 *
 * 仅在编辑器持有焦点且选区落在其内部时成立——否则「发送后清空输入框」这类
 * state 变短的程序化重置会被误判成末字符，导致输入框清不掉。
 */
export function isImeTailAheadOfState(
  root: HTMLDivElement,
  domDocument: EditorDocumentNode[],
  stateDocument: EditorDocumentNode[],
  files: SelectedFileItem[]
): boolean {
  if (root !== document.activeElement) return false
  if (!hasSelectionInside(root)) return false

  const domText = editorDocumentToPlainText(domDocument, files)
  const stateText = editorDocumentToPlainText(stateDocument, files)
  const extraChars = domText.length - stateText.length

  return (
    extraChars > 0 && extraChars <= IME_TAIL_MAX_EXTRA_CHARS && domText.startsWith(stateText)
  )
}
