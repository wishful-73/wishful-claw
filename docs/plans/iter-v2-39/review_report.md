# iter-v2-39 阶段五代码审查报告

❌ 0 项 / ⚠️ 11 项 —— **可进入验证态**

> 审查范围：`git diff 2c925c88..HEAD`（分支 `dev/v2-iter-39`，HEAD = `f111da66`，62 个文件，+2744 / −695）。
> 判定基准：`docs/plans/iter-v2-39/plan.md` + `requirements/S-182.md` ~ `S-188.md` + `plan-s182/` ~ `plan-s188/`。
> 只读审查：未改动任何代码/文档，未执行 git 写操作，未跑构建与测试。

---

## 审查项结论速览

| # | 审查项 | 结论 | 关键证据 |
|---|---|---|---|
| ① | 分层约定（反反向依赖） | ✅ 合规 | 新增 C# 全在 `WishfulClaw.Agent`；渲染端新增 `lib/tools/project-session-queue.ts` 只依赖 `@renderer/stores` / `@renderer/hooks`（同层）；`native-agent-runtime.ts` 仅增字符串常量 |
| ② | 硬编码 | ⚠️ 2 处 | 加速站域名**已集中**（`content/site.ts:26-32`）；但 `scripts/site-stats.mjs:22` 硬编码服务器 IP、`go-page.tsx:14` 开放重定向（见 ⚠️1 / ⚠️2） |
| ③ | **S-188 桥路方法名四处登记一致性** | ✅ **全部一致，无漏登记** | 见下方「S-188 四处登记逐名对照」 |
| ④ | 错误处理（三态 + 假成功） | ✅ 三态齐全，无假成功 | 会话不存在 / 队列为空 / 无运行流 —— 三态各有独立返回值，见 S-188 节 |
| ⑤ | 多余依赖 | ✅ 零新增 | `git diff --stat` 中**无** `package.json` / `*.csproj` 改动 |
| ⑥ | 需求符合度 | ✅ 7/7 达标 | 逐条见下 |

---

## S-188 四处登记逐名对照（审查项③ —— 本迭代最脆的一环）

**结论：4 个工具名 × 4 个登记点，拼写逐字符一致，无漏登记、无错拼。**

| # | 登记点 | 位置 | 实际字符串 |
|---|---|---|---|
| 1 | C# 工具定义 | `src/runtime/WishfulClaw.Agent/Tools/Providers/ProjectToolsProvider.cs:135 / :152 / :170 / :185` | `get_session_queue` / `remove_session_queue_message` / `clear_session_queue` / `stop_session_run` |
| 2 | C# 工具名集合 | `src/runtime/WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs:24-25`（`ProjectToolNames` HashSet） | 同上 4 个 |
| 3 | C# 执行分支 | `AgentRuntimeProjectExecutor.cs:47-50`（`ExecuteAsync` switch） | `"get_session_queue" => GetSessionQueueAsync` 等 4 条 |
| 4 | C# 反向请求方法名 | `AgentRuntimeProjectExecutor.cs:402 / :430 / :456 / :482` | `project/session-queue` / `project/remove-session-queue-message` / `project/clear-session-queue` / `project/stop-session-run` |
| 5 | 主进程白名单 | `src/main/ipc/native-agent-runtime.ts:222-225`（`rendererMethods`） | 与第 4 列**逐字符一致** |
| 6 | 桥接分支 | `src/renderer/src/lib/ipc/renderer-tool-bridge.ts:164 / :173 / :182 / :191` | 与第 4 列逐字符一致 |
| 7 | 桥接 import | `renderer-tool-bridge.ts:10-13` | `handleProjectGetSessionQueue` / `handleProjectRemoveSessionQueueMessage` / `handleProjectClearSessionQueue` / `handleProjectStopSessionRun` |
| 8 | Handler 导出 | `src/renderer/src/lib/tools/project-session-queue.ts:68 / :113 / :153 / :181` | 与第 7 列同名，全部 `export async function` |

**旁证（handler 依赖的 API 全部真实存在，不会运行时报错）**：

- `use-chat-actions.ts:297 / :772 / :836 / :847 / :943` 分别导出 `clearPendingSessionMessages` / `getPendingSessionMessages` / `isPendingSessionDispatchPaused` / `removePendingSessionMessage` / `hasActiveSessionRunForSession` —— 与 `project-session-queue.ts:21-27` 的 import 逐名对上；
- `stores/chat-store/db-helpers.ts:632` 导出 `dbGetSession` —— 与 `project-session-queue.ts:20` 对上；
- `stores/chat-store/index.ts:161 / :541` 声明并实现 `cancelStream(targetSessionId?)`；`streamingMessages: Record<string, string>`（`streaming-slice.ts:13`）—— 与 `project-session-queue.ts:199` 的 `useChatStore.getState().streamingMessages[sessionId]` 对上。

---

## S-182 官网侧统计 —— 记录「下载次数」与「访问次数」

VERDICT: **PASS**

**证据**

