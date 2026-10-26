# S-224 阶段五 代码审查报告

> 审查对象：`docs/plans/iter-v3-1/requirements/S-224.md` 对应实现（工作区未提交改动）
> 审查方式：只读。`git status --porcelain --untracked-files=all` 取全量改动清单，逐个 read/grep；行数用 `[IO.File]::ReadAllLines(path).Count` 实测。
> 未修改任何源码 / 测试，仅新增本文件。

## 结论

**不通过** —— ❌ 1 / ⚠️ 10 / ℹ️ 7

三条核心保证（不误删 data、协议不被穿越、失败不阻断发送）中，前两条**成立且证据充分**；第三条在「畸形块」和「落盘写入被中断」两个角上各有缺口，其中落盘那条会真正丢数据，故阻断。

---

## ❌ 必须修（阻断）

| # | 文件:行 | 问题 | 修法 |
|---|---|---|---|
| 1 | `src/main/ipc/misc-handlers.ts:355-357` | **落盘写非原子 + `existsSync` 短路，可造成永久性图片损坏（本次唯一真正的数据丢失路径）**。`fs.writeFileSync(filePath, ...)` 直接写最终路径：若写到一半进程被杀 / 磁盘满 / 杀软占用文件，最终路径上留下 0 字节或截断文件。下次同一张图重发时 `if (!fs.existsSync(filePath))` 命中 → **永不重写** → 返回坏路径。而此时 `serializeMessage` 已因 `filePath` 非空把 `source.data` 剥掉（`src/renderer/src/lib/image-payload.ts:33-37`），库和内存里都不再有 base64 → 图永久损坏、不可自愈、用户无从察觉（只看到裂图）。相关：`Buffer.from(args.data,'base64')` 对非法 base64 返回空 buffer，也会写出 0 字节文件并同样被短路固化。 | ① 写临时文件再原子替换：`const tmp = filePath + '.tmp'; fs.writeFileSync(tmp, buf); fs.renameSync(tmp, filePath)`；② 短路条件加尺寸校验：`if (!fs.existsSync(filePath) \|\| fs.statSync(filePath).size === 0)` 才写；③ 顺手 `if (buf.length === 0) return { error: 'Empty image data' }`。三处合计约 4 行。 |

---

## ⚠️ 建议修

