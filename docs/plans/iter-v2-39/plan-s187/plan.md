# Plan: S-187 右侧面板 Git 选项卡 —— 收敛单列 SCM + diff/历史全走弹窗 + 未跟踪目录展开

> 所属迭代：iter-v2-39 ｜ 需求明细：[`../requirements/S-187.md`](../requirements/S-187.md)
> 类型：**渲染端为主 + C# 一处** —— 本迭代**唯一** C# 改动。
> 口径：**已齐（6 条，10-10 10:46 / 11:02 / 11:10 / 11:17）**。

---

## 一、目标

右侧面板「文件 → Git」子选项卡当前按宿主宽度切形态：`≥640px` 走**三栏并排**（SCM 固定 360 ｜ diff `flex-1` ｜ 历史固定 300，需 800+ 才放得下）⇒ 面板落在 **640~800** 区间时两栏固定宽把中间挤爆、**内容重叠**。同时 SCM 列表把未跟踪目录折叠成一条「文件夹」，点进去只有「说明」。

⇒ 收敛为**永远单列 SCM**，diff 与文件历史**全走弹窗**；C# 侧让未跟踪目录下的文件**逐个列出**。

---

## 二、口径（6 条，已定）

| # | 口径 | 出处 |
|---|---|---|
| 1 | **三栏并排不要** | 11:02 |
| 2 | **阈值不留**（不再按宽度切形态） | 11:10 |
| 3 | **文件历史改弹窗**，入口 = **右键文件行**（不用左侧列表入口） | 11:02 / 11:10 |
| 4 | **未跟踪目录下的文件也要列出来** | 11:10 |
| 5 | 布局统一「**只有 SCM 一列**」—— diff 与历史全走弹窗 | 11:17 |
| 6 | **不设条目上限**，高了走滚动条 | 11:17 |

**弹窗里的内容保留不动**（11:10）。

---

## 三、步骤清单

- [x] **步骤 1（C#）：未跟踪文件逐个列出**
  - `src/runtime/WishfulClaw.Agent/Modules/Git/GitStatusTools.cs` 的 `status` 参数数组（参考 `:16`）由 `["status", "--porcelain=v1", "-b"]` 改为加 `--untracked-files=all`。
  - 副作用：未跟踪目录不再折叠成一条，SCM 列表会列出目录内每个文件（正是口径 4）。
  - **验证检查点**：`dotnet build src/runtime/WishfulClaw.sln` 0 警告 0 错误；在仓库里找一个未跟踪目录，跑一次 Git 状态工具，确认返回的是逐文件条目而非 `dir/`。
- [x] **步骤 2：新建文件历史弹窗（先建，后接线）**
  - `src/renderer/src/components/chat/GitPage/git-history-dialog.tsx`（新建）—— 照 `git-diff-dialog.tsx`（约 136 行）的形状：左提交列表 / 右该次 diff；props 至少含 `open` / `path` / `onOpenChange`。
  - 历史逻辑**原样复用**：`historyPick`、`loadFileHistory`、`historyFileDiffByKey`。
  - **验证检查点**：`npm run typecheck` 两配置零错误（此时尚未接线，仅确保编译通过）。
- [x] **步骤 3：SCM 文件行挂右键菜单**
  - `src/renderer/src/components/chat/GitPage/utils.tsx` 的 `ScmFileRowView`（参考 `:168`）挂 `ContextMenu`（该文件已 import 该组件），菜单项「文件历史」⇒ 回调通知上层打开弹窗。
  - **单点改动，conflict / staged / unstaged 三处一起生效**（现 `:549` / `:595` / `:641`）。
  - 顺带补齐缺口：**紧凑形态原本没有文件历史入口**，右键菜单一并补上。
  - **验证检查点**：`npm run typecheck` 零错误；三个分组下的行都能弹出菜单。
