# Plan: iter-v2-34 第四批 · S-139 消息操作按钮组死链清理 + 「编辑」改为回填输入框

> 2026-09-22 建，同日 16:07 按老大两次纠口径**重写**。**需求口径权威源 = `requirements/S-139.md`**，本文件只排步骤与文件面。
> 分支：承接 S-135 ~ S-138 的口径，**直接在 `dev/v2-iter-34` 上实施**，编号顺延，一并收尾（老大 2026-09-22 拍定「不走 iter-35」）。

## 目标

三件事：

1. **删** —— 重新生成 / 删除消息 / 继续执行三条死链（含 `showContinue` 整条判定位）。
2. **删** —— `UserMessage` 那一整套内联编辑态（就地 textarea 编辑器）。
3. **接** —— 「编辑」按钮 → 把消息内容**回填到底部输入框**（追加语义，不删原消息）。

## 已定口径（2026-09-22 收口）

| # | 项 | 定案 | 依据 |
|:--:|---|---|---|
| 1 | 重新生成 | **删** | 老大「不渲染的 删掉一下」；`onRetry` 恒 undefined |
| 2 | 删除消息 | **删** | 同上 |
| 3 | 继续执行 | **删** | 同上 |
| 4 | `showContinue` 判定位 | **删** | 老大 15:54「那这个没必要存在了」 |
| 5 | 内联编辑态 | **删** | 老大 16:07「这套整个删掉」 |
| 6 | 编辑语义 | **回填输入框**，追加，**原消息不动** | 老大 16:02 + 16:07 |
| 7 | 回填通道 | `useUIStore.setPendingInsertText` / `setPendingInsertImages` | 现成机制，5 个既有调用方 |
| 8 | 落点 | 直接在 `dev/v2-iter-34`，不新开 iter-35 | 老大同日拍定 |
| 9 | 提交 | **独立一刀**，不并入收尾刀 | 删除面大 + 含新功能 |

**已消掉的上版待定项**（不再需要老板）：

- ~~「`UserMessage` 的删除按钮一起接？」~~ ⇒ **删**（老大定案 2）。
- ~~「三个孤儿 store 方法删不删？」~~ ⇒ 仍按原判**删**（零调用点实测：`removeLastAssistantMessage` / `removeLastUserMessage` / `replaceSessionMessages`，`session-slice.ts:98-101`）。
- ~~「`action.delete` 是否别处仍在用？」~~ ⇒ 实施时 grep 核，仍在用则保留该键。

## 为什么不能只删 UI

`@electron-toolkit/tsconfig`（`tsconfig.json:15-16`）开了 **`noUnusedLocals` + `noUnusedParameters`** ⇒ 删掉 JSX 分支后，解构出来的 prop 立刻变「未使用」⇒ `npm run typecheck` 直接失败。**要么全链删到源头，要么别动。**

## 步骤清单

### 第 0 步：前置勘测（不动代码）

- [ ] **步骤 1** —— 三项待核（**全部只读**）
  - `onEdit` 的**最终签名**：现签名 `(messageId, draft: EditableUserMessageDraft)`。回填只需 `text` + `images`，`command` 已含在 text 里 ⇒ 评估是**沿用现签名**（改动最小）还是**收窄成 `(messageId, text, images)`**。
  - `serializeUserSkillDirective` 的格式已确认 = `[Skill: ${name}]\n${body}`（`user-message-helpers.tsx`）⇒ 回填技能消息时按此拼。
  - `action.delete`（`common` 命名空间）在删 `UserMessage` / `action-bar` 删除入口**之后**是否仍被别处引用。
  - **产出**：三项均无意外则直接进步骤 2；有意外则回报。

### 第一部分：删死链