| # | 文件:行 | 问题 | 修法 |
|---|---|---|---|
| 1 | `tests/local-media-url/program.ts:23-25` | **验收点 #3「往返一致」实际没被测住**。测试自己用 `` `${LOCAL_MEDIA_SCHEME}://${LOCAL_MEDIA_HOST}/${encodeURIComponent(filePath)}` `` 复刻了渲染端的编码格式，从未 import 渲染端的 `filePathToMediaUrl`（全仓 grep `filePathToMediaUrl` 在 tests 下只命中 `tests/local-media-url/program.ts:12` 的一句注释）。于是「渲染端换了编码格式 → 重启后图片全裂」这类回归，测试照样全绿。 | `src/renderer/src/lib/local-media-url.ts` 是纯函数、无 electron 依赖，直接 `import { filePathToMediaUrl } from '../../src/renderer/src/lib/local-media-url'`，用它在 `mediaUrl()` 里替换手写模板；再补一条 Windows 盘符 + 中文路径走**渲染端函数**的用例。 |
| 2 | `src/main/lib/local-media-url.ts:53-63` | **解析结果无「绝对路径 / 无 `..`」约束**。`parsed.pathname.replace(/^\/+/,'')` 后直接返回：相对路径会按主进程 cwd 解析、`%2e%2e` 解码出的 `..` 段原样保留、`oc-media://local/\\\\server\\share\\a.png`（UNC）会触发 SMB 连接（Windows 上可被用来探测/挂起主进程）。不至于越权读到新东西（`fs:read-file-binary` 本来就无限制），但协议不该比既有 IPC 更宽松。 | `const p = path.isAbsolute(decoded) ? decoded : null`；再加 `if (decoded.split(/[\\/]/).includes('..')) return null`；UNC 前缀 `^\\\\\\\\` 一并拒绝。三条各一行，配 3 条测试。 |
| 3 | `src/main/lib/local-media-protocol.ts:61-65` | **兜底分支 `readFile` 无大小上限**。注释自己写明「正常走上面的流式分支，兜底只影响降级路径」——但兜底存在的理由正是「某版本 net.fetch 不认 `file:`」，那种版本下所有请求都会走这里，一个 2 GB 视频整块进主进程堆。 | 兜底前 `await stat(filePath)`，超阈值（如 64 MB）返回 413，或改 `createReadStream` + `Readable.toWeb`。 |
| 4 | `src/renderer/src/hooks/use-chat-actions.ts:223-230` vs `src/renderer/src/lib/image-attachments.ts:94-111` | **两份同语义的 hydrate 实现**：前者用 `ipcClient.invoke(IPC.FS_READ_FILE_BINARY)`，后者用注入的 `ReadBinaryFileFn`，判据（读失败 / 空 data → 丢弃并 warn）分处两地。本次已经因为这条反复改了 `image-attachments.ts`，下次只改一处就会分叉。 | 抽 `readBinaryFileViaIpc` 常量传入 `hydrateImageAttachmentsFromFilePaths`，use-chat-actions 只留一行调用。 |
| 5 | `src/renderer/src/hooks/use-chat-actions.ts:233-236` | **编辑重发时对已带 `filePath` 的附件无条件重走落盘**。`imageAttachmentToContentBlock`（`image-attachments.ts:70`）会把 `filePath` 带过来，`attachChatImagePaths` 仍然把整份 base64（最多 20 MB）msgpack 过一遍 IPC、主进程再解码一次（`chat-image-dir.ts:27` 解一次 + `misc-handlers.ts:356` 再解一次），最后得到的路径和原来一模一样。用户在长会话里编辑一张大图，这次发送前要多等两趟 20 MB。 | `attachChatImagePaths` 里 `if (block.source?.filePath) return block` 短路（信任既有路径；需要更稳则让主进程 `existsSync` 确认）。 |
| 6 | `src/main/ipc/misc-handlers.ts:352-356` | **主进程同步 IO**：`mkdirSync` / `existsSync` / `writeFileSync` 全同步，写 20 MB 期间整个 app 的 IPC 与窗口响应都停（Electron 主进程单线程）。 | `await fs.promises.mkdir/writeFile`；handler 已是 `async`，改动无额外成本。 |
| 7 | `src/main/lib/chat-image-dir.ts:27` + `src/main/ipc/misc-handlers.ts:353,356` | **同一份 base64 被解码两次**：`chatImageFileName` 内部 `Buffer.from(base64,'base64')` 求 sha256，`writeFileSync` 那行再解一次。20 MB 图多一次 20 MB 分配 + 解码。 | `chatImageFileName` 改成接受 `Buffer`，handler 解一次拿到 buf 后既算哈希又写盘。 |
| 8 | `tests/chat-image-dir/program.ts:76-80` | **自反断言（永远通过）**：`checkEqual(chatImageFileName(viaUtf8,'image/png'), chatImageFileName(viaUtf8,'image/png'), '同字节稳定')` —— 同一表达式比自身。上一行 75 行的 `viaUtf8 === viaConcat` 说明作者本想构造「base64 文本不同、字节相同」，但 `Buffer.from('hello world').toString('base64')` 与 `Buffer.concat(...)` 拼出来的文本恰好相同，用例空转。而同组 82-91 行已经用「对字节哈希 ≠ 对 base64 文本哈希」覆盖了真意图。 | 删掉 76-80 这一处自反断言（保留第二组），或改用带换行的非规范 base64（如 `'aGVsbG8gd29y\\nbGQ='`）作为「文本不同」的 fixture。 |
| 9 | `tests/image-payload/program.ts`（整套） + `src/renderer/src/stores/chat-store/db-helpers.ts:132,133,136` | **测试只覆盖纯函数，没覆盖落点，也没覆盖两条降级保证**。`stripImagePayloads` 本身测得不错，但 `serializeMessage` 三个调用点（toolCalls / segments / content）无用例；`attachChatImagePaths` 与 `hydrateImageAttachmentsFromFilePaths` 在 `tests/` 下 **0 命中**（grep 实测），而这两条正是验收 #7「落盘失败降级」和 #8「编辑重发」的唯一实现落点，现在完全靠人读代码相信。 | 给 `db-helpers.serializeMessage` 补一条「image 带 filePath → meta JSON 里不含 `data` 字串」的端到端断言；`attachChatImagePaths` 注入一个恒 reject 的 persist，断言返回块与原块深度相等且仍有 `source.data`。 |
| 10 | `src/renderer/src/lib/image-persist-chat.ts:34` | **守卫在 try 之外**：`if (block.source?.type !== 'image') return block` 在 34 行，`try` 从 35 行才开始。块畸形（`source` 为 null / 非对象 / 数组）时这行会抛 TypeError，冒到 `use-chat-actions` 的发送主路径，违背本文件「落盘失败绝不阻断发送」的承诺。 | 把 34 行守卫移进 try，或改成 `if (!block \|\| block.type !== 'image' \|\| !block.source) return block`（先去空再取属性）。 |
| 11 | `src/renderer/src/hooks/use-chat-actions.ts:233-236`（结合 `image-attachments.ts:137-157`） | **全丢后可能发出空 content**：图片全部 hydrate 失败且文本为空时，`attachChatImagePaths` 返回空数组 → `userContent` 变成 `''`，仍会 `sendMessage({ content: '' })`。用户看到的是自己一条空白消息 + 一次莫名其妙的模型响应。 | 发送前 `if (Array.isArray(userContent) && userContent.length === 0 && !messageText.trim())` → 提示「图片已丢失，请重新附件」并 return。 |

