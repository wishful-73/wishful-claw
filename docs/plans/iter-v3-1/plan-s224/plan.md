# S-224 实施计划：聊天图片落盘存储，DB 只存路径

> 阶段二产物，阶段三审查后已修订（v2）。
> 上游依据 `docs/plans/iter-v3-1/requirements/S-224.md`；审查报告 `compliance_report.md`。

## 0. 目标

图片字节落盘到 `{dataRoot}/images/{yyyy-MM}/{sha256前16}.{ext}`，`messages.meta` 里只留 `filePath`，不再存 base64。存量数据不迁移。

## 1. 阶段一探索结论（2026-10-26 实查）

### 1.1 写入侧四条来源

| 来源 | 入口 | 现状 |
|---|---|---|
| 用户上传 | `use-chat-actions.ts:218` `imageBlocks` | base64 进 `messages.meta.content` |
| 渠道入站 | `use-channel-auto-reply.ts:263` `buildInboundUserContent` | 同上（S-211 做成与聊天窗同构） |
| 工具产物 | `FileReadTool.cs:320-347` `BuildImageContent` | 已落盘，块内**同时带 `filePath` 与 base64**（`:339`） |
| 已落库回放 | `db-helpers.ts:118` `serializeMessage` | 整个块数组 JSON 化进 `meta` |

### 1.2 ★ 缺口一：`oc-media` 协议从未实现（阻断）

全仓 `oc-media` 只有 3 处引用，**没有任何注册端**：

| 位置 | 内容 |
|---|---|
| `lib/local-media-url.ts:15` | 生成 `oc-media://local/<encoded>` |
| `components/chat/use-image-display-src.ts:110` | 注释「streamed via the oc-media protocol」 |
| `src/main/ipc/fs-handlers.ts:12` | 注释「viewers use the oc-media protocol」 |

`local-media-url.ts:10` 声称「registered in src/main/local-media-protocol.ts」—— **该文件不存在**。全仓 `protocol.handle` / `registerSchemesAsPrivileged` / `registerFileProtocol` 均 0 处。

现状之所以没暴露：所有图片块都带 `data`，`useImageDisplaySrc` 第一支 `isDataUrl(rawSrc)` 直接返回 data URL，`filePath` 分支从不启用。

⇒ **剥离 base64 之后，历史图片显示会全裂。不补协议，本需求必然失败。**

### 1.3 ★ 缺口二：restore 丢弃 `meta.content`（不修，仅记录）

`SessionRestoreTools.ConvertToWireMessage` 对普通用户消息只写 `entity.Content`（`messages.content` 纯文本列），**从不读 `meta.content`**；全文件没有 `image` 字样。

⇒ 冷启动/切会话后，历史图片块本来就不进模型上下文。这是既有行为，**本需求不改变它**，也不修（另立需求）。它意味着剥离 base64 **不会造成「模型看不到历史图」的回归**。

### 1.4 读取侧现状（都已支持）

| 用途 | 位置 | 结论 |
|---|---|---|
| 渲染显示 | `use-image-display-src.ts:105` | 第一支 data URL；`filePath` 支走协议（**协议待补**） |
| 组件取源 | `lib/tools/image-block-source.ts` | 只有 `filePath` 时 `src: ''` + `filePath`，已支持 |
| 下载/复制/预览 | `ImagePreview.tsx` | 优先 `filePath` 走 IPC 读盘 |
| 视觉注入 | `visual-context.ts:261-287` | 有 `filePath` 直接读盘 |
| 编辑重发 | `image-attachments.ts:60-80` | 只认 base64 / url，**需补 `filePath` 支路** |

### 1.5 三处 provider 写入器只认 `source.data`（不改）

`OpenAIChatRequestBuilder.cs` / `AnthropicMessagesInputWriter.cs` / `OpenAIResponsesInputWriter.cs` 都只在 `data` 非空时写出图片，**不读 `filePath`** ⇒ 不会把本地路径泄漏进 payload。剥离只发生在**落库序列化**这一层，发送用的内存块不受影响。

### 1.6 `ToolCallInfo` 结构（决定要不要剥 toolCalls）

`stores/chat-store/types.ts:13-22`：`{ id, name, input: Record<string, unknown>, status, output?: string, error?, startedAt?, completedAt? }`。

