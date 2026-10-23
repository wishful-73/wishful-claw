# S-218 规划合规检查（阶段三）

**审查日期**：2026-10-23
**审查范围**：`docs/plans/iter-v3-1/plan-s218/plan.md`（对照 `docs/plans/iter-v3-1/requirements/S-218.md`、`AGENTS.md`、`docs/project-structure.md`、`docs/dev-workflow.md` L397-416）
**审查方式**：只读。未改任何源文件，未做任何 git 写操作。
**结论计数**：❌ 3 / ⚠️ 11 / ✅ 12

---

## 阻断

**阻断：禁止进入用户确认环节**（❌ = 3）。

三条阻断项：§2.3 授权页完整口径无步骤覆盖、§5 风险口径无步骤覆盖、错误码翻译与重试策略无步骤覆盖。

---

## 一、步骤覆盖目标

| # | 检查项 | 结论 | 依据 |
|---|---|---|---|
| 1 | 登录链路（铸 state → 浏览器 → 轮询 token / account → 企业号） | ✅ | `plan.md:16` 步骤 3 逐环对应 `S-218.md` §3.2 六步；实施记录 `S-218.md:507` 与代码 `workbuddy-signin.ts:200-292` 一致 |
| 2 | 双版预设与模型清单（15 / 16） | ✅ | `plan.md:15` 步骤 2；实测 `workbuddy.ts:24-59` 为 15 + 16 条 |
| 3 | 令牌续期 + `clientId` 前置放开 | ✅ | `plan.md:17` 步骤 4；代码 `provider-auth-accounts.ts:23-25`、`:36-38` |
| 4 | 身份头注入 | ✅ | `plan.md:18` 步骤 5；代码 `ProviderHttpHeaders.cs:120-140` |
| 5 | 签到（一天一次 / 不重试 / UTC+8 / 可关闭） | ⚠️ | `plan.md:19` 步骤 6 只写「渲染端 + 主进程 + 开关」三件物，未把 §5.5 的五条行为口径写进步骤；检查点也不验行为（见第 16 项） |
| 6 | §2.3 授权页完整口径（判据 `authMode === 'oauth'`、Codex / Copilot / Moonshot 迁入、`ProviderPanel` 过滤） | ❌ | `plan.md:20` 步骤 7 仅写「新增页签 + 两处 id 同步」。`S-218.md:122` 明写「判据必须是 `authMode === 'oauth'`」、`:145` 明写三家一并迁入、`:176` 明写 `ProviderPanel.tsx:182/:190` 过滤。plan 缺这三项，实施结果相应偏离（`ProviderAuthPanel.tsx:23-25` 只收 `server_poll`） |
| 7 | §3.4 出站修补 + §3.3.1 四个会话头 + 工具名转义 | ⚠️ | `plan.md:21` 步骤 8 有覆盖，但状态 `[ ]`；且把四类互不相关的修补压成一步，未拆子项 |
| 8 | §3.5 模型清单 / §6 额度 / 计费倍率 | ⚠️ | `plan.md:22-24` 步骤 9-11 均 `[ ]`，`plan.md:26` 自述「步骤 8 完成前不能算交付」 |
| 9 | §5 风险口径（接入前三层提示 + 勾选确认、服务商「第三方」标识、错误码人话） | ❌ | 全文 62 行无任何「风险 / 第三方 / 非官方 / 勾选」步骤。`S-218.md:340` 明写「三层，缺一层不算尽责」 |
| 10 | 错误码翻译与重试归口（`11140` / `14018` / `unapproved channel`；`ProviderRetryPolicy.cs`） | ❌ | `plan.md:60-62` 只解释了「不新建 Dialect」，对 `S-218.md:101` 的 `ProviderRetryPolicy` 归口与 `:358-364` 的文案表一字未提 |

## 二、验证检查点

| # | 检查项 | 结论 | 依据 |
|---|---|---|---|
| 11 | 步骤 1 检查点 | ✅ | `plan.md:14`「`tsc` web / node 双配置 0 错」，可执行 |
| 12 | 步骤 2 检查点 | ✅ | `plan.md:15`「`flowType === 'server_poll'` 能筛出 + tsc 0 错」，可执行 |
| 13 | 步骤 3 检查点 | ⚠️ | `plan.md:16`「三个轮询分支的退出条件与超时都能对上 §3.2」——「对上」无判定手段，且实际只有两个轮询（token / account），第三个分支并不存在 |
| 14 | 步骤 4 检查点 | ✅ | `plan.md:17`「`server_poll` 走新分派、其余走原分派」 |
| 15 | 步骤 5 检查点 | ✅ | `plan.md:18`「`dotnet build` 0 警告 0 错误」，与 `AGENTS.md:214` 门禁一致 |
| 16 | 步骤 6 检查点 | ⚠️ | `plan.md:19` 只验编译与「定时器每分钟重读 provider 文件」，不验「同日去重 / 失败不重试 / 系统时区改 UTC+0 / 睡眠唤醒」，而 `S-218.md:475-482` 把这四项列为验收 |
| 17 | 步骤 7 检查点 | ✅ | `plan.md:20`「两处 id 一致 + tsc 0 错」，可执行（但只覆盖登记面，不覆盖页面内容，见第 6 项） |
| 18 | 步骤 8-11 检查点 | ⚠️ | `plan.md:21-24` 全部以真账号为前提，当前无账号即不可执行；步骤 8「真账号发一次带工具的请求，不报 `11133`」无回归手段，且与 `AGENTS.md:206-208`「迭代交付标准 · 有闭环」冲突时未写处置 |