---

## ℹ️ 观察

| # | 位置 | 内容 |
|---|---|---|
| 1 | `src/renderer/src/lib/local-media-url.ts:10` | 注释里的来源路径过期：写的是 `src/main/local-media-protocol.ts`，实际在 `src/main/lib/local-media-protocol.ts`（`docs/data-storage.md` 已写对）。 |
| 2 | `src/main/lib/local-media-protocol.ts:39` | `protocol.handle` 注册在 **default session**（未传 partition）。`BrowserPanel` 在「复用浏览器数据」开启时不带 partition、落到 default session，此时远端页面可用 `<img src="oc-media://local/C:/Users/...">` 探测本机文件是否存在并显示出来。响应不带 CORS 头，读不回像素/内容，危害限于「确认某路径存在 + 本机已登录用户可见」，故列观察不列缺陷。加固建议：handler 里校验 `request.referrer` 以 app 源开头，或把协议注册进专用 partition。 |
| 3 | 全局 | `filePath` 是任何渲染端代码都能往 image block 上塞的自由字段（来源有三：`FileReadTool.cs:339`、桌面截图持久化、本次 `image:persist-chat`），协议层只按扩展名白名单放行、不校验路径来源。当前渲染端完全可信，属可接受设计，记录在案。 |
| 4 | `src/renderer/src/lib/image-attachments.ts` 的 `toolResultContentEqual` | 相等性比较新增了 `filePath`，即同一张图「无路径 → 有路径」会被判为内容不同。这是**期望行为**（避免误判相等而跳过落盘），但建议在函数注释点一句，否则后人会当成多余比较删掉。 |
| 5 | `src/renderer/src/lib/image-attachments.ts:94-111` | hydrate 是串行 `for...of await`，一屏 5 张图 = 5 次串行 IPC（每次最多 20 MB）。改 `Promise.all` 可提速，但注意 `fs:read-file-binary` 本身无大小上限，并发后峰值内存要一起看。 |
| 6 | `src/main/index.ts`（495 行） | 离 500 行硬线只剩 5 行；本次协议注册刚好 3 行塞进去了。下次再往 `index.ts` 加东西就得先拆或先挂豁免头。 |
| 7 | `docs/data-storage.md` | 跨月去重限制（8 月发过的图 9 月再发会存两份）已明确记为已知取舍，不算缺陷。 |