`output` 是**字符串**、`input` 是普通 record ⇒ 当前结构下 toolCalls 里**不存在** `{ type:'image', source:{…} }` 块。但剥离函数对不含该结构的对象是零操作、零风险，**照剥**（防御未来结构变化）。

### 1.7 基础设施

| 项 | 值 |
|---|---|
| `fs:read-file-binary` | `fs-handlers.ts:169`，上限 64 MB（`:13`） |
| `resolveDataDir()` | dev 落 `~/.wishful-claw-dev`，生产落 `~/.wishful-claw`（S-223） |
| 已有读盘复用点 | `InputArea/use-image-attachments.ts:48-69` `readImagePathAsAttachment`（hook 内闭包，逻辑可提取共用） |
| 测试注册 | `scripts/run-tests.mjs:27-30` 自动收集 `package.json` 的 `test:*` |

## 2. 步骤清单

- [ ] **步骤 1：纯函数层 `oc-media` 解析**

  新建 `src/main/lib/local-media-url.ts`（**只 import `node:path`，零 electron**）：

  - `LOCAL_MEDIA_SCHEME = 'oc-media'`
  - `ALLOWED_MEDIA_EXTENSIONS`（`.png .jpg .jpeg .webp .gif .bmp .mp4 .webm .mov .mkv .avi .ogv .m4v`）
  - `parseMediaUrlPath(url: string): string | null` —— 校验 `protocol === 'oc-media:'`、**`host === 'local'`**，取 `pathname` 去首斜杠后 `decodeURIComponent`
  - `isAllowedMediaPath(filePath: string): boolean` —— 扩展名白名单

  **验证检查点**：`npm run test:local-media-url` 全绿（步骤 7 先落测试）；文件顶 `grep electron` 零命中。

- [ ] **步骤 2：主进程协议注册**

  新建 `src/main/local-media-protocol.ts`（electron 胶水，`import { net, protocol }`）：

  - `prepareLocalMediaScheme(): void` —— 调 `protocol.registerSchemesAsPrivileged([{ scheme: LOCAL_MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])`，**必须在 app ready 前**
  - `registerLocalMediaProtocol(): void` —— `protocol.handle('oc-media', …)`：`parseMediaUrlPath` → 非法或非白名单返回 `new Response(null, { status: 403 })` → 合法 `net.fetch(pathToFileURL(filePath).toString())`

  改 `src/main/index.ts`（**行数敏感，见风险 9**）：加 1 行 import、模块顶层 1 行 `prepareLocalMediaScheme()`、`:261` `whenReady` 回调内 1 行 `registerLocalMediaProtocol()`。

  **验证检查点**：`index.ts` 改完 `ReadAllLines().Count` ≤ 495；`typecheck` 通过。

- [ ] **步骤 3：主进程落盘模块**

  **3a** 新建 `src/main/lib/image-extension.ts`（纯）：`MIME_EXTENSION_MAP` + `guessExtensionFromMimeType`。`image-persist.ts:23` 改为 import 后 `export { guessExtensionFromMimeType }`（既有路径不断）。

  **3b** 新建 `src/main/lib/chat-image-dir.ts`（纯，只 import `node:crypto` / `node:path`）：

  ```ts
  export const CHAT_IMAGES_SUBDIR = 'images'
  export function formatChatImageMonth(date: Date): string   // 本地时间 'yyyy-MM'
  export function chatImageFileName(base64: string, mediaType?: string): string  // 对「解码后字节」求 sha256 前 16 位 + 扩展名
  export function resolveChatImageDir(dataRoot: string, date: Date): string
  ```

  **3c** 改 `src/main/ipc/misc-handlers.ts`，在 `image:persist-generated`（`:294-336`）之后新增 `image:persist-chat`，同一个 `registerMessagePackHandler`：

  - 入参 `{ data?: string; mediaType?: string }`，出参 `{ filePath?, mediaType?, error? }`（与邻居同形）
  - 空值校验照 `:308-310`；`Buffer.from(data,'base64')` → 算名 → `resolveChatImageDir(resolveDataDir(), new Date())` → `mkdirSync recursive` → **文件已存在则跳过写盘** → 返回路径
  - `catch` → `{ error }`，不抛

  **验证检查点**：`typecheck`；`chat-image-dir.ts` / `image-extension.ts` 顶 `grep electron` 零命中。