- 本地报表脚本：`scripts/site-stats.mjs`（新增 117 行）—— SSH 拉 `/data/stats/summary.json` + `????-??-??.json` 逐日，支持 `--days N` / `--json`；取不到时给可执行提示（`:84-88`），失败不崩。
- 前端展示：`website/src/lib/site-stats.ts` —— `fetch('./stats.json', { cache: 'no-store' })`，失败**静默不显示**（不显示 0、不报错），符合需求「数字是锦上添花」；`MIN_VISIBLE_COUNT = 100`（`:23`）落地 §五 第 6 条「不足 100 次先不显示」。
- 留档：`docs/release-workflow.md`（+47 行）。
- 口径「两个日志源各自去重后相加」由 `/go` 中转页（S-186）在结构上保证正交 —— 加速站点击只进 `clicks`。

**⚠️ 见 ⚠️2、⚠️10。**

---

## S-183 项目档案页 —— 内容区缺少高度约束

VERDICT: **PASS**

**证据**（逐条对照 requirements §四「修复方向」）

| 需求 §四 要求 | 实际代码 | 判定 |
|---|---|---|
| 第 2 层进入 flex 高度链：`mx-auto` + `max-w` + `flex-1` + `min-h-0` + `flex-col` | `ProjectArchivePage.tsx:251` = `mx-auto flex min-h-0 w-full max-w-[1480px] flex-1 flex-col` | ✅ 逐类一致 |
| 同层 `shrink-0` 保证内容区拿到剩余高度 | `:253`（header）、`:396`（人格按钮组）、`:411`（预览区标题行）均 `shrink-0` | ✅ |
| tab 内容区 `flex min-h-0 flex-1 flex-col overflow-hidden` | `:350` 完全一致 | ✅ |
| 人格档同受影响 → 一并修 | `:369` / `:395` / `:410` 三层均带 `min-h-0 flex-1` 与 `overflow-hidden` | ✅（覆盖需求 §六 第 2 问「人格档是否也在现象内」） |
| 页面外层仍保持 `overflow-hidden`（不引入整页滚动条） | `:250` 保留 `overflow-hidden` | ✅ |

**未实测**：需求 §五 的实机验证（出滚动条 / 底部可达 / 矮窄窗口）留到验证态，本报告只做静态判定。

---

## S-184 项目人格 —— 无法点击切换查看、无法删除

VERDICT: **PASS**

**B（无法切换查看）**

- 新增选中态：`ProjectArchivePage.tsx:65` `selectedPersonaId`；
- 预览跟随点击：`:125-128` `selectedPersona = personas.find(p => p.id === selectedPersonaId) ?? personas[0] ?? null` —— 替代原硬编码 `personas[0]`，且**回落逻辑与需求 §五 验证表第 4 条**（「删掉当前选中项后预览回落」）**一致**。

**C（无法删除）**

- `:133-164` `handleDeletePersona`：`confirm({ variant: 'destructive' })` → 文案 `将从本项目删除「{{name}}」，全局人格与内置预设不受影响。` —— **与需求 §五 验证表第 2 条记录的实测文案逐字一致**；
- 删除后 `setSelectedPersonaId(null)` + `loadPersonas()` + `usePersonaStore.getState().listPersonas(...)` 回灌设置页（`:155-158`），避免两处列表不一致（正对需求 §二 D「两处人格列表语义不一致」）；
- `:159-161` 失败路径 `setPersonaError` —— 不吞异常。

**⚠️ 见 ⚠️7（偏离需求 §四 指定的 `persona/delete`）。**

---

## S-185 24 个内置 preset 文件精简

VERDICT: **PASS**

**证据**

- 改动面 = 24 个文件（6 preset × 4 文件）：`+168 / −197` 行；
- 总量 **15,435 → 11,344 字符（73.5% / −26.5%）**，落在 plan-s185 §八 第二轮自设目标「压到原基线 60%~75%」**区间内**；
  > ⚠️ **口径订正（2026-10-14，验证态复算）**：15,435 是「基线字符 **+ 709 个 CRLF**」（工作区口径），11,344 是「归一 LF 后的字符」—— **两个数不是同一口径，混算了**。同口径复算：**14,726 → 11,344 = −23.0%（LF↔LF）**、**15,435 → 12,028 = −22.1%（CRLF↔CRLF）**。**结论不变**（需求 §一 明文「不设压缩指标」），但下游按 26.5% 验收会误判 ⇒ 以 **−23.0%** 为准。S-185 的 commit message 仍留原口径（改它需重写迭代 hash 链，代价大于收益）。
- 抽样精读 `lao-zheng/ONTOLOGY.md`（最大人格，唯一在 1,226 字符档的那份）：删的都是**整句**而非同义词替换（例：`核心功能是跟兄弟一起干活，不是被动等指令。会主动思考…是并肩的工程师，不是手底下的执行者。` → `核心是跟兄弟一起干活，会主动思考…提个醒。`）；**章节标题层级零破坏**，「能做 / 做不到」清单、「价值观」5 条、「诚实性」三删改项**均在**；**未发现新增意思**。
- 硬约束自洽：需求 §三「不允许」5 条（不新增意思 / 不改人格取向 / 不压成含糊表述 / 不破结构 / default 除外）与 `default` 78.9% 的偏差说明（plan §八 已回填）一致。