**另：三处 provider 写入器实测无影响（验收 #9 通过）**
`grep -c filePath` 在 `OpenAIChatRequestBuilder.cs` / `AnthropicMessagesInputWriter.cs` / `OpenAIResponsesInputWriter.cs` 中均为 **0** 命中；image 源只读 `source.data` / `source.url`，新增的 `filePath` 不会进请求体。

---

## 关键验证记录（支撑结论的正面证据）

**① 数据丢失风险（重点 1）：剥离条件成立，无「没 filePath 却丢 data」的路径**

`src/renderer/src/lib/image-payload.ts:30-37` 的四条件与门：

```ts
if (copy.type === 'image' && isPlainObject(copy.source)) {
  const source = copy.source
  const filePath = source.filePath
  if (typeof filePath === 'string' && filePath.trim().length > 0 && 'data' in source) {
```

逐条排查可能的误删路径：
- `filePath` 为空串 / 全空格 / `undefined` / `null` / 非 string → `typeof` 或 `trim().length > 0` 拦下，**不剥**；
- `source` 为 null / 数组 / 字符串 → `isPlainObject` 拦下，**不剥**；
- 块类型写成 `'image'` 但实际是 url 型（`source.type==='url'`，无 `filePath`）→ 无 `filePath`，**不剥**；
- `data` 不存在 → `'data' in source` 为假，**不剥**（不会凭空造出空 source）；
- `segments` / `toolCalls` 里嵌套的块 → `stripNode` 递归（18-28 行）同样走这条门，语义一致；
- 深拷贝（25-28 行、34 行）保证不动内存里的原块，下一轮请求仍拿得到 base64。

**唯一能丢字节的路径不在这个函数里，而在落盘的写入侧**，即上面 ❌ #1。

**② 协议安全性（重点 2）：白名单与编码绕过没有口子**

- 路径穿越：`parseMediaUrlPath` 先 `new URL()`，`%2e%2e%2f` 之类在 `pathname` 里仍是编码态，`decodeURIComponent` 只解一次（`local-media-url.ts:58`），不会二次解码成新分隔符；解出的 `..` 不做规范化 → 只可能落到「相对 cwd 解析」和「UNC」，见 ⚠️ #2，但**不会**放大成任意文件读取（扩展名白名单仍在 `extname` 上把关）。
- 编码绕过：`isAllowedMediaPath` 用 `extname(decoded).toLowerCase()`（66-68 行）。`a.PNG` ✓ 放行（大小写不敏感，测试 60 行已覆盖）；`a.png.txt` → `extname` 取 `.txt` → 拒绝；`a.png%00.txt` → 解码后含 NUL，`extname` 取 `.txt` → 拒绝；`a.png/`（尾斜杠）→ `extname` 为空 → 拒绝。没找到「白名单外文件被放行」的构造。
- host 校验：`parsed.hostname !== 'local'` → 400（51 行），`oc-media://evil/...` 被拒（测试 44-47 行覆盖）。
- 前缀白名单本身（23-36 行）含 `.exe`/`.dll`/`.ps1` 之类可执行后缀？**否**，测试 64-70 行专门钉死这一点。
- 解码失败（`%E0%A4%A`）→ catch 返回 null → 400（58-61 行，测试 49 行覆盖）。

**③ 降级路径（重点 4）**

