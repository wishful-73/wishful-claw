# iter-v2-31 原始需求登记

> 2026-09-17 建档。分支 `dev/v2-iter-31`（base `main` @ `f815e739`，v0.2.30）。
> 本文件为权威需求文档。
> **已立项 4 项**：S-46 废弃入口与占位清理／S-47 Channels 项目主页入口删除／S-48 Translate 残留按钮清理／S-49 完善 Git 功能（右侧面板补常规 Git 操作）。
> （S-46~S-48 为老大 2026-09-17 口述 —— 原话「这些算是需求，而不是直接动手」，来源是当日知识库收口核对时发现的入口残留；S-49 为同日口述「需要完善 git 相关功能」。）
> 其余候选（Draw 功能、快捷搜索扩展整合、扩展功能内容）见文末「待登记」，**未点名，不擅自排入**。
> 勘测行号均为 2026-09-17 实读。

---

## S-46 废弃入口与占位页清理（死代码）

**一句话**：`MainLayout.tsx` 里有一整批「占位页」分支和配套的路由状态，其中**绝大多数开关全仓零调用方**，用户永远碰不到；清掉这批死代码，只保留真正可达的入口。

### 背景

知识库收口（2026-09-17）时逐条核对「占位页是否等于待实现功能」，结论：**这些占位入口本质都是入口层面的问题，不是功能缺失**。老大两次纠正：

- 「清理占位页是不是不太对啊，我看到你列出来的大部分都已经做了」
- 「你现在说的都是入口吧……你发的这些感觉都是入口」

**判据（本次确立，供后续复用）**：判断一个占位页是不是真待办，要过三步 ——
1. 查开关**调用方数量**（排除 store 内定义）→ 零调用方 = 死入口
2. 查**功能是否已在别处实现** → 已实现 = 只是废弃入口
3. 只有「入口可达 ∧ 功能确实没有」才算真正未实现

### 实测清单（2026-09-17）

`src/renderer/src/components/layout/MainLayout.tsx`：

| 开关 | 调用方 | 功能实况 |
|------|--------|---------|
| `openSkillsPage` | **0** | 技能已在设置页 —— `components/settings/skill-panel.tsx` + 浮动对话窗 |
| `openSoulsPage` | **0** | 人设已在设置页 —— `components/settings/persona/PersonaPanel.tsx` |
| `openSyncPage` | **0** | 无对应实现 |
| `openResourcesPage` | **0** | 无对应实现 |
| `openCodeGraphPage` | **0** | Code Graph 已完成（工具 `CodeGraphToolProvider.cs` + 卡片 `CodeGraphToolCard.tsx` + 项目档案索引 + 插件启停 + 设置开关） |

另：`FEATURE_PAGES` 整块（`MainLayout.tsx:37-48`，10 项）是**死配置** —— `setActiveNavItem` 全仓唯一调用是 `setActiveNavItem('chat')`（`WorkspaceSidebar.tsx:156`），故 `activeNavItem !== 'chat'` 那条分支（`MainLayout.tsx:77-82`）**永不触发**。

对应 `ui-store.ts:204-240` 的 `xxxPageOpen` 状态 + `open/closeXxxPage` 动作同样全批可清。

### 要清的东西

- `MainLayout.tsx`：`FEATURE_PAGES` 常量、`activeNavItem !== 'chat'` 分支、上表 5 个 `if (xxxPageOpen)` 分支
- `ui-store.ts` / `ui-store-interface.ts`：对应 5 组 `xxxPageOpen` 状态与 `openXxxPage` / `closeXxxPage` 动作
- `PlaceholderPage.tsx` 本身**视清理结果决定去留**（若 S-47 / S-48 清完后再无引用则可删）
- locales 里对应的 `placeholder.*` key（若有）

### 归属划分（2026-09-17，避免与 S-47 / S-49 打架）

`MainLayout.tsx:111/113` 两个 `chatView` 分支**不归本条**：

| 项 | 归属 | 理由 |
|------|------|------|
| `chatView: 'channels'` | → **S-47** | 渠道定位为全局，入口整体删除 |
| `chatView: 'git'` | → **S-49** | 甲案落地后 Git 入口在右侧面板，该 `chatView` 值一并删除 |

本条（S-46）只清：`FEATURE_PAGES` 整块、`activeNavItem !== 'chat'` 分支、上表 5 个 `openXxxPage` 及其 `xxxPageOpen` 状态与动作。

---

## S-47 Channels 项目主页入口删除

**一句话**：项目主页上有个「渠道（Channels）」入口，但**渠道的定位是全局的**，不该挂在项目下，该入口删除。

### 背景

老大 2026-09-17 原话：「channels 这个是渠道但是**我们的定位是全局的**，这个项目主页上的入口**可以删了**」。

### 实测

- 入口：`src/renderer/src/components/chat/ProjectHomePage.tsx:129` → `navigateToChannels(projectId)`
- 落地：`ui-store.ts:426-432` `navigateToChannels` → `set({ activeNavItem: 'chat', chatView: 'channels', ... })`
- 渲染：`MainLayout.tsx:112-113` → `PlaceholderPage title="Channels" iterLabel="迭代四"`
- 渠道配置本体在设置页（`components/settings/plugin-panel-*.tsx`），与项目无关

### 要清的东西

- `ProjectHomePage.tsx` 的渠道入口按钮
- `navigateToChannels`（`ui-store.ts` / `ui-store-interface.ts`）—— **若无其他调用方则删**（实测当前仅 ProjectHomePage 一处）
- `MainLayout.tsx` 的 `chatView === 'channels'` 分支与 `FEATURE_PAGES.channels` 条目
- 对应 locales key

---

## S-48 Translate 残留按钮清理

**一句话**：消息操作栏的「翻译」按钮仍然存在，但翻译需求已放弃 —— 点击会 toast「已发送到翻译」然后跳到占位页，**给了个假承诺**。

### 背景

老大 2026-09-17 原话：「**翻译不太想要了**」。

### 实测（功能断裂链）

1. 按钮：`components/chat/AssistantMessage/action-bar.tsx:79-85` `handleTranslate` → `setTranslateSourceText(text)` + `openTranslatePage()` + `toast.success('已发送到翻译')`
2. 另一处：`components/chat/UserMessage.tsx:163` 同样调 `openTranslatePage`
3. 落地：`ui-store.ts:216-218` `openTranslatePage` → `translatePageOpen: true`
4. 渲染：`MainLayout.tsx:89` → **`PlaceholderPage title="Translate" iterLabel="后续"`**

即：用户点「翻译」→ 提示成功 → 看到「Planned for 后续」。**toast 是假承诺。**

### 要清的东西

- `action-bar.tsx` 的翻译按钮 + `handleTranslate`（含 `useTranslateStore` 的 `setSourceText` 引用）
- `UserMessage.tsx:163` 的同类调用
- `openTranslatePage` / `closeTranslatePage` / `translatePageOpen`（`ui-store.ts` / `ui-store-interface.ts`）
- `MainLayout.tsx:89` 的 `chatView` / placeholder 分支与 `FEATURE_PAGES.translate` 条目
- 对应 locales key

### 已定：能力本体**保留**（老大 2026-09-17）

`lib/translate-agent-service.ts` + `stores/translate-store.ts` + 消息级翻译能力**保留**，本需求只处理入口按钮与占位分支（不删能力）。

---

## S-49 完善 Git 功能：右侧面板补常规 Git 操作

**一句话**：右侧面板现在只能「看」git（未提交改动 + 提交记录）和 commit 系列，**缺常规 git 操作**（拉取、切换分支、合并分支、刷新远程等）；底层能力与 handler **其实全都实现了**，缺的是 UI 入口。

### 背景

老大 2026-09-17 原话：「右侧面板 目前我们可以看 git 的提交记录了，但是缺了几个东西，增加右键的 拉取 git、切换分支、合并分支、刷新远程等常规 git 操作。需要完善 git 相关功能」

### 实测：三层现状（2026-09-17）

| 层 | 现状 |
|------|------|
| **存储层** `stores/git-store.ts` | ✅ **能力齐备** —— `fetchRepository` / `pullRebase` / `pushRepository` / `syncRepository` / `createBranch` / `checkoutBranch` / `mergeBranch` / `rebaseBranch` / `deleteLocalBranch` / `deleteRemoteBranch` / `renameBranch` / `stageFiles` 系列 / `commit` |
| **handler 层** `components/chat/git-page-handlers.ts` | ✅ **全部封装** —— `handleFetch` / `handlePullRebase` / `handleSync` / `handlePush` / `handleCreateBranch` / `runMergeInto` / `runRebaseOnto` / `runDeleteLocal` / `runDeleteRemote` / `handleBranchDialogConfirm`（含 rename） |
| **UI 层（右侧面板实挂）** `components/cowork/changes-panel.tsx` | ❌ **只有** 刷新 / Commit / Commit (Amend) / Commit & Push / Commit & Sync（`type CommitAction = 'commit' \| 'amend' \| 'push' \| 'sync'`）。**无** fetch/pull、无分支切换、无合并、无分支管理 |

### ★ 关键发现：**已有一套功能完整的 Git UI，但它是孤儿**

- `components/chat/GitPage.tsx`（21.7 KB）+ `components/chat/GitPage/ScmSidebar.tsx`（27.6 KB）
- **分支右键菜单已实现**（`ScmSidebar.tsx:238-342`）：检出 / 合并到当前 / 变基到当前 / 删除本地 / 删除远程 / 重命名
- 工具栏也有：Fetch（`:376`）/ Pull（`:390`）/ Push（`:404`）/ Sync（`:423`）
- **但全仓 `import ... GitPage'` 零命中** —— 没有任何文件挂载它。`chatView: 'git'` 走的是 `PlaceholderPage`（见 S-46）

即：这套 UI **从没被接进界面**，所以右侧面板看不到这些操作。**要做的主要是「接线」，不是「造轮子」。**

### 方向（**已定：甲** —— 老大 2026-09-17）

| 方案 | 结论 |
|------|------|
| **甲**：把 `GitPage` / `ScmSidebar` 挂到右侧面板 | ✅ **采纳** —— 直接复用成熟 UI，能力最全 |
| **乙**：给 `ChangesPanel` 补右键菜单与按钮 | ✗ 不采纳 |

**甲案落地要点（实施时核）**：

- `GitPage.tsx` 是「整页」形态，含历史面板 + 分区拖拽（`hooks/use-git-panel-split.ts`），挂进右侧面板窄栏需适配尺寸与布局
- 需先定 `ChangesPanel`（`components/cowork/changes-panel.tsx`，现由 `AgentFilesPanel.tsx` 引用）的**去留** —— 甲案落地后它是被取代，还是两处并存分工
- **与 S-46 的交集**：`chatView: 'git'` 废弃入口（原走 `PlaceholderPage`）—— 甲案落地后 Git 入口在右侧面板，该 `chatView` 值应删除。**此项归 S-49，S-46 只清其余**

### 要做的事（无论甲/乙）

- 拉取（fetch / pull）
- 切换分支（checkout）
- 合并分支（merge，含 rebase）
- 刷新远程（刷新分支列表 / `fetch --prune`）
- 分支管理（新建 / 删除本地 / 删除远程 / 重命名）
- 参考载体：`ScmSidebar.tsx:238-342` 的右键菜单结构 + `git-page-handlers.ts` 的 handler

### ★ 落地裁定（2026-09-17 老大）

老大原话：「**可以复活 gitpage 但是呈现的位置是右侧面板，之前的 changesPanel 在 gitpage 成熟后可以下架**」

⇒ 甲案落点定为**右侧面板**，且**不动 `chatView`**（`chatView: 'git'` 走 `PlaceholderPage` 那条分支**保留**，S-49 不删它）。`changesPanel` / `branches` 两个 tab **暂时共存**，等 GitPage 成熟后再下架。

### ★ 实测：GitPage 不能原样挂（宽度冲突）

| 事实 | 数值 |
|------|------|
| 右侧面板默认宽 | **384px**（min 280 / max 80vw，`right-panel-defs.ts:5-8`） |
| `ScmSidebar` 宽度 | **固定 px** `style={{ width: scmWidth }}` + `shrink-0`（`ScmSidebar.tsx:154-156`），默认 **360** |
| 文件历史栏 | 固定 `historyWidth` 默认 **300**（`use-git-panel-split.ts:17,39`） |
| 三栏合计下限 | ≈ 200 + 5 + 0 + 5 + 200 ≈ **410px 起**，还没给 diff 栏留位置 |
| 页面级外壳 | `px-6 pt-4 pb-6` + `max-w-[1480px]` + 顶部大标题区（`GitPage.tsx:262-282`） |
| 上下文 | GitPage 读 `activeProject`（`GitPage.tsx:26-28`）；右侧面板读**会话** `workingFolder`（`AgentFilesPanel.tsx:26-40`）⇒ 全局会话下 GitPage 直接走「Select a project」空态 |

### 落地方案（已定）

1. **GitPage 加 `workingFolder?: string \| null` prop** —— 会话级优先，回落 `activeProject.workingFolder`；空态判断也改用它
2. **GitPage 加容器宽度自适应的「紧凑形态」**（`ResizeObserver` 测宿主宽度，阈值 640px）：
   - **紧凑（< 640px，即右侧面板常态）**：去掉页面级 padding / `max-w` / 顶部标题区；只渲染 `ScmSidebar` 占满宽度（分支下拉+右键菜单、fetch/pull/sync/push、commit box、文件列表全在其中）；**点文件 → 弹 Dialog 看 diff**（照 `changes-panel.tsx:155-170` 的既有先例，用户已熟悉该交互）
   - **宽松（≥ 640px）**：保持现有三栏
3. **diff 渲染抽成 `GitPage/GitDiffContent.tsx`** —— 宽态内联区与紧凑态 Dialog 共用
4. **`ScmSidebar` 的 `scmWidth` 类型放宽为 `number \| string`** —— 紧凑态传 `'100%'`
5. **`AgentFilesPanel` 加第四个 tab `git`** → `<GitPage workingFolder={sessionView.workingFolder} />`

---

## S-50 左侧面板首排组合按钮重新设计样式

**一句话**：侧栏第一排的「新对话 | 免费对话」两个按钮**没边框、没底色、二者等重**，单看一个还行，并排就显得突兀；重新设计一版。

### 背景

老大 2026-09-17 原话：「现在左侧面板 第一排是两个按钮 新对话 和免费对话，目前不太好看，想让你重新设计一版样式，主要是现在按钮没边框，没颜色，以前是一个操作看着还可以 现在两个并列着就突兀」

**沿革**：上一轮已按老大要求把它改成「等宽半半 + 都带文本」（原话「一半一半对了，但是样式不太好看」）—— **等宽与文案解决了，「不太好看」一直没解决**，即本条。

### 现状（`components/layout/workspace-sidebar-nav.tsx:82-112`）

`renderSplitNavItem` 的按钮基类：

```
flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2
text-[13px] font-medium transition-colors
text-muted-foreground hover:bg-accent/50 hover:text-foreground
```

即：**无 `bg`、无 `border`**，仅 hover 时出现 `accent/50` 底。

### 问题诊断