- [ ] **步骤 2** —— 删 UI 出口（`AssistantMessage` 一层）
  - `components/chat/AssistantMessage/action-bar.tsx`：删 `handleDeleteAndRegenerate`（`:143-146`）、显示条件里的三项（`:179 / :181 / :182`）、`:184` 的 `opacity` 三元（`onContinue` 恒 falsy ⇒ 退化为常量 `opacity-0 group-hover/msg:opacity-100`）、继续按钮（`:201-222`）、重试按钮（`:223-231`）、下拉「继续执行 / 重新生成参考 / 删除并重新生成 / 删除」（`:273-303`）、`ActionBarProps` 的五个字段（`:36-40`）与对应解构（`:58-62`）。
  - **连带 imports**：`RotateCcw` / `Play` / `Trash2`（`:7-8`）、`DropdownMenuSeparator`（`:19`）、`Tooltip*`（`:21`，若删完无其它用点）—— **逐个核实后再删**。
  - `components/chat/AssistantMessage/types.ts`：删 `showRetry` / `showContinue` / `onRetry` / `onContinue` / `onDelete`（`:26-31` 内，**保留 `isLastAssistantMessage`** —— 另有 `requestRetryState` 用途）。
  - `components/chat/AssistantMessage/index.tsx`：删解构（`:49-53`）与传参（`:459-463`）。
  - **验证**：`npm run typecheck` EXIT=0。

- [ ] **步骤 3** —— 删中转层透传
  - `components/chat/MessageItem.tsx`：删 props（`:43` `showContinue`、`:45-48` 三个回调）、解构（`:144-149`）、传参（`:195` `onDelete`、`:213` `showContinue`、`:215-217`）、`arePropsEqual` 四条（`:339 / :341 / :342 / :344`）。**`onEditUserMessage` 保留**（步骤 6 要用）。
  - `components/chat/MessageList/MessageRow.tsx`：删透传（`:19` / `:32-33` / `:64` / `:67-70`）。
  - `components/chat/MessageList.tsx`：删解构（`:21-22` / `:24`）与传参（`:111` / `:125-126` / `:128`）—— **`onEditUserMessage` 保留**。
  - `components/chat/MessageList/utils.ts`：`MessageListProps`（`:15-23`）删 `onRetry` / `onContinue` / `onDeleteMessage`；`MessageRowProps`（`:184-202` 区段）删对应字段；`areMessageRowPropsEqual`（`:616-618`）删对应三条。
  - `components/chat/MessageList/props-equal.ts`：删 `:7-9`。
  - `components/chat/MessageList/VirtualListContent.tsx`：删 props（`:61-64`）/ 解构（`:102-105`）/ 传参（`:246` / `:261-264`）；`:222` 的 `showContinue` 局部变量一并清（**保留 `isLastUserMessage` / `isLastAssistantMessage`**）。
  - `components/chat/MessageList/ExportView.tsx`：删 props（`:24-28` 中的三个）/ 解构 / 传参。
  - `components/chat/MessageList/StaticMessageTranscript.tsx`：删 `:115` 的 `showContinue={false}`。
  - **验证**：`npm run typecheck` EXIT=0。

- [ ] **步骤 4** —— 删 `UserMessage` 的内联编辑态
  - **state**：`editing`（`:95`）、`editText`（`:97`）、`editSkillName`（`:98`）、`editImages`（`:99-101`）、`textareaRef`（`:105`）、`fileInputRef`（`:106`）。
  - **副作用**：聚焦 effect（`:108-113`）、`loadSkills` effect（`:115-119`）。
  - **逻辑**：`nextDraft` / `canSave`（`:121-129`）、`handleSave`（`:138-142`）、`handleCancel`（`:144-149`）、`handleKeyDown`（`:203-211`）、`addImages` / `removeImage`（`:213-223`）。
  - **UI**：`:251-330` 整块（命令提示条 + `UserSkillEditControl` + `textarea` + 图片编辑条 + 隐藏 file input + 「保存并重新发送 / 取消」按钮）。
  - **收敛**：`:243` / `:419` / `:424` / `:429` 的 `!editing &&`；`:331` 的 `collapsed ? … : …` 三元（去掉 `editing ?` 那一支）。
  - **连带清理**（删完逐个核实是否仍有别处引用）：
    - imports：`ACCEPTED_IMAGE_TYPES`（`:20`）、`fileToImageAttachment`（`:23`）、`hasEditableDraftContent`（`:24`）、`EditableUserMessageDraft`（`:25`）、`ImageAttachment`（`:26`）、`Button`（`:4`）、`ImagePlus` / `X`（`:8`）、`UserSkillEditControl`（`:46`）、`UserSkillEditControl` 之外的 `useSkillsStore`（`:29` + `:91-93`，仅供编辑态技能选择器）
    - **保留**：`cloneImageAttachments`（`:21`，回填图片要用）、`Pencil`（`:8`）、`Check` / `Copy`（别处仍用）、`selectFileTextToPlainText`（`:71`）、`expandPastedBlocks`（`:70`）
  - **`UserSkillEditControl`**（`components/chat/user-message-views.tsx:124` 定义）：全仓唯一使用点就是 `UserMessage.tsx:258` ⇒ 删完变死组件，**一并删定义**（连带其专属 props / imports）。
  - **改 `handleStartEdit`（`:131-136`）**：见步骤 6。
  - **验证**：`npm run typecheck` EXIT=0。