- [ ] **步骤 4：preload 暴露 + 通道白名单**

  改 `src/preload/index.ts`：`persistChatImage: (args) => invokeMessagePackBinary('image:persist-chat', args)`。
  改 `src/preload/index.d.ts`：对应声明。

  **改 `tests/ipc-msgpack-routing/program.ts`**：把 `'image:persist-chat'` 加进 `PRELOAD_BINARY_ONLY`（`:39-83`，字母序落在 `file-search:take-initial-keyword` 与 `launcher:add-custom-app` 之间）。

  > 不登记会撞 `:190-194` 的「registered but nothing routes to it」断言，`npm test` 必红。

  **验证检查点**：`npm run test:ipc-msgpack-routing` 全绿。

- [ ] **步骤 5：渲染端落盘封装（注入式）**

  新建 `src/renderer/src/lib/image-persist-chat.ts`：

  ```ts
  export type PersistChatImageFn = (args: { data: string; mediaType?: string })
    => Promise<{ filePath?: string; error?: string }>
  export async function attachChatImagePaths<B>(blocks: B[], persist: PersistChatImageFn): Promise<B[]>
  ```

  - 非 image 块 / 无 `source.data` ⇒ 原样
  - 有 `data` ⇒ 调 `persist`；成功且有 `filePath` ⇒ `source` 补 `filePath`（**保留 `data`**，发送仍需）；失败 ⇒ 原样降级

  改 `use-chat-actions.ts:218`：`imageBlocks` 后过一遍。
  改 `use-channel-auto-reply.ts:263`：`buildInboundUserContent` 返回数组时过一遍，字符串跳过。

  **验证检查点**：`typecheck`；两个 hook 行数增量各 ≤ 6 行。

- [ ] **步骤 6：落库剥离**

  新建 `src/renderer/src/lib/image-payload.ts`：

  ```ts
  export function stripImagePayloads<T>(value: T): T
  ```

  递归深拷贝；**四个条件全满足**才删 `source.data`：`type === 'image'`、`source` 是对象、`source.filePath` 是非空字符串、`source.data` 存在。

  改 `db-helpers.ts:130-134` 三处并列全过：

  ```ts
  if (msg.toolCalls?.length) meta.toolCalls = stripImagePayloads(msg.toolCalls)   // :130
  if (msg.segments?.length) meta.segments = stripImagePayloads(msg.segments)      // :131
  if (msg.content) meta.content = stripImagePayloads(msg.content)                 // :134
  ```

  **验证检查点**：`npm run test:image-payload` 全绿，含「序列化产物不含 `"data":"iVBOR`」断言。

- [ ] **步骤 7：编辑重发读回**

  改 `src/renderer/src/lib/image-attachments.ts`：

  - `ImageAttachment` 加 `filePath?: string`
  - `imageBlockToAttachment`：base64 分支在 `data` 空、`filePath` 非空时返回 `{ id, dataUrl: filePathToMediaUrl(filePath), mediaType, filePath }`
  - 新增注入式 `hydrateImageAttachmentFromFilePath(filePath, read: (p: string) => Promise<{data?: string; error?: string}>, mediaType)` —— 逻辑同 `InputArea/use-image-attachments.ts:48-69`，两处共用一份实现
  - `areImageAttachmentsEqual`（`:193`）比较项补 `filePath`

  改 `use-chat-actions.ts`：`imageBlocks` 之前，把 `dataUrl` 以 `oc-media://` 开头的附件经 `FS_READ_FILE_BINARY` hydrate 回 base64；失败丢弃该图 + `console.warn`，不阻断发送。

  **验证检查点**：`typecheck`；`image-attachments.ts` 行数 ≤ 320。

