# S-224 阶段三 规划验证报告

**不通过，禁止进入阶段四。**

> 审查对象：`docs/plans/iter-v3-1/plan-s224/plan.md`（阶段二产物）
> 上游依据：`docs/plans/iter-v3-1/requirements/S-224.md`
> 规范依据：`docs/dev-workflow.md:397-416`、`AGENTS.md`
> 审查方式：全部结论来自实际读文件（真实行号见下文），不采信 plan 自述。

## 结论

❌ **5 项** / ⚠️ **10 项** / ✅ 通过项见「已核对通过」

❌ 明细：
1. 步骤清单没有逐步验证检查点，且不是 `- [ ]` 可勾格式 —— 阶段四执行态无法逐步骤 Mini 验证。
2. 新 IPC 通道 `image:persist-chat` 没进 `tests/ipc-msgpack-routing` 的四种分类之一 ⇒ `npm test` 必红，直接撞验收 #10。
3. 步骤 5 落库剥离只覆盖 `meta.content` / `meta.segments`，漏 `meta.toolCalls` —— 与 S-224 §4.4、风险 2 明确要求不符，验收 #5（工具产物不含 base64）不成立。
4. 步骤 1 把「纯函数」和 `electron` 绑在同一个文件里，plan 自称「可单测」兑现不了；步骤 7 也没安排协议解析的单测。
5. 风险 9 的事实描述错误：`use-channel-auto-reply.ts` **已有** 500 行豁免头（实测 550 行），照 plan 执行会重复加头；且既有头里的行数写成 553，已过期。

---

## ❌ 必须修改（阻断）