- [ ] **步骤 5** —— 删 `showContinue` 数据链（三层全清）
  - `components/chat/MessageList/useMessageListData.ts`：删 `continueAssistantMessageId` 的 useMemo（`:246-250`）、返回对象里的它（`:461`）、`tailToolExecutionState` 的导出（`:467`，**仅在确认无其它消费者后**）、`hasCompleteTailToolExecutionResults` import（`:23`）。
  - `components/chat/MessageList/utils.ts`：删 `hasCompleteTailToolExecutionResults`（`:117-121`）、`MessageRowProps` 的 `showContinue`、`areMessageRowPropsEqual` 的 `:603`。
  - `components/chat/transcript-utils.ts`：删 `ChatRenderableMessageMeta`（`:15-17`）、`buildChatRenderableMessageMetaFromAnalysis`（`:292-301`）、`buildChatRenderableMessageMeta`（`:364-374`）、`getTailToolExecutionState`（`:348-352`，**仅在确认零调用后**）。
  - `components/chat/renderable-chat-items.ts`：删 `showContinue` 字段（`:33`）与六处硬编码（`:46 / :62 / :221 / :333 / :346 / :364`）。
  - `transcript-utils.ts:260` 的 `tailToolExecutionState` 是否保留，取决于 `TranscriptStaticAnalysis` 该字段**是否还有别的消费者** —— **先 grep 核实**。
  - **测试**：同步改 `tests/renderable-chat-items/program.ts` 的 17 条断言（删 `showContinue` 相关）。
  - **验证**：`npm run typecheck` EXIT=0；`npm test -- --filter renderable-chat-items` 过。

- [ ] **步骤 6** —— 删 store 孤儿方法 + i18n 键
  - `stores/chat-store/session-slice.ts`：删 `removeLastAssistantMessage` / `removeLastUserMessage` / `replaceSessionMessages`（声明 `:98-102` + 实现 `:726-765` 区段）—— **`truncateMessagesFrom` 本需求不用，但**它仍是「零调用」的既有实现，**本次不动它**（避免扩大范围；在报告里记档）。
  - i18n：`locales/{zh,en}/chat.json` 删 `assistantMessage.regenerateReference` / `continueToolExecution` / `continueToolExecutionHint` / `messageActions.deleteAndRegenerate` / `userMessage.saveAndResend`（内联编辑态专属）；`action.delete` 按步骤 1 的核实结果处置。**zh / en 两侧必须同步删，否则 `test:i18n-coverage` 会挂。**
  - **验证**：`npm run typecheck` + `npm test -- --filter i18n` 过。

### 第二部分：接「编辑 → 回填输入框」

