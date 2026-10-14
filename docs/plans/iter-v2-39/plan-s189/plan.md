# Plan: S-189 —— 全局 PM 建会话后首次派发任务报「Target session must be a project session」

> 归口：`docs/plans/iter-v2-39/requirements/S-189.md`（原文 / 现象 / 根因 / 修复方向 A + B 已定）。
> 口径来源：老大 2026-10-12 09:07「根据你的推荐登记，不着急动手」⇒ 采纳 **A + B**；2026-10-12 18:32「39迭代内没做的需求 都根据开发工作流开始推进」⇒ **开工**。

## 目标

让全局 PM 用 `create_session` 建出的项目会话**当场**就是项目会话（`scope` 不再为 NULL），并把派发校验换成与全项目一致的判定口径，消除「首次派发必失败、重启后自愈」这一症状。

## 步骤清单

- [x] **步骤 1 —— `CreateSessionAsync` 补 `scope`（A，主改）**
  文件 `src/runtime/WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs`：
  - `SessionEntity` 初始化块（`:219-231`）补 `Scope = "project"`；
  - INSERT 列清单（`:236-237`）加 `scope`，`VALUES`（`:238`）加 `@scope`，参数列表（`:239-247`）加 `SqliteParameter("@scope", (object?)entity.Scope ?? DBNull.Value)`。
  - **只补 `scope` 一列**：`collaboration_mode` / `permission_mode` 的缺省取决于渲染端用户设置（worker 读不到），继续留 NULL 由 `rowToSession` 归一化回填。
  - **验证检查点**：`git diff` 确认只动这一处；`dotnet build src/runtime/WishfulClaw.sln` 0 错误。

- [x] **步骤 2 —— 派发校验改口径（B，互补）**
  文件 `src/runtime/WishfulClaw.Infrastructure/Db/DbGlobalTaskDispatchTools.cs`：
  - `:109-114`（合规检查实测行号；原写 `:108-112` 偏 1~2 行）的 `SELECT COUNT(*) FROM sessions WHERE id = @id AND scope = 'project'` 改为 `AND project_id IS NOT NULL`；
  - 对齐全项目同一规则：`getSessionScope()`（`lib/session-context.ts:127-129`）与启动补写（`DbClient.cs:545-547`）。
  - 与 `:114-120` 已有的「`project_id` 为空 ⇒ Target project session has no projectId」互补，**不删**后一段（前者判「是不是项目会话」，后者取 `projectId` 供派发记录用）。
  - **验证检查点**：`dotnet build` 0 错误；通读该事务块确认四条校验的相对顺序未变。
  - **脏数据复核（合规检查补）**：确认换口径后 **不会**误放行「`scope` 显式为 `global` 但 `project_id` 非空」的行 —— 这类行在当前代码里**不可能由正规路径产生**（`DbSessionTools.Create` / `DbPluginSessionRouting` / `DbPluginSessionTools` / `AgentRuntimeProjectExecutor` 四处 INSERT 的 `scope` 均与 `project_id` 同源），且**语义上就该算项目会话**（全项目同一口径）；同时确认 `global_task_dispatches` 的其它两处操作（`:194` Update / `:218` Cancel）只按 `id` 走、不依赖 `scope`。

- [x] **步骤 3 —— 自查发现的第三条旁路：`CreatePluginSession` 补 `scope`**
  > **来源**：S-189 §六 开工自查（grep 全项目 `INSERT INTO sessions`）实测发现 —— §六 原断言「`create_session` 工具是唯一漏的」**不准确**：`src/runtime/WishfulClaw.Infrastructure/Db/DbPluginSessionTools.cs:159`（`CreatePluginSession`）同样漏写 `scope`，且它接受 `projectId`（可建成项目会话）⇒ **同类缺陷、同一修法**。
  文件 `src/runtime/WishfulClaw.Infrastructure/Db/DbPluginSessionTools.cs`：
  - `:158-170` 的 INSERT 加 `scope` 列与 `@scope` 参数，值 = `projectId is not null ? "project" : "global"`（该路径两种会话都可能建，**不能硬写** `"project"`）。
  - **验证检查点**：`dotnet build` 0 错误；grep `INSERT INTO sessions` 全项目 **4 处**（`DbSessionTools` / `DbPluginSessionRouting` / `DbPluginSessionTools` / `AgentRuntimeProjectExecutor`）**全部含 `scope`**。

- [x] **步骤 4 —— 门禁**
  - `dotnet build src/runtime/WishfulClaw.sln` 0 警告 0 错误（**先按 `dev-workflow.md` §「编译环境」关掉 dev 实例**）。
  - `npm run typecheck` 0 错误、`npm test` 68/68 —— 本需求**不动 TS 代码**，跑一遍确认无回归。
  - **验证检查点**：三条命令退出码 0，输出尾部无 error。

- [ ] **步骤 5 —— 实机验证（**未执行** —— 无 dev 实例，留验证态）**
  见 `S-189.md` §五：① 建会话后不重启直接 `send_work_request` 应成功；② 同一会话再发普通消息应以项目会话身份跑；③ 查库 `SELECT scope, collaboration_mode, permission_mode FROM sessions WHERE id='<新会话>'` ⇒ `scope` 直接是 `'project'`。
  - **验证检查点**：无 dev 实例则记 **PARTIAL**，逐项写进 `verification_report.md`，不谎报 PASS。

## 涉及文件

- `src/runtime/WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs` — 改（步骤 1）
- `src/runtime/WishfulClaw.Infrastructure/Db/DbGlobalTaskDispatchTools.cs` — 改（步骤 2）
- `src/runtime/WishfulClaw.Infrastructure/Db/DbPluginSessionTools.cs` — 改（步骤 3，自查新增）
- 只读参照（不改）：`DbClient.cs`、`DbSessionTools.cs`、`DbPluginSessionRouting.cs`、`lib/session-context.ts`

## 参考源码

无（本地缺陷修复，不涉及 OpenCowork / KodaClaw 搬码）。

## 风险与边界

- **不改 DB**：不加 `DEFAULT`（方案 C 已否决）。
- **不碰渲染端与主进程**：渲染端本来就正确处理 NULL（`rowToSession` 归一化），是「被动放大症状」的一方。
- **步骤 3 属自查新增**：若老大认为应单独登记为需求，实施时**回退该步**即可，与步骤 1 / 2 无耦合。
