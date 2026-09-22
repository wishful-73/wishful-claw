# Plan: iter-v2-34 本体需求实施（第一批：S-112 + S-111）

> 2026-09-21 建。**需求口径权威源 = 同目录 `raw-requirements.md`**，本文件只排步骤与文件面，不重复取证。
> 建立缘由：本迭代 S-126 ~ S-130 等条目此前**未经阶段二 / 阶段三直接实施**，违反 `docs/dev-workflow.md`「规划验证通过后、执行前」这个必停节点。本计划把流程补齐，并作为后续本体需求的执行模板。

## 目标

按工作流把本迭代**已定案**的更新域需求实施完：先 **S-112**（顶栏问号 → 设置页「关于」），再 **S-111**（更新机制调整：6h 巡检 + 顶栏图标取代常驻浮块 + 点图标顺带重查最新）。

## 范围与顺序

| 序 | 需求 | 状态 | 为什么排这个位置 |
|:--:|---|---|---|
| 1 | **S-112** | **定案**（路径 A / tooltip「关于」/ 图标不动） | 2 个文件、零待裁定，先把流程跑通 |
| 2 | **S-111** | **裁定完毕可开工**（10 条 + 10a/b/c 全定） | 体量大，且与 S-112 同碰 `TitleBar.tsx`，接在后面省一次上下文切换 |

### 不在本批范围（各有硬阻断，不硬塞进来）

| 需求 | 卡在哪 | 解锁条件 |
|---|---|---|
| **S-107** | 4 条待裁定未定（全局值量纲 / 继承落地字段 / 与 `capModelId` 解耦 / 是否保留会话级覆盖） | 老大拍板 |
| **S-108** | 待取证：Worker 日志 `context compression DIAG` 行里 `contextLength` 是 `200000` 还是 `384000` | 取到日志即可对半砍；**且 S-107 落地前必须先有它结论**（否则全局值会被后端以同样方式忽略） |
| **S-109** | 1 条待裁定（下载中是否保留「稍后」档） | 老大拍板 |
| **S-115** | 崩溃级 bug，**尚未探索**（`create_session` 的 `sessions.model_selection_mode` NOT NULL 约束失败） | 需先补阶段一探索态 |
| **S-129** | 已明确**后置** | 官网备案落地后再执行 |

## 口径来源（均已拍板，本计划不重新讨论）

| # | 事项 | 裁定 | 出处（`raw-requirements.md`） |
|---|---|---|---|
| S-112-1 | 打开路径 | **A `openSettings('about')`** —— 整页路径，与侧栏「设置」入口逐字等价；`TitleBar` 消失属正常，设置页自带 `ArrowLeft` 返回 | L286-290 |
| S-112-2 | tooltip 文案 | 「关于」；key `topbar.userGuide` → **`topbar.about`**（全仓唯一消费点） | L292 |
| S-112-3 | 图标 | 保持 `HelpCircle`（老大未提） | L294 |
| S-111-1 | 巡检频率 | **启动一次 + 低频定时 6h + 手动**（不照抄「只启动查一次」—— 本机 24 小时常驻） | L179、L434 |
| S-111-2 | 自动下载 | **不做**（不抄 OpenCowork） | L180 |
| S-111-3 | 顶栏形态 | **纯图标**；任何窗口宽度下都在（**不抄** OpenCowork 的 `xl:inline-flex`） | L181 |
| S-111-4 | 任务栏进度 | **已具备，无需实施** | L182 |
| S-111-5 | 左下角浮块 | **砍掉**（方案 A）；**连带撤销 S-110** | L183、L211、L432 |
| S-111-6 | 下载完成 | **自动弹开更新弹窗 + `toast.success`** —— 砍浮块的前提 | L184 |
| S-111-7 | 图标 tooltip | hover 带百分比 | L185 |
| S-111-8 | 图标常驻 | 有新更新就一直存在，不做 dismiss | L186 |
| S-111-9 | 停定时器 | **已具备，无需实施**（发现更新即 `stopPeriodicRecheck`） | L187 |
| S-111-10 | 点图标重查 | **要查**；10a 方案 B（先开弹窗、后台同时查）/ 10b 方案 A（发现更新版本即丢弃旧包）/ 10c 图标即「有更新」信号 | L188-191、L238 |
| 连带 A | 设置页「关于」 | **保持原样，不处理**；收口范围 = 只收拢「点图标重查」+ 弹窗「重新检查」 | L258 |
| 连带 B | 文案 | `autoUpdateEnabled` 描述「只在启动时检查」与实际 6h 巡检不符，随本需求改 | L262、L434 |

## 关键工程决策（阶段三重点挑战对象）

