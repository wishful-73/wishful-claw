// 撤销/重做边界的选区处理。与 file-aware-editor-ime.ts 同为「输入边界」补丁，
// 不改动共享解析器（parseDomToDocument / renderDocument）。

/** 该 inputType 是否由浏览器撤销/重做产生（historyUndo / historyRedo）。 */
export function isHistoryInputType(inputType: string | undefined): boolean {
  return inputType === 'historyUndo' || inputType === 'historyRedo'
}

/**
 * 浏览器撤销会把「被还原内容原先占据的区间」恢复成一段选中态（合成键盘探针实测：
 * 在数字串中间插入字母/中文必现，插入数字不出现）。这段选区不是用户选的，一旦
 * 被 syncSelection 原样记进 selectionRef，就会被 focus/重渲染两个回画出口带到后续
 * 渲染里，表现为「撤销后莫名留下一截选中」。这里在边界上把它收成插入点。
 *
 * 只收撤销前本就是折叠光标的场景：用户主动选中一段文字、删掉再撤销时，浏览器还原
 * 的整段选中是有用的，不该被清掉。
 *
 * @returns 是否真的收起了选区
 */
export function collapseRestoredHistorySelection(root: HTMLDivElement): boolean {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return false
  const range = selection.getRangeAt(0)
  if (range.collapsed) return false
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return false
  selection.collapse(range.startContainer, range.startOffset)
  return true
}