- 落盘失败：`misc-handlers.ts:359-361` catch 后返回 `{ error }`，`image-persist-chat.ts` 侧不写 `filePath`、块保持原样（含 `data`）→ `serializeMessage` 因无 `filePath` **不剥** → 发送与落库都正常，只是 Fig 走 base64 老路。这条链是通的 ✓（缺口仅 ⚠️ #10 的畸形块与 ⚠️ #11 的全丢空消息）。
- hydrate 失败：`image-attachments.ts:137-157` 读不到 → 丢弃该附件 + `console.warn`，`await` 不抛 → 发送继续 ✓。但「已发出的历史消息里的图，文件被用户删了」会静默消失，建议在气泡上给个占位提示（当前无）。

**④ await 时序（重点 6）**

`use-chat-actions.ts:223-236` 两次新增 `await` 都在既有 `try/finally`（清 `_startingSessionSends`）内部、在 `sendMessage` 之前，任一失败都不影响后面的发送；`_startingSessionSends` 的清理仍在 finally。时序上没有引入新的悬挂/双发风险 ✓。代价是发送前多了 2 次 IPC 往返，见 ⚠️ #5。

---

## 实测记录

`[IO.File]::ReadAllLines(path).Count` 实测，2026-10-26：

| 文件 | 行数 | 是否超 500 | 有无豁免头 |
|---|---:|---|---|
| `src/main/index.ts` | 495 | 否（差 5 行） | 不需要 |
| `src/main/ipc/misc-handlers.ts` | 363 | 否 | 不需要 |
| `src/main/lib/local-media-url.ts` | 89 | 否 | 不需要 |
| `src/main/lib/local-media-protocol.ts` | 71 | 否 | 不需要 |
| `src/main/lib/chat-image-dir.ts` | 39 | 否 | 不需要 |
| `src/main/lib/image-extension.ts` | 32 | 否 | 不需要 |
| `src/main/lib/image-persist.ts` | 79 | 否 | 不需要 |
| `src/preload/index.ts` | 121 | 否 | 不需要 |
| `src/preload/index.d.ts` | 39 | 否 | 不需要 |
| `src/renderer/src/hooks/use-chat-actions.ts` | 1128 | **是** | 有，第 1-4 行；声称「实测 1128 行，含本头 4 行」——**与实际一致** ✓ |
| `src/renderer/src/hooks/use-channel-auto-reply.ts` | 560 | **是** | 有，第 1-4 行；声称「实测 560 行，含本头 4 行」——**与实际一致** ✓ |
| `src/renderer/src/stores/chat-store/db-helpers.ts` | 714 | **是** | 有，第 1-3 行；声称「2026-10-26 实测 714 行」——**与实际一致** ✓ |
| `src/renderer/src/lib/image-attachments.ts` | 314 | 否 | 不需要 |
| `src/renderer/src/lib/image-payload.ts` | 45 | 否 | 不需要 |
| `src/renderer/src/lib/image-persist-chat.ts` | 47 | 否 | 不需要 |
| `src/renderer/src/lib/local-media-url.ts` | 16 | 否 | 不需要 |
| `src/runtime/WishfulClaw.Agent/Tools/FileTools/FileReadTool.cs` | 364 | 否 | 不需要 |
| `tests/local-media-url/program.ts` | 95 | 否 | 不需要 |
| `tests/chat-image-dir/program.ts` | 119 | 否 | 不需要 |
| `tests/image-payload/program.ts` | 159 | 否 | 不需要 |
| `tests/ipc-msgpack-routing/program.ts` | 235 | 否 | 不需要 |

三个超 500 的文件**豁免头存在且行数声明准确**，本次改动没有破坏硬线纪律 ✓。

---

## 验收条件逐条对照（S-224.md）

