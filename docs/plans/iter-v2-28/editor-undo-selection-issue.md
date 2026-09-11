# 编辑器撤销后遗留多余选中态

来源：v2-iter-27 粘贴修复（Plan H）验证期间发现。老大确认**不影响操作，仅观感**，故不卡 27 收尾，挪到 iter-28 处理。

记录日期：2026-09-11

## 现象

粘贴一段文本后，在其间手动插入内容，`Ctrl+Z` 撤销的**文本结果正确**，但会遗留一段选中态。

复现样例：粘贴 `1234` → 手动改成 `12你好34` → 撤销得到 `1234`，其中 `34` 呈选中。

选中段的起点与长度，恰好等于被撤销内容原先占据的区间（`你好` 在偏移 2..4，撤销后 2..4 落在 `34` 上）。

## 影响面

仅观感，不影响数据：

- 发送读的是 DOM 快照，不是选区（`use-composer-keydown.ts:121` 回车只调 `handleSend`），选中态不会被当作"已选中待替换"
- 鼠标点击或继续输入即覆盖

## 复现条件（老大现场观察）

| 插入的字符类型 | 是否出现选中态 |
|---|---|
| 字母 | 是 |
| 中文 | 是 |
| 数字 | 否 |

这条分界是关键线索：它否证了"纯输入法组合选区"这一单一解释（字母不经输入法也复现）。

## 已排除

- **与 iter-27 的 `insertHTML` 粘贴修复无关**：同一序列改用修复前的 `insertText` 粘贴，结果一致
- **不是裸 contenteditable 的 Blink 行为**：探针实测每次撤销后均为折叠光标
- **不是共享解析器的问题**：用 esbuild 载入真实的 `parseDomToDocument` / `isSameDocument` / `renderDocument` / `getSelectionOffsets` / `setSelectionOffsets`，复刻组件整条往返（粘贴 → 打字 → 撤销，每步走一遍 sync + 布局 effect），三步全部 `rendered: false`、选区 `{2,2}` 折叠，**未复现**

即：合成事件层面复现不出来，需要真实键入/输入法时序。

## 唯二能画出非折叠选区的出口

全项目只有这两处会把选区设成区间，且都消费 `selectionRef.current`：

1. `FileAwareEditor.tsx:144` —— `focus()` 时若编辑器外没有选区
2. `FileAwareEditor.tsx:253` —— `renderDocument` 之后回写选区

`selectionRef.current` 由 `FileAwareEditor.tsx:73-80` 的 `syncSelection` 从实时 DOM 选区取得。要出现选中态，`selectionRef` 必须先被记成一个非折叠区间。

相关：组合输入落点在 `FileAwareEditor.tsx:328-353` 的 `scheduleCompositionSettle`，其中第 340 行的 `scheduleSelectionSync()` 抓的是 compositionend 后一帧的实时选区，而组合期间 Blink 的选区本就包住整段待上屏文本。

## 结论（iter-28 实施）

复现路径最终用**真实键盘事件**在裸 contenteditable 上定位到：粘贴 `1234` → 光标移到偏移 2 → 逐字敲入 `ab` → 一次 `Ctrl+Z`，`input` 事件（`inputType: historyUndo`）触发时实时选区就是 **非折叠的 `{2,4}`**，正好覆盖被撤销内容原先占据的区间；同样条件下逐字敲入 `56` 再撤销，选区是折叠的 `{2,2}`。这条分界与老大的现场观察一致，且**不涉及本项目任何代码**——是 Blink 按词分组撤销时还原「受影响区间」的行为。

因此选区有两条入口，都被 `syncSelection` 原样记进 `selectionRef`，再经 `:144` / `:253` 两个出口回画：

1. **撤销边界**：浏览器在 `historyUndo` / `historyRedo` 的 `input` 事件里就给出了非折叠选区。
2. **组合输入边界**：组合期间的实时选区是未上屏文本的下划线区间（`insertCompositionText`），同样不是用户选区。数字不经组合、也不产生词边界，两条入口都不成立，故「数字不出现」。

修复只落在**两个输入边界**上，共享解析器 `parseDomToDocument` / `renderDocument` / `isSameDocument` 一行未动：

- 新增 `file-aware-editor-undo-selection.ts`：`isHistoryInputType` + `collapseRestoredHistorySelection`，在 `handleInput` 中把撤销还原出的区间收成区间起点（＝上屏前的插入点，与数字分支下浏览器自身的落点一致）。**仅当撤销前本就是折叠光标时生效**——用户主动选中一段文字、删掉再撤销时，浏览器还原的整段选中是有用的，不清。
- `syncSelection` 在 `isComposingRef.current` 为真时只保留区间末端（上屏后光标该在的位置），不把组合下划线区间记成用户选区。DOM 选区本身不动，避免打断输入法会话。

## 验证缺口

- 探针**无法稳定复现**老大描述的完整序列（真实输入法 + 人工键入时序），裸 DOM 上同一序列在不同次运行里 `{2,4}` 与 `{2,2}` 都出现过；已证的是「撤销能在 `input` 事件里给出非折叠还原选区」这一条入口。
- `collapseRestoredHistorySelection` 的 DOM 语义（反向选区也归一到左端、外部选区不被动）已在真实浏览器中实测。
- **仍须老大真机复验 #3.3**：粘贴 `1234` → 改 `12你好34` → 撤销应无选中；并顺带确认「选中一段 → 删除 → 撤销」仍保留整段还原选中（本修复刻意不动这条）。