| # | 位置 | 问题 | 依据 | 建议修法 |
|---|---|---|---|---|
| 1 | plan.md §2「步骤清单」（72-219 行） | 8 个步骤全是 `### 步骤 N` 小标题 + 正文，**没有任何一条「验证检查点」**，也不是 `- [ ]` 复选框。阶段四要靠 `[ ] → [✓]` 推进，且每步要做「TS 编译零错误 + 能跑」的 Mini 验证；现在这 8 步没有可判定的完成标准（如步骤 1 写完协议，怎么算过？） | `dev-workflow.md:382`（模板 `- [ ] 步骤1：描述 + 验证检查点`）、`:403`（检查项「每步是否有明确的验证检查点」）、`:423`（执行态按 `[ ]` 找步骤）、`:428-431`（Mini 验证） | 每步改写成 `- [ ] 步骤N：描述`，下面挂一条 `验证：`——至少包含「`npx tsc --noEmit -p tsconfig.node.json` 0 错」或「`npm run test:<x>` 全绿 / 真机现象」。例：步骤 1 验证 = `node -e "require(...)"` 解析用例 3 条 + 应用冷启动无协议报错 + `curl` 式 `<img>` 实测一张图能显示。 |
| 2 | plan.md 步骤 3（117-120 行）、步骤 7（192-213 行） | 步骤 3 新增 preload 专用方法 → 通道名以**字面量**出现在 `src/preload/index.ts`。`tests/ipc-msgpack-routing/program.ts` 会把 `misc-handlers` 里 `registerMessagePackHandler('image:persist-chat', …)` 扫成一个「只在 `<channel>:msgpack` 上注册」的通道，随后要求它满足四种分类之一（invoke 路由 / send / event / `PRELOAD_BINARY_ONLY` / `NO_CALLER`）。新通道四类都不占 ⇒ `assert(unexplained.length === 0)` 失败，`npm test` 必红 | `tests/ipc-msgpack-routing/program.ts:130-155`（扫描注册）、`:179-194`（Group 2 断言）、`:39-83`（`PRELOAD_BINARY_ONLY` 白名单）、`:196-212`（Group 3）、S-224 §7 #10 | 二选一，并写进步骤 3/7：<br>**A（推荐，与 `dialog:openFolder` 完全同型）**：把 `'image:persist-chat'` 加进 `tests/ipc-msgpack-routing/program.ts` 的 `PRELOAD_BINARY_ONLY`（`:39-83`）。<br>**B**：加进 `src/renderer/src/lib/ipc/messagepack-channel-routing.ts` 的 `MESSAGEPACK_INVOKE_CHANNELS`（`:3-430`），渲染端统一走 `ipcClient.invoke(IPC.IMAGE_PERSIST_CHAT, …)` + `channels.ts:334-336` 加常量，反而不新增 preload 方法。<br>另外步骤 7 的验证里必须显式跑 `npm run test:ipc-msgpack-routing`。 |
| 3 | plan.md 步骤 5（152-173 行） | 只改 `db-helpers.ts:131`（segments）与 `:134`（content）两行，**没有 `:130` 的 `meta.toolCalls`**。S-224 §4.4 原文是「递归走一遍 content / segments / **toolCalls**」，风险 2 的处置也写「递归覆盖 content / segments / **toolCalls**」。C# 侧 `AgentRuntimeToolCallState.Output` 是 `JsonElement`（`src/runtime/WishfulClaw.Agent/Models/ToolModels.cs:25-30`），工具结果带图时是块数组；渲染端把它原样塞进 `seg.output` / `tc.output`（`src/renderer/src/stores/chat-store/index.ts:1538`、`:1556`）。少剥一处，截图 / Read 读图的 base64 仍会进库，验收 #5 不成立 | S-224 §4.4、§6 风险 2；`db-helpers.ts:130/131/134` 三行并列，漏一行即是覆盖缺口 | `serializeMessage` 里三行统一过 `stripImagePayloads`：<br>`if (msg.toolCalls?.length) meta.toolCalls = stripImagePayloads(msg.toolCalls)`<br>`if (msg.segments?.length) meta.segments = stripImagePayloads(msg.segments)`<br>`if (msg.content) meta.content = stripImagePayloads(msg.content)`<br>并把 `tests/image-payload/program.ts` 加一条「toolCalls[].output 数组里的 image 块也能剥」的用例。 |
| 4 | plan.md 步骤 1（74-90 行）、步骤 7（192-213 行） | 新建的 `src/main/local-media-protocol.ts` 同时承担：`LOCAL_MEDIA_SCHEME` / 扩展名白名单 / `parseMediaUrlPath`（纯函数）**和** `prepareLocalMediaScheme()` / `registerLocalMediaProtocol()`（`protocol.registerSchemesAsPrivileged` / `protocol.handle` / `net.fetch`，必 import `electron`）。纯函数与 electron 绑在一个模块里 ⇒ 单测 import 它就拉进 electron 直接崩 —— 这正是 plan 步骤 2a（96 行）自己立下的判断标准。而步骤 7 的测试清单里只有 `chat-image-dir` 与 `image-payload`，**完全没有协议解析 / 白名单的单测**，所以「纯函数，可单测」是句空话，安全边界（扩展名白名单）成了唯一不可测的代码 | `dev-workflow.md:406`（分层依赖正确）、`AGENTS.md:172-183`（按职责拆分）；plan 自身步骤 2a（94-99 行）的同一原则 | 拆两个文件：<br>• `src/main/lib/local-media-url.ts`（纯）：`LOCAL_MEDIA_SCHEME` / `ALLOWED_MEDIA_EXTENSIONS` / `parseMediaUrlPath` / `isAllowedMediaPath`，只 import `node:path`；<br>• `src/main/local-media-protocol.ts`（薄绑定）：只 import electron + 上面那个纯模块，导出 `prepare*` / `register*`。<br>步骤 7 增加 `tests/local-media-url/program.ts`：合法 URL 解析、非 `oc-media` / host 非 `local` 返回 null、`..` 穿越拒绝、`.png/.jpg` 通过、`.exe/.txt` 拒绝。 |
| 5 | plan.md §5 风险 9（270 行） | 事实错误：`use-channel-auto-reply.ts` **已有**豁免头（第 1-4 行：`// 500 行豁免（2026-10-26 实测 553 行，含本头 3 行）…` + `AGENTS.md §大文件拆分 第 5 条第 2 类`），实测 550 行。plan 写「两者都没有豁免头」并让「动工前先补豁免头」——照做会在已有头上面再叠一个，或覆盖掉正当豁免说明。另外既有头里写的 553 与实测 550 不一致，本身就违反「写明豁免理由与**当前**行数」 | `AGENTS.md:178-181`（超线必须在文件头写明理由与当前行数，否则一律 ❌）；实际文件 `src/renderer/src/hooks/use-channel-auto-reply.ts:1-4` | 风险 9 改成：<br>• `use-chat-actions.ts`（1106 行，**确无**头，第 1 行即 `import`）→ 补豁免头，写明 1106 行 + 「高度内聚的 hook」+ 依据条款；<br>• `use-channel-auto-reply.ts`（550 行，**已有**头）→ 不新增，只把头部行数从 553 校正为实测值，并在本需求改完后再次校正；<br>• 两个文件的新逻辑一律外置到独立模块（`image-persist-chat.ts` / 已定的 hydrate 模块），这条本身是对的，保留。 |