| 项 | 决策 | 依据 / 待确认 |
|---|---|---|
| 图标落点 | `TitleBar.tsx` 右侧按钮簇内新增（现状**无更新指示位**） | L144 |
| 浮块删除范围 | 删 `UpdateStatusBanner.tsx`、`banner-position.ts`、`shouldLiftToastsForBanner`、`UPDATE_BANNER_TOAST_BOTTOM` | L206-207 |
| **存量 settings 字段** | `updateBannerPosition` + 迁移里的 `normalizeUpdateBannerPosition` **删前先确认迁移不炸**（涉及已发布版本的存量 settings） | L207 —— **留作步骤 7 的显式检查点** |
| 旧包处置实现 | 重查发现更新版本 ⇒ 清 `downloadedVersion` + 删已下载文件 | L231 |
| `skipped` 保护 | 重查返回 `skipped: true` 时**不动原 phase**（否则图标亮着点一下就消失） | L232、L240 |
| 重查出处 | 只归 `useAppUpdater`；设置页那份 `handleCheckForUpdates` **不动** | L258 |
| 砍浮块后的进度载体 | 弹窗进度条（主）+ 任务栏进度 + 图标 tooltip | L183、L199-201 |
| `silentAnnounce` | 用户主动重查**不算 silent**，否则 `App.tsx:58-69` 的 effect 会把弹窗压掉 | L233 |
| in-flight 共享 | 点图标时若有 6h 巡检在飞，手动调用会搭车并沿用 `checkIsPeriodic` —— **不能误判为静默** | L234 |

## 步骤清单

### 无对应步骤的裁定（列全，避免后续审查反复核）

| 裁定 | 为什么无步骤 |
|---|---|
| S-111-2 不做自动下载 | 否定式裁定，**不做任何事** |
| S-111-4 任务栏进度 | **已具备**（`src/main/updater.ts:375-376` / `:390` / `:409`） |
| S-111-9 发现更新即停定时器 | **已具备**（`runPeriodicRecheck` 内调 `stopPeriodicRecheck`） |
| S-112-3 图标保持 `HelpCircle` | 老大未提 ⇒ **不改动** |
| 连带 A 设置页「关于」保持原样 | 老大明确不处理 ⇒ **不改动** |

### 第一部分：S-112（2 个文件）

- [ ] 步骤 1 —— `src/renderer/src/components/layout/TitleBar.tsx`
  - `:95` `onClick={openUserGuide}` → `onClick={() => openSettings('about')}`
  - `:101` tooltip key `topbar.userGuide` → `topbar.about`
  - `:6` 移除 `openUserGuide` import（否则成未使用导入）
  - **验证**：`npx tsc --noEmit -p tsconfig.web.json` 0 错；`grep openUserGuide TitleBar.tsx` 0 命中
- [ ] 步骤 2 —— `src/renderer/src/locales/zh/layout.json` + `locales/en/layout.json`
  - `:101` key 改名 `topbar.about`，值 `关于` / `About`
  - **验证**：`grep -rn "topbar.userGuide" src/` 0 命中；两语言 JSON 可解析
- [ ] 步骤 3 —— 真机验证 + 需求提交
  - 点问号 → 整页设置且选中「关于」tab；tooltip 显示「关于」；设置页 `ArrowLeft` 能返回
  - **验证**：`npm run typecheck`（node + web 双配置）EXIT=0 ⇒ **commit（S-112 独立一刀）**

### 第二部分：S-111

- [ ] 步骤 4 —— `src/main/updater.ts:52` 巡检频率：`60 * 60 * 1000` → `6 * 60 * 60 * 1000`（注释同步）
  - **验证**：`npm run typecheck:node` 0 错
- [ ] 步骤 5 —— 顶栏图标组件：新建 `src/renderer/src/components/updater/UpdateIndicator.tsx`
  - 纯图标（无文案）；`available` / `downloading` / `downloaded` / `error` 四态；hover tooltip 带百分比；点击 → `showUpdateDetails()` 兼触发重查；**任何窗口宽度都在**
  - **常驻语义（裁定 8）**：有更新即常驻 —— **不提供 dismiss、不自动隐藏**，直到下载 + 安装完成
  - 挂到 `TitleBar.tsx` 右侧按钮簇
  - **验证**：`tsc` 0 错；dev 下无更新时**图标不渲染**（10c）
- [ ] 步骤 6 —— 重查收口：`src/renderer/src/hooks/use-app-updater.ts`
  - 新增 `recheckLatest()`：**10a 方案 B** —— 立即开弹窗显示快照、后台同时查、state 自动刷新，不引入等待
  - 弹窗「重新检查」改调它；**`skipped` 保护**（不改 phase）；**10b**（发现更新版本即清 `downloadedVersion` + 删已下载包）；`silentAnnounce` 不置 true
  - **验证**：`tsc` 0 错；L231-234 四个风险点逐条对代码复核并记录