| # | 问题 | 说明 |
|---|------|------|
| 1 | **没有实体感** | 半宽 + 居中，视觉上已被当作「按钮」，但按钮该有的底色/边框都没有 → 像两片浮着的文字 |
| 2 | **两个等重** | 都是 `text-muted-foreground` + 同样尺寸，没有主次，视线被对半分 |
| 3 | **版式语言不一致** | 上下的导航项（`renderNavItem`）是**全宽左对齐**的列表样式，中间插一排**居中半宽**的东西，视线会跳 |

### 候选方案（**已定：甲**，老大 2026-09-17「根据你的推荐来」）

| 方案 | 做法 | 取舍 |
|------|------|------|
| **甲（采纳）分段控件** | 外层套一个容器 `flex h-8 w-full overflow-hidden rounded-md border border-border/60`，内部两个等宽选项，中间 `border-l` 分隔，active 才填 `bg-accent` | 语义最贴合 —— 两者都是「开一个新对话」的两种方式，本就该是一个控件组里的两个**选项**；一次性解决「没底、没形、等重」 |
| **乙** 主次按钮 | 新对话 filled（`bg-primary text-primary-foreground` 或 `bg-accent`+`border`），免费对话 outline（`border border-border/60` + 灰字） | 主次分明、不抢；但会暗示二者是「不同层级的功能」，而实际语义是平行的 |
| **丙** 改布局 | 新对话恢复全宽（与上下导航项同款版式），免费对话降级为图标按钮或另起一行 | 版式最统一，但退回了「一个主操作」的形态，免费对话入口变弱、可达性下降 |

**裁定：甲**。理由：突兀的根因是「半宽居中后仍按列表项样式渲染」，而分段控件正好给这排东西一个**属于它自己的形态语言**，同时保持两个入口的平等可达。

### 落地（2026-09-17）

只改 `renderSplitNavItem` 一个函数（`workspace-sidebar-nav.tsx:82-116`）：

- 容器：`flex h-8 w-full overflow-hidden rounded-md border border-border/60` —— 补上老大点名的「没边框」
- 两半：`flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 px-2 text-[13px] font-medium transition-colors`
- 空闲态：`text-muted-foreground hover:bg-accent/40 hover:text-foreground`
- 激活态：`bg-accent text-foreground`
- 右半加 `border-l border-border/60` 作分隔线
- `overflow-hidden` 让 hover 底色不越出圆角

全用语义色（`border` / `accent` / `muted-foreground`），light / dark 两套主题自动成立；`h-8` 与 `text-[13px]` 沿用原值，未破坏侧栏垂直节奏。

### 约束

- 沿用既有的 `h-8` 行高与 `text-[13px]`，不要破坏侧栏整体垂直节奏
- 需同时兼顾 **light / dark** 两套主题（`bg-muted` / `accent` 系已主题化，优先复用语义色，不写死色值）
- 改动集中在 `renderSplitNavItem`，不影响 `renderNavItem`（其余导航项）

---

## S-51 代码图谱核心化（变成核心工具）

> **状态：已实施**（2026-09-17 晚老大拍板重启）。准入判据 = **插件开关开 ∧ 项目已有索引** —— 比原方案多出来的"有索引"这半个条件，正对着下面那条"它是领域工具不是通用工具"：没有索引的项目连工具都看不到，非开发场景不受打扰。

**一句话**：`codegraph_explore` 自称 PRIMARY code-intelligence tool，却因 `isCore = false` 只能走 `use_capability` 代理 —— 用之前得先"想起有代码图谱这回事"再去代理里翻；把它提升为核心工具，直接出现在工具列表里。

### 背景

老大 2026-09-17 原话：「**代码图谱需要变成项目下的核心工具**」。

### 实测（2026-09-17）

| 项 | 值 |
|---|---|
| 注册点 | `src/runtime/WishfulClaw.Agent/Tools/Providers/CodeGraphToolProvider.cs:16-28` |
| 工具名 | `codegraph_explore`（`CodeGraphToolDefs.cs:29` 的 `DefaultSurface` 就是它） |
| `visibleScopes` | `ToolVisibilityScopes.Everywhere` |
| `isCore` | **未传 ⇒ 默认 `false`**（`ToolDefinitionPlaceholder.cs:29` `bool isCore = false`） |
| 对比 | `GrepTool.cs:59` `IsCore => true`；直连注入只收 core |

**核心化现在只需一道门**：preset 白名单已在 iter-30 S-43 整体退役，可见性只剩 `VisibleScopes` / `ExcludedScopes` + `IsCore` + `AgentRunContextPolicy`。（历史上要过两道门 —— S-42 把 todo 核心化时就踩过「只改 `IsCore` 被 preset 白名单挡回去」。）

### 「项目下」的语义

`codegraph_explore` 的 schema 里 `projectPath` 可选、默认 working folder；描述写明 "Requires CodeGraph to be enabled and the project to be indexed"。**全局会话没有 working folder ⇒ 无索引可言**。所以核心化的实际生效面是**项目会话**，与老大的措辞一致。

### 要改的

`CodeGraphToolProvider.cs` 的 `registry.Register(...)` 补 `isCore: true`，并核对它经 `AgentRunContextPolicy` 后的实际直连集合（改完必须重生成 `visibility-snapshot.expected.txt` 并逐段核对差异）。

### 裁定：搁置，本迭代不做（老大 2026-09-17）

> 「只有启用才注入，先不要核心化吧」

**老大的判断比我上一轮的分析准确 —— 我漏了一层。** 我当时说「preset 白名单已在 iter-30 S-43 退役，核心化只需 `isCore: true` 一道门」，那只算了**可见性**，漏掉了**功能开关**。

**核实结果（2026-09-17）**

`CodegraphEnabled` 确实进了 `AgentRunContext`（`AgentRunContextPolicy.cs:11` 声明、`:89` 赋值），**但全仓只有一个消费方**：

```csharp
// AgentRuntimeUseCapabilityDiscovery.cs:111-112
private static bool IsRunEnabledTool(AgentRunContext runContext, string toolName)
    => !toolName.StartsWith("codegraph_", StringComparison.Ordinal) || runContext.CodegraphEnabled;
```

它在 **`use_capability` 代理侧**（`list` / `inspect` / `call` 共用同一个可见性谓词）。而**直连注入侧**（`IsToolAllowed` / `ResolveDirectInjection`，`AgentRunContextPolicy.cs:136-201`）**从头到尾不读这个字段** —— 它只认 `VisibleScopes` / `ExcludedScopes` / `IsCore`。

⇒ **未启用 CodeGraph 时**：代理路径已经挡住了 ✅；一旦核心化，工具就改走直连注入，而直连注入不看开关 ⇒ **把一个用不了的工具直接塞进工具表**。

**重启本需求的前提（独立于核心化本身，且有独立价值）**

先把「功能开关」接进直连注入的准入判据 —— 让 `IsRunEnabledTool` 那套判据在 `IsToolAllowed` / `ResolveDirectInjection` 同样生效。**现在任何 opt-in 工具核心化都会踩同一个坑**，不只 codegraph。

**原待裁定项（搁置后已失去时效，仅存档）**

1. 范围：只核心化 `codegraph_explore`，还是连 `codegraph_search` / `codegraph_node` 一起（多吃常驻 schema token）
2. 未启用时是"靠描述里的前置条件兜住"还是"从直连集合摘掉" —— **裁定已给出方向：摘掉**（即前提那一步）

**补充理由：它是领域工具，不是通用工具（老大 2026-09-17 晚）**

> 「至于代码图谱，我突然想到这个东西并不是所有的都有代码，这个软件并不是全面用来开发的，也可以做其它事情」

这条比"缺开关门控"更根本。开关门控是**实现层**缺陷（补上就能核心化），而这条讲的是**产品定位**：Wishful Claw 不只为写代码服务 —— 写作、调研、日常问答都不涉及代码。把 `codegraph_explore` 摆进所有会话的直接工具列表，对非开发场景是**纯噪音**：占 schema token、占注意力，却永远用不上。

**重启（2026-09-17 晚，老大拍板）**

> 「你先探索下是否好处理」→「重开，是否进核心的一句是 **插件开关为开 并且 有代码图谱索引**」

上面那条结论没有被推翻，而是被**条件化**了：不再问"要不要核心化"，改问"什么条件下才核心化"。加进"有索引"这半个条件后，产品定位的顾虑自动消失 —— 没被索引过的项目（写作、调研、非开发仓库的绝大多数）连工具都看不到；有索引，说明用户本来就在拿它做开发。

⇒ 上面那个"前提"（把功能开关接进直连注入）照旧必须做，而且这一步做完整了：开关门控从代理侧的一个私有谓词，搬成 `IsToolAllowed` 的**第一道**判据，直连、代理、执行前准入三处一次性统一。

### 落地（2026-09-17 晚）

**判据的解析位置在渲染端**，理由是实测出来的，不是偏好：

1. **`Resolve` 不能碰文件系统** —— `VisibilitySnapshot.ResolveScenarios()` 是**通过 `AgentRunContextPolicy.Resolve(parameters)` 造 context 的**（其注释写明"不直接 new，避免绕过被测的归一化"），golden 又拿它逐上下文比对。判据一旦进 `Resolve`，golden 就会随"跑测试的机器上有没有索引"变化，**整套可见性回归直接失效**。
2. **Agent worker 推不出索引路径** —— 索引有两条布局：本地项目是 `{workingFolder}/.wishful-claw/codegraph`，SSH 项目是 data-dir 下的 `projects/<id>/codegraph`（远端仓库写不进去）。后者由渲染端推导后当 `dataRoot` 传给主进程；`CodeGraphDataRootRegistry` 是 **CodeGraph worker 进程内**的内存表，Agent worker 看不到 —— 直接调 `CodeGraphDataDir.IsInitialized` 会回落集中式布局并**误判成"没有索引"**。

所以判据在渲染端算好、随 run 参数下发；`codegraphEnabled` 这个参数从此承载的语义是**「插件开 ∧ 有索引」**，Worker 侧不必为"索引"改一个字。

**C# 侧（4 处 + golden）**

| 文件 | 改动 |
|---|---|
| `AgentRunContextPolicy.cs` | 新增 `IsRunEnabledTool`（原在 `AgentRuntimeUseCapabilityExecutor`），接进 `IsToolAllowed` 的**第一道**判据 —— 直连 / 代理 / 执行前准入三处共用它 |
| `AgentRuntimeUseCapabilityDiscovery.cs` | 删掉本地那份重复定义与 `&& IsRunEnabledTool(...)`，门控从此只有一个出处 |
| `Tools/Providers/CodeGraphToolProvider.cs` | 补 `isCore: true` |
| `Core/Tools/ToolCategoryCatalog.cs` | `Core` 名单加 `codegraph`（类别进核心 ⇒ 代理侧 `GetProxiedCategoryNames()` 自动不再宣传它） |
| `tests/.../VisibilitySnapshot.cs` | 加场景 `project:cowork@codegraph`（`codegraphEnabled: true`）。不加它，没有任何被扫场景能承认这个类别，`RunCoreCategoryReachableSuite` 会要求一件不可能的事 |
| `tests/.../ToolDeclarationChecks.cs` | `sessionContexts` 纳入该场景 |
| `tests/.../CodeGraphGateChecks.cs` | **新增**，8 条断言：开关两侧的直连集合 / 代理可见性 / 「开关只改变一个工具」/ 类别与 `IsCore` 两处声明 |
| `tests/.../visibility-snapshot.expected.txt` | 重生成：**只多一行**，其余 15 个上下文的工具集合逐字未变 |

**渲染端**

| 文件 | 改动 |
|---|---|
| `lib/agent/codegraph-availability.ts` | **新增**。纯逻辑：`shouldProbeCodegraphIndex` / `resolveCodegraphDataRoot` / `resolveCodegraphEnabled`（注入式探测 + 30s 缓存 + **只在探测成功时写缓存**）。刻意不 import `agentBridge`，探测由调用方注入，纯逻辑才可直接单测 |
| `hooks/use-chat-actions.ts` | `codegraphEnabled` 由"插件开关"改为 `await resolveCodegraphEnabled({...})`；探测实现就地 —— 一次 `codegraph/index-status` RPC，5s 超时，只认 `indexed === true` |

**已知取舍**：探测要等一次跨进程 RPC，所以**插件没开、或没有项目根时一次都不问**；命中缓存 30s（建/删索引是分钟级动作，不会出现"刚建好索引还要等很久"）。探测失败按"没有索引"处理（这一轮不给工具）且**不写缓存**，避免一次启动抖动钉住整个 TTL。

**验证**：`codegraph-availability` 23 断言 · `CodeGraphGateChecks` 8 断言（跑生产注册表）· `Provider header regression checks passed` · 全量 TS 30/30 · C# 回归 10/10 · Worker 与 tests.sln 各 0 警告 0 错误。

---

## S-52 探索结论：tgrep 不能替代代码图谱（近似需求的靶子其实是 Grep）

**一句话**：微软的 `microsoft/tgrep` 是**三元组索引加速的正则搜索**，不是代码图谱。它替代不了 CodeGraph（能力不重叠），但它的靶子正是我们自己那个朴素全扫的 `Grep` 工具。

### 已核实的 tgrep 事实（来源 github.com/microsoft/tgrep）

| 项 | 内容 |
|---|---|
| 定位 | Trigram-indexed grep —— **大仓库 regex 搜索加速**，ripgrep 的加速替代 |
| 架构 | 预建 trigram 倒排索引（mmap 零拷贝 + 二分查找）→ 候选文件集 → 并行正则验证；client/server over TCP JSON-RPC，常驻 server + file watcher 增量 |
| 集成 | **已进 GitHub Copilot CLI**，用来做 grep 搜索 |
| 性能 | 比 ripgrep 快最多 **52x**（大仓库）；18 格基准赢 17 格，唯一例外是 Kubernetes on Linux 的 0.93x 近平 |
| 其他 | `.gitignore`（含 `core.ignorecase` / `--no-require-git`）、64MiB 文件上限、扩展名+内容双重二进制判定、Rust / MIT / 有 Windows 预编译二进制 |

### 为什么不能替代（能力不重叠）

- **CodeGraph 回答结构问题**：`codegraph_callers`（谁调用它）/ `codegraph_callees`（它调用谁）/ `codegraph_impact`（改它的爆炸半径）/ `codegraph_node`（签名+正文+调用轨迹）/ `codegraph_explore`（自然语言问句 → 按文件分组的源码 + 调用路径 + 影响面，一次capped调用内给全）
- **tgrep 只回答文本问题**：哪些文件的哪些行匹配这段正则。**没有符号、没有定义、没有调用关系、没有影响面**
- **索引的语料根本不同**：CodeGraph 的 FTS5（`Storage/CodeGraphSchema.cs:113` `nodes_fts`）索引的是**符号元数据**（`name` / `qualified_name` / `docstring` / `signature`），不是**文件正文**；tgrep 索引的是**每一个文本文件的全部 trigram**。两者互补，不构成替代关系

### 它真正对标的是我们的 `GrepTool`

`src/runtime/WishfulClaw.Agent/Tools/SearchTools/GrepTool.cs`：