---

## ⚠️ 建议修改

| # | 位置 | 问题 | 依据 | 建议修法 |
|---|---|---|---|---|
| 1 | plan.md 全篇「不改什么」/ 涉及文件表 | 漏了 S-224 点名的一项交付：`FileReadTool.cs:337-338` 的注释「DB 侧也按它把 base64 换成 `[image: <path> …]` 占位（S-145 §3.3）」在 S-224 §3.4 要求「要么兑现，要么把注释改成事实」，§5 明确「那句注释要改写成实际行为」。实测该注释确实还在（`FileReadTool.cs:337-338`），全仓 `[image:` 无实现。plan 步骤 8（文档）也没带它 | S-224 §3.4、§5；`dev-workflow.md:402`（步骤覆盖任务目标） | 步骤 8 增加一条：把 `FileReadTool.cs:336-338` 注释改成实际行为（「路径用于渲染端 hydrate 与落盘去重；DB 侧由渲染端 `serializeMessage` 剥离 base64，只留 filePath」）。涉及文件表补一行。 |
| 2 | plan.md §1.1 表 17 行、步骤 4 150 行 | 行号偏差：`buildInboundUserContent(content, task.images)` 实际在 `use-channel-auto-reply.ts:263`，plan 写 259（259 是 `try {`）；`imageBlocks` 的构造在 `use-chat-actions.ts:218`，plan 写「改 214 行」（214 是 `? _images as ImageAttachment[]` 的续行） | `dev-workflow.md:406`（参考源码正确性）；实测两处 | 改成 263 / 218。行号写错会让阶段四改错位置（尤其 use-chat-actions 214 行前后是三元表达式，插错就语法错）。 |
| 3 | plan.md §1.4 47 行、182 行 | `use-image-display-src.ts` 实际路径是 `src/renderer/src/components/chat/use-image-display-src.ts`，不在 `hooks/`。plan 与 S-224 都只写裸文件名，容易被理解为 `hooks/` 下 | `dev-workflow.md:404`（文件路径符合项目结构） | 首次出现处写全路径，后续可简写。 |
| 4 | plan.md 步骤 6（177-190 行） | 计划新写 `hydrateOcMediaAttachments`，但渲染端**已有同功能实现**：`src/renderer/src/components/chat/InputArea/use-image-attachments.ts:48-69` 的 `readImagePathAsAttachment(filePath)`，同样是 `FS_READ_FILE_BINARY` → `data:<mediaType>;base64,<data>`，同样失败 `console.warn` + 返回 null。再写一份就是两套降级口径 | `AGENTS.md:185-189`（耦合/重复逻辑不并列放置） | 把该读取逻辑上提到 `src/renderer/src/lib/image-attachments.ts`（纯 lib，`ipcClient` 注入或调用方传入），InputArea 与 `use-chat-actions` 共用；`use-chat-actions` 里只留几行包装。 |
| 5 | plan.md 步骤 2b（105-107 行） | `chatImageFileName(base64: string, mediaType?)` 以 **base64 文本**做 sha256，S-224 §4.2 写的是「文件名 = **内容** sha256 前 16 位」。两者对同一字节的不同编码（换行 / 补位差异）会得到不同文件名，去重不彻底；主进程还要把整段 base64 字符串再过一遍 sha256 | S-224 §4.2、§7 #4 | 签名改成 `chatImageFileName(buffer: Buffer, mediaType?): string`，主进程 `Buffer.from(data,'base64')` 之后直接算哈希（`createHash('sha256').update(buffer)`）。单测也跟着改成传 Buffer。 |
| 6 | plan.md 步骤 2c（110-115 行） | 入参 `data?: string` 但没写空值处理。邻居 `image:persist-generated` 有显式校验（`misc-handlers.ts:308-310` 返回 `{ error: 'Missing image data' }`），新通道漏了会走到 `Buffer.from('', 'base64')` 写出 0 字节文件 | 与邻居一致；`misc-handlers.ts:308-310` | 步骤里补一句「`data` 为空/非字符串 ⇒ 直接返回 `{ error }`，与邻居同形」。 |
| 7 | plan.md 步骤 1（81 行） | `parseMediaUrlPath` 只写「取 `pathname` 去首斜杠后 `decodeURIComponent`」，没写 **host 必须是 `local`**。`oc-media://evil/C:/x.png` 与 `oc-media://local/C:/x.png` 会解析出同一路径 | 安全边界自查（plan 90 行自己说「不设限等于给页面一个无限制文件读取通道」） | 解析时校验 `url.protocol === 'oc-media:' && url.host === 'local'`，否则 null；单测加「host 非 local ⇒ null」。另建议 `path.normalize` 后拒绝含 `..` 的路径。 |
| 8 | plan.md §6 验收表 #4（281 行） | 「同图两次发送 ⇒ 磁盘一份」在**跨月**时不成立：路径含 `{yyyy-MM}`，10 月发一次、11 月再发一次会各存一份。需求 §4.2 也是这个口径，但验收表述没说清 | S-224 §4.1/§4.2、§7 #4 | 验收口径写成「同一自然月内重复发送只留一份」，或验收时固定在同一月内做。 |
| 9 | plan.md 步骤 7（201-206 行） | 只有 `stripImagePayloads` 的**函数级**断言，没有 S-224 风险 2 明确要求的门禁断言：「序列化产物 JSON 内不含 `"data":"iVBOR` 之类的 base64 头」。函数测通了不等于 `serializeMessage` 的出口干净（三处赋值漏一处就白测） | S-224 §6 风险 2「门禁加断言」 | `tests/image-payload` 里加一条：构造带 content/segments/toolCalls 三条路径的 `ChatMessage` 走 `serializeMessage`（需把它导出，或复制其赋值逻辑），断言 `JSON.stringify(meta)` 不含 `'iVBOR'`。 |
| 10 | plan.md 步骤 6（179 行） | `ImageAttachment` 新增 `filePath?`，但 `areImageAttachmentsEqual`（`image-attachments.ts:193-213`）只比 `id` / `dataUrl` / `mediaType`，不比 `filePath`。编辑草稿比对会认为「同图不同路径」相等；若后续 dataUrl 统一成 `oc-media://`，两张不同文件也可能撞成相等 | `AGENTS.md:174-183`（拆分/改造后保持行为等价） | 明确口径：要么把 `filePath` 纳入比较，要么在注释里写明「filePath 是 dataUrl 的派生，不单独比较」。 |