**⚠️ 见 ⚠️9（压缩比低于 plan 自设参考区间、语义等价仅能抽样）。**

---

## S-186 下载按钮改走 GitHub + 国内加速站

VERDICT: **PASS**

**证据**（逐条对照 requirements §四「变化点」+ §五「必须保留」）

| 要求 | 实际 | 判定 |
|---|---|---|
| `releaseFileUrl` 语义改 GitHub 直链 | 新增 `githubDirectUrl()`（`latest-yml.ts:70-72`）= `{GITHUB_RELEASES_BASE}/v{version}/{setupFile}`；`releaseFileUrl` 保留但**只服务「本站直链」**（`:59-63`） | ✅ |
| 新增加速站前缀拼接 | `acceleratedUrl(prefix, direct)`（`:75-77`），`prefix` 为空原样返回 | ✅ |
| Windows 改「主按钮 + 源选择」 | `download-buttons.tsx:32-111` `WindowsDownload`：主按钮 = `downloadSources[0]`，右侧圆按钮展开 `role="menu"` | ✅ |
| **下拉保留「本站直链」**（口径 c） | `:103` `<a href={local} download>` 「本站直链 / 服务器带宽小，较慢」 | ✅ |
| 加速站 `href` **不直指第三方**，先到 `/go?src=&u=`（口径 b） | `:63` 主按钮 + `:93` 5 个菜单项全部走 `goUrl()`（唯一例外是本站直链）；`goUrl()`（`latest-yml.ts:85-86`）用 `encodeURIComponent` 编码 src 与 u | ✅ |
| 加速站清单作为常量 | `content/site.ts:26-32` `downloadSources`（5 项：4 加速站 + GitHub 直链，顺序按实测可用性，失效项 `note: '当前不可用'`） | ✅ **集中可维护** |
| 中转页 4 处落点 | `website/go.html`（+16）· `website/src/go-main.tsx`（+10）· `go-page.tsx`（+49）· `vite.config.ts`（+8，PAGES + rollup input 加 `go`） | ✅ |
| 版本号/文件名仍从官网 `latest.yml` 读 | `parseReleaseManifest` 未改语义 | ✅ |
| macOS / Linux 置灰逻辑不动 | `PlatformButton:125-138` 占位分支与改动前同构 | ✅ |
| **软件内更新链路零改动** | 主仓业务代码零改动（`git diff --stat` 可证）；express `latest.yml` 只被读、未被改写 | ✅ |
| 来源说明（§五 第 4 条） | `:151-155` 页脚小字「下载由第三方公益加速站提供；若某个源不可用，请点右侧箭头换一个。」 | ✅ |

**⚠️ 见 ⚠️1、⚠️6。**

---

## S-187 右侧面板 Git 选项卡收敛成单一 SCM 列

VERDICT: **PASS**

**证据**（逐条对照 requirements §四「6 条口径」+ §五「落地方案」）

| 口径 | 要求 | 实际 | 判定 |
|---|---|---|---|
| 1 | 三栏并排不要 | `GitPage.tsx` 容器内**只剩** `<ScmSidebar>`（`:333`）；内联「diff 区 + 文件历史」整块已删 | ✅ |
| 2 | 阈值不留 | `GIT_PAGE_COMPACT_MAX_WIDTH` / `compact` / `ResizeObserver` 在 `components/chat/GitPage/*.tsx` 全仓 **Grep 零匹配** | ✅ |
| 3 | 文件历史改弹窗，入口 = 右键文件 | `GitPage/utils.tsx:201-293`：`ScmFileRowView` 包 `ContextMenu` + `ContextMenuTrigger` + `ContextMenuItem onSelect={onShowHistory}`；新增可选 prop `onShowHistory?`（`:193`）/ `historyLabel?`（`:195`）。**单点改动** ⇒ conflict / staged / unstaged 三处同时生效 | ✅ |
| 3 附带 | **弹窗里的内容保留，不动它** | `GitPage/git-diff-dialog.tsx` 仅 `+9 / −1`（补 `listTitle?` / `listFooter?` 两个**可选**槽），历史列表与 patch 逻辑**原样照搬** | ✅ |
| 4 | 未跟踪目录下的文件也要列出来 | `GitStatusTools.cs` 单行加 `--untracked-files=all` | ✅ |
| 5 | 布局统一为「只有 SCM 一列」，diff 与历史全走弹窗 | `GitPage.tsx:389`（工作区 diff 弹窗）+ `:405`（历史弹窗）两个 `GitDiffDialog`，各有独立 `open` / `onOpenChange` | ✅ |
| 6 | **不设条目上限**（高了走滚动条） | `GitPage.tsx` 与 `GitPage/*` 中 `slice(` / 截断上限 **Grep 零匹配** | ✅ |
| §五2 | `hooks/use-git-panel-split.ts` 整个删除 | diff stat：`src/renderer/src/hooks/use-git-panel-split.ts | 58 ---`（纯删）；`useGitPanelSplit` 全仓零引用 | ✅ |
| §五4 | `ScmSidebar` 删 `compact` / `scmWidth` prop 与 resize 手柄 | `ScmSidebar.tsx` `+32 / −`，`compact` / `scmWidth` 在 `GitPage/*` Grep 零匹配 | ✅ |