## 三、文件路径与项目结构

| # | 检查项 | 结论 | 依据 |
|---|---|---|---|
| 19 | 后端路径落在正确层 | ✅ | `plan.md:48` 的 `ProviderHttpHeaders.cs` 位于 `WishfulClaw.Agent/` 根，与 `docs/project-structure.md:54`「模型 Provider 实现平铺在 Agent 根」一致；未触碰 Contracts / Core |
| 20 | 渲染端面板目录归属 | ⚠️ | `plan.md:35` 放 `components/settings/ProviderAuthPanel.tsx`，但既有服务商面板都在 `components/settings/provider/`（实测该目录 9 个文件）；需求 `S-218.md:175` 原定也是 `settings/provider/AuthorizedProviderPanel.tsx`。plan 未写改名与换目录的理由 |
| 21 | 涉及文件清单与实际改动一致 | ⚠️ | plan 列 14 个文件，与 `69e49b4a` 一致；但实际另改了 `locales/{zh,en}/settings.json`（工作区未提交，`git diff --stat`），plan 未列。反向：需求 `S-218.md:90` 的 `provider-icons.tsx` 既未进 plan 也未实施，无处置说明 |

## 四、分层依赖

| # | 检查项 | 结论 | 依据 |
|---|---|---|---|
| 22 | 是否引入逆向 / 跨层依赖 | ✅ | 四个提交未新增 C# 项目引用（`git show --stat` 无 `.csproj`）；渲染端只新增同层 import；`ProviderHttpHeaders.cs` 仅在 Agent 层内部被调用 |
| 23 | 跨语言契约的单一真源 | ⚠️ | `oauthAccount` 只在 `src/shared/types/provider.ts`（TS）声明，C# 侧用 `JsonElement.TryGetProperty("oauthAccount")` + 裸字段名读取（`ProviderHttpHeaders.cs:120`、`:163-168`）。plan 未说明契约同步与 AOT 下的序列化登记方式（`AGENTS.md:163-169`） |

## 五、参考源码

| # | 检查项 | 结论 | 依据 |
|---|---|---|---|
| 24 | 参考文件是否存在、是否逐个对应 | ✅ | `plan.md:52-58` 列的 6 个 `.mjs` 在 `.wishful-claw/tmp/astra-plugins/` 全部存在（13 个 `.mjs` 中取 6）；`src_session.mjs:14-17` 的 `expiresAt` 口径也证明参考实读而非凭记忆 |
| 25 | 参考源码可复现性与许可登记 | ⚠️ | 该目录被 `.gitignore:74`（`.wishful-claw/*`）排除，换机器 / 下个会话无法复核；`AGENTS.md:127-133` 参考源码表未登记该来源；`THIRD_PARTY_NOTICES.md` 只有 OpenCowork / shadcn，无 astra-gate 条目（`workbuddy.ts:1-13` 仅文件头注明 Apache-2.0） |

## 六、过程

| # | 检查项 | 结论 | 依据 |
|---|---|---|---|
| 26 | 阶段三是否在实施前真正生效 | ⚠️ | `plan.md:3` 自述「补写于 2026-10-23」，且整个 `plan-s218/` 在 `git status` 里是未跟踪（`??`）。即规划验证实际发生在四个提交之后，本报告的结论只能用于「补正」，不能视为已过门禁 |

---

## 附：与需求正文的口径差（供确认，不计入计数）

| 需求条目 | plan / 实施 | 备注 |
|---|---|---|
| `S-218.md:401` 随机量「1~30 min，待确认」 | 实现 1~10 min（`workbuddy-checkin-scheduler.ts:24`） | `S-218.md:516` 已记为偏差，待老大确认 |
| `S-218.md:378` `lastCheckinDate` 落盘 + 常显连签 | 落 `lastAttemptDate`，状态只在点按时 toast（`:174`、`ProviderAuthPanel.tsx:193-228`） | `S-218.md:519` 已记 |
| `S-218.md:145` 三家迁入 | 未迁（`S-218.md:518` 已记） | 与本报告第 6 项同源：plan 未把该口径写进步骤 |