- [x] **步骤 4：`ScmSidebar` 去掉形态与宽度相关 props**
  - `src/renderer/src/components/chat/GitPage/ScmSidebar.tsx`：删 `compact?: boolean`（参考 `:63` / `:118`）与 `scmWidth` 两个 prop，删其唯一用途 **resize 手柄**（参考 `:667-674`）。
  - **验证检查点**：`npm run typecheck` 零错误。
- [x] **步骤 5：`GitPage.tsx` 收敛为单列**
  - 删阈值常量 `GIT_PAGE_COMPACT_MAX_WIDTH`（参考 `:31`）、`compact` state 与 `ResizeObserver`（参考 `:82-96`）、`useGitPanelSplit` 调用（参考 `:98-104`）；
  - 删宽形态头部（参考 `:347-368`）与**中间 diff 区 + 历史栏整块**（参考 `:433-567`）；
  - **删「无目录早返回」块里的形态分支**（参考 `:303-336`，内 `:307` / `:316` / `:324` 三处也用 `compact` 选样式）—— 收敛后该块只留一套结构；
  - 容器 className 三分支统一取**现紧凑套**（参考 `:338-346`）；
  - `GitDiffDialog`（参考 `:569+`）去掉 `compact ?` 条件包裹，改为常驻按需渲染；
  - 接上步骤 2 / 3 的历史弹窗：新增 `historyDialogPath` state + 渲染 `GitHistoryDialog`。
  - **验证检查点**：`npm run typecheck` 零错误；面板在任意宽度下都只有一列，无重叠。
- [x] **步骤 6：删除已无调用方的 hook 文件**
  - `src/renderer/src/hooks/use-git-panel-split.ts` —— **整个删除**（唯一调用方是 `GitPage`，步骤 5 已移除引用）。
  - **验证检查点**：全仓搜索该文件名/Hook 名无残留引用；`npm run typecheck` 零错误。
- [x] **步骤 7：命名残留清理**
  - `handleDiffSelect`（参考 `:262`）、`compactRows`、`compactDiffOpen` 等名字里剩的 `compact` 字样改中性名。
  - **验证检查点**：`npm run typecheck` 零错误。
- [x] **步骤 8：整体实测**
  - dev 实例 → 右侧面板 → 文件 → Git：① 面板拉到最窄 / 最宽都不重叠；② 点文件行看 diff（弹窗）；③ 右键文件行 →「文件历史」→ 弹窗内选提交看该次 diff；④ 未跟踪目录下的文件逐个出现在列表里；⑤ 内容多时列表出滚动条、不设上限。
  - **验证检查点**：上述 5 条逐条亲眼确认；`npm test` 全量跑一遍（回归面）。

---

## 四、涉及文件

| # | 侧 | 文件 | 动作 |
|---|---|---|---|
| 1 | **C#** | `src/runtime/WishfulClaw.Agent/Modules/Git/GitStatusTools.cs` | 改 —— `status` 参数加 `--untracked-files=all` |
| 2 | 渲染 | `src/renderer/src/components/chat/GitPage.tsx` | 改 —— 收敛单列（删阈值 / `compact` / `ResizeObserver` / 宽形态头部 / 中间 diff 区与历史栏整块）；接历史弹窗 |
| 3 | 渲染 | `src/renderer/src/hooks/use-git-panel-split.ts` | **删除** |
| 4 | 渲染 | `src/renderer/src/components/chat/GitPage/ScmSidebar.tsx` | 改 —— 删 `compact` / `scmWidth` prop 与 resize 手柄 |
| 5 | 渲染 | `src/renderer/src/components/chat/GitPage/utils.tsx` | 改 —— `ScmFileRowView` 挂 `ContextMenu` |
| 6 | 渲染 | `src/renderer/src/components/chat/GitPage/git-history-dialog.tsx` | **新建** |
| 7 | 渲染 | `src/renderer/src/components/chat/GitPage.tsx` | 改 —— 新增 `historyDialogPath` state + 渲染弹窗 |

---

## 五、参考源码