---

## ✅ 已核对通过

### 行数与豁免头（AGENTS.md §大文件拆分）
- `src/main/index.ts` = **490 行**（`[IO.File]::ReadAllLines` 实测）。+3 = **493 < 500**，不越硬线 ✅。`app.whenReady().then(() => {` 确在 **261 行**，plan 说的插入点准确 ✅。
- `src/renderer/src/hooks/use-chat-actions.ts` = **1106 行**，第 1 行是 `import { useCallback, useEffect } from 'react'` —— **无豁免头**，plan 判断正确 ✅（补头是必须的）。
- `src/renderer/src/hooks/use-channel-auto-reply.ts` = **550 行**，第 1-4 行**已有豁免头**（内容见 ❌5），plan 判断错误。

### 纯函数 / 分层
- `src/main/lib/image-persist.ts:15` 确实 `import { resolveDataDir } from './data-dir'`；`src/main/lib/data-dir.ts:1` 是 `import { app } from 'electron'` ⇒ 「单测 import image-persist 会连带拉 electron」的判断**成立** ✅，步骤 2a 抽 `image-extension.ts` 的动机正确。
- `guessExtensionFromMimeType` 只在 `image-persist.ts:23` 定义、`:70` 内部调用，全仓无其它引用 ⇒ 抽走后 `image-persist` 的 re-export 非必需（但无害）✅。
- `src/renderer/src/lib/local-media-url.ts`（16 行）只导出 `filePathToMediaUrl`，**无 electron 依赖** ✅，步骤 6 在 `image-attachments.ts` 里 import 它安全。
- `src/renderer/src/lib/api/types.ts:101-110` `ImageBlock.source` 确含 `filePath?: string`（第 108 行）⇒ 无需扩契约，与 S-224 §4.3 一致 ✅。