- `:347` `Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)` —— 全树遍历，**零索引**
- `:169` 逐文件 `File.ReadAllTextAsync` 全量读入
- `:203` 逐行 `regex.Match`
- ⇒ **O(总字节) per query**，正是 tgrep README 点名要解决的那类实现

### 建议（**未动手，待老大定**）

- **不引入 tgrep 本体**：它是独立常驻 server + 独立索引目录 + 独立生命周期，对桌面应用是全新的部署面与故障面；而 CodeGraph 已经有 SQLite 索引 + 增量重扫 + 文件监视 + 进程锁一整套基础设施
- 若要解决 `Grep` 在大仓库下的性能，**优先复用 CodeGraph 已有索引**（在 `files` 表上补一层内容级索引），而不是再拉一个 sidecar 进程

---

## S-53 子代理轮次预算失控：触顶不落盘、结束不回主会话

**一句话**：子代理撞轮次上限时**没有任何收尾机会** —— 循环直接退出，报告只剩开场白；且"结束"不保证回到主会话，主 agent 干等一个早就结束的任务，用户也跟着懵。

### 来源（老大 2026-09-17 原话）

> 「首先迭代上限太小了，触碰迭代上限需要由子agent自己判断是落盘了还是继续延长，以及结束了需要回到主会话让主agent唤醒继续处理，而不是现在你不知道，它结束了。用户懵逼」

**同日 08:46 澄清（关键，口径以此为准）**：

> 「我说的上限更多是一个**提醒作用**，子agent自己决定继续还是落盘，**其实也就是无上限啊**」

⇒ **不设硬上限。** 那个数字不是闸门，是**提醒点** —— 到点了提醒子 agent 一次，让它自己判断继续还是收尾。**"延长"这个动作不需要存在**（本来就无限，没有东西需要申请）。

### 现场（生产库 `sub_agent_runs` 实测，2026-09-17 08:26）

| agent | iteration | toolCalls | report 长度 | 结果 |
|---|---|---|---|---|
| custom | 3 | 3 | **2437** | ✅ 完整 |
| custom | 5 | 4 | **9597** | ✅ 完整 |
| code-reviewer | **12** | 21 | **149** | ❌ 只剩开场白 |
| code-reviewer | **12** | 22 | **77** | ❌ 只剩开场白 |

**12 是天花板，一撞上报告就废。** 最近那条（`call_00_Lwsf3qxhbTK76VDLDzKR1802`）跑 41.5 秒、12 轮、22 次调用，`reportStatus` 仍是 **`submitted`**、`endReason` 仍是 **`completed`** —— 外面看一切正常，里面只有一句：

> `I'll start by exploring the repository structure and the iteration artifacts.`

### 根因（四层，每层都有实测证据）

**① 轮次配置的键名对不上（静默失效）**

- `code-reviewer.md:6` 写的是 `maxIterations: 0`（本意 = 不限轮次）
- 解析器 `SubAgentDefinition.cs:94` 只读 `maxTurns`：`GetFrontmatterInt(frontmatter, "maxTurns") ?? DefaultMaxTurns`
- `git log -S "maxIterations"` 查证：该文件**从未**出现过这个键名 —— 不是改名遗留，是一开始就不匹配
- 读不到 ⇒ 回落 `DefaultMaxTurns = 12`（`:33`）
- **用户目录 16 个 agent 定义里，15 个用 `maxIterations`（全废）；只有 `researcher.md`(10) / `reviewer.md`(8) 用对了键名**

**② 触顶没有收尾机会**

`AgentLoop.cs:253` 的循环条件 `for (var iteration = 1; !hasIterationLimit || iteration <= requestedMaxIterations; iteration++)` —— 计数一到就**直接退出循环**，没有"最后一轮收尾"的机制。子代理的报告还躺在它脑子里没吐出来。

**③ 触顶这个事实在传递链上丢光**

- loop 内部算得出 `"max_iterations"`（`:496`：`state.StopReason ?? (completed ? "completed" : "max_iterations")`）
- 但它**只传给了 `EmitLoopEndAsync`，没有写回 `state.StopReason`**
- 而 `EmitLoopEndAsync` 对子代理是**跳过**的（`:505` 注释：`Skipped for sub-agents (SuppressTransportEvents = true)`）
  ⇒ 触顶事实既没进 state，也没发事件
- `SubAgentExecutor.Background.cs:82` 上报时传的是 `childState.StopReason`（此时为 null）⇒ 到 UI 变成 `completed`
- **后果**：没有任何一处能区分「干完了」和「被砍断了」

**④ 结束不回主会话（唤醒链有洞）**

- Worker 侧两条路都做了：`:105` 父队列活着就注入；`:125` 父队列已关就缓冲到 `BackgroundSubAgentNotifications`
- 渲染端 `use-background-subagent-wakeup.ts:67`：主 run 活跃 → **直接 return**，指望"报告会通过正常队列注入下一轮"
- **但主 run 一旦结束，就再没有东西来触发 drain 了** —— `pendingWakes` 的 3 次重试全挤在 800/1600/2400ms 内打完，那时主 run 还活着，三次全废
- 实测：08:27:16 子代理结束 → 到 08:31 之前**会话里零回推消息**；`~/.wishful-claw/logs/2026-09-17.log` 里 `subagent` 相关 **0 命中**（事件压根没到渲染端）
- **且**：S-36 辛苦落库的 `finalOutput`（77 字符）**这个 hook 根本没读** —— 它读 `agent:drain-sub-agent-notifications`，空数组就 `return`（`:76`）。库里有报告，链路上没人去拿

### 需求（老大三条 → 可执行定义）

| # | 老大口径 | 可执行定义 |
|---|---|---|
| 1 | 迭代上限太小 | **取消硬上限** —— 子代理不限轮次，靠父 run 的取消令牌兜底（`state.IsCancellationRequested` 每轮已检查）；同时修掉 ① 的键名失配 |
| 2 | 上限是**提醒点**：子 agent 自己判断继续还是落盘 | 到提醒点时注入一条**临时**提示（照 S-44 的 `InjectTransientPrefix` 模式，走临时副本、不改历史、不废前缀缓存）。内容 = **告知已跑了多少轮 + 没有硬上限 + 它可以继续也可以收尾**，由它自己决定。**不需要"申请延长"的工具** |
| 3 | 结束要回主会话唤醒继续 | 主 run 活跃时不能"登记完就完事"，要挂上 **run 结束后的补偿触发**；已结束未送达的报告（通知区 + `sub_agent_runs.finalOutput`）都要能补读 |

**附**：`endReason` 必须如实反映结束原因 —— 取消、异常、正常完成要能区分；UI 上要看得出来这是"被中断的"而非"干完的"。
（无硬上限后 `max_iterations` 基本不会出现，但**如实标记**这个原则不变。）

### 参考依据：代码里已有的同款哲学

`SubAgentDefinition.cs:125-132`（`CreateStructuredDefinition` 的注释）已经写明：

> a turn cap only exists to force-stop runaway models, but reasoning models legitimately spend early turns thinking before emitting text — MaxTurns=2 starved them into "completed but produced no output". **The parent's cancellation token is the real safety net; the loop ends when the model answers.**

⇒ 主会话自己也是 `maxIterations` 默认 0（不限）、靠取消令牌兜底（`AgentLoop.cs:236` 注释 `// 0 = unlimited`）。**子代理没有理由比主会话管得更死。**

### 待定口径（需老大拍板）

1. **提醒点的字段怎么放** —— 甲：复用 agent 定义里现有的 `maxTurns`，语义从「硬上限」改成「提醒点」（默认仍 12，但不再强杀）；乙：`maxTurns` 保留为**可选**硬上限（默认 0 = 不限），另立独立字段做提醒点。**我倾向乙** —— 一个字段一个语义；这次的坑就是名字含糊（`maxIterations` 看着像生效、实际没人读）
2. **提醒一次还是多次** —— 到点提醒一次就不再打扰，还是每隔若干轮重复提醒？重复提醒的注入内容每轮都进请求、要付 token
3. **提醒文案** —— 必须**如实**告知"没有硬上限"。理由：现在这个 bug 的镜像就是——模型以为自己快到上限了（或者压根不知道自己有多少轮），于是草草收尾。文案不能写成"催它收尾"的嘱咐，得把「你可以继续，也可以收尾」这个**事实**给它，判断权留给它。按 `docs/prompt-authoring.md` 四关定稿
4. **"落盘"落到哪** —— 是指让它把结论作为最终报告输出，还是写进子会话产物/文件？口径不同，文案写法不同
5. **键名兼容还是迁移** —— 甲：解析层同时认 `maxTurns` 与 `maxIterations`（旧文件一律不动）；乙：统一成 `maxTurns` 并批量改 15 个 md。**我倾向乙 + 甲兜底**（16 个文件里 15 个写错，说明这个键名得当成公开契约来对待）
6. **`endReason` 的消费方** —— 只在卡片上显示，还是也要影响主 agent 的提示语（"这份报告是被中断的，别当完整结论用"）

### 实施（2026-09-17）

老大同日拍板两条：**"上限"只是提醒点、实质是无上限**；**注入照 `session_todo` 那套用法，只在子代理中生效**。

**C# 侧**

| 文件 | 改动 |
|---|---|
| `SubAgentDefinition.cs` | `DefaultMaxTurns` 12 → **0（不限）**；解析同时认 `maxTurns` 与 `maxIterations`（前者优先） |
| `AgentLoop.SubAgentReminder.cs`（新建） | `SubAgentTurnReminderAfter = 12`；`BuildSubAgentTurnReminderBlock(iteration)`；`InjectSubAgentTurnReminder(...)` |
| `AgentLoop.cs` | `ExecuteTurnAsync` 加 `iteration` 形参；注入点串联；loop 收尾把真实原因写回 state |
| `AgentRuntimeRunState.cs` | 新增 `internal RecordStopReason(string)` —— `StopReason` 是 `private set`，外部根本写不进去，这正是它一直为 null 的原因 |
| `GoalSubAgentExecutor.cs` | goal 子代理写死的 `maxIterations: 12` → **0**（与 Task 子代理同源问题） |

注入块（英文，只给事实）：

```text
<sub_agent_status>
Turn 12. No turn limit is enforced on this run — you may keep working until the task is complete.
Only the text you emit is delivered back to the caller.
</sub_agent_status>
```

两句话各自对应一个实测失败：① 它不知道自己还剩多少轮，一感觉"跑挺久了"就草草收尾；② 它把成果留在工具调用里，而 `GetFinalOutput()` 只串联 text 事件。**刻意不写"记得收尾"这类嘱咐** —— 每轮都要付 token，而它看到事实会自己判断。

**渲染端**

`use-background-subagent-wakeup.ts` 重写调度：

- 原来固定重试 3 次（800/1600/2400ms），三次几乎必然全落在主 run 还活着的时间窗里，每次都被「主 run 活跃」挡回，之后再无任何触发 ⇒ 报告滞留到进程退出
- 现在：事件到达 → 会话**挂号**；主 run 活跃就挂着，订阅 `useChatStore` + `useAgentStore`，**在它空闲的那一刻补唤醒**
- 保留 400ms 首次延迟：Worker 是**先 emit 事件、后写通知区缓冲**（`SubAgentExecutor.Background.cs:85` vs `:125`），立即 drain 可能读到空
- 顺带：拿不到 active provider 时打日志（原来静默 return，报告会无声消失）

**门禁**：Worker / tests 编译 0 警告 0 错误；C# 回归 **10/10**（Goal **213 → 230**，新增 17 断言）；typecheck 三配置 0 错；TS **23/23**；AOT 无 IL2026/IL3050/IL3051（23,161,344 B）；6 个触碰文件 BOM clean。

> `ProviderHeaderRegressionTests` 在本批连续跑套件时出现过一次失败，单跑与再连跑 5 次均全过，且该套件零引用 `StopReason` —— 判定为它自带的真实退避重试（日志有 429/503 重试）导致的 flaky，**与本次改动无关**。

**遗留（未做）**

1. 15 个 agent 定义里的 `maxIterations` 键**没有批量改写**（解析层已兼容），用户数据不动
2. **「父 run 先死、事件根本没送达渲染端」这条路径本次没修** —— 那种情况下渲染端连 `sub_agent_end` 都收不到，hook 不会触发；S-36 落库的 `finalOutput` 是唯一数据源，而渲染端目前没有主动读它的通道
3. `endReason` 的**消费方**未动 —— 现在能如实上报（`max_iterations` / `cancelled` / `error`），但 UI 还没专门呈现"被中断"

### 补漏：报告回传渲染端（2026-09-17 晚，老大真机验收发现）

上面遗留第 2 条**本次补掉**，而且根因与我先前的推断不同。

**真实断点：事件照常到渲染端，只是没人往下传。**

子代理卡片的状态能正常清除 ⇒ `sub_agent_end` 确实送达了。断的是 `stores/chat-store/index.ts` 收到 `sub_agent_*` 后**只调 `handleSubAgentEvent` 更新 UI 状态，从不通知 `backgroundSubAgentCompletions` 总线** —— 而唤醒 hook 订阅的正是这条总线。**整条链只差这一根线。**

（先前推断的两条都不成立：`EmitAsync` 父 run finalize 后仍能通，它走的是请求上下文，且 `:175` 的 catch 会吞掉异常；`sub-agent-native-ui.ts` 的 `handleNativeSubAgentUiUpdate` 零调用方是移植进来就没接的**死代码**，不是当前链路。）

| 文件 | 改动 |
|---|---|
| `stores/chat-store/index.ts` | `sub_agent_end` 且是后台子代理时向总线挂号（**放在 `handleSubAgentEvent` 之前** —— 它会删掉 `activeSubAgents` 里那条） |
| `stores/agent-store/types.ts` + `slices/sub-agent-slice.ts` | `SubAgentState` 补 `isBackground?: boolean`（原先没有，slice 里用 `as any` 硬塞），两处 `as any` 去掉 |

**只对后台子代理挂号**：前台子代理的报告是父 run 的 tool result，父 run 自己在等它，不需要唤醒。

### 唤醒消息的呈现修正（同一批）

回传补上后暴露的第二个问题：那条消息是**真以 user 消息发出去的**（走 `sendMessage` + 落库），于是渲染成用户气泡 —— 可用户从没发过它。

**现成机制**：`MessageItem.tsx:65` 的 `AgentWakeNotification` **本来就是为这个场景写的** —— 它有一支 `subAgentMatch = content.match(/^\[Background sub-agent (.+?)\]:\n?/)`（紫色主题 + 人形图标）。但触发它的 `source === 'team'` 判定**全仓零写入点**，唤醒侧也从没按这个前缀发过 ⇒ 这条路从没通过。

| 文件 | 改动 |
|---|---|
| `lib/agent/sub-agents/background-wake-message.ts`（新建） | 格式的**唯一出处**：构造 / 识别 / 剥尾 / 从 Worker 信封取名字 / 解析标题。生产端（唤醒 hook）与消费端（渲染）共用，前缀漂移不可能 |
| `hooks/use-background-subagent-wakeup.ts` | 改用 `buildBackgroundWakeMessage(名字, 报告)` 构造 |
| `MessageItem.tsx` | user 分支识别 → 渲染通知卡；并剥掉尾部那句写给模型的指令（卡片里是噪音） |
| `transcript-filters.ts` | `isRealUserMessage` 排除它 —— 否则它会变成**可编辑**的 |
| `MessageList/useMessageListData.ts` | 吸附卡找"最后一条用户消息"时跳过它 |