**⚠️ 见 ⚠️8（`git-history-dialog.tsx` 未新建，改复用 diff 弹窗外壳）。**

---

## S-188 全局 PM 对项目会话队列的观测与干预

VERDICT: **PASS**

**③ 四处登记**：见上文专项，**无漏登记**。

**④ 错误处理三态（本审查项核心）** —— `src/renderer/src/lib/tools/project-session-queue.ts`：

| 态 | 触发条件 | 返回 | 判定 |
|---|---|---|---|
| **会话不存在** | `ensureSessionExists()`（`:63-66`，`store.sessions` ∪ `dbGetSession`）为假 | `{ success: false, found: false, error: 'Session "x" does not exist.' }`（4 个 handler 各自返回，`:73-80` / `:120-127` / `:158-165` / `:186-193`） | ✅ 不误报为空队列（`:59-62` 注释明说「reported as `found: false` rather than as an empty queue」） |
| **队列为空** | `getPendingSessionMessages(sid).length === 0` | `get_session_queue` → `success: true` + `result: '…has no queued messages.'`（`:89-92`）；`clear_session_queue` → `success: true` + `cleared: 0` + `'…had no queued messages.'`（`:173-177`） | ✅ **不是假成功** —— 如实报 0 条，且不谎称「已清空 N 条」 |
| **没有可取消的流** | `streamingMessages[sessionId]` 为空（`:199`） | `{ success: false, found: true, error: 'Session "x" has no running turn to stop.' }`（`:200-207`） | ✅ **不谎报「已停止」**；`:195-198` 注释说明为何刻意用**与 `cancelStream` 完全相同的判据**（否则会报告一次没发生的停止） |
| 撤销不存在的 id | `removePendingSessionMessage()` 返回 false | `success: false` + `'Queued message "m" was not found in session "x". Call get_session_queue for the current ids.'`（`:130-140`） | ✅ 且给了自纠指引 |
| 缺参 | 缺 `sessionId` / `messageId` | `'Missing required field(s): …'`（`:70-72` / `:117-119` / `:155-157` / `:183-185`） | ✅ |

**「停止只停本轮、队列保留」（需求 §二裁定）**：

- `handleProjectStopSessionRun` 只调 `await useChatStore.getState().cancelStream(sessionId)`（`:209`）—— **不调** `clearPendingSessionMessages`；返回文案明说 `${queued} queued message(s) are kept`（`:219-222`）⇒ **队列保留** ✅。
- ⚠️ 但「派发照旧 / 不暂停派发」与实现不符，见 ⚠️3、⚠️5。

**分层（审查项①）**：C# 新增全部落在 `WishfulClaw.Agent`（`Tools/Providers/ProjectToolsProvider.cs`、`AgentRuntimeProjectExecutor.cs`）；渲染端唯一新文件在 `renderer/src/lib/tools/`，只 import `@renderer/stores/*` 与 `@renderer/hooks/*`（**同层**），**未** import main / C# 侧 ⇒ 无反向依赖 ✅。

**需求 §六 影响面表复核**：表中列了 `AgentRuntimeReverseRequests.cs` 与 `ToolDispatchRouter.cs` 两处改动，**实际两文件在本迭代零改动且无需改动** —— `AgentRuntimeReverseRequests.RequestAsync(context, "<method>", params, ct)` 按**方法名字符串**通用转发（见 `AgentRuntimeProjectExecutor.cs:401-402`）；`ToolDispatchRouter.cs:463-478` 只判断 `AgentRuntimeProjectExecutor.IsProjectTool(toolCall.Name)`，而 `IsProjectTool` 走 `ProjectToolNames` 集合（已扩到 4 个新名字）⇒ 路由自动覆盖。**不构成本次缺陷**，但需求文档高估了改动面（⚠️4）。

---

## ⚠️ 清单（逐条，按严重度降序）

**⚠️1（安全 · 中）`website/src/go-page.tsx:13-14`** —— `/go` 中转页对 `u` 参数**只校验 `https://` 前缀**，无主机白名单：

```ts
const target = rawTarget.startsWith('https://') ? rawTarget : ''
useEffect(() => { if (target) window.location.replace(target) }, [target])
```

⇒ 官网域名下存在**开放重定向**（`https://wishful-claw.work/go?u=https://evil…` 可被用作「官网已信任」的钓鱼跳板；虽挡掉了 `javascript:` / `data:`，但任意 https 站点均可）。
**建议**：加目标白名单 —— `const allowed = target.startsWith(GITHUB_RELEASES_BASE)`，不匹配则走「下载链接无效」分支（该分支已存在，`:35-46`）。