### 写入侧 / 读取侧事实
- `use-chat-actions.ts:213-218`：`imageAttachments` 取参 → `const imageBlocks: ContentBlock[] = imageAttachments.map(imageAttachmentToContentBlock)`；`:239-241` 拼 `[{type:'text'}, ...imageBlocks]`。步骤 4 的注入点成立 ✅。
- `use-channel-auto-reply.ts:263` `const userContent = buildInboundUserContent(content, task.images)`；`lib/channel/inbound-content.ts:33-55` 返回 `string | ContentBlock[]`（无图时返回原字符串）⇒ 步骤 4「字符串不动、数组过一遍」的写法与实现吻合 ✅。
- `src/renderer/src/lib/image-attachments.ts:60-80` `imageBlockToAttachment`：base64 分支条件是 `type === 'base64' && data`（第 61 行）⇒ 步骤 6「data 空、filePath 非空时另起一支」改法**成立**，但必须新增分支而不是改原条件（否则有 data 的老图会丢 dataUrl）✅。
- `src/renderer/src/stores/chat-store/db-helpers.ts`：`serializeMessage` 在 **118-147**；`meta.toolCalls` **130**、`meta.segments` **131**、`meta.content` **134**、`Object.assign(meta, msg.meta)` **135**。plan 说的「131-134」是其中两行 ✅（漏 130 见 ❌3）。
- `src/main/ipc/misc-handlers.ts`：`image:persist-generated` 的 `registerMessagePackHandler` 块确在 **294-336**，`empty data` 校验 308-310，`catch → { error }` 332-334，入参/出参形状与 plan 描述一致 ✅；文件顶部已 `import { resolveDataDir, resolveProjectDirName } from '../lib/data-dir'`（第 5 行）⇒ 步骤 2c 不需要新增 import ✅。
- `src/preload/index.ts`（111 行）：`invokeMessagePackBinary` 在 9-15，`api` 对象 48-97；`ping` / `dialog:openFolder` 都用**字面量通道名 + invokeMessagePackBinary**（51、88 行）⇒ 步骤 3 的「沿用既有惯例」写法成立 ✅（但触发 ❌2 的路由测试）。
- `src/preload/index.d.ts`（37 行）：只需在 `api` 类型里加一行即可 ✅。注意第 22 行 `fetchImageBase64` 是历史遗留声明、preload 并未实现（`index.ts` 无此键），本需求不要照它加「未实现声明」的先例。
- `fs:read-file-binary` 实现在 `src/main/ipc/fs-handlers.ts:165-195`，返回 `{ data: base64 } | { error }`，单元上限 `MAX_BINARY_READ_BYTES`（64 MB，`fs-handlers.ts:13` 附近）✅；渲染端调用范例：`InputArea/use-image-attachments.ts:53`、`ImagePreview.tsx:57`、`lib/agent/visual-context.ts:272`。
- `ImagePreview.tsx:176-191` `resolveImageBase64` 确实「先 filePath 读盘、再回退 dataUrl、最后 http」⇒ 图文件被删的降级链是现成的，S-224 风险 1 已由既有代码兜住 ✅。