**标题口径**照抄右侧面板 `SubAgentsPanel.tsx:297-301`：**任务描述优先**，agent 名垫底。实测拿 agent 名当标题会显示成 `custom`（没有信息量的类型名），而描述（`Description: Iter docs H2 recount`）就在 Worker 信封里现成。

**发给模型的内容**随之调整：前缀 `[Background sub-agent <名>]:` 置于行首（渲染端按此解析），指令句原句保留、从开头挪到末尾。

**测试**：新增 `tests/background-wake-message/program.ts`（**30 断言**），锁的是生产端与渲染端之间的**格式契约**（不是"当前输出什么"）；`package.json` 加 `test:background-wake-message`。

**门禁**：typecheck 0 错；TS **29/29**；未动 C#；BOM clean。

**老大真机验收（2026-09-17 晚）**：后台子代理在父 run 先结束时**报告自动回到主会话**（不必手动发消息去叫），呈现为通知卡、标题是任务描述。**已通过。**

### 顺带待核（同一批 agent 定义里的其它键）

那 15 个 md 还写了 `allowedTools: Read, Glob, Grep, LS, Bash` 和 `icon`，解析器同样不读（`SubAgentDefinition.cs:70` 注释只列 name / description / maxTurns / model / temperature）。**子代理的工具白名单可能同样是个摆设** —— 是否一并核实，待老大点名。

---

## S-54 agent 消息时间戳显示错误（永远显示开始时间）

**老大 2026-09-17**：「还有一个 bug，这个应该是 30 迭代或者 29 迭代处理的，增加了一个 agent 消息的更新时间，聊天窗 agent 回复会在结束后才显示时间。但是目前显示的时间都是错的。**先探索，探索后进需求**」

### 根因（已钉死，非推断）

写入侧正常、DB 读回正常，**断在 `ChatMessage` → `UnifiedMessage` 的转换层**。

`src/renderer/src/components/chat/MessageList/utils.ts:438-500` 的 `convertChatMessagesToUnified` 是**白名单式重建**：逐个字段搬运 `id` / `role` / `content` / `createdAt` / `usage` / `debugInfo` / `meta` / `preToolPhase` / `memoryRecall` —— **唯独没有 `updatedAt`**（`:451-456` 构造 `result`，`:458-462` 是全部显式搬运项）。

于是 `MessageItem.tsx:206-208` 的

```ts
createdAt={effectiveMessage.updatedAt ?? effectiveMessage.createdAt}
```

前半段**恒为 `undefined`**，永远回落 `createdAt`。`action-bar.tsx:150-155` 显示的因此永远是**开始时间**。

### 完整链路（两端正常，中间断）

| 环节 | 代码 | 状态 |
|---|---|---|
| 写入 | `stores/chat-store/index.ts:1521-1531` loop_end → `msg.updatedAt = finishedAt` | ✅ 正常 |
| 持久化 | `stores/chat-store/db-helpers.ts:131-139` `serializeMessage` 不带 `updatedAt`；DB 的 `updated_at` 由 Worker 时钟单独盖章 | ✅ 正常 |
| 读回 | `stores/chat-store/db-helpers.ts:145-152` `deserializeMessage` → `updatedAt` | ✅ 正常 |
| **转换** | **`components/chat/MessageList/utils.ts:451-456` 白名单重建漏 `updatedAt`** | ❌ **断点** |
| 消费 | `components/chat/MessageItem.tsx:206-208` `updatedAt ?? createdAt` | ✅ 逻辑对，拿不到值 |

顺带核实的相邻事实：
- `MessageRow` / `MessageList` 的 memo 不背锅 —— `updateMessage` 是 `Object.assign(msg, patch)`（`stores/chat-store/session-slice.ts:536-545`），原地改不重建对象；loop_end 时 `streamingMessages` 被删 → `isStreaming` prop 翻 false → `areMessageRowPropsEqual` 必然放行重渲染。
- 转换缓存不背锅 —— 失效判据是 `signature = JSON.stringify(messages)`（`utils.ts:434-441`），全量快照，能感知 `updatedAt` 的原地变更。

### 为什么 iter-30 当时「看着修好了」

iter-30 那轮（`ac30a723`）补的是 `action-bar.tsx:151` 的 `!isStreaming` 门控 —— 满足的是「**结束后才出现**」这条；「**显示结束时间**」这条从头到尾没通过。短回复（秒级）看不出来，跑几分钟的回复就明显是错的，所以拖到这次才被点出来。

### 修法

`utils.ts` 的 `convertChatMessagesToUnified`，在 `result` 构造后补一行：

```ts
if (typeof msg.updatedAt === 'number') result.updatedAt = msg.updatedAt
```

两个不该动的地方：
- **缓存层**：不用改，`JSON.stringify` 全量签名已覆盖 `updatedAt`。
- **`_revision`**（`utils.ts:472`）：**不该**加 `updatedAt`。它管的是「结构性重建」（文本/思考/工具数量变化触发 `renderableMessageIds` 重建），时间戳不属于结构，混进去只会多触发无谓重算。

### 实施（2026-09-17）

老大拍板：耗时格式取 **乙**（给 `formatDurationMs` 补小时档）。

| 文件 | 改动 |
|---|---|
| `src/renderer/src/lib/format-duration.ts` | `formatDurationMs` 补小时档（`1h30m`），并按老大要求**掐掉无意义的小数/零尾**：`1.0s`→`1s`、`1m0.0s`→`1m`、`1h0m`→`1h` |
| `components/chat/MessageList/utils.ts` | **正题**：`convertChatMessagesToUnified` 补 `updatedAt`（`typeof === 'number'` 才搬；缺省/脏值保持 `undefined`，不回填） |
| `components/chat/AssistantMessage/types.ts` | `AssistantMessageProps` 加 `updatedAt?: number` |
| `components/chat/MessageItem.tsx` | 拆成 `createdAt` + `updatedAt` 两个 prop（原来是 `updatedAt ?? createdAt` 的合并值，不拆算不出差值）；显示优先序挪进 action-bar，**显示值不变** |
| `components/chat/AssistantMessage/index.tsx` | 解构 + 透传 `updatedAt` |
| `components/chat/AssistantMessage/action-bar.tsx` | 时间改显示 `{updatedAt ?? createdAt}`，有差值时追加 ` · {formatDurationMs(updatedAt - createdAt)}` |
| `tests/message-timestamp/program.ts`（新增） | **25 断言**；`package.json` 加 `test:message-timestamp` |

**测试当场抓到一个错 —— 但错在我的期望值，不在代码**：`formatDurationMs(60_000)` 实际是 `1m0.0s`，因为「秒 < 10 保留一位小数」是**既有行为**（`digits = seconds >= 10 ? 0 : 1`），我凭印象写成了 `1m0s`。

老大随后定调「**不希望有 0S 这种显示**」。于是回头把无意义的尾巴统一掐掉：小数用 `replace(/\.0+$/, '')` 去零尾，整分/整点直接省掉尾单位。

| 输入 | 改前 | 改后 |
|---|---|---|
| `1000ms` | `1.0s` | `1s` |
| `9999ms` | `10.0s` | `10s` |
| `60000ms` | `1m0.0s` | `1m` |
| `3600000ms` | `1h0m` | `1h` |
| `86400000ms` | `24h0m` | `24h` |

其余读数（`850ms` / `1.5s` / `6.2s` / `8m34s` / `1h30m`）**一字未动**。

**测试环境坑**：`MessageList/utils.ts` 的依赖链会拉到 Electron IPC client（模块顶层读 `window.electron`），静态 import 直接 `ReferenceError: window is not defined`。按 `tests/renderable-chat-items/program.ts:510-523` 的**既有做法**解决 —— stub `globalThis.window.electron.ipcRenderer` + 动态 `import()`，类型用 `typeof import(...)` 编译期擦除。

**门禁**：typecheck（node + web）0 错；TS 全量 **24/24**（新增 1 个）；BOM clean（9 文件）。**未动 C#**。

**显示形态**：`09:20 · 8m34s`。老消息（`updated_at` 为 NULL）只显示时间、不显示耗时 —— 与 `??` 回落同一逻辑，无需特判；用户消息不显示耗时（`MessageItem.tsx:182` 只传 `createdAt`）。

### 附带需求：显示本轮耗时（老大 2026-09-17 追加）

**老大原话**：「我想顺便加一个耗时，也就是 修改时间-开始时间。显示从毫秒到秒 到小时，跟组件执行的耗时一样的显示格式」

**落点**：同一条时间戳行 —— `action-bar.tsx:150-155` 改为 `{结束时间} · {耗时}`。

**现成的格式化函数**：`src/renderer/src/lib/format-duration.ts` 的 `formatDurationMs(ms)` —— 全仓唯一定义，就是「组件执行的耗时」在用的那个（`ImageGeneratingLoader.tsx:147` 图片生成 loader、`InputArea/utils.ts:46` TTFT）。

| 区间 | 输出 |
|---|---|
| `< 1s` | `123ms` |
| `< 10s` | `1.5s` |
| `10s ~ 60s` | `15s` |
| `>= 60s` | `5m30s` / `15m0s` |

**⚠️ 待老大裁定一点**：该函数**只到分钟，没有小时档**（90 分钟会输出 `90m0s`）。老大说的「到小时」有两种落法：

- **甲**：直接用 `formatDurationMs`，严格「跟组件耗时一样」，**不动**共享函数（到分钟为止）
- **乙（我建议）**：给 `formatDurationMs` 补一档 `1h30m`。现有全部调用点（图片生成 loader / TTFT / 用量面板）都是**秒级**，走不进新分支，**零回归**；而 agent 回复实测已有 514s，长任务破小时完全可能，`90m0s` 很难看

**改动清单（连正题共 4 个文件）**：

| 文件 | 改动 |
|---|---|
| `components/chat/MessageList/utils.ts` | **正题**：`convertChatMessagesToUnified` 补 `updatedAt` |
| `MessageItem.tsx:206-208` | 现在传的是合并值 `updatedAt ?? createdAt`，**必须拆成两个 prop**（`createdAt` + `updatedAt`），否则算不出差值；显示优先序挪到 action-bar |
| `AssistantMessage/index.tsx` | props 加 `updatedAt` 并透传（`:60` 解构、`:469` 传递） |
| `AssistantMessage/action-bar.tsx` | `:150-155` 时间改 `{updatedAt ?? createdAt}`，有差值时追加 `· {formatDurationMs(updatedAt - createdAt)}` |

**天然降级**：老消息 `updated_at` 为 NULL → `updatedAt` 缺 → **只显示时间、不显示耗时**（无需特判，与 `??` 回落同一逻辑）。用户消息不显示耗时（`MessageItem.tsx:182` 只传 `createdAt`）。

---

## S-55 免费对话站点清单支持排序

**老大 2026-09-17**：「还有一个改进项，我们 30 迭代的时候增加了一个免费对话。然后在面板中有设置按钮支持自己维护清单，现在我需要让这个清单支持排序，往上或者往下，然后更改后面板中的选项卡同步生效，这也是一个追加需求」

### 探索结论：三个容易踩的点都天然成立

| 关注点 | 现状 | 结论 |
|---|---|---|
| **选项卡顺序跟谁** | `FreeChatPage.tsx:122` 渲染的是 `sites.map(...)`，**不是** `openIds.map` | 顺序跟**配置数组** ⇒ 改数组即改排列，无需额外同步 ✅ |
| **选中项会不会错位** | `freeChatActiveTabId` 存的是**站点 id**（`settings-store.ts:143`）；`restoreFreeChatTabs` 也逐项按 id 校验 | 按 id 追踪，**排序不串位** ✅ |
| **webview 会不会重建** | `key={site.id}`（`FreeChatPage.tsx:198`），且全部 webview 都是 `absolute inset-0` 叠放、靠 `invisible` 切换（`:202`） | 排序只动 DOM 顺序，**不重建、不重载、登录态不丢** ✅ |

这三点恰是 iter-30 / S-40 那轮反复踩过的地方（若 tab 按下标存、webview 按渲染顺序 key，排序必然出事）。实际实现是对的，**所以本需求没有隐藏坑**。

### 方案

1. **抽纯函数** `src/renderer/src/components/free-chat/free-chat-sites.ts`：
   `moveFreeChatSite(sites, siteId, direction: 'up' | 'down'): FreeChatSite[]`
   —— 越界、非法 id 一律**返回原数组引用**（便于调用方跳过无谓写盘）。抽成纯模块是为了可测。
2. `FreeChatSitesDialog.tsx`：每行在删除按钮**左侧**加一对上移/下移按钮（`ChevronUp` / `ChevronDown`），
   首行禁用上移、末行禁用下移；点击后 `updateSettings({ freeChatSites: moveFreeChatSite(...) })`。
3. locales zh/en `settings.json` 加 `freeChatPage.moveUp` / `moveDown`。
4. 新测 `tests/free-chat-sites/program.ts` + `test:free-chat-sites`。

### 明确不做

- **不做拖拽排序**。老大说的是「往上或者往下」，按钮足够；拖拽要多引依赖，触摸/键盘可达性还得重做。要做另开需求。
- **不动 `free-chat-tabs.ts`** —— 那是 tab 开关状态，与清单顺序无关。

### 实施（2026-09-17）

老大当日确认：「就是箭头往上往下就行，不拖拽，就是新增和删除清单的地方」，按上述方案落地。

| 文件 | 改动 |
|---|---|
| `components/free-chat/free-chat-sites.ts`（新增） | 纯函数 `moveFreeChatSite(sites, siteId, 'up' \| 'down')`；越界 / id 不存在一律返回**原数组引用** |
| `components/free-chat/FreeChatSitesDialog.tsx` | 每行删除按钮**左侧**加一对 `ChevronUp`/`ChevronDown`；首行禁上移、末行禁下移；`handleMove` 拿到原引用即跳过写盘 |
| `locales/{zh,en}/settings.json` | 加 `freeChatPage.moveUp` / `moveDown` |
| `tests/free-chat-sites/program.ts`（新增） | **15 断言**（正常挪动 / 越界返回原引用 / 退化输入 / 不可变性）；`package.json` 加 `test:free-chat-sites` |

**门禁**：typecheck（node + web）0 错；TS 全量 **25/25**（新增 1）；BOM clean（6 文件）。未动 C#。

**提交** `6ef73164`（6 files, +149/−3），**未推送**。

**一个接线细节**：`package.json` 同时装着 S-54 与 S-55 的测试脚本，而 S-54 的 `tests/message-timestamp/` **不能**跟着提交（它断言的是 S-54 的新行为，代码没提交就会挂）。所以提交前**临时摘掉** `test:message-timestamp` 那一行，提交完**立刻放回** —— 保证每一刀自洽，不留指向不存在文件的测试脚本。

---

## S-56 终端面板操作不流畅（命令历史 + Ctrl+C 行为）

**老大 2026-09-17 原话**：

