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

## 下一步建议

从"字母/中文 vs 数字"的差异反推 `selectionRef` 何时被记成区间——数字不产生词边界变化，字母和中文会，方向可能是 Blink 的按词撤销分组在还原时给出区间选区，被 `syncSelection` 原样存下后由上述两个出口回写。修的位置应在**粘贴/撤销边界的选区处理**，不要去动共享解析器。