### `oc-media` 协议确无注册端（plan §1.2 属实）
全仓（排除 node_modules/out）`oc-media` 仅 4 处：
- `src/renderer/src/lib/local-media-url.ts:15`（生成 URL）
- `src/renderer/src/components/chat/use-image-display-src.ts:110`（注释）
- `src/main/ipc/fs-handlers.ts:12`（注释）
- 加上 plan / 需求文档自身的引用

`registerSchemesAsPrivileged` / `protocol.handle` / `registerFileProtocol` **全仓 0 处**；`src/main/index.ts` 无协议注册、`local-media-protocol.ts` 不存在。⇒ 「不补协议，剥离 base64 后历史图必裂」的阻断判断**成立**，把它排成步骤 1 前置是对的 ✅。

### 项目结构与测试约定
- `docs/project-structure.md` 只写到「层 → 子目录 → 一句话职责」（第 5 行自述），主进程没有子目录地图 ⇒ 新文件落位只能按同侪判断：`src/main/lib/` 下已有 `image-persist.ts`、`generated-image-dir.ts`、`data-dir.ts`，新增 `image-extension.ts` / `chat-image-dir.ts` **位置正确** ✅；`local-media-protocol.ts` 放 `src/main/` 根与 `quick-launcher.ts`、`clipboard-enhancer.ts` 等进程级模块同级，可接受 ✅。
- 渲染端 `src/renderer/src/lib/` 放 `image-persist-chat.ts`、`image-payload.ts` 合理 ✅。
- 测试目录约定核对：`tests/<name>/program.ts` + `package.json` 的 `test:<name>` 脚本；`scripts/run-tests.mjs:27-30` 自动收集所有 `test:*`（排除 `test:clean`），**不需要另注册** ✅。`tests/image-block-source/program.ts:14-15` 确实用相对路径 `../../src/...` 直接 import、无 `@renderer` alias ⇒ plan 步骤 7「不用 alias」的写法与现状一致 ✅。
- `docs/data-storage.md:13-24`「全局目录」树里确实没有 `images/`，步骤 8 补文档的落点正确 ✅；`docs/PROGRESS.md` 更新也在步骤 8 内 ✅。

### 步骤 5 剥离条件的判定
`stripImagePayloads` 的四条同时满足（`type==='image'` ∧ `source` 是对象 ∧ `filePath` 非空 ∧ `data` 存在）——「无 filePath 一律不剥」的方向对：落盘失败降级时块里只有 `data`，剥了图就彻底没了。与 S-224 §4.5 降级口径一致 ✅。

### 边界声明
plan §4「不改什么」（246-256 行）与 S-224 §5 范围外基本对齐：表结构不动、三处 provider 写入器不动（已核对类型只读 `source.data`，`filePath` 不会进 payload）、存量不迁移、工具产物目录不复用 ✅。

---

## 遗漏检查（对照 S-224.md）

### §7 验收标准 10 条