> 我们现在有终端面板，会在聊天窗下方面板呈现。但是整体操作不流畅 1.没有 键盘上下键切换历史输入的命令 2.ctrl+c退出的时候还会额外询问

### 勘探结论（2026-09-17，已核实的代码事实）

| 事实 | 证据 |
|---|---|
| 面板与组件 | `components/terminal/BottomTerminalDock.tsx`（聊天窗下方面板，398 行）→ 每个 tab 挂 `LocalTerminal.tsx`（xterm 实例，309 行） |
| **渲染端零按键拦截** | `LocalTerminal.tsx:139-146` 的 `term.onData((data) => invoke(TERMINAL_INPUT, { id, data }))` —— 按键**原样透传** PTY，没挂 `attachCustomKeyEventHandler` |
| dock 的 keydown 不拦方向键 | `BottomTerminalDock.tsx:274-279` 只处理关闭 tab 按钮的 `Enter` / `' '`，其余一律 `return` |
| **实际 shell = cmd.exe** | `terminal-handlers.ts:196-211` 候选顺序 `preferred → ComSpec → powershell.exe → pwsh.exe`；而 `terminal-store.ts:87-90` 的 `TERMINAL_CREATE` **只传 `{ cwd, cols: 80, rows: 24 }`，不传 shell** ⇒ 落到 `ComSpec`，即 **cmd.exe** |
| 交互式启动参数 | `terminal-handlers.ts:225-232`：无 command 时 PowerShell 给 `['-NoLogo']`，cmd 给 `[]` |
| **用户换不了 shell** | 全仓 `terminalShell` 零命中，设置页无此项 |
| **关闭终端没有确认弹窗** | `BottomTerminalDock.tsx:208-213` 的 `handleClose` 直接 `closeTab` → `TERMINAL_KILL`；全仓 `window.confirm` / `confirm(` / `Terminate batch` 零命中 |
| PTY 由 node-pty 起 | `terminal-handlers.ts:323` `spawn(launch.shell, ..., { name: 'xterm-256color', cols, rows })` |

### 待核实（尚未定论，勿当结论用）

1. **现象 1 根因未定**：cmd.exe 自身有 doskey 历史，ConPTY 下 ↑↓ 通常可用。需要真机取「xterm 实际发出的字节」与「shell 是否响应」，才能分清是渲染层没发、PTY 没转、还是 cmd 在 ConPTY 下不认。
2. **现象 2 的「询问」原文未取到** —— 但**处置口径已定（老大 2026-09-17）**：「如果不是我们导致的现象，那就完全可以不用管呗」。即 **判定为非我方引入（shell 自身 / 被运行程序自身的提示）就不修**，只保留换 shell 带来的自然改善。全仓无相关 UI 代码（`window.confirm` / `ctrl+c` / `SIGINT` 零命中），大概率属「非我方」。

### 设置项语义（老大 2026-09-17 补充）

> 「S-56 必需 这个我希望能设置默认，也就是首次打开用什么，所以我才在说希望在设置页可以调整」

**定性：这是个「默认 Shell」设置项，不是「即时切换」。**

- 作用范围 = **新建的终端 tab**（`terminal-store.createTab` 读取后随 `TERMINAL_CREATE` 下发）
- **已有 tab 不回溯** —— 正在跑的进程换不了 shell，这是终端的本性，不是缺陷
- 因此必须落在**设置页**（`settings-store`，持久化），不能只做在终端面板里（面板里只有会话级 / 临时操作）
- **设置项位置已定（2026-09-17）：A —— 合进现有 `ssh` tab，label 改「终端与 SSH」**，上面一段「终端」（默认 Shell）、下面一段「SSH 连接」（现值不动）

**取值形态（老大 2026-09-17 确认）**：

> 「下拉框还是有必要的，我设置了默认 PowerShell 但是有些场景需要用到 cmd」

⇒ 下拉**必做**（不能只改候选顺序了事）—— 需要按场景切回 cmd。

| 选项 | 行为 |
|---|---|
| **自动**（出厂默认） | 走候选链，但**顺序改为 PowerShell 优先** |
| PowerShell | 固定 `powershell.exe` |
| cmd | 固定 `cmd.exe` |
| 自定义 | 手填可执行文件路径 |

**出厂默认取「自动」而不是显式 PowerShell**：机器上没装 PowerShell 时不会直接失败，退回候选链仍有 cmd 兜底；而「自动」的顺序已是 PowerShell 优先，所以正常机器开箱即得 PowerShell。

**为什么建议把「自动」的顺序改成 PowerShell 优先**：现行顺序是 `ComSpec`(= cmd.exe) → `powershell.exe` → `pwsh.exe`（`terminal-handlers.ts:199-204`），**这正是本需求两个现象的源头**。默认值若继续落在 cmd.exe，装完还是被坑，等于设置项白加。改顺序 + 默认「自动」，老用户不操作也能拿到 PowerShell。

**副作用提示**：现象 2（Ctrl+C 额外询问）若是 cmd.exe 执行 `.cmd` / `.bat` 的原生 `Terminate batch job (Y/N)?`，换 PowerShell 后自然消失。**但这条仍待老大给询问原文确认**，不要当已定论。

### 技术方案（2026-09-17 已定）

**取「加设置项」+「候选顺序 PowerShell 优先」的组合** —— 光改顺序不够，因为老大要按场景切回 cmd。

| 原候选 | 结论 |
|---|---|
| **A** 默认 shell 换成 PowerShell | **采纳一半** —— 不写死默认，而是把「自动」的候选顺序改成 PowerShell 优先 |
| **B** 保留 cmd.exe，另修输入通路 | **不做** —— 换 shell 已解决现象 1；现象 2 若是 cmd 自身行为，修通路也治不了 |
| **C** 新增 `terminalShell` 设置项 | **采纳**（老大 2026-09-17：下拉必做） |
| **D** 渲染端自建命令历史 | **不做** —— 与 shell 自带历史冲突 |

### 落地清单（待开工）

| 落点 | 改动 |
|---|---|
| `src/main/ipc/terminal-handlers.ts:199-204` | Windows 候选链顺序改为 `preferred → powershell.exe → pwsh.exe → ComSpec` |
| `stores/settings-store`（+ `-types`） | 新增 `terminalShell`（`'auto'` \| `'powershell'` \| `'cmd'` \| 自定义路径），默认 `'auto'`，纳入 `partialize` |
| `stores/terminal-store.ts:87-90` | `createTab` 读设置，非 `'auto'` 时随 `TERMINAL_CREATE` 下发 `shell` |
| `components/settings/SshPanel.tsx` + `SettingsPage.tsx` | 合进 `ssh` tab：label 改「终端与 SSH」，上半段「终端」、下半段「SSH 连接」（SSH 现值不动） |
| locales zh/en | `tabs.ssh.label` → 「终端与 SSH」/ "Terminal & SSH"；新增终端段文案 |

> **验收标准**：现象 1 是硬的（↑↓ 能翻历史）；现象 2 若判定为非我方引入则**不计入验收**。

### 实施（2026-09-17）

**开工时的一个发现直接改写了落地方式：这套 shell 配置是「存了不用」的死配置。**

`settings-store` 里 `shellExecutionEndpoint`（`:156`）+ `customShellExecutable`（`:157`）+ `shellEnvironmentVariablesText`（`:158`）**全都在** —— 默认值（`:309-311`）、`partialize`（`:472-474`）、migrate（`settings-store-migrate.ts:309-315`）、类型与默认常量（`settings-store-types.ts:38-48`）、纯函数 `normalizeShellExecutionEndpoint`（`:276`）与 `resolveShellExecutable`（`:292`）**一应俱全**，但是：

- **UI 组件零引用** —— 没有任何设置项能改它
- **`resolveShellExecutable(` 零调用方** —— `settings-store.ts:108` 那个 import 是死的

⇒ 所以**不新增 `terminalShell`**，改为**把这套现成配置接上**（接入口 + 接消费方）。上方「落地清单」里新增字段那一行作废。

| 落点 | 改动 |
|---|---|
| `src/main/ipc/terminal-handlers.ts:198-207` | Windows 候选链顺序改为 `preferred → powershell.exe → pwsh.exe → ComSpec`，附注释说明理由 |
| `src/renderer/src/stores/terminal-store.ts` | `createTab` 读 `shellExecutionEndpoint` + `customShellExecutable` → `resolveShellExecutable({ endpoint, customShellExecutable, platform: window.electron?.process?.platform })`，非 undefined 时随 `TERMINAL_CREATE` 下发 `shell` |
| `src/renderer/src/components/settings/SshPanel.tsx` | 页面标题改「终端与 SSH」；新增 `SettingsSection#sec-terminal-shell`「终端」段（平台相关端点下拉 + `custom` 时才出现的路径输入框）；原 SSH 列表降为第二段，标题从页面级 `h1` 改为 `h2` |
| `src/renderer/src/components/settings/SettingsPage.tsx:83` | `tabs.ssh.label` 默认值改「终端与 SSH」 |
| `src/renderer/src/locales/{zh,en}/settings.json` | `ssh.title` / `description` 改写；新增 `ssh.terminal.*`（title / description / customPlaceholder / 8 个 `shellOptions`）与 `ssh.connections.*` |
| `tests/shell-executable/program.ts`（新增） | **35 断言** —— `resolveShellExecutable` 此前**零覆盖**：auto 与非法值 → undefined、三个 Windows 端点、三个 POSIX 端点、跨平台回落、custom 的 trim 与空白、platform 大小写空白、`normalizeShellExecutionEndpoint` 全值域 |

**端点选项按平台给**（`getShellEndpointOptions()`）：Windows = `auto / powershell / pwsh / cmd / custom`，POSIX = `auto / zsh / bash / sh / custom`。

**门禁**：typecheck 三配置 0 错；TS 全量 **26/26**（新增 1 套）；locale JSON 合法（Node UTF-8 校验）；6 个触碰文件 BOM clean。未动 C#。

---

## S-57 排队消息在 UI 上看不到内容（只能看到「有一条」）

**来源**：老大 2026-09-17 原话 ——「本身我们UI上可以继续发送消息后续消息排队的，但是现在排队看不到发送的消息，只知道有一条，消息长了可以折叠，但是需要显示出来，并且移入可以看到全文才行，这是一个小改动，不走完整流程，可以登记一下就推动」

**现状（已核实）**：`components/chat/InputArea/queued-messages-panel.tsx:128-281` 的面板本身存在且默认渲染（`suppressPendingQueue` 全仓无调用方传 `true`），但每条只给：

- 序号 `index + 1`（`:249-251`）
- `summarizeQueuedMessage(msg.text)` 的 **72 字截断摘要**（`InputArea/utils.ts:324-328`）
- `truncate` **单行**省略号（`:252-254`）
- **没有任何 `title`** ⇒ 悬停无从看全文（该文件仅 3 处 `title`，均属「立即插入 / 图片预览 / 移除图片」）

**诉求**：① 消息内容要能看到；② 长了可以折叠（截断可以，但要露得出来）；③ **移入（悬停）能看到全文**。

**改动**

| 落点 | 改动 |
|---|---|
| `components/chat/InputArea/utils.ts` | 新增纯函数 `queuedMessageFullText(text)`：`expandPastedBlocks` 展开折叠粘贴块 → `selectFileTextToPlainText` 去掉 `<select-file>` 等标签 → `trim`。供悬停全文使用 |
| `components/chat/InputArea/queued-messages-panel.tsx` | 摘要行加 `title={全文}`（回落到 `fallbackText`，保证非空消息必有提示）；`truncate` → `line-clamp-2` + `break-words`，长消息折叠成两行而不是一行 |
| `tests/queued-message-text/program.ts`（新增） | 覆盖纯函数：普通文本 / 折叠粘贴块展开 / select-file 标签去标签 / 空串 / 纯空白 |

**不做**：不动聊天窗消息流（排队消息不进聊天窗是 S-33 之后的既定设计）；不放宽 `summarizeQueuedMessage` 的 72 字截断 —— 视觉截断交给 CSS，悬停已有全文。

### 形态调整（老大 2026-09-17 拍板）

**原话**：「首先插入发送，和删除这个是每条消息的，不是最终统一在上面一起，然后可以收起和展开」「头部不再放，点击 c 就是 C 先插入，默认展开 收起后按照你的推荐来」

**四条裁定**

1. **「立即插入」下放到每条**，头部不再放 —— 留两个入口就是同一个动作两处，容易混。
2. **点哪条插哪条**：队列 `[A, B, C]` 时点 C 的插入 = C 先进当前轮，A、B 继续排队。底层 `insertPendingSessionMessageNow(sessionId, messageId)` **本来就按 id 取**，此前只是 UI 把按钮放头部、写死传 `queuedMessages[0]`。
3. **默认展开**，收起状态不持久化、不跨会话。
4. **收起后**：标题「排队消息 (1)」+ 右侧箭头，**整行可点**；「清空」仍留头部（那是整队动作，不该每条都有）。

| 落点 | 改动 |
|---|---|
| `use-queued-messages.ts` | `insertQueuedMessageNow` 由 `()` 改收 `messageId`；去掉 `queuedMessages[0]` 那份写死；依赖数组去掉 `queuedMessages` |
| `queued-messages-panel.tsx` | 新增 `collapsed` 状态（默认 `false`）；头部标题区改为可点按钮 + `ChevronDown`（收起时 `-rotate-90`），去掉头部「立即插入」；列表区 `{!collapsed && ...}`；每条行尾加「立即插入」（同样受 `canInsertNow` 门控） |

**额外一处（我按建议做，老大未明确表态，可回退）**：行尾按钮组由 `opacity-0 group-hover:opacity-100` 改为**常显**。理由：按钮从 2 个变 3 个，hover 才显形会让人点不到；这是「下放到每条」能顺用的前提。

### 「编辑」改「取回」（老大 2026-09-17 拍板 B）

**起因**：老大问「点编辑是移除，然后输入到输入框里面去，这个是这个效果么」—— 答：**不是**。现状是**就地编辑**（那一行原地变 Textarea + 图片管理，保存后仍在队列原位）。给出三个选项（A 保持就地编辑 / B 改成取回 / C 两者都留），老大回「**B 呀**」。

**取舍依据**：就地编辑只有一个简化 Textarea，选中文件、粘贴图片、`/` 命令、`@` 引用全都用不了；真要改内容，还得删掉重打。代价是取回后重发会回到**队尾**。

**改动（就地编辑整块下线）**