- [ ] **步骤 8：单测**

  新建 `tests/local-media-url/program.ts`：
  - `parseMediaUrlPath` 正常解析 + `decodeURIComponent` 还原含空格/中文的 Windows 路径
  - 非 `oc-media:` 协议 / host ≠ `local` / 空路径 ⇒ `null`
  - `isAllowedMediaPath`：`.png/.jpg/.mp4` 通过，`.exe/.txt/.dll` 拒绝，无扩展名拒绝

  新建 `tests/chat-image-dir/program.ts`：
  - `formatChatImageMonth` → `'2026-10'`
  - 同字节同类型 ⇒ 同名；不同字节 ⇒ 不同名
  - **同 base64 不同 mediaType ⇒ 不同名**（扩展名不同）
  - 扩展名映射 `.jpg/.webp/.gif/.bmp/默认 .png`
  - `resolveChatImageDir` 拼接

  新建 `tests/image-payload/program.ts`：
  - 有 `filePath` 的 image 块被剥 `data`
  - **无 `filePath` 的 image 块 `data` 保留**（关键安全断言）
  - text 块 / string / 非 image 块原样
  - `content` 数组、`segments` 结构、`toolCalls` 三处都能剥到
  - 原对象不被修改
  - `JSON.stringify(stripImagePayloads(msg))` 不含 `"data":"iVBOR`

  `package.json` 加三条 `test:*`（不带 `@renderer` alias，被测模块用相对路径 import，同 `tests/image-block-source/program.ts:14-15`）：

  ```json
  "test:local-media-url": "esbuild tests/local-media-url/program.ts --bundle --platform=node --format=cjs --outfile=tests/local-media-url/out/program.cjs && node tests/local-media-url/out/program.cjs",
  "test:chat-image-dir": "esbuild tests/chat-image-dir/program.ts --bundle --platform=node --format=cjs --outfile=tests/chat-image-dir/out/program.cjs && node tests/chat-image-dir/out/program.cjs",
  "test:image-payload": "esbuild tests/image-payload/program.ts --bundle --platform=node --format=cjs --outfile=tests/image-payload/out/program.cjs && node tests/image-payload/out/program.cjs"
  ```

  **验证检查点**：`npm test` 全绿（三套新增全过 + 既有套件不回归）。

- [ ] **步骤 9：文档与注释**

  - `docs/data-storage.md`：补 `images/{yyyy-MM}/` 目录、命名规则、去重、不迁移口径
  - `src/runtime/WishfulClaw.Agent/Tools/FileTools/FileReadTool.cs:337-338`：注释「DB 侧也按它把 base64 换成 `[image: <path> …]` 占位（S-145 §3.3）」**与事实不符**（全仓无该占位机制），改写为「DB 侧由 `serializeMessage` 剥掉 `data`、保留 `filePath`（S-224）」
  - `docs/PROGRESS.md`、`requirements/S-224.md` §8

  **验证检查点**：`dotnet build src\runtime\WishfulClaw.sln` 0 警告 0 错误。

- [ ] **步骤 10：门禁全量**

  `npm run typecheck`（双配置 0 错）→ `npm test`（全绿）→ `dotnet build`（0 警告 0 错误）。

  **验证检查点**：三条命令实跑输出贴进 `verification_report.md`。

## 3. 涉及文件

| # | 文件 | 动作 |
|---|---|---|
| 1 | `src/main/lib/local-media-url.ts` | 新建（纯） |
| 2 | `src/main/local-media-protocol.ts` | 新建（electron） |
| 3 | `src/main/index.ts` | +3 行注册 |
| 4 | `src/main/lib/image-extension.ts` | 新建（纯，抽出） |
| 5 | `src/main/lib/image-persist.ts` | 改 import + re-export |
| 6 | `src/main/lib/chat-image-dir.ts` | 新建（纯） |
| 7 | `src/main/ipc/misc-handlers.ts` | + `image:persist-chat` |
| 8 | `src/preload/index.ts` / `index.d.ts` | 暴露 API |
| 9 | `tests/ipc-msgpack-routing/program.ts` | 白名单登记 |
| 10 | `src/renderer/src/lib/image-persist-chat.ts` | 新建 |
| 11 | `src/renderer/src/lib/image-payload.ts` | 新建 |
| 12 | `src/renderer/src/hooks/use-chat-actions.ts` | 落盘 + hydrate |
| 13 | `src/renderer/src/hooks/use-channel-auto-reply.ts` | 渠道落盘 |
| 14 | `src/renderer/src/stores/chat-store/db-helpers.ts` | 三处剥离 |
| 15 | `src/renderer/src/lib/image-attachments.ts` | `filePath` 支路 + hydrate + 相等性 |
| 16 | `tests/local-media-url/program.ts` | 新建 |
| 17 | `tests/chat-image-dir/program.ts` | 新建 |
| 18 | `tests/image-payload/program.ts` | 新建 |
| 19 | `package.json` | 三条 test 脚本 |
| 20 | `src/runtime/.../FileTools/FileReadTool.cs` | 注释改写 |
| 21 | `docs/data-storage.md` / `PROGRESS.md` / `S-224.md` | 文档 |