- [ ] **步骤 7** —— 改写 `handleStartEdit` + 上层接线
  - **`UserMessage.tsx` 侧**（替换 `:131-136`）—— 只准备数据、调 `onEdit`，**不碰 store**：
    ```ts
    const handleStartEdit = (): void => {
      if (!onEdit) return
      // 回填文本要带回技能 / 命令前缀，否则重发不等价
      const body = selectFileTextToPlainText(expandedText)
      const text = command
        ? `/${command.name}${body ? ` ${body}` : ''}`
        : skillDirective
          ? serializeUserSkillDirective(skillDirective.name, body)
          : body
      onEdit(messageId, { text, images: cloneImageAttachments(allImages), command })
    }
    ```
    - 注意 `serializeUserSkillDirective` 在 `:45` 已被 import（若删内联态时被清掉，这里要**保留**）。
    - 按钮/下拉的 `onEdit &&` 判断**保留**（导出视图与静态渲染必须无此按钮 —— 见下）。
  - **上层接线 ①：`components/layout/SessionConversationPane.tsx`**（主界面）
    - 新增 handler：调 `useUIStore.getState().setPendingInsertText(draft.text.trim() ? draft.text : null)` + `setPendingInsertImages(draft.images.length ? draft.images : null)` —— **与 `use-queued-messages.ts:88-90` 同一套写法**。
    - `<MessageList … onEditUserMessage={handleEditUserMessage} />`（`:161`）。
    - **不需要** `setTimeout` / 焦点处理：`InputArea` 的 effect 会自己 `replaceSelectionWithText`。
  - **上层接线 ②：`components/settings/floating-chat-window.tsx`**（技能浮窗，`:107` 的 `<MessageList>` 同样要接）。
  - **不接线**：`ChatPage.tsx:9`（死文件，见第六节记档）。若后续删除该文件，本条自动消失。
  - **语义提醒**：`pendingInsertText` 是**追加**（插到光标处），会保留用户已敲的内容 —— **这是老大定案的 A 方案**。
  - **验证**：`npm run typecheck` EXIT=0。

- [ ] **步骤 8** —— 真机验证 + commit
  - **编辑回填**：发一条消息 → 点该消息的**编辑按钮** ⇒ 内容出现在**底部输入框**，原消息**仍在 transcript 里**（不删）。
  - **追加语义**：先在输入框敲几个字 → 再点另一条消息的编辑 ⇒ 两段内容**并存**，没有覆盖。
  - **技能 / 命令消息**：对带技能的消息点编辑 ⇒ 回填文本是 `[Skill: name]\n正文` 形态，**重发后仍被识别为技能**。
  - **图片消息**：带图消息点编辑 ⇒ 图片回到输入框附件条。
  - **草稿**：回填后刷新 / 切走再切回 ⇒ 内容还在。
  - **导出 / 静态视图无编辑按钮**：导出会话、静态 transcript 里**不应**出现编辑按钮（`onEdit` 未传）。
  - **无内联编辑**：点编辑**不再**就地变 textarea。
  - **删除按钮不存在**；`action-bar` 的重新生成 / 继续执行也不再出现。
  - **回归**：分叉（S-136）正常；`MessageList` 导出、浮动聊天窗渲染正常。
  - **验证**：`npm run typecheck` + `npm test` 全量 ⇒ **commit（S-139 独立一刀）**

## 涉及文件

| 文件 | 动作 | 备注 |
|---|---|---|
| `components/chat/AssistantMessage/action-bar.tsx` | 删 | 四个操作块 + 5 props + imports |
| `components/chat/AssistantMessage/types.ts` | 删 | 5 个字段（保留 `isLastAssistantMessage`） |
| `components/chat/AssistantMessage/index.tsx` | 删 | 解构 + 传参 |
| `components/chat/MessageItem.tsx` | 删 | props / 传参 / 比较（**保留 `onEditUserMessage`**） |
| `components/chat/MessageList/MessageRow.tsx` | 删 | 透传 |
| `components/chat/MessageList.tsx` | 删 | **保留 `onEditUserMessage`** |
| `components/chat/MessageList/utils.ts` | 删 | `MessageListProps` / `MessageRowProps` / 比较 |
| `components/chat/MessageList/props-equal.ts` | 删 | 3 条比较 |
| `components/chat/MessageList/VirtualListContent.tsx` | 删 | 透传 |
| `components/chat/MessageList/ExportView.tsx` | 删 | 透传（**不加回填**） |
| `components/chat/MessageList/StaticMessageTranscript.tsx` | 删 | 一行 |
| `components/chat/MessageList/useMessageListData.ts` | 删 | `continueAssistantMessageId` + 导出 |
| `components/chat/transcript-utils.ts` | 删 | `ChatRenderableMessageMeta` + 两个函数（`getTailToolExecutionState` 待核） |
| `components/chat/renderable-chat-items.ts` | 删 | `showContinue` 字段 + 6 处硬编码 |
| `components/chat/UserMessage.tsx` | **大改** | 删内联编辑态 + 改写 `handleStartEdit` |
| `components/chat/user-message-views.tsx` | 删 | `UserSkillEditControl` 死组件 |
| `stores/chat-store/session-slice.ts` | 删 | 3 个孤儿方法 |
| `locales/{zh,en}/chat.json` | 删 | 5 个键（`action.delete` 待核） |
| `components/layout/SessionConversationPane.tsx` | **改** | 接 `onEditUserMessage` |
| `components/settings/floating-chat-window.tsx` | **改** | 同上 |
| `tests/renderable-chat-items/program.ts` | 改 | 17 条断言同步 |