| 落点 | 改动 |
|---|---|
| `use-queued-messages.ts` | 删 `editingQueueItemId` / `editingQueueText` / `editingQueueImages` 三个 state 与 `startEditQueuedMessage` / `cancelEditQueuedMessage` / `saveQueuedMessage` / `addQueuedImages` / `removeQueuedImage` / `handleQueueEditPaste` 六个 handler；新增 `takeBackQueuedMessage(id)`；`UseQueuedMessagesOptions` 由 6 项收到 3 项（去掉 `isStreaming` / `getPastedImageFiles` / `setPreviewImage` —— 它们只服务编辑态） |
| `use-input-area-effects.ts` | 新增 `pendingInsertImages` 消费端（追加进 `attachedImages`）；文本仍走原有 `pendingInsertText` |
| `stores/ui-store{,-interface}.ts` | 新增 `pendingInsertImages` / `setPendingInsertImages` —— `attachedImages` 是 InputArea 的**局部 state**，此前没有任何外部写入通道，图片只能靠新开一条 |
| `queued-messages-panel.tsx` | 删编辑态整块 UI；「编辑」→「取回」；props 由 23 项收到 13 项 |
| `composer-editor-area.tsx` | 删专为编辑态上传排队图片的隐藏 `<input type="file">` 及其两个 props（`queueFileInputRef` / `addQueuedImages`） |
| `use-chat-actions.ts` | 删 `updatePendingSessionMessageDraft` —— 唯一调用方就是删掉的 `saveQueuedMessage`，已确认 src + tests **零引用** |
| locales `{zh,en}/chat.json` | 新增 `queueTakeBack` / `queueTakeBackHint`；删孤儿 key `queueEditing` / `queueImageCount` / `queueRemoveImages`（同样零代码引用） |

**语义**：取回 = 从队列移除 + 文本与图片送回 composer。走的是**追加**语义（与文件树「添加到会话」同一条路），**不覆盖**用户已经打进去的内容 —— 取回把已有草稿毁掉是数据丢失，不能接受。队列里存的是 `<pasted-block>` 标签形态，进输入框前用 `expandPastedBlocks` 展开回原文（沿用 T-13 的既有约定）。

### 「立即插入」没有回显（S-33 遗留缺口，老大 2026-09-17 发现）

**原话**：「这个立即插入，我没有看到聊天窗有渲染」

**根因（不是坏了，是压根没做）**：`insertPendingSessionMessageNow`（`use-chat-actions.ts:770-801`）只做两件事 —— ① 调 `agent/append-messages` 把消息塞进 run 的内存队列；② 把渲染端队列里那条删掉。**渲染端 `session.messages` 一个字都没动**。

再深一层：Worker 侧也不落库 —— `AgentRuntimeRunState.EnqueueMessages`（`:112-145`）只往 `_queuedMessages` 塞，`AgentLoop.cs:299` 在下一轮 iteration 起点 `DrainQueuedMessages` 读进对话。**整条链没有一处碰数据库**。所以这条消息：agent 下一轮读得到（功能是通的），但界面上永不出现、刷新/重启后也不存在。

这是 S-33 实现时就有的洞（当时验收只盯「agent 能不能读到」）；本轮把按钮从头部下放到每条之后才露出来。

**修法（老大拍板 A）**：渲染端插入成功后自行回显 + 落库。

| 落点 | 改动 |
|---|---|
| `stores/chat-store/session-slice.ts` | 新增 `insertUserMessageIntoRunningTurn(sessionId, msg)`：插在**正在流式输出的那条 assistant 之前**（找不到流式消息就退回落末尾）；维护 `messageCount` / `messagesLoaded` / `isRuntimeResident` / `updatedAt`。不碰 streaming 状态、不开新一轮 |
| `hooks/use-chat-actions.ts` | `insertPendingSessionMessageNow` 成功分支：构造 `ChatMessage` → 调上面的 action → `dbUpsertMessage(sessionId, msg, 0)`；整体包 try/catch，回显失败只 warn，**不影响插入本身的结果** |

**为什么插在流式消息之前**：这条消息是被插进**当前这一轮**的（agent 输出到一半时用户插话），追加到末尾会变成「一条 user 紧跟正在输出的 assistant」，看着像两条 user 连在一起。

**B 案（Worker 落库 + 发事件）有意不做**：两边内容实质相同，为它上跨端改动不划算。已知代价 = Worker 内存那份与渲染端 DB 那份各存一份（内容一致）。

**老大对 sortOrder 的口径**：「sortOrder 没什么用，目前是根据创建时间来的」—— 故 `dbUpsertMessage` 的第三参传 0，排序以 `createdAt` 为准。

---

## S-58 跨会话派发被误报为失败（实际是排队中）

**来源**：老大 2026-09-17 原话 ——「目前全局会话可以给项目下会话发送消息，正常发送消息前端可以排队，但是工具返回的值让 agent 以为是报错了，实际是排队中」

### 现象

全局会话（项目管理者）给**已有一个活跃 run** 的项目会话派任务：

- **前端行为是对的** —— 消息进排队区（`_pendingMessages`），当前轮结束后自动出队执行
- **但工具返回值是失败** —— agent 据此判断「派发失败」，可能重试、可能换路子、可能直接向用户报错

功能没坏，`false` 这个词传错了。

### 根因链（三层，已核实）

**第 1 层：`sendMessage` 的 `false` 有两种语义，调用方无从区分**

`src/renderer/src/stores/chat-store/index.ts` 的 `sendMessage` 共三处 `return false`：

| 行 | 含义 |
|---|---|
| `:200` | **真失败** —— 没有 sessionId |
| `:235` | **正常排队** —— 该会话已有活跃 run，消息已入队（iter-30 BUG-A 修复引入） |
| `:434` / `:455` | **真失败** —— `agent/run` 未启动 / 抛异常 |

返回值类型是 `boolean`，实际语义被复用成「是否启动了新一轮」，**「已受理但排队」没有独立表达**。

**第 2 层：派发侧把 `false` 一律当失败**

`src/renderer/src/lib/tools/project-send-message.ts:225-230`：

```ts
if (!started) {
  if (channelRegisteredHere) unregisterExternalChannelReply(sessionId)
  const error = `Failed to start message processing for session "${sessionId}".`
  await failScheduledFollowUp(error)
  return { success: false, error }
}
```

排队走的就是这一支。附带两个副作用：

1. **渠道回执注册被撤**（`unregisterExternalChannelReply`）—— 消息还没跑，回执链先断了
2. 带 `followUp` 时把已排的跟进任务标成 `blocked`（`failScheduledFollowUp`）

**第 3 层：Worker 把渲染端返回的 JSON 原样丢给 agent**

`AgentRuntimeProjectExecutor.cs:298-302`（`send_session_message` 工具）：

```csharp
var output = result.ValueKind == JsonValueKind.String
    ? result.GetString() ?? string.Empty
    : result.ToString();
return string.IsNullOrEmpty(output) ? "Message sent successfully." : output;
```

`result` 是渲染端返回的**对象** ⇒ 走 `result.ToString()` ⇒ agent 的工具输出里明明白白写着：

```
{"success":false,"error":"Failed to start message processing for session \"xxx\"."}
```

**agent 看到 `success:false` + `error`，判定为报错 —— 这正是老大观察到的现象。**

### 影响面：同一通道三个消费方，另两条更严重

| 消费方 | 落点 | 排队时的行为 |
|---|---|---|
| `send_session_message`（老大报的） | `AgentRuntimeProjectExecutor.cs:298-302` | JSON 原样进工具输出 ⇒ **agent 以为失败** |
| `send_work_request` | `AgentRuntimeGlobalTaskExecutor.cs:260-266` | `ExtractDeliveryFailure` 判失败 ⇒ `MarkDispatchFailed` + `EncodeError` ⇒ **dispatch 记录被误标 failed** |
| `reply_global_dispatch` | `AgentRuntimeGlobalDispatchReplyExecutor.cs:186-194` | 报 `Reply recorded but not delivered to the global session` ⇒ **项目会话回报给正在跑的全局会话本来必然排队**，却被标成未送达 |

可见「排队」是跨会话派发的**常态**，不是边缘情况 —— 全局会话派活时项目会话多半在跑；项目会话回报时全局会话也多半在跑。

### 修法（待拍板）

**核心：让「已排队」成为一个成功结果，从渲染端一路正确地传到工具输出。**

| 方案 | 内容 | 评价 |
|---|---|---|
| **A（推荐）** | 渲染端 handler 拿到 `started === false` 后**回查队列**（`getPendingSessionMessages(sessionId)` 里存在刚入队这条）→ 是则返回 `{ success: true, result: 'Message queued for session "X"; it will run after the current turn finishes.' }` | 最小改动；不动 `sendMessage` 签名（全仓多处依赖 `boolean`）；**无竞态** —— 入队是同步写 `_pendingMessages`，`await` 返回后立刻可读 |
| **B** | 改 `sendMessage` 返回值语义（如 `true \| 'queued' \| false`），调用方精确判断 | 语义最干净，但要改签名 + 全部调用点，收益与风险不成比例 |
| **C** | handler 调用前先判忙，忙则**自己**入队（带 `rawParams`）再返回成功 | 不依赖回查，但「判忙 → 入队」之间有竞态窗口，且把入队逻辑搬出了 store |

**无论选哪个都要配套两条**：

1. `project-send-message.ts` 的失败分支**不再无条件**撤渠道回执注册 / 标 `blocked` —— 只有真失败才撤
2. Worker 侧 `SendSessionMessageAsync` 不该把渲染端返回对象 `ToString()` 当工具输出 —— 至少把 `result` 字段提出来，`success:false` 才有资格进 error

**验收标准**：全局会话给正在跑的项目会话派任务 → 工具返回明确写「已排队」→ agent 不重试、不报失败；队列消息照常出队执行；渠道会话下回执注册不被撤。

### 实施（2026-09-17 老大拍板 A）

| 落点 | 改动 |
|---|---|
| `src/renderer/src/lib/tools/project-send-message.ts` | 调 `sendMessage` **前**记下 `getPendingSessionMessages(sessionId).length`；`!started` 时回查队列 —— 命中 `text === content` 的条目或长度增长 ⇒ 判为「已入队」，返回 `{ success: true, result: 'Message queued for session "X"; it will run after the current turn finishes.…' }`；**只有真失败**才走原来的撤渠道注册 + `failScheduledFollowUp` + `success: false` |
| `src/runtime/WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs` | 新增 `FormatSendSessionMessageResult`（`internal`，供回归直测）：按 `success` 分流 —— `false` → `EncodeError(error)`；`true` → 只交出 `result` 文案；无 `result` / 空白 → `"Message sent successfully."`；非对象（字符串）原样透传。**不再 `result.ToString()` 把整份信封抖给 agent** |
| `tests/WishfulClaw.GoalRegressionTests/Program.SendSessionMessage.cs`（新） | 11 断言，`Program.cs` 注册 `RunSendSessionMessageResultSuite()` |

**另两条消费方自动跟着好（已核实：走的都是同一个 reverse-request `project/send-session-message`）**：

- `send_work_request` —— `AgentRuntimeGlobalTaskExecutor.cs:245-246` 发同一个 reverse-request，`:260` 的 `ExtractDeliveryFailure` 见到 `success:true` 即不再 `MarkDispatchFailed`
- `reply_global_dispatch` —— `AgentRuntimeGlobalDispatchReplyExecutor.cs:184-186` 同样；排队时报 `delivered=true`，不再输出「Reply recorded but not delivered to the global session」

**排队判定为什么能命中**：`stores/chat-store/index.ts:232-236` 的入队是**同步**写 `_pendingMessages`（`enqueuePendingSessionMessage` 直接 set），`await sendMessage(...)` 返回时队列已经改完，回查没有竞态窗口。

**没动 `sendMessage` 签名**：返回 `boolean` 的语义复用确实是根因，但全仓多处依赖它；B 案（改成 `true | 'queued' | false`）收益与风险不成比例。渲染端回查把「排队」在**唯一需要区分它的地方**（派发 handler）判出来。

**门禁**：Worker 与 `tests.sln` 各 0 警告 0 错误；C# 回归 10/10（Goal 230 → **241**）；typecheck 三配置 0 错；TS 27/27；BOM clean。

**待老大真机验收**：全局会话给正在跑的项目会话派任务 → 工具输出写「已排队，当前轮结束后运行」→ agent 不重试不报错；队列消息照常出队执行；渠道会话下回执注册不被撤。

---

## S-59 聊天模式（含全局会话）放开 YOLO 权限档

**来源**：老大 2026-09-17 口述 —— 「全局对话的 shell 默认会弹审批，之前前端处理过，只有协作模式才出来可以选择 YOLO 的。但是现在这种处理方式，全局对话特别难受，聊天模式也把 YOLO 放出来吧」。

**现象**：全局会话（`scope=global`）的协作模式恒为 `chat`，而权限档被 `collaborationMode === 'cowork'` 死死绑定 ⇒ 全局会话永远拿不到 YOLO，每次跑 shell 都得点一次审批；项目里开 chat 模式的会话同样如此。

**根因（四道门，缺一不可）**：

| 门 | 落点 | 现状 |
|---|---|---|
| ① UI 显隐 | `components/chat/InputArea/index.tsx:445` | `showPermissionControl={projectScoped && effectiveCollabMode === 'cowork'}` |
| ② 渲染派生 | `components/chat/InputArea/use-composer-mode-state.ts:36-38` | 非 cowork 一律 `'default'`（`:44` 切到 chat 还会把 pending 清成 default） |
| ③ 渲染端会话归一化 | `lib/session-context.ts:36-42`、`:57-62` | global 硬编码 `permissionMode: 'default'`；project 在 chat 时强制 `'default'` |
| ④ **Worker 侧会话归一化** | `WishfulClaw.Infrastructure/Db/DbSessionTools.cs:414-417`、`:432-436` | 同上，global 强制 default、chat 强制 default —— **只改前端会被这里抹回去** |

**口径（2026-09-17 19:51 老大改定，覆盖先前"缺省不动"）**：

- **YOLO 也共享 cowork 中的默认值** —— 缺省不再按协作模式分流，聊天 / 协作 / 全局共用同一个默认来源（`coworkDefaultPermissionMode`）。显式选择照旧优先。
- **渠道会话默认 YOLO** —— 先前的"渠道护栏保留 default"被推翻。外部入口没人守着，弹审批只会把这一轮挂死。
- 渠道会话仍不显示权限控件（`!pluginId`），所以它没有"显式选择"的入口，档位由代码写死。

**实施记录**：

| 落点 | 改动 |
|---|---|
| `lib/session-context.ts` | global / project 两条分支的缺省都改成 `defaults.coworkPermissionMode`，不再看 `collaborationMode` |
| `components/chat/InputArea/use-composer-mode-state.ts` | 派生缺省由 `collabMode === 'cowork' ? 设置值 : 'default'` 改为直接 `defaultCoworkPermissionMode` |
| `hooks/use-chat-actions.ts` | `permissionMode: isChannelSession ? 'default' : session.permissionMode` → `permissionMode: session.permissionMode` |
| `hooks/use-channel-auto-reply.ts` | 两处：① 本地兜底会话的 `normalizeSessionContext` 显式传 `permissionMode: 'fullAccess'`（渠道 YOLO 的来源，与 Worker 侧一致）；② 发 run 时的 `permissionMode: 'default'`（写死）改为 `session.permissionMode ?? 'fullAccess'` —— **这条是渠道消息进入的主路径，不改则连新建的渠道会话也照样弹审批挂死**（上一轮漏改，2026-09-17 20:0x 补） |
| `WishfulClaw.Infrastructure/Db/DbPluginSessionRouting.cs` | 新建渠道会话的 `permissionMode` 由 `"default"` 改为 `"fullAccess"` —— 这是 Worker 侧唯一在写这条的地方 |
| `WishfulClaw.Infrastructure/Db/DbClient.cs` | 迁移改写：原来是 `scope = 'global'` 一律填 `'default'`；现在改为填 `'fullAccess'`，且只命中「NULL / 非法值」与「渠道会话的 `'default'`」（渠道会话的 default 是系统塞的，用户没有入口能选） |
| `locales/{zh,en}/settings.json` | `sessionDefaults` 文案同步新语义（"新建会话"、"默认权限模式"、hint 说明渠道固定 YOLO） |