> **✅ 已消解（2026-10-11，`bf4bd16f`）** —— 修法比本建议**更彻底**：**直接把 `u` 参数删掉**，`/go` 只接受源名 `src`，目标直链由页面自己读 `latest.yml` 拼（`go-page.tsx:6-15`、`:31-36`）。`src` 瞎填也只会回落默认源 ⇒ **URL 再也决定不了跳去哪**，无需再加白名单。详见 [`requirements/S-186.md`](requirements/S-186.md) §9.1。

**⚠️2（硬编码 · 低）`scripts/site-stats.mjs:21-27`** —— 服务器配置硬编码进版本库，且与 `scripts/deploy.mjs` 重复一份：

```js
const CFG = { sshHost: '119.45.103.252', sshUser: 'ubuntu', sshKey: join(homedir(), '.ssh', 'wishfulclaw_deploy'), statsDir: '/data/stats' }
```

注释（`:9-10`）已说明「deploy.mjs 不入版本库，故自包含一份」——取舍可理解，但**服务器 IP 进了仓库**，且两处未来必然漂移。
**建议**：抽 `scripts/site-config.mjs`（或 `.env` + 默认值），两侧共用；密钥路径已用 `homedir()` 拼装、无明文密钥 ✅。
**附带观察**：`SSH_OPTS` 含 `-o StrictHostKeyChecking=accept-new`（`:29`）—— 首次连接自动接受指纹，内网工具可接受，记此备查。

**⚠️3（口径不符 · 中）`docs/plans/iter-v2-39/requirements/S-188.md:31` ↔ `src/renderer/src/lib/tools/project-session-queue.ts:195-224`** —— 需求 §二 写：

> 「**只停当前这一轮运行**（`cancelStream(sessionId)`），**队列保留、派发照旧** … **不丢队列、不暂停派发。**」

而 `cancelStream` 内部本身就会 `pausePendingSessionDispatch(sessionId)` ⇒ 实际行为是「**队列保留、派发暂停**」。实现侧文案（`:219-222`）也如实写 `their dispatch is now paused — exactly what happens when the user presses stop in the UI`。
**定性**：实现走的是需求**自己指定的落点**（§二 明写「对应落点：`useChatStore.getState().cancelStream(sessionId)`」），且**未直接调用** `pausePendingSessionDispatch`（符合「不碰」的字面），**语义与 UI 停止按钮完全一致** ⇒ **非代码缺陷，是需求原文对 `cancelStream` 既有行为的描述有误**。
**建议**：回改需求 §二 那句为「队列保留、**派发暂停**（与 UI 停止按钮同款）」，避免下游按「派发照旧」验收而误判。

**⚠️4（文档偏差 · 低）`requirements/S-188.md:168-169`** —— §六 影响面表列出 `AgentRuntimeReverseRequests.cs`（「新增反向请求类型」）与 `ToolDispatchRouter.cs`（「登记新工具名」）两处改动，**两文件本迭代零改动**且**无需改动**（理由见上「需求 §六 影响面表复核」）。
**建议**：更正需求文档，避免后续迭代照抄这张表去做无用改动。

**⚠️5（功能覆盖 · 中 · 待实测）`project-session-queue.ts:209-223`** —— 停止后队列派发处于**暂停**态，而 PM 侧**没有「恢复派发」的工具**（本迭代只加了读 / 撤 / 停三类）；返回文案承诺 `You can send the session a new message now.`，但「**发一条新消息是否会自动恢复旧队列的派发**」**未在代码中验证**（`send_session_message` → `project-send-message.ts` 是否触达 `dispatchNextQueuedMessageForSession` 未查）。
**建议**：验证态必测 —— 「停 → 发新消息 → 旧队列是否继续派发」。若不自动恢复，需求 §二「停完之后 PM 还能（也应该能）重新发消息给这个会话」只兑现了一半。

**⚠️6（跨域行为 · 中 · 需求自标「必测」）`website/src/components/download-buttons.tsx:60-63 / :90-98`** —— 主按钮与 4 个加速站项**均不挂 `download` 属性**（跨域时浏览器本就忽略），文件名改由对方 `Content-Disposition` 决定。需求 §五 第 5 / 6 条明写「**开工时必测**」、S-186 §八 亦登记为已知限制。
**建议**：验证态用真实安装包复测「加速站是否透传 `Content-Disposition`」；若不透传，点击会变成**页面导航**而非下载（后果已登记，但需实测确认当前 2 个可用源的行为）。

**⚠️7（偏离需求指定落点 · 低）`src/renderer/src/components/chat/ProjectArchivePage.tsx:130-133 / :152`** —— 需求 §四 明确「**不涉及 C# 侧** —— 删除直接走已有的 `persona/delete`（`PersonaModule.cs:123-143`），本身就支持 `workingFolder`」，实现改走 `IPC.FS_DELETE`：