| # | 验收条件 | 覆盖情况 | 说明 |
|---|---|---|---|
| 1 | 发图 ⇒ `{dataRoot}/images/{yyyy-MM}/` 出现哈希文件，字节一致 | **plan 有覆盖** | 步骤 2a/2b/2c + §6 #1。⚠️ 哈希口径要按内容字节（⚠️5）。 |
| 2 | `messages.meta` 内不含 base64 长串 | **plan 有覆盖（不完整）** | 步骤 5 只剥 content/segments，漏 toolCalls（❌3）；且缺出口级断言（⚠️9）。 |
| 3 | 重启 / 切会话后历史图仍显示 | **plan 有覆盖** | 步骤 1 补协议是前提；`use-image-display-src.ts:105-116` 的 filePath 支已存在。⚠️ 协议单测缺失（❌4）。 |
| 4 | 同图重复发送 ⇒ 磁盘一份 | **plan 有覆盖** | 步骤 2c「已存在跳过写盘」+ `tests/chat-image-dir` 同名断言。⚠️ 跨月不成立（⚠️8）。 |
| 5 | 工具产物（截图 / 生成图）落库不含 base64 | **plan 覆盖不足** | 工具产物走 `meta.toolCalls` / `meta.segments`；plan 只剥 segments（❌3）。 |
| 6 | 渠道（QQ）收图 ⇒ 落盘、显示、模型能看到 | **plan 有覆盖** | 步骤 4 在 `use-channel-auto-reply.ts:263` 前过 `attachChatImagePaths`；模型侧靠保留 `data`。⚠️ 行号写错（⚠️2）。 |
| 7 | 写盘失败 ⇒ 消息照发、图照显 | **plan 有覆盖** | 主进程 catch 返 `{error}`（步骤 2c）+ 渲染保留 data 降级（步骤 4）；§6 #7 真机验证（只读目录）。 |
| 8 | 历史消息「编辑重发」带图 ⇒ 图还在 | **plan 有覆盖** | 步骤 6 补 `filePath` 支 + hydrate。⚠️ 与既有 `readImagePathAsAttachment` 重复（⚠️4）。 |
| 9 | 三 provider payload 里仍是真 base64 | **plan 有覆盖（仅门禁表）** | 步骤 4 保留 `source.data`；§1.5 已核对三处写入器只读 `data`；§6 #9「抓包/单测」。**没有步骤级动作**，建议补一条 `tests/provider-payload` 断言（带 `filePath` 的块仍输出 `data`）。 |
| 10 | typecheck 双配置 0 错 / dotnet build 0 警告 0 错 / npm test 全绿 | **plan 有覆盖，但当前方案必挂** | §6 #10 有写；然而 `npm test` 的 `ipc-msgpack-routing` 会因新通道失败（❌2），且步骤 1-8 没有逐步编译检查（❌1）。 |

### 需求正文里的额外交付项（不在 §7 但明确要求）

| 位置 | 要求 | 覆盖情况 |
|---|---|---|
| §3.4 / §5 | `FileReadTool.cs:337-338` 的 `[image: <path>]` 注释「要么兑现，要么改成事实」 | **plan 未覆盖** —— 既不兑现也不改注释，plan 涉及文件表无此文件（⚠️1） |
| §4.4 | 落库剥离「递归走一遍 content / segments / **toolCalls**」 | **plan 未覆盖 toolCalls**（❌3） |
| §6 风险 2 | 「门禁加断言：序列化产物 JSON 内不含 `"data":"iVBOR` 之类的 base64 头」 | **plan 未覆盖**（⚠️9） |
| §4.2 | 文件名 = **内容** sha256 前 16 位 | **实现口径偏成 base64 文本哈希**（⚠️5） |
| §4.1 | `dataRoot` 用 `resolveDataDir()`，dev 自动落 `-dev` | **plan 有覆盖** ✅（步骤 2c 明确用 `resolveDataDir()`） |
| §4.6 | 存量不迁移 | **plan 有覆盖** ✅（§4 边界表） |

---

## 给阶段二的一句话

骨架和阶段一的探索结论是实的（缺口一确实存在、缺口二判断也对、步骤顺序「先补协议再剥离」正确），主要问题集中在**门禁能否跑绿**和**三个容器的剥离只写了两个**这两件事上。❌1/❌2 必须在进阶段四前改掉，否则第一步就会卡在 `npm test`。

---