- `src/renderer/src/components/chat/GitPage/git-diff-dialog.tsx` —— **历史弹窗的直接模板**（同一目录、同一交互形态）。
- `src/renderer/src/components/chat/GitPage.tsx` 内的 `historyPick` / `loadFileHistory` / `historyFileDiffByKey` —— 历史数据逻辑，**原样复用不重写**。
- `src/renderer/src/components/chat/GitPage/utils.tsx` 内已 import 的 `ContextMenu` —— 右键菜单组件，直接复用。
- 无外部参考项目。

---

## 六、风险

1. **行号为勘测时快照**（10-10 11:xx），实施时以实际读到的为准。
2. **删 `use-git-panel-split.ts` 前必须确认零调用方** —— 全仓搜索，避免漏掉间接引用。
3. **C# 的 `-uall` 会让列表变长** —— 大仓库下未跟踪文件很多时列表会很长；口径 6 已定「不设上限、走滚动条」，不再加截断。

---

## 七、执行记录（实施后回填）

**结论：8 个步骤全部落地，门禁三绿。**

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | 0 错误（node + web 两配置） |
| `npm test` | **68/68**（TS 51 + C# 17） |
| `dotnet build src/runtime/WishfulClaw.sln` | 0 警告 0 错误 |

**与计划的偏差（均为实施细节，助手自行拍定）**

1. **步骤 2 没有新建 `git-history-dialog.tsx`** —— 改为**复用 `GitDiffDialog` 外壳**（同一目录、同一「左列表 / 右正文」形态），只给该组件补 `listTitle?: string` 与 `listFooter?: React.ReactNode` 两个可选槽。
   - 理由：历史弹窗与 diff 弹窗的骨架、翻页、全屏、打开文件、关闭完全一致，只有左侧数据源与标题不同。新写一个 136 行的同类组件等于复制粘贴一份交互，后续改一处要改两处。
   - 影响：**涉及文件表第 6 项「新建」作废**，改为 `git-diff-dialog.tsx` 加两个 prop。
2. **步骤 5 的状态名**：计划写 `historyDialogPath`，实际用 `historyDialogOpen: boolean`，路径直接取 `selectedRow`（右键时已把该文件设为选中）。
   - 理由：省一份 state 与同步逻辑；打开历史前先 `setSelectedKey(scmFileKey(row))`，`selectedRow` 必然就是被右键的那个文件。
3. **步骤 7 命名**：`handleDiffSelect` → `handleFileSelect`（语义已是「点文件 = 开 diff 弹窗」）；`compactRows` → `fileRows`；`compactDiffOpen` → `diffDialogOpen`。全仓已无 `compact` 残留。
4. **顺带清理**（计划外、同属收敛）：`DiffContent.tsx` 的 `GitDiffContent` 与 `utils` 的 `parseDiffBlocks` 在内联 diff 区删除后于本文件不再引用，已一并剪掉 import；两个「回到工作区差异」入口随内联区消失而废弃（关闭弹窗即回到工作区 diff，不再需要该按钮）。
   - `GitDiffContent.tsx` / `parseDiffBlocks` **导出本身保留**（可能被其它面板使用），只删本文件引用。
5. **保留原 `<>` fragment 包裹**：`ScmSidebar` 的 resize 手柄删除后该 fragment 只剩一个子元素，属于冗余；但删它会牵动约 500 行缩进重排，收益不抵风险，故保留。**已知瑕疵，非功能问题。**

**遗留核查项（实施时已确认）**

- `use-git-panel-split.ts` 全仓调用方只有 `GitPage.tsx` 两处（import + 调用），已随文件删除清空。
- `ScmSidebar` 的 `setHistoryPick` prop 保留：SCM 行 `onSelect` 仍用它重置历史选中态（切文件即退出历史 diff 视图）。
- `resizeScmPanel` / `resizeHistoryPanel` 两条 i18n 文案在删除 resize 手柄后已无引用，**保留未删**（避免动 locale 文件；后续若清理无用文案再一并处理）。