```ts
// S-184 (C): delete the selected project persona. This goes through the local fs channel
// rather than persona/delete because an SSH project's personas live under
// ~/.wishful-claw/projects/{id}/personas, which persona/delete(workingFolder) cannot address.
await ipcClient.invoke(IPC.FS_DELETE, { path: joinFsPath(personasDir, selectedPersona.id) })
```

**定性**：SSH 项目场景下的偏离**理由充分且注释完整**；删除路径由 `listDir` 真实目录名拼成（无用户输入成分），无路径穿越风险；删除后已回灌 `usePersonaStore.listPersonas()`。
**残留风险**：绕过了 `PersonaStore.DeletePersona` 的**内置 preset 保护与全局/项目作用域判定**（需求 §三 开放问题 1 提到该保护「只在全局作用域生效，项目层可删」—— 所以本次语义上一致，但**保护逻辑被旁路**，未来若 `DeletePersona` 增强校验，这里不会跟随）。
**建议**：在 requirements/plan 里回填该偏离与理由（当前只写在代码注释里）。

**⚠️8（偏离计划 · 低）`requirements/S-187.md:131`** —— 计划「**新建** `GitPage/git-history-dialog.tsx`（照 diff 弹窗样式）」，实际改为**复用** `GitPage/git-diff-dialog.tsx` 并补 `listTitle?` / `listFooter?` 两个可选槽。需求 §7.1 已回填（「未新建 —— 改为复用」），`git-diff-dialog.tsx` 的 diff 仅 `+9 / −1` ⇒ 口径 3 附带「弹窗里的东西保留，不动它」**确实兑现**。
**建议**：requirements 正文（§五 表第 6 行）与 §7.1 目前口径不一，统一到「复用」一侧。

**⚠️9（质量 · 低）24 个人格文件** —— 压缩比 **−26.5%**（混口径；同口径复算 **−23.0%**，见本节证据段订正），低于 plan-s185 §五 自设的「参考量级 **30%~45%**」（需求 §一 明文「**不设压缩指标**」，且 `default` 78.9% 属 §三 允许的「明显更低」⇒ **不构成 FAIL**）。抽样 `lao-zheng/ONTOLOGY.md` 未见新增意思，但删的是**整句**，存在「该句在别处无落点 ⇒ 意思静默丢失」的残余风险，例：

- `- **技术搭档，不是工具**：…是并肩的工程师，不是手底下的执行者。` 中「不是工具」「是并肩的工程师，不是手底下的执行者」两处被删；
- `- **思考方式**：…不靠直觉瞎猜。但信息不够时也敢拍板，先干了再调。` 中「信息不够时也敢拍板」被删。

**建议**：plan §五 **步骤 6（实机观感）目前仍是未勾选状态** —— 验证态挑 `lao-zheng` + `default` 实跑，确认说话风格与行为准则没走样；这是唯一能兜住「意思不变」这条硬约束的手段。

**⚠️10（验证范围 · 中）** —— S-182 与 S-186 的 **b 半边（服务器侧）不在版本库**：nginx snippet 的 `/downloads` 独立日志 + `/go` 的 `location = /go` 与 `wishfulclaw-clicks.log`、root crontab 的 `wishfulclaw-stats.sh`、`/data/stats/` —— 全部按设计不入库（需求 §六 第 2 条：防换机器即丢 ⇒ 已留档 `docs/release-workflow.md`）。
**⇒ 本迭代「官网统计」这条链路无法仅凭代码判定可行性**（只能确认本地脚本与前端读取侧正确）。
**建议**：验证态必须在服务器上确认三点 —— ① `/data/stats/summary.json` 存在且 `downloads_total` / `visits_total` / `sources.*` 字段名与 `site-stats.ts:36` / `site-stats.mjs:90-95` 的读取键**一致**；② `/stats.json` 已 alias 到该文件；③ `/go` 请求确实落进 `clicks` 日志。

**⚠️11（输出体积 · 低）`project-session-queue.ts:95-99`** —— `get_session_queue` 把每条消息的 id 与文本预览**拼成字符串**塞进 `result`：

```ts
// Message ids ride along in the text: the C# side only forwards `result`.
const detailLines = messages.map((m, i) => `[${i + 1}] id=${m.id} text=${JSON.stringify(m.text)}`)
```

同时返回的 `messages` 数组在 C# 侧被 `FormatToolReverseResult` 丢弃。单条预览已限 `TEXT_PREVIEW_LIMIT = 200`（`:30`），但**条目数无上限**（队列本身无上限，S-187 口径 6「不设条目上限」的精神同源）⇒ 队列长时工具输出线性膨胀。
**建议**：要么 C# 侧改透传 JSON（结构不丢），要么对 detailLines 设条目上限 + 「另有 N 条」摘要。

---

## 正面记录