## 4. 不改什么（边界）

| 项 | 理由 |
|---|---|
| `messages` 表结构 | 无新列，`filePath` 本就在 `ImageBlock.source` 里 |
| 三处 provider 写入器 | 只认 `data`；不改就不会把路径送进 payload |
| `SessionRestoreTools` | 缺口二属既有行为，另立需求 |
| 存量 base64 | 不迁移、不写回填脚本（S-224 §4.6） |
| `image:persist-generated` / `resolveGeneratedImagesDir` | 工具产物目录语义不同，不动 |
| 压缩快照 | 存内存 wire conversation，仍带 base64，既有行为 |
| 其它 msgpack 通道 | 只增 `image:persist-chat` 一条 |

## 5. 风险与处置

| # | 风险 | 处置 |
|---|---|---|
| 1 | 协议未实现导致显示全裂 | 步骤 1-2 前置，先做完再动剥离；阶段六真机验证 |
| 2 | 协议变任意文件读取通道 | host 必须 `local` + 扩展名白名单 + 403 |
| 3 | 剥离误伤无 `filePath` 的块 ⇒ 图彻底丢 | 四条件全满足才剥；单测反向断言 |
| 4 | `meta.toolCalls` / `segments` / `content` 任一处漏剥 | 三处并列全过；单测逐个覆盖 |
| 5 | 新 msgpack 通道撞路由断言 | 步骤 4 同步登记 `PRELOAD_BINARY_ONLY` |
| 6 | 纯函数模块被 electron 污染 ⇒ 单测跑不了 | `local-media-url` / `chat-image-dir` / `image-extension` 三个纯模块零 electron import，检查点卡住 |
| 7 | 落盘失败阻断发送 | 全 catch 后原样返回，降级内联 base64 |
| 8 | 编辑重发时文件已删 | hydrate 失败丢弃该图 + warn |
| 9 | `index.ts` 490 行，插入不当越 500 | 只加 3 行，改完实测 ≤ 495 |
| 10 | 并发同哈希写同一路径 | 内容相同，存在即跳过；写失败回查存在则视为成功 |
| 11 | 大视频整读进内存 | 用 `net.fetch(pathToFileURL)` 走原生流支持 Range |

**已处置（阶段三）**：`use-chat-actions.ts`（实测 **1110** 行）与 `use-channel-auto-reply.ts`（实测 **554** 行）**两个文件原本都没有 500 行豁免头**，2026-10-26 已各补一处（AGENTS.md §大文件拆分 第 5 条第 2 类「高度内聚的 hook」），头内行数为补后实测值。

## 6. 已知限制

| # | 限制 | 说明 |
|---|---|---|
| 1 | 跨月去重不成立 | 同一张图 10 月、11 月各发一次 ⇒ 两个目录各存一份（按写入时刻分桶）。月级粒度下可接受 |
| 2 | 历史图不进模型上下文 | 缺口二，既有行为，另立需求 |
| 3 | 存量记录不瘦身 | 老消息仍是内联 base64，渲染两种形状都支持 |
| 4 | dev 与生产各一份图 | 预期行为（S-223 同口径） |

## 7. 阶段六验收入口

| # | 验证 | 方式 |
|---|---|---|
| 1 | 发图 ⇒ `~/.wishful-claw/images/2026-10/` 出现哈希文件 | 真机 + 文件比对 |
| 2 | `messages.meta` 不含 base64 长串 | 查库 |
| 3 | 重启 / 切会话后历史图正常显示 | 真机 |
| 4 | 同图两次发送 ⇒ 磁盘一份 | 真机 |
| 5 | 工具产物（截图 / 生成图）落库后无 base64 | 查库 |
| 6 | 渠道收图落盘并可显示 | 真机（有渠道环境） |
| 7 | 只读目录下写盘失败 ⇒ 消息照发、图照显 | 真机 |
| 8 | 历史消息编辑重发带图 ⇒ 图还在 | 真机 |
| 9 | 三处 provider 请求体仍是真 base64 | 抓包 / 单测 |
| 10 | `typecheck` 双配置 0 错 / `dotnet build` 0 警告 0 错误 / `npm test` 全绿 | 门禁 |