## 参考源码

| 项目 | 路径 | 参考什么 |
|---|---|---|
| **本地（首选对标）** | `components/chat/InputArea/use-queued-messages.ts:78-93` | **队列「取回」= 同一个交互**，写法和语义照抄 |
| 本地 | `components/chat/InputArea/use-input-area-effects.ts:156-176` | 通道消费端，看清追加语义与清空时机 |
| 本地 | `components/chat/ToolCallCard/output-blocks/text-output.tsx:183-188` | 组件内直调 `useUIStore` 的先例（本需求**不用**这条路，但可对照） |
| OpenCowork | `D:\koda\OpenCowork\src\renderer\src\stores\chat-store.ts` | 「编辑并重发」的原始实现。**注意：本需求已弃用该语义**，仅作死链溯源 |

## 风险与回退

| 风险 | 处置 |
|---|---|
| 删 UI 后 prop 变「未使用」⇒ typecheck 挂 | 预期内。步骤 2~6 **按层推进、逐层 typecheck** |
| 误删仍有消费者的符号 | 高危项（`tailToolExecutionState` / `getTailToolExecutionState` / `action.delete` / `cloneImageAttachments` / `Pencil` / `selectFileTextToPlainText`）**均已标「先核实」** |
| **`ExportView` / `StaticMessageTranscript` 冒出编辑按钮** | 靠 `onEdit &&` 判断 + 上层不传 `onEdit` 保证；真机验证含「导出视图无按钮」 |
| 回填丢技能 / 命令前缀 ⇒ 重发不等价 | 回填文本按 `:72-76` 的 `copyText` 规则拼；真机验证含「技能消息重发后仍识别」 |
| 覆盖用户已敲内容 | **不会** —— 通道是追加语义（老大定案 A） |
| **`pendingInsertText` 全局单例，主窗 + 浮动窗双 `InputArea`** | **既有问题**，队列取回同病；真机验证时**只开一个窗口**测回填 |
| 大文件 `UserMessage.tsx` 改错连带 | 步骤 4 列出**逐项清单**（state / 副作用 / 逻辑 / UI / 收敛 / imports）；imports 一条条核实 |
| 改动面跨 20 个文件，审查易漏 | 独立成刀 + 分层 typecheck；报告按「删死链 / 删编辑态 / 接回填」三栏列清单 |

## 提交节奏

- 步骤 8 ⇒ **commit：S-139 独立一刀**
- **迭代内一律不 push**（收尾时才推）

## 门禁基线

- 起点：`npm run typecheck` EXIT=0；`npm test` **48/48**（TS 36 + C# 12）。
- 每层删改后：`npm run typecheck`；整刀提交前：`npm test` 全量。
- `npm test` 参数：`--ts-only` / `--csharp-only` / `--no-build` / `--filter <子串>`（`scripts/run-tests.mjs:7-10` 实测）。
- **不碰 C# 运行时** ⇒ 无需停机编译。

## 记档（本需求不处理）

- `ChatPage.tsx` 整个文件无人 import（死文件）。
- `subscribeInputDraftCache`（`input-drafts.ts:95-103`）零订阅者。
- `truncateMessagesFrom`（`session-slice.ts:748-755`）零调用点，且**只改内存不落库**。