**刻意保留**：非渠道会话里用户**显式选过**的 `'default'` 不动 —— 那是他的选择，迁移不能替他改。迁移只吃「从未有过取值」与「渠道会话的 default」。

**渠道会话的判据**（2026-09-17 补）：不能只看 `plugin_id`。早期格式的渠道会话只有 `external_chat_id`（形如 `plugin:<id>:chat:<chatId>`），`plugin_id` 可能是 NULL 或空串 —— 只看 `plugin_id` 会让这批老会话漏网、继续弹审批。现判据为 `plugin_id` / `external_chat_id` / `channel_route_key` 三者任一非空。

**副作用（知悉）**：渠道会话在 UI 上不显示权限控件（`!pluginId`），所以它的档位没有任何人工入口 —— 迁移后即为 YOLO 且改不回去。若日后要放开，需先给渠道会话补上控件。

**测试**：`tests/session-permission-mode/program.ts`（24 断言，重写为共享缺省口径）；`PluginSessionRoutingTests.cs` 渠道会话断言由 `default` 改 `fullAccess`。

**验收标准**：新建全局会话缺省即 YOLO → 跑 shell 不弹审批；设置里把默认权限改成 Default → 新建会话回到审批；已有会话不受影响；渠道会话跑 shell 不弹审批（且无权限控件）。

---

## S-60 PowerShell 工具参数名与 schema 不符（任何调用都失败）

**来源**：老大 2026-09-17 报 —— 「PowerShell 工具被 proxied 后传参被吞 —— 子 agent 直接调一律"PowerShell requires a non-empty script."，本轮失败 1 次、上轮失败 4 次，都得绕道 Bash 里嵌 powershell.exe -NoProfile -Command」。

**根因：schema 与执行器读的参数名不一致，且与代理无关。**

| | |
|---|---|
| schema 声明 | `Tools/Providers/CodeCompatibleToolProvider.cs:23` → `command` |
| 执行器读取 | `AgentRuntimeCodeCompatibleExecutor.cs:57` → `call.Input.script` |

取不到即判空 → 报「requires a non-empty script」。**直连和走代理一样失败**，"被代理吞参数"是表象而非归因。文件头自述 "Simplified port from WishfulClaw"，属移植遗留。

**改动**（`AgentRuntimeCodeCompatibleExecutor.cs`）：

1. 参数名对齐：`script` → `command`，错误文案一并改（模型看到能自己纠正）
2. 命令行拼法改 **`-EncodedCommand`**（Base64 / UTF-16LE）—— 原为手拼 `-Command \"{script.Replace("\"","\\\"")}\"`，脚本里只要有引号就会被拆坏。**只修参数名的话，这工具一被真正使用还会撞上这个**，所以一并改

**顺带查明（未修）**：`Monitor` 同类错位且更严重 —— schema 声明 `session_id`（描述是"监控**已启动**的进程"），执行器 `ExecuteMonitorAsync:120` 读的却是 `command`（执行一段命令）。**不只是参数名，语义都对不上**，等老大定它该是什么再动。

**同批反馈的「Bash 工具 `$` 被吃掉」不是本仓问题**：实测在 Bash 工具里 `$items` / `$it` / `$LASTEXITCODE` 全部正常。子代理遇到的是它自己被迫绕道 `powershell.exe -Command "..."` —— 外层就是 PowerShell，双引号内 `$f` **先被外层展开成空**，实测复现 `foreach ( in @('a','b')) { Write-Output  }` 报 `Missing variable name after foreach`。正确写法是外层用单引号或 `-EncodedCommand`。**工具修好后不必再绕道，此坑自然绕开。**

**门禁**：Worker 编译 0 警告 0 错误；typecheck 0 错；TS 29/29；BOM clean。

**老大真机验收（2026-09-17 晚）**：**已通过。**

---

## S-61 右侧面板 git 三选项卡职责重排（变更下架 / git 只换 diff 弹窗 / 分支加同步）

**来源**：老大 2026-09-17 22:00 口头下达，分两轮澄清。

**背景**：右侧面板（`AgentFilesPanel`）同一条 tab 栏挂了四个入口 —— `files` / `changes` / `branches` / `git`，后三个各带一套自己的 git 能力，职责重叠：

| tab | 组件 | 现在有什么 |
|---|---|---|
| `changes` | `components/cowork/changes-panel.tsx` | 未提交变更列表 + **提交区**（commit 框 / Commit / Amend / Push / Sync 下拉）+ **点文件 diff 弹窗** |
| `branches` | `components/cowork/branch-panel.tsx` | 纯只读：commit graph + 本地/远端分支列表 |
| `git` | `chat/GitPage.tsx` | SCM 侧栏（暂存 / 提交 / 同步四件套 / 分支右键菜单）+ 历史栏 + diff；紧凑宿主下点文件弹 `GitDiffContent` 简表 |

**口径（老大原话，两轮）**

> 「实际上变更选项卡的点文件看 diff 更全面，所以让你把现有的 git 的点击查看换一下，git 上的本身分支操作可以保留」
> 「首先变更选项卡删掉，只是要它的 diff 弹窗接到 git 上去。git 选项卡本身就是改一下弹窗其它不动了。分支增加拉取合并这些，不要提交，简单来说分支就是纯拉取和切换同步」
> 「合并指的是合并分支」

**落地**

1. **`changes` 选项卡删除** —— tab 与组件一并下架；它唯一不可替代的东西是那个 diff 弹窗，搬到 git 上。
2. **`git` 选项卡只换弹窗** —— 紧凑态点文件由 `GitDiffContent` 简表换成 changes 那套：96vw 弹窗 / 文件内 ←→ 翻页 / `N/total` 计数 / 全屏切换 / 跳外部预览 / 左侧 240px 文件列表 / `CodeDiffViewer`（带行号、可切 diff 模式）。宽态三栏内联、SCM 侧栏、同步四件套、分支右键菜单**全部不动**。
3. **`branches` 选项卡从只读变可操作** —— 加「与远端同步那一组」（fetch / pull / push / sync）+「点分支切换」+「合并分支」；**不放任何提交入口**（老大明说"不要提交"）。

**已知代价**：`changes-panel` 的提交区随之消失，其中的 **Commit & Sync**（提交并同步的组合动作）在 git 上没有对应入口（git 只有普通 commit）。老大未要求补，先按不补处理。

**已实施（2026-09-17 22:30）**

| 文件 | 改动 |
|---|---|
| `components/layout/AgentFilesPanel.tsx` | `TABS` 去掉 `changes`（现为 files / branches / git），删 `ChangesPanel` 的 import 与渲染分支 |
| `components/chat/GitPage/git-diff-dialog.tsx`（新） | 共享 diff 弹窗外壳：96vw 宽 / 全屏切换 / `N / total` 计数 / ←→ 环绕翻页 / 跳外部预览 / 左侧 240px 文件列表；差异正文由调用方 `children` 提供，便于两端共用 |
| `components/chat/GitPage/diff-chunks.ts`（新） | `diffTextToChunks(text)` —— unified diff 文本 → `CodeDiffViewer` chunk（取代 changes-panel 内的私有 `toChunks`） |
| `components/chat/GitPage.tsx` | 紧凑弹窗换成 `GitDiffDialog` + `CodeDiffViewer`（带行号、可切 split/inline）；新增 `diffChunks` / `compactRows` memo。宽态三栏内联、SCM 侧栏、同步四件套、分支右键菜单**未动** |
| `components/cowork/branch-panel.tsx` | 顶部加 fetch / pull --rebase / push / sync 四个动作（进行中转圈、成败 toast、完成后刷图）；本地分支行可点击切换（当前分支与远端分支不响应）；非当前本地分支 hover 出「合并到当前分支」按钮（带确认框） |
| `locales/{zh,en}/layout.json` | `agentFiles` 段新增 12 个 key：`fetch/fetchDone/pullRebase/pullRebaseDone/push/pushDone/sync/syncDone/branchCheckoutDone/branchMergeIntoCurrent/branchMergeIntoConfirm/branchMergeDone` |

`changes-panel.tsx` 文件本身保留（tab 下架后全仓零引用），按老大「gitpage 成熟后再下架」的口径没删。

**裁定（老大 2026-09-17 22:06）**：合并分支在 `git` 的分支右键菜单（`runMergeInto`）与分支选项卡两处**都保留** —— 原话「保留 git 允许有多个地方一起都有这些功能」。同一个动作允许多入口，不做「摘一份」的收敛。**两侧均未改动。**

**后续**：上面那条「Commit & Sync 消失」的代价已在 **S-62** 补回 —— git 的提交区加了主按钮 + 下拉（提交 / 修订 / 提交并推送 / 提交并同步）。

---

## S-62 右侧面板 git 提交区上移 + 主按钮/下拉形态 + 接线真实提交

**来源**：老大 2026-09-18 06:37 口头下达，06:40 拍板「顺手接上」。

**口径（老大原话，三轮）**

> 「git 的提交输入框 + 提交按钮 移动到暂存的修改上方，并且提交按钮跟之前变更一样 是一个提交主按钮+下拉」
> 「因为我这里刚好没有冲突，所以没看到冲突分组，第一位置是分支切换和各种按钮，第二位置就应该是提交区域」
> 「顺手接上」

**落点（自上而下）**：① 分支区（分支切换 + fetch/pull/push/sync 那一排）→ ② **提交区（输入框 + 提交主按钮 + 下拉）** → ③ 文件列表（冲突 / 暂存的修改 / 更改）。提交区原先钉在文件列表最底部。

**已实施（2026-09-18 06:55）**

| 文件 | 改动 |
|---|---|
| `components/chat/GitPage/ScmSidebar.tsx` | 提交区从列表底部搬到工具栏正下方；提交按钮由光杆按钮改为「主按钮 + 下拉」（下拉：提交 / 提交（修订）/ 提交并推送 / 提交并同步）；AI 生成提交信息按钮随之上移；抽出 `commitDisabled` |
| `components/chat/git-page-handlers.ts` | `handleCommit(action: CommitAction = 'commit')` —— 新增 `export type CommitAction = 'commit' \| 'amend' \| 'push' \| 'sync'` 与 `COMMIT_DONE_KEYS`；push / sync 作为提交的后续动作串在里面 |
| `components/chat/GitPage.tsx` | 去掉 S-49 移植时留的空壳 `handleCommit={async () => {}}` / `handleAiCommitMessage={async () => {}}`，改用 handlers 的真实实现；`aiCommitLoading` 由恒 `false` 改为读真实 state |
| `stores/git-store{,-types}.ts` | `commit(repoPath, message, options?: { amend?: boolean })` —— 透传 `amend` |
| `main/ipc/git-handlers.ts` | `git:commit` handler 接受可选 `amend`，为真时执行 `git commit --amend -m <msg>`（原先只有 `commit -m`；amend 在旧「变更」面板里其实是个假菜单项，点了等同普通提交） |
| `locales/{zh,en}/chat.json` | `git` 段新增 `commitAmend / commitAmendDone / commitPush / commitPushDone / commitSync / commitSyncDone` |

**语义决定（提交范围）**：**只提交已暂存的改动**，不做 `stageAll`。SCM 面板有明确的「暂存的修改 / 更改」分组，提交语义应以暂存区为准（VS Code 同款）；暂存区为空时提交按钮保持禁用。旧「变更」面板是 `stageAll` + 提交，两者行为不同 —— 要改成自动全暂存说一声。

---

## S-63 聊天窗图片「复制」谎报成功（底层函数是空实现）

**现象**（老大 2026-09-18）：聊天窗里图片右上角有个复制按钮，点了弹「复制成功」，但粘贴时没有图片。

**根因**：`src/renderer/src/lib/utils/image-clipboard.ts` 三个导出**全是空实现**：

```ts
export async function writeImageBlobToClipboard(_blob: Blob): Promise<void> {}
export async function writeImageDataUrlToClipboard(_dataUrl: string): Promise<void> {}
export async function writeSvgStringToClipboard(_svg: string): Promise<void> {}
```

空函数不抛错 ⇒ 调用方的 `try` 走 success 分支 ⇒ toast 谎报成功。

**两个受影响的调用链**（全仓仅这两处 import 该模块）：

| 调用方 | 链路 | 谎报点 |
|---|---|---|
| `components/chat/user-message-views.tsx:246-255` | `copyImage` → `copyImageAttachmentToClipboard`(`:228`) → `copyImageSourceToClipboard`(`:217-226`) → 两个 stub | `setCopied(true)` + `toast.success(t('userMessage.imageCopied'))` |
| `components/chat/ToolCallCard/output-blocks/widget-output.tsx:30-44` | `SvgWidgetCopyButton.handleCopy` → `writeSvgStringToClipboard` | `setCopied(true)` + `toast.success(t('toolCall.widget.imageCopied'))` |

**另一条调用链（同样不通）**：预览窗 `lib/preview/viewers/image-viewer.tsx:219` 与 `components/chat/ImagePreview.tsx:252` 走的是**另一条**通道 —— `window.api.writeImageToClipboard({ data })`。这条路**只有类型声明**：`src/preload/index.d.ts:22` 声明了它，但 `src/preload/index.ts` 的 `api` 是白名单对象（只有 `ping / invoke / workerRequest / workerRequestWithId / cancelWorkerRequest / on / onAgentStream / openFolderDialog / log / readLogs`），**没有这个方法的实现**；`src/main` 全目录也**没有 `clipboard:write-image` 的 handler**（只有 `clipboard:copy` / `get-history` / `toggle-pin` / `clear` / `get-config` / `update-config` / `hide` / `delete`）。

⇒ **结论：整条图片复制链路从移植进来就是死的**，不是"只有聊天窗那处"。通道名三件套倒是齐的（`channels.ts:322 CLIPBOARD_WRITE_IMAGE = 'clipboard:write-image'`、`messagepack-channel-routing.ts:167` 已列入白名单），只是 handler 与调用实现从来没写。

**修法**（A 案，已向老大报备）：主进程新建 `clipboard:write-image` handler（`clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(data,'base64')))`）→ `image-clipboard.ts` 三个函数统一走该通道（Blob / DataURL → base64；SVG 先在 canvas 光栅化成 PNG）→ `ImagePreview.tsx` / `image-viewer.tsx` 两处也改走同一 helper → 清掉 `preload/index.d.ts` 里的假声明。

---

## S-64 agent 回复里的工作区文件路径渲染成可点击（点击打开右侧面板预览）

**需求**（老大 2026-09-18）：agent 回复正文里经常带工作区文件路径，用户希望**点一下就能在右侧面板打开该文件的预览**；把文件路径渲染成可识别的标签最好。

**落点（待细化）**：
- 渲染侧：`components/chat/AssistantMessage/markdown-renderer.tsx`、`content-renderer.tsx`（agent 回复正文链）
- 预览侧现成能力：`stores/preview-panel-slice.ts`、`components/layout/PreviewPanel.tsx`、`lib/preview/viewers/*`（含 `image-viewer.tsx`、`fallback-viewer.tsx`）

