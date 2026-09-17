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