| # | 验收点 | 结论 | 依据 |
|---|---|---|---|
| 1 | 发送前落盘 | ✅ | `use-chat-actions.ts:233`、`use-channel-auto-reply.ts:265-269` |
| 2 | 消息里不含 base64 | ✅ | `image-payload.ts:30-37` + `db-helpers.ts:132/133/136`（⚠️ 无测试覆盖，见 ⚠️ #9） |
| 3 | 重启后图片仍显示 | ⚠️ | 协议链路齐全（`index.ts` 注册 → `protocol.handle`），**但往返一致性未被测试钉住**（⚠️ #1），且 Chromium 对 `standard` scheme 的大写盘符/`%5C` 规范化只经过 Node `URL` 验证，需阶段六真机确认 |
| 4 | 同图去重 | ✅ | `chat-image-dir.ts:26-29` 按解码字节哈希；跨月限制已在文档记录 |
| 5 | 工具产物同样只留路径 | ✅ | `db-helpers.ts:132` 覆盖 `meta.content` / `toolCalls` / `segments`；C# 侧已写 `filePath`（FileReadTool.cs:339） |
| 6 | 渠道入站图片同样落盘 | ✅ | `use-channel-auto-reply.ts:265-269` |
| 7 | 落盘失败不阻断发送 | ✅（有两处小洞） | `misc-handlers.ts:359-361` + `image-persist-chat.ts` 不改块；洞见 ⚠️ #10 / ❌ #1 |
| 8 | 历史消息编辑重发 | ✅ | `use-chat-actions.ts:223-230` hydrate 后重走同一落盘链 |
| 9 | 三处 provider 写入器不受影响 | ✅ | 三个 `.cs` 中 `filePath` 命中数均为 0 |
| 10 | 三道门禁绿 | ✅ | 本次新增 3 套单测 + `ipc-msgpack-routing` 同步放行 `image:persist-chat`（`tests/ipc-msgpack-routing/program.ts` 白名单） |

---

## 修复优先级建议

1. **必修（阻断）**：❌ #1 原子写 + 尺寸校验 —— 4 行，消除唯一的数据丢失路径。
2. **合并前建议做**：⚠️ #1（往返一致性真覆盖）、⚠️ #3（守卫移进 try）、⚠️ #10（畸形块）、⚠️ #8（删自反断言）—— 都是几行且直接对应验收点。
3. **可留到下个迭代**：⚠️ #2（`..`/UNC 加固）、⚠️ #4/#5/#6/#7（DRY 与主进程性能）、⚠️ #9 补测试。

---

## �׶��崦�ü�¼��2026-10-26��ʵʩ�����

**���ú�? 0 / ?? 0�������뽨����ȫ���տڣ�??9 ���ִ�����˵����/ ?? �Ѽ�¼**

### ? ����

| # | ���� | ��� |
|---|---|---|
| 1 | **����**��`writeFileSync` ֱд�ġ���ʱ�ļ� + `rename` ԭ���滻����`existsSync` �� `isNonEmptyFile()`��`stat().isFile() && size > 0`����0 �ֽ�/�ض��ļ�һ����д��`Buffer.from(...).length === 0` ֱ�ӷ��� `{ error }`��˳�ְ� `mkdirSync/writeFileSync/existsSync` ȫ�� `fs.promises`��??6�� | `src/main/ipc/misc-handlers.ts` `image:persist-chat` + ���� `isNonEmptyFile()` |

### ?? ������

| # | ���� | ��� |
|---|---|---|
| 1 | **����**�����Ը�Ϊ `import { filePathToMediaUrl }` ֱ������Ⱦ�˺�����ɾ�����ظ��̵ı���ģ�壻�ļ�����ע��˵�����������̡������� | `tests/local-media-url/program.ts` |
| 2 | **����**��`parseMediaUrlPath` ��������`isAbsolute()` ����ܡ�`..` �ξܣ�����б�ܣ���UNC �ܣ�`\\` �� `//` ����ǰ׺������ 6 ������ | `src/main/lib/local-media-url.ts` + ���� ��2b |
| 3 | **����**�����׷�֧�� `stat()`���� `MAX_FALLBACK_BYTES`��64 MB������ 413 �� warn | `src/main/lib/local-media-protocol.ts` |
| 4 | **����**����ģ�鼶 `readBinaryFileViaIpc: ReadBinaryFileFn`�����õ�ֻ�������� | `src/renderer/src/hooks/use-chat-actions.ts` |
| 5 | **����**��`attachChatImagePaths` ������ `filePath` �Ŀ�ֱ�Ӷ�·���༭�ط�����Ϊͬһ��ͼ�ش�һ�� base64����ȡ�᣺���μ���·�����ļ����ⲿɾ��ʱ�ߡ���ͼ���������� ���� �ó������������ݿɻָ� | `src/renderer/src/lib/image-persist-chat.ts` |
| 6 | **����**���� ?1 ͬ���� | ͬ�� |
| 7 | **����**������ `chatImageFileNameFromBuffer(buffer, mediaType)`��handler ��һ�� buffer ������ϣ��д�̣�`chatImageFileName(base64)` ����Ϊ����װ | `src/main/lib/chat-image-dir.ts` |
| 8 | **����**���Է����Ի��ɡ������еķǹ淶 base64���ı���ͬ���ֽ���ͬ ? ͬ����������ǰ�ö��Զ�ס���ı�ȷʵ��ͬ�� | `tests/chat-image-dir/program.ts` ��4 |
| 9 | **���ִ���**��`attachChatImagePaths` �� 5 ����ԣ��ɹ���·���ұ��� data / ���쳣���� / ���� error ���� / ����·����· / ���ο鲻�ף����� +19 ���ԡ�**`serializeMessage` �˵��˶���δ��**�������� `workerRequest` �� `ipcClient` �� `window.electron`��node �����������������屾������ `stripImagePayloads` �� 23 ��ǣ��������õ�ֻ�ܿ� `db-helpers.ts:132/133/136` �� code review ��ס��**�������ռ��� tech-debt**��`db-helpers` �� DB ����װ��ȱ��ע��Ĵ���㣬���¡������û�нӴ����޷����Զ�����ס�� | `tests/image-payload/program.ts` ��6 |
| 10 | **����**��`isImageBlock` �� `!!block && typeof block === 'object' && block.type === 'image'`�������ƽ� `try` | `src/renderer/src/lib/image-persist-chat.ts` |
| 11 | **����**��hydrate ������ǰ�����أ�`imageAttachments.length > 0 && hydratedAttachments.length === 0 && !messageText.trim()` �� warn + `return false` | `src/renderer/src/hooks/use-chat-actions.ts` |

### ?? �۲�

| # | ���� |
|---|---|
| 1 | **����**��ע��·������Ϊ `src/main/lib/local-media-protocol.ts` |
| 2 | **��¼����**��`protocol.handle` ע���� default session��Զ��ҳ���̽�Ȿ���ļ��Ƿ���ڡ���ǰ `BrowserPanel` ��Զ��ҳ��Ĭ�ϲ��� partition �ų������Ҷ��������ݣ��ӹ̣�У�� `referrer` ��ר�� partition�������������� |
| 3 | **��¼����**��`filePath` ����Ⱦ�������ֶΣ�Э��ֻ����չ���ѹء���ǰ��Ⱦ�˿��ţ����ɽ������ |
| 4 | **�Ѳ�ע��**��`areImageAttachmentsEqual` �ȶ� `filePath` ��˵��������ͬһ��ͼ����·�� �� ��·����������ȶ��������̡� |
| 5 | **��¼����**��hydrate ���� `for...of await`��������ͼʱ������������ 20 MB ͼ�ķ�ֵ�ڴ���ո���������ʵ�������ٶ� |
| 6 | **�Ѽ�¼**��`index.ts` 495 �У���Ӳ�� 5 �У��´��ٶ��Ȳ���ȹһ���ͷ |
| 7 | ��д�� `docs/data-storage.md`���޶��� |

### ���ú��Ž���2026-10-26 ���ܣ�

| ���� | ��� |
|---|---|
| `npm run typecheck` | 0 ���� |
| `npm test` | **83/83 ͨ��** |
| `npm run test:local-media-url` | 44 ����� |
| `npm run test:chat-image-dir` | 18 ����� |
| `npm run test:image-payload` | 33 ����� |
| `dotnet build src\runtime\WishfulClaw.sln` | 0 ���� 0 ���� |