## 阶段三处置记录（2026-10-26，plan 已升 v2）

### ❌ 逐条销项

| # | 审查结论 | 处置 | 落点 |
|---|---|---|---|
| ❌1 | 步骤不是 `- [ ]`、无逐步验证检查点 | **已改**：10 个步骤全部 `- [ ]` 格式，每步带「验证检查点」（具体命令 + 判据） | plan §2 |
| ❌2 | 新 msgpack 通道会让 `npm test` 必红 | **成立，已改**：`'image:persist-chat'` 加进 `tests/ipc-msgpack-routing/program.ts:39-83` 的 `PRELOAD_BINARY_ONLY`（字母序落 `file-search:take-initial-keyword` 与 `launcher:add-custom-app` 之间）。已核对该文件 Group 3 三项要求：不在 invoke 列表、main 已注册、caller 存在（preload 字面量）—— 新通道全部满足 | plan 步骤 4 |
| ❌3 | 漏剥 `meta.toolCalls` | **已改**，但**事实需订正**：`ToolCallInfo` 实测为 `{ id, name, input: Record, status, output?: string, … }`（`stores/chat-store/types.ts:13-22`），`output` 是字符串、无 `{ type:'image' }` 块 ⇒ 当前结构下此项**不是实测缺陷**。仍照剥（四条件不满足即零操作，零风险，防未来结构变化） | plan 步骤 6 |
| ❌4 | 纯函数与 electron 混一文件，`parseMediaUrlPath` 无法单测 | **成立，已改**：拆为 `src/main/lib/local-media-url.ts`（纯，零 electron）+ `src/main/local-media-protocol.ts`（electron 胶水），并新增 `test:local-media-url` 套件 | plan 步骤 1-2、8 |
| ❌5 | 「`use-channel-auto-reply.ts` 已有豁免头，plan 说两者都没有」 | **不成立，属时序误判**。审查期间主会话正在补这两个文件的豁免头，你读到的是补后版本。改动前实测：`use-chat-actions.ts` **1106 行、第 1 行即 import，确无头**；`use-channel-auto-reply.ts` **550 行、前 4 行是普通 docblock（`Channel Auto-Reply Hook` 说明），不是豁免头**。现两文件各**一处**豁免头，补后实测 **1110 / 554** 行，头内数字已订正为该值 | plan §5「已处置」 |

> ❌5 附注：审查提到的「既有头写 553 已过期」同属中间态（先写 553、实测后改 554）。

### ⚠️ 采纳情况

| 审查建议 | 处置 |
|---|---|
| `FileReadTool.cs:337-338` 注释未覆盖 | **采纳**：已列为步骤 9，改写为「DB 侧由 `serializeMessage` 剥 `data` 保留 `filePath`（S-224）」 |
| 行号偏差（`imageBlocks` 218 / `buildInboundUserContent` 263） | **采纳**：plan §1.1 与步骤 5 已改为 218 / 263 |
| `hydrateOcMediaAttachments` 与 `readImagePathAsAttachment` 重复 | **采纳**：改为在 `image-attachments.ts` 出注入式 `hydrateImageAttachmentFromFilePath`，两处共用一份实现 |
| `chatImageFileName` 应按解码后字节哈希 | **采纳**：步骤 3b 明确「对解码后字节求 sha256」 |
| 协议缺 `host === 'local'` 校验 | **采纳**：步骤 1 加入校验，步骤 8 有对应用例 |
| 缺「序列化产物不含 base64 头」门禁断言 | **采纳**：步骤 8 加入 `JSON.stringify(...)` 不含 `"data":"iVBOR` 断言 |
| `areImageAttachmentsEqual` 不含 `filePath` | **采纳**：步骤 7 补齐 |
| 跨月去重不成立 | **采纳，记为已知限制**：§6 第 1 条，月级粒度可接受、不额外处理 |

### 处置后结论

❌ **5 → 0**（4 项已改，1 项判定不成立并留证）。⚠️ 全部落地到步骤。
**可进入阶段四。**