- **S-188 是本迭代风险最高的一环（四处登记跨 4 个文件、2 种语言），登记点 8 处 × 4 个名字全部逐字符一致，无一处漏登记** —— 这是同类改动里最容易翻车的地方，本次零失误。
- 反向请求的**三态错误处理设计克制**：刻意复用 `cancelStream` 自己的判据（`streamingMessages[sid]`）而非更宽的 `hasActiveSessionRunForSession`，避免报告「一次没发生的停止」；`clear` 空队列如实返回 `cleared: 0` 而不伪造成功。
- 新增代码的**注释密度与决策留痕**质量高（`ensureSessionExists` 为何区分 `found` / 空队列、`WindowsDownload` 为何光效只挂主按钮、`go-page` 为何不裸 302），后续维护成本低。
- **零新增依赖**（无 `package.json` / `*.csproj` 改动），符合沉淀迭代的定位。
- **删除干净**：`use-git-panel-split.ts` 整文件删除且全仓零残留引用；`compact` / `scmWidth` / `ResizeObserver` 在 GitPage 目录零残留。
- 加速站域名**集中为一份常量**（`content/site.ts:26-32`）并带「顺序即下拉顺序 + 失效项标注」的维护约定，正是审查项②想要的形态。

---

## 汇总表

| # | 级别(❌/⚠️) | 位置(文件:行号) | 问题 | 建议 |
|---|---|---|---|---|
| 1 | ⚠️ | `website/src/go-page.tsx:13-14` | `/go` 中转页对 `u` 参数只校验 `https://` 前缀，无主机白名单 ⇒ 官网域名下开放重定向 | 加 `target.startsWith(GITHUB_RELEASES_BASE)` 白名单，否则走「下载链接无效」分支 |
| 2 | ⚠️ | `scripts/site-stats.mjs:21-27` | 服务器 IP / 用户 / 目录硬编码进版本库，与 `deploy.mjs` 重复一份配置 | 抽 `scripts/site-config.mjs` 共用；密钥路径已用 `homedir()`，无明文密钥 |
| 3 | ⚠️ | `requirements/S-188.md:31` ↔ `lib/tools/project-session-queue.ts:195-224` | 需求写「派发照旧 / 不暂停派发」，实际 `cancelStream` 会暂停派发 ⇒ 需求描述与既有行为不符 | 回改需求为「队列保留、派发暂停（与 UI 停止按钮同款）」；代码无需改 |
| 4 | ⚠️ | `requirements/S-188.md:168-169` | §六 影响面表列了 `AgentRuntimeReverseRequests.cs` / `ToolDispatchRouter.cs`，实际两文件零改动且无需改动 | 更正需求文档，避免后续照抄做无用改动 |
| 5 | ⚠️ | `lib/tools/project-session-queue.ts:209-223` | 停止后派发被暂停，PM 侧无「恢复派发」工具；「发新消息是否自动恢复派发」未验证 | 验证态实测「停 → 发新消息 → 旧队列是否继续派发」 |
| 6 | ⚠️ | `website/src/components/download-buttons.tsx:60-63 / :90-98` | 跨域后 `download` 属性失效，文件名交由对方 `Content-Disposition`；需求自标「开工时必测」 | 用真实安装包复测 2 个可用加速站是否透传 `Content-Disposition` |
| 7 | ⚠️ | `components/chat/ProjectArchivePage.tsx:130-133 / :152` | 需求 §四 指定走 `persona/delete`，实现改走 `IPC.FS_DELETE`（绕过 `DeletePersona` 的内置预设保护与作用域判定） | 偏离理由充分且已注释；建议回填到 requirements/plan |
| 8 | ⚠️ | `requirements/S-187.md:131` vs `GitPage/git-diff-dialog.tsx`(＋9/−1) | 计划新建 `git-history-dialog.tsx`，实际改为复用 diff 弹窗外壳 + 两个可选槽 | 需求 §五 表与 §7.1 口径不一，统一到「复用」 |
| 9 | ⚠️ | `src/runtime/WishfulClaw.Persona/Resources/Personas/**`（24 文件） | 压缩 −26.5%（混口径，同口径 **−23.0%**），低于 plan-s185 自设参考区间 30%~45%；整句删除的「意思不变」只能抽样验证 | 执行 plan §五 步骤 6 实机观感（`lao-zheng` + `default`），确认行为准则未走样 |
| 10 | ⚠️ | nginx snippet / crontab / `wishfulclaw-stats.sh` / `/data/stats/`（**不在版本库**） | S-182 与 S-186-b 的服务器半边无法凭代码验证 | 验证态在服务器确认 `summary.json` 字段名与读取侧一致、`/stats.json` 已 alias、`/go` 已进 `clicks` 日志 |
| 11 | ⚠️ | `lib/tools/project-session-queue.ts:95-99` | `get_session_queue` 把 id/预览拼成文本（`messages` 数组被 C# 侧丢弃），条目数无上限 ⇒ 队列长时输出膨胀 | C# 侧改透传 JSON，或对明细行设上限 + 「另有 N 条」摘要 |

---

**结论（第一轮范围 S-182 ~ S-188）：❌ 0 项 / ⚠️ 11 项 —— 可进入验证态。**

---

## 补充轮 · S-189 ~ S-202 审查索引（2026-10-14 收尾补记）