- [ ] 步骤 7 —— 砍浮块
  - 删 `components/updater/UpdateStatusBanner.tsx`、`components/updater/banner-position.ts`
  - `App.tsx` 移除 `:30-33` import、`:229` 的 `shouldLiftToastsForBanner` 用法、`:231` 的挂载
  - **显式检查点**：先跑一次 `settings-store` 迁移的存量配置用例（带 `updateBannerPosition` 的旧 settings 能正常加载、不报错），再定 `updateBannerPosition` / `normalizeUpdateBannerPosition` 的处置（删字段 or 留兼容）；结论写进实施记录
  - **验证**：`grep -rn "UpdateStatusBanner\|banner-position\|shouldLiftToastsForBanner\|UPDATE_BANNER_TOAST_BOTTOM" src/` 0 命中；`tsc` 0 错
- [ ] 步骤 8 —— 下载完成自动弹窗 + toast：`App.tsx`
  - 监听下载完成相位 ⇒ `setUpdateDialogOpen(true)` + `toast.success`；失败 ⇒ `toast.error`
  - **验证**：① 机械判据 —— `grep -n "setUpdateDialogOpen(true)" App.tsx` 命中 + `grep -n "toast.success" App.tsx` 命中；② 真机实跑（或 dev 下模拟相位）观察到弹窗自动打开
- [ ] 步骤 9 —— 文案复核
  - `locales/{zh,en}/settings.json` 的 `autoUpdateEnabled` 描述（zh `:845-846`）改为「启动时检查 + 每 6 小时后台巡检」
  - 复核 `UpdateDialog.tsx:172-176` 的 `trayHint`（浮块没了以后这是唯一指引）
  - **验证**：两语言同步；`grep 只在启动时检查` 0 命中
- [ ] 步骤 10 —— 复验与回写
  - `npm run typecheck` + `npm test` 全量
  - `raw-requirements.md` 的 S-111 / S-112 节补「实施记录」
  - **验证**：`npm test` 全过 ⇒ **commit（S-111 独立一刀）**

## 涉及文件

| 文件 | 动作 |
|---|---|
| `src/renderer/src/components/layout/TitleBar.tsx` | 改（步骤 1、5） |
| `src/renderer/src/locales/zh/layout.json` | 改（步骤 2） |
| `src/renderer/src/locales/en/layout.json` | 改（步骤 2） |
| `src/main/updater.ts` | 改（步骤 4） |
| `src/renderer/src/components/updater/UpdateIndicator.tsx` | **新建**（步骤 5） |
| `src/renderer/src/hooks/use-app-updater.ts` | 改（步骤 6） |
| `src/renderer/src/components/updater/UpdateDialog.tsx` | 改（步骤 6、9） |
| `src/renderer/src/App.tsx` | 改（步骤 7、8） |
| `src/renderer/src/components/updater/UpdateStatusBanner.tsx` | **删**（步骤 7） |
| `src/renderer/src/components/updater/banner-position.ts` | **删**（步骤 7） |
| `src/renderer/src/locales/zh/settings.json` | 改（步骤 9） |
| `src/renderer/src/locales/en/settings.json` | 改（步骤 9） |

## 参考源码

| 项目 | 路径 | 参考什么 |
|---|---|---|
| OpenCowork | `D:\koda\OpenCowork\src\renderer\src\components\layout\TitleBar.tsx:341-376` | 顶栏琥珀图标形态（下载中转圈、否则下载图标、文案随状态） |
| OpenCowork | `D:\koda\OpenCowork\src\renderer\src\App.tsx:762-773` | 下载完成自动弹窗 + `toast.success` |
| OpenCowork | `D:\koda\OpenCowork\src\main\updater.ts:138-158` | 瞬时错误抑制（**我们已有，仅作对照**） |
| Reasonix | `D:\koda\DeepSeek-Reasonix-main-v2\desktop\frontend\src\components\UpdateBanner.tsx` | 「只在可行动时才出现」的静默自动检查思路 |

**不抄清单**（已明确）：OpenCowork 的自动下载、`xl:inline-flex` 窄窗消失坑、Reasonix / OpenCowork 的「只启动查一次」。

## 风险与回退

| 风险 | 处置 |
|---|---|
| 删 `updateBannerPosition` 影响存量 settings | 步骤 7 显式检查点；确认不炸再删，否则只停用不删字段 |
| 重查把图标打回 `idle`（dev / 不支持检查） | 步骤 6 的 `skipped` 保护；实施后**专门验这条路径** |
| 已下载旧包被装错 | 步骤 6 的 10b 实现 + 真机验证「已下载 0.2.34 → 远端 0.2.35 → 点图标」场景 |
| 顶栏图标在窄窗消失 | 步骤 5 验证时**必须试窄窗**（OpenCowork 就栽在这里） |
| 砍浮块后下载完成无提示 | 步骤 8 与步骤 7 同批验证，缺一不可 |

## 提交节奏

- 步骤 3 完成 ⇒ **commit 1：S-112**
- 步骤 10 完成 ⇒ **commit 2：S-111**
- 迭代收尾再一刀「审查与验证修复调整」
- **迭代内一律不 push**