**老大裁定（2026-09-18 08:50）**：
1. **必须校验存在性** —— 「图片都能点开预览了，说明一定在，没有图片不允许点开预览」⇒ stat 过才渲染成可点标签。
2. **点击目标按类型分派** —— 图片 → 复用全屏图片预览（`ImageViewer`）；代码 / md / 任意文件 → 右侧预览面板。

**实施（2026-09-18）**：

复用既有识别逻辑（`markdown-components.tsx` 的 `isLikelyLocalFilePath` / `resolveLocalFilePath`：反引号包裹 + 绝对路径 / 相对路径 / 根文件名白名单，相对路径按会话 `workingFolder` 拼接），只把「识别到路径之后干什么」补齐 —— 原来 `openLocalFilePath` 是 `TODO: implement file preview panel` 的空壳，返回 true 但什么都不做。

| 文件 | 改动 |
|---|---|
| `lib/preview/local-target.ts`（新） | `isImageFilePath` / `localTargetIsAvailable`（`fs:stat-path`，存在**且非目录**才算可用，抛错一律当不可用）/ `openLocalTarget`（图片 → 全屏预览，其余 → `openFilePreview`） |
| `stores/local-image-preview-store.ts`（新） | 全局单例：`open` / `filePath` / `sshConnectionId` |
| `components/chat/LocalImagePreviewDialog.tsx`（新） | 90vh × 95vw Dialog，内容复用 `ImageViewer`，挂在 `MainLayout` |
| `hooks/use-local-target-available.ts`（新） | 按 `(sshConnectionId, path)` 缓存 + 在途去重；返回 `boolean \| null`（null = 未探测完） |
| `components/chat/AssistantMessage/LocalPathCode.tsx`（新） | 行内 code 组件：`available === true` 才渲染成按钮，否则保持普通 code；`sshConnectionId` 订阅 active session |
| `lib/preview/viewers/markdown-components.tsx` | 行内 code 的路径分支改用 `LocalPathCode`；`openLocalFilePath` 由空壳改为真实现（显式 markdown 链接不做预校验，用户已明确要打开） |
| `components/chat/AssistantMessage/markdown-renderer.tsx` | 同上，`MarkdownCode` 行内分支改用 `LocalPathCode` |

**未探测完时不渲染成可点**（而非乐观渲染）：否则会出现「点了才发现不存在」的窗口，与老大口径冲突。

**门禁**：typecheck 三配置 0 错 · TS 30/30 · 8 个触碰文件 BOM clean。

---

## S-65 剪贴板增强：置顶（pin）项被 maxItems 裁掉

**位置**：`src/main/clipboard-enhancer.ts`（ditto-style 剪贴板历史；`ClipboardEntry` 在 `:50-57`，持久化到 `~/.wishful-claw[-dev]/clipboard-history.json`）

**现象**：置顶的粘贴项过一段时间不见了（置顶失效）。

`purgeExpired()` 对 pinned 有正确豁免（`:149` `if (entry.pinned) return true`，注释写明 *Pinned items are never purged*），**但 `maxItems` 的裁剪完全没看 pinned**，三处裸 slice：

| 位置 | 代码 |
|---|---|
| `loadHistory:117` | `history = parsed.slice(0, config.maxItems)` |
| 轮询捕获 `:189` | `history = history.slice(0, config.maxItems)` |
| `saveHistory:132` | `history.slice(0, config.maxItems)` |

存储顺序是「新项 `unshift` 到头部」（`:188`），所以老 pinned 项必然沉到数组末尾 ⇒ 一旦总条数超 100（`DEFAULT_CONFIG.maxItems`），**它就被切掉且不可恢复**（saveHistory 落盘时也没了）。

**修法**：三处裁剪统一改成「先保 pinned，再用非 pinned 项按时间补满 `maxItems`」（抽一个纯函数，三处共用）。

---

## S-66 剪贴板增强：支持图片的复制粘贴

**现象**（老大 2026-09-18）：剪贴板增强窗体不支持保存图片，希望像 ditto 一样能复制粘贴图片。

**现状**：
- `ClipboardEntry`（`:50-57`）只有 `id / text / timestamp / preview / lastUsed / pinned`，**没有图片字段** ⇒ 从数据模型上就没这个能力
- 轮询只读文本（`:177` `clipboard.readText()`）
- 写入侧只有 `clipboard:copy`（`clipboard.writeText`，`:241`）

**参考源码**：`D:\claw\Ditto`（老大点名，本机已有）。Ditto 的做法是多格式条目（同一份剪贴板内容按 CF_DIB / CF_BITMAP / PNG / HTML / RTF / text 分别存一份）+ 缩略图 + 恢复时按优先级写回多格式。

**老大裁定（2026-09-18 08:50）**：
1. **图片存文件** —— 「图片存文件吧」（不 base64 内联）
2. **粘贴到前台窗口** —— 「粘贴回前台窗口也增加图片处理」

**实施（2026-09-18）**：

| 文件 | 改动 |
|---|---|
| `src/main/clipboard-enhancer.ts` | `ClipboardEntry` 加 `type: 'text' \| 'image'`（缺省视为 text，老数据零迁移）/ `imageFile` / `imageWidth` / `imageHeight`；图片落 `<DATA_DIR>/clipboard-images/<sha256>.png`（文件名即内容哈希，天然去重） |
| 同上 | 新增 `captureClipboardImage()`：`readBuffer` 优先直接取原始 PNG 字节（省一次 nativeImage 解码 + 重编码，字节可直接哈希落盘），失败回退 `readImage().toPNG()`；宽高从 PNG IHDR 读，不用解码整图 |
| 同上 | 轮询改「图片优先」：复制图片的程序常同时给一份文本（路径 / alt），两个都记会变两条重复历史。Ditto 同样是 PNG / DIB 优先 |
| 同上 | 图片检测独立节流 **1s**（`IMAGE_POLL_INTERVAL_MS`）。Ditto 靠 Win32 剪贴板序列号判变化，Electron 没有这个 API，只能重读剪贴板 —— 所以不让它跟着 250ms 的文本轮询跑。代价：复制图片后最多 1s 进历史 |
| 同上 | `clipboard:copy` 改收条目 id（兼容旧的传文本写法）；图片条目走 `nativeImage.createFromPath` + `clipboard.writeImage`，并回写 `lastClipboardImageHash` 防止刚粘的图又被轮询记一遍 |
| 同上 | **`pasteToForegroundWindow` 无需改动** —— 它只负责把目标窗口带回前台并注入 Ctrl+V，剪贴板里是什么就粘什么（已核实 `priority-shortcuts.ts:864-868` 不读剪贴板内容） |
| 同上 | 新增 `clipboard:read-image`（返回 data URL，纯文件名 + `basename` 校验挡路径穿越）；剪贴板窗口是独立 BrowserWindow，不为读本地图片放宽它的加载策略 |
| 同上 | 新增 `cleanupOrphanImageFiles()`，只在 `saveHistory` 里调一次 —— delete / clear / 过期 / maxItems 裁剪四条路径就都覆盖到了，不用各自去删文件 |
| `src/renderer/src/clipboard/main.tsx` | 列表按 `type` 分支：图片条目显示缩略图（`clipboard:read-image`，模块级缓存）＋ `[图片] W×H`；粘贴改传 `entry.id`；新增 `ImageIcon` |
| `src/renderer/src/lib/ipc/messagepack-channel-routing.ts` | 白名单加 `clipboard:read-image`（data URL 体积大，走 messagepack 而非 JSON 通道） |

**未做**：按类型过滤 UI（老大的裁定里没提，Ditto 那套分栏对当前 420px 面板没必要）。

**门禁**：typecheck 三配置 0 错 · TS 30/30 · 3 个触碰文件 BOM clean。

---

## S-67 文档预览排版语义复位（不隔离，收窄全局 + 容器集中复位）

**现象**（老大 2026-09-18）：右侧面板文件预览打开 `README.md`，顶部一排居中 badge 在 GitHub 上是并排一行，预览里变成**一个元素占一行**。反复问「是我们的全局样式影响到了么」。

**排查结论 —— 三层叠加，都不是全局样式**：

| # | 来源 | 说明 |
|---|---|---|
| 1 | `markdown-components.tsx` 的 `p` / `li` 写 `whitespace-pre-wrap break-words` | **从聊天窗照抄来的**。`pre-wrap` 保留空白**且允许折行** ⇒ HTML 源码里的缩进换行被原样保留 ⇒ 每个元素独占一行 |
| 2 | 同文件 `img` 组件写 `className="... block ..."` | 当初按「正文插图一张占一段」设计的（带卡片边框/圆角/阴影）。落到并排 badge 上就是一排图各占一行 |
| 3 | Tailwind preflight `img,svg,video,…{ display: block }` | 全局存在，但被 #2 的 class 覆盖，不是本次的实际开关 |

**判据**：① 全仓 CSS `white-space: pre` / `pre-wrap` 零命中 ⇒ 先排除全局样式；② `.html` 文件走 `html-viewer.tsx`（iframe `srcdoc`，真浏览器内核）**不可能**出这现象 ⇒ 问题只在 md 预览（`markdown-viewer.tsx` → `createMarkdownComponents`）；③ 产物 CSS 里 preflight 确实是 `display:block`。

**老大裁定（2026-09-18 11:06）**：「按 C 处理吧」—— 即**不做 iframe / Shadow DOM 隔离**，走「收窄全局 + 预览容器集中复位」。老大原话「感觉好像隔离了也不对」，与结论一致。

**为什么不做真隔离**（两层要分开看）：
- **视觉皮肤**（颜色 / 字体 / 字号缩放 / 主题 / 滚动条 / 代码高亮）→ **应该**跟随产品。全隔离会变成「一篇外来文档」，深色模式与字号设置全脱节。
- **排版语义**（谁 inline 谁 block、空白怎么折叠）→ **不该**被产品改。产品 CSS 把 `img` 设成 block 是为应用界面定的，管到文档排版就是越界。

**实施（4 处）**：

| 文件 | 改动 |
|---|---|
| `assets/main.css` | 两条**裸写在 `@layer` 外**的通配符规则（`* { scrollbar-* }`、`* { scroll-behavior: smooth }`）收进 `@layer base`。裸写时特异性压过一切组件样式 —— iter-30 修聊天窗滚动只能靠 inline style 硬顶 `smooth` 就是这个原因；收进 base 后普通 class 即可覆盖 |
| `assets/main.css` | 新增 `.markdown-doc` 的**排版语义复位**（`@layer components`）：`:where(img)` / `:where(video)` → `inline-block`。集中一处，以后 preflight 或产品 CSS 再动语义，补一条即可 |
| `markdown-viewer.tsx` | 预览容器挂 `markdown-doc` |
| `markdown-components.tsx` | ① `p` / `li` 去掉 `whitespace-pre-wrap`；② 代码块去掉 `pre-wrap` / `break-all`，恢复横向滚动（对齐 GitHub，也是它改动前的行为）；③ `img` 的 `display` 挪去容器层，组件只留视觉样式；④ `rehypeRaw` 从共享常量里拆出 —— 新增 `CHAT_REHYPE_PLUGINS = [rehypeKatex]` 给聊天窗，`MARKDOWN_REHYPE_PLUGINS`（含 raw + sanitize）只给文档预览 |

**边界（老大 11:0x 原话「聊天窗的预览不改内容，主要是右侧面板中的文件预览，你别改过度了哈」）**：全部改动只落在文档预览这一条链。聊天窗**刻意不共用** rehype 插件 —— 那是对流式渲染敏感的界面，半截 HTML 标签会让整段反复闪。

**将来要上隔离的时机**：预览要渲染**不受信内容**（用户从网上拽下来的 html/md），或要做独立阅读器（沉浸全屏 / 独立主题 / 自带目录侧栏）。届时 iframe 是正解，`html-viewer.tsx` 已有先例；代价是交互全要桥接（路径标签点击、图片预览、代码复制、mermaid）。

**门禁**：typecheck 三配置 0 错 · TS 30/30 · BOM clean。

---

## 待登记

### 不立项 —— 正式版才排入（老大 2026-09-17）

以下两条**不列入 iter-31**，留到正式版规划阶段再排：

- **快捷搜索扩展整合** —— 「扩展」tab + 扩展数据源匹配。实测 `renderer/src/launcher/main.tsx` 只有 `list` / `settings` 两个视图。（知识库 `迭代排期-v2后续.md` / `正式版发布规划.md` 遗留待办 C-1；其中「在线翻译」子项已随 S-48 方向放弃。）
- **扩展功能内容** —— 目前左侧面板扩展只有 Draw / Automation / Task Board 三项，当初规划的 Skills / Souls / Sync / Resources 等均未纳入。（注：Skills / Souls 已在设置页实现，是否还需要扩展入口待定。）

### 待定（老大尚未表态）

- **Draw（绘画）功能** —— 唯一「入口可达 ∧ 功能确实没有」的项。入口在侧栏扩展（`WorkspaceSidebar.tsx:207`）+ 搜索对话框（`search-dialog.tsx:123/551`），落地 `MainLayout.tsx:90` → `PlaceholderPage title="Draw"`。老大 2026-09-17：「绘画确实是个占位」。**要不要做、什么时候做，未定。**
- **`NavItem` 的废弃取值 + `activeNavItem` 字段本身（S-46 延伸）** —— S-46 清掉所有非 `chat` 的导航入口后，`setActiveNavItem` 全仓唯一调用是 `setActiveNavItem('chat')`（`WorkspaceSidebar.tsx:156`），其余导航全走硬写的 `set({ activeNavItem: 'chat', ... })` ⇒ `activeNavItem` **恒为 `'chat'`**，`NavItem`（`ui-types.ts:5-15`）里 `channels / resources / skills / souls / sync / translate / tasks / codegraph` 八个取值也是死的。属 S-46 的直接延伸但**不在其登记范围内**，未擅动；要不要连字段一起删，待老大发话。
  - 现状：`ui-types.ts:7` 的 `| 'channels'` 是 S-46 / S-47 清完后唯一残留的 `channels` 字面量（其余 `channels` 命中均为设置页渠道 tab 与后端模块名，无关）。

---

## 裁定记录（2026-09-17 老大拍板）

- 「需要先拆分 31 迭代分支出来，然后**这些算是需求**，而不是直接动手」→ 本文档建档；分支 `dev/v2-iter-31` 已从 `main` @ `f815e739` 拆出
- 「Code Graph 是已经有了的」→ S-46 中 `openCodeGraphPage` 归入死入口，不再当功能缺口
- 「git 目前会话右侧面板上有 git 未提交，历史提交记录」→ Git 归入「已完成」，`chatView:'git'` 见 S-46 待定
- 「绘画确实是个占位」→ 归入「待登记」
- 「翻译不太想要了」→ S-48
- 「channels ... 我们的定位是全局的，这个项目主页上的入口可以删了」→ S-47
- 「那两个不立项，那些是**正式版本才排入**的」→ 快捷搜索扩展整合、扩展功能内容两条**不列入 iter-31**