> 本报告主体是**第一轮**（截至 HEAD `f111da66`，覆盖 S-182 ~ S-188），体例为「逐需求详节」。**S-189 起改为「逐需求独立报告」** —— 审查报告落在各 `plan-s*/review_report.md`，本节只做索引与结论汇总。
> 口径：**「❌」= 阻断项（必须修）**；已修复的标「（已修）」。

| 编号 | 审查报告 | 结论 | 关键项 / 处置 |
|---|---|---|---|
| **S-189** | [`plan-s189/review_report.md`](plan-s189/review_report.md) | **❌ 1（已修）/ ⚠️ 4** | ❌ = S-115 回归夹具 `CreateSessionInsertTests.cs` 的 legacy `CREATE TABLE sessions` 缺 `scope` 列 ⇒ `npm test` 必红 ⇒ **已补 `scope TEXT`**（工作区，随收尾刀） |
| **S-190** | [`plan-s190/review_report.md`](plan-s190/review_report.md) | **✅ 通过（❌ 0）** | 逐字段一致；筛选只作用明细表（`filtersRef` 隔离）；两处共用同一 WHERE，无注入 |
| **S-191** | [`plan-s191/review_report.md`](plan-s191/review_report.md) | **❌ 1（已修）/ ⚠️ 6** | ❌-1 已按**方案 A** 修复（`sidecar:lifecycle` 补发出方）；⚠️-1「`abortOrphanedSubAgents` 只收敛当前 live 会话」**待老大裁定** |
| **S-192** | [`plan-s192/review_report.md`](plan-s192/review_report.md) | **❌ 0 / ⚠️ 2** | 无阻断；「不动 `cancelStream`」的边界守住了 |
| **S-193** | [`plan-s193/review_report.md`](plan-s193/review_report.md) | **❌ 1（已修）/ ⚠️ 3** | ❌ 已修；⚠️ 2 条留裁定 + 1 条文档回填 |
| **S-194** | [`plan-s194/review_report.md`](plan-s194/review_report.md) | **⚠️ 有条件通过（❌ 0）** | 四条判据全符；**「仓内只剩一份 token 格式化器」字面成立、实质不成立**（仍有 3 处同族各吐一种串）⇒ 记录待裁定 |
| **S-195** | [`plan-s195/review_report.md`](plan-s195/review_report.md) | **⚠️ 有条件通过（❌ 0）** | **主会话补审发现 `isBrowserToolName` 恒 `false` ⇒ `BrowserToolCard` 整张卡不可达**，三处修复里的浏览器那处**是空转**（⚠️-1） |
| **S-196** | [`plan-s196/review_report.md`](plan-s196/review_report.md) | **✅ 通过（❌ 0）** | 根因命中；B（`cutAt`）+ A（`clampCutTime`）+ 段数门三件套落地正确；3 条非阻断观察 |
| **S-197** | [`plan-s197/review_report.md`](plan-s197/review_report.md) | **✅ 通过（❌ 0）** | 判据收紧正确、与操作栏同起点同口径；7 条非阻断建议 |
| **S-198** | — | **N/A（免审）** | 老大 2026-10-14 08:20 裁定「**单纯改内置地址**，不走那些流程」⇒ 免阶段五 / 六 |
| **S-199** | — | **N/A（未开工）** | **唯一未开工项**，等老大点头后走完整六阶段 |
| **S-200** | [`plan-s200/review_report.md`](plan-s200/review_report.md) | **⚠️ PARTIAL（❌ 1，已在 `bae36640` 修）** | ❌ = `InputSchema` 里 `path` 的描述漏改（与已改的 `Description` 自相矛盾）⇒ 修订刀修掉，套件 35 → **37** 断言 |
| **S-201** | [`plan-s201/review_report.md`](plan-s201/review_report.md) | **PASS（❌ 0 / ⚠️ 2）** | 数据准确、红线全守；两处 ⚠️ 均为**非本 diff 缺陷**（`baseUrl` 判等的同向副作用 / 运行时鉴权未真机） |
| **S-202** | [`plan-s202/review_report.md`](plan-s202/review_report.md) | **PASS（❌ 0）** | 主运行面修法正确完整；⚠️ 1 注释错号**已修**；⚠️ 5 处同类点（子 agent / goal / 压缩表面）**待裁定是否扩面** |

**补充轮合计**：❌ **4**（S-189 / S-191 / S-193 / S-200，**全部已修**）/ ⚠️ **≥ 29**（其中 2 条留裁定：S-191 ⚠️-1、S-195 ⚠️-1 的空转卡）；**无残留阻断项**。

无阻断项。11 条 ⚠️ 中，需在验证态落实的是 **⚠️5 / ⚠️6 / ⚠️9 / ⚠️10** 四条（属「必须实测才能收口」而非「代码需改」）；**⚠️1** 建议在本次一并修掉（一行白名单，成本最低、收益最直接）；**⚠️3 / ⚠️4 / ⚠️8** 属需求文档回改。
