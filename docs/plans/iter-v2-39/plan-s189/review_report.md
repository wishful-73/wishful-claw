# S-189 代码审查报告

> 审查者：独立代码审查 subagent（阶段五）｜日期：2026-10-12
> 审查对象：commit `66651053`（`fix(project): 全局 PM 建会话后首次派发任务失败（S-189）`）
> 姿态：全程只读（`git show` / `git diff` / `git grep` / Read），未改动任何源码；唯一写动作是本报告。

## 审查范围

- **commit**：`66651053d4c656095163c3697cc401464f7c784c`，父提交 `689e031c`。
- **文件清单（实际 3 个源码文件，与任务描述一致）**：
  - `src/runtime/WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs`（+8/−2）
  - `src/runtime/WishfulClaw.Infrastructure/Db/DbGlobalTaskDispatchTools.cs`（+3/−1）
  - `src/runtime/WishfulClaw.Infrastructure/Db/DbPluginSessionTools.cs`（+6/−3）
  - 共 3 files changed, 17 insertions(+), 6 deletions(-)；`--stat` 实测只有这三个文件，无测试文件、无文档。
- **基准文档**：
  - `docs/plans/iter-v2-39/requirements/S-189.md`（§二 目标、§四 修复方向 A+B、§六 自查项）
  - `docs/plans/iter-v2-39/plan-s189/plan.md`（步骤 1/2/3、门禁、实机）
  - `docs/plans/iter-v2-39/plan-s189/compliance_report.md`（规划合规，❌ 0）

## 逐项审查

### 1. 需求符合性（三处改动是否恰好落地 §四 A+B）

**判据**：A = `CreateSessionAsync` 补 `Scope="project"` 且写进 INSERT；B = 派发校验由 `scope='project'` 放宽为 `project_id IS NOT NULL`；plan 步骤 3 = 同类旁路 `CreatePluginSession` 补 `scope`。

**证据**：

- A 落地：`AgentRuntimeProjectExecutor.cs:224-226` `Scope = "project"`（含注释）；`:241` INSERT 列清单加 `scope`；`:243` VALUES 加 `@scope`；`:247` 参数 `new SqliteParameter("@scope", (object?)entity.Scope ?? DBNull.Value)`。只补了 `scope` 一列，未动 `collaboration_mode` / `permission_mode`，与 §四「为什么不连 … 一起硬写」一致。
- B 落地：`DbGlobalTaskDispatchTools.cs:110-112` 由 `AND scope = 'project'` 改为 `AND project_id IS NOT NULL`；`:113-114` 失败回执文案仍为 `Target session must be a project session`（未动）。
- 步骤 3 落地：`DbPluginSessionTools.cs:159` INSERT 加 `scope`；`:165` 参数 `projectId is not null ? "project" : "global"`（按 plan 步骤 3「该路径两种会话都可能建，不能硬写 project」）。

**结论**：✅ 三处改动恰好实现 §四 A+B 与 plan 步骤 3，无多做、无少做。

### 2. 同类旁路是否覆盖全（全仓 `INSERT INTO sessions`）

**判据**：生产代码每条 INSERT 都必须写 `scope`。

**证据**：`git grep -in "into sessions" -- src` 实测生产代码恰好 4 条：

| # | 位置 | 是否写 `scope` |
|---|---|---|
| 1 | `src/runtime/WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs:241` | ✅ 本刀补上 |
| 2 | `src/runtime/WishfulClaw.Infrastructure/Db/DbPluginSessionTools.cs:159` | ✅ 本刀补上 |
| 3 | `src/runtime/WishfulClaw.Infrastructure/Db/DbPluginSessionRouting.cs:78` | ✅ 既有（`:69` `scope = project is null ? "global" : "project"`） |
| 4 | `src/runtime/WishfulClaw.Infrastructure/Db/DbSessionTools.cs:98` | ✅ 既有（`:108` 写 `input.Scope`） |

未发现第 5 条生产旁路（大小写不敏感 grep 同结果；无 `INSERT OR REPLACE/IGNORE INTO sessions`）。`tests/` 下另有 4 条 INSERT 未写 `scope`（`WishfulClaw.CompactionSnapshotRegressionTests/Program.cs:1494`、`WishfulClaw.GoalRegressionTests/Program.Lifecycle.cs:16`、`Program.Support.cs:68`、`Program.cs:217`），属测试夹具，且其 legacy 库由 `DbClient.Initialize` 的 `EnsureColumn`（`DbClient.cs:535`）补列后不影响断言，非缺陷。

**结论**：✅ 4 条生产 INSERT 全部写 `scope`，无漏网。

### 3. 判据口径一致性（`project_id IS NOT NULL` vs 全仓）

**判据**：新判据须与全项目「怎么判定项目会话」的口径一致。

**证据**：

- 启动补写 `DbClient.cs:545-547`：`UPDATE sessions SET scope = CASE WHEN project_id IS NULL THEN 'global' ELSE 'project' END` ⇒ 语义即 `project_id IS NOT NULL → project`。**与新判据逐字同源。**
- `src/renderer/src/lib/session-context.ts:124-130` `getSessionScope()`：`if (session.scope === 'global' || session.scope === 'project') return session.scope; return session.projectId ? 'project' : 'global'` ⇒ 兜底分支（`scope` 非合法值时）同样落到 `projectId ? project : global`，**与目标场景（`scope` 为 NULL）一致**；但该函数**显式 scope 优先**——一行 `scope='global'` 且 `project_id` 非空会返回 `global`，而新的 C# 判据会当 `project` 处理。二者仅在「脏数据」上分歧。
- 另见 `AgentRunContextPolicy.cs:41-50`：`scope` 合法则优先用 `scope`，非 `project` 缺 `projectId` 才抛。也属「显式 scope 优先」一类。

**结论**：⚠️ 对**目标场景**（`scope` 为 NULL）新判据与 `getSessionScope()` 兜底分支及启动补写**完全一致**，修复正确；仅对「显式 `scope='global'` 且 `project_id` 非空」这类**脏数据**存在口径分歧（需求 §六.2 已点名）。正规路径（`DbSessionTools` / `DbPluginSessionRouting` / `DbPluginSessionTools` / `AgentRuntimeProjectExecutor`）的 `scope` 均与 `project_id` 同源，产不出这类行，故不构成缺陷，仅记录备查。见问题汇总 #3。

### 4. 回归风险

**判据**：① `scope` 为 NULL 的历史行在新判据下行为变化是否可控；② `DbGlobalTaskDispatchTools` 的 Update/Cancel 是否只按 id、未受影响。

**证据**：

- NULL-scope 历史行：`project_id` 非空者由「旧判据拒绝」变为「新判据放行」——**这正是本需求的修复目标**；`project_id` 为空者仍被拒（`:111` 要求 `project_id IS NOT NULL`，紧接 `:121-122` 再兜一层）⇒ 行为变化符合预期、无越界放行。渲染端对 NULL 行的懒归一化（`rowToSession`）保持不变。
- Update：`DbGlobalTaskDispatchTools.cs:193-195` `UPDATE global_task_dispatches SET … WHERE id = @id`——**只按 `id`**，不引用 `scope`。
- Cancel：`:217-224` `UPDATE … WHERE id = @id AND status NOT IN (…)`——**只按 `id` + `status`**，不引用 `scope`。

**结论**：⚠️ 行为变化符合预期（问题汇总 #2 另记死分支）；Update/Cancel 未受影响。**无函数内回归**；但跨套件存在一处测试回归，见 #1（❌）。

### 5. 代码规范

**判据**：命名、注释准确、无新依赖、文件规模 200~500 行。

**证据**：

- 命名：`@scope` / `Scope` 与前文 `@pid` / `@ca` 风格一致；无新依赖（`SqliteParameter`、`DBNull` 均已在用）。
- 注释密度适中，绝大多数准确；**一处措辞不准**：`DbPluginSessionTools.cs:164` 注释「与 `DbSessionTools.Create` / `DbPluginSessionRouting` 同口径：有 projectId 即项目会话」——`DbSessionTools.Create` 实际写的是**渲染端传入的 `scope`**（`DbSessionTools.cs:108` `input.Scope`），并非由 `projectId` 派生；只有 `DbPluginSessionRouting.cs:69` 真是 `project is null ? "global" : "project"`。见问题汇总 #4。
- 文件行数：`AgentRuntimeProjectExecutor.cs` 609 行（>500 建议上限，**属存量**，本刀仅 +8），`DbGlobalTaskDispatchTools.cs` 297、`DbPluginSessionTools.cs` 353，均在区间内。

**结论**：✅ 规范基本合格；⚠️ 一处注释引用不准（#4）。

### 6. 潜在遗漏（跨端登记项）

**判据**：工具定义 / `ProjectToolNames` 集合 / `ExecuteAsync` switch / 主进程白名单 / 渲染端桥是否需要同步改动。

**证据**：本刀改动全部落在既有函数体内部——`create_session` 工具早已注册（`ProjectToolsProvider.cs:69`、`AgentRuntimeProjectExecutor.cs:22` 的 `ProjectToolNames`、`:43` 的 switch 分支均已存在）；`CreatePluginSession` 早已接受 `projectId`（`DbPluginSessionTools.cs:143`）。未新增工具、未改协议字段、未改渲染端。

**结论**：✅ 无新增跨端登记项，本刀不涉及。与 plan「不碰渲染端与主进程」一致。

### 7. 测试落点

**判据**：本次是否有对应自动化断言？无则明确写出。

**证据**：

- 本刀**未新增任何自动化断言**（`git show --stat` 无测试文件；`git grep -n "S-189" -- tests` 无命中）。
- 唯一触达该路径的现存测试是 `tests/WishfulClaw.SessionTaskCascadeRegressionTests/CreateSessionInsertTests.cs`，**且会因本刀而红**（详见问题汇总 #1）：它把 `sessions` 重建为**不含 `scope` 列**的 legacy 形态（`:33-38`），再真跑 `create_session` 插入（`:40-56`），断言「不再撞 NOT NULL」（`:49-50`）。新 INSERT 引用了不存在列 `scope`，插入抛错 → `create_session` 回错误 JSON → 断言失败。
- 因此 S-189 §五的三点验证（建会话后立刻派发成功、普通消息按项目会话跑、查库 `scope` 直接为 `'project'`）仍**只能实机验证**。

**结论**：⚠️ **无新增断言，需实机验证**；且现存关联测试因本刀回归（❌，见 #1）。见问题汇总 #5。

## 问题汇总

| # | 级别 | 位置（文件:行号） | 问题 | 建议 |
|---|---|---|---|---|
| 1 | ❌ | `tests/WishfulClaw.SessionTaskCascadeRegressionTests/CreateSessionInsertTests.cs:33-38` ↔ `src/runtime/WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs:241-243` | 该 S-115 回归测试把 `sessions` 表 DROP 后重建为**不含 `scope` 列**的 legacy 形态，再真跑 `create_session` 插入并断言不报错。本刀给 INSERT 加了 `scope`，而 `DbClient` 二次 `EnsureInitialized` 走早退（`DbClient.cs:50-58`）**不会**重跑 `EnsureColumn`（`DbClient.cs:535`）⇒ 插入撞 `no such column: scope` ⇒ `create_session` 返回错误 ⇒ `:49-50` 断言失败。**阶段六 `npm test` 必红。** | 同步更新该测试：在 `:33-38` 的 `CREATE TABLE sessions` 里补 `scope varchar(255)`（并可一并补其它 `EnsureColumn` 列），或让测试在建表后重跑一次迁移；本刀已含代码，建议补一个小提交修测试 |
| 2 | ⚠️ | `src/runtime/WishfulClaw.Infrastructure/Db/DbGlobalTaskDispatchTools.cs:116-122` | 新判据 `:110-112` 已保证 `project_id IS NOT NULL`，紧随其后的 `string.IsNullOrEmpty(sessionProjectId)`（`:121`）分支**恒不可达**（死分支），且又多发一条 `SELECT project_id` 查询 | 可把 `:110-122` 合并为一次 `SELECT project_id FROM sessions WHERE id=@id`，一次判空同时承担「是否项目会话」与「取 projectId」两职；若刻意留防御冗余，请补注释说明（plan 已声明「不删」，此处仅提示恒不可达） |
| 3 | ⚠️ | `AgentRuntimeProjectExecutor` 新判据 vs `src/renderer/src/lib/session-context.ts:128` | 口径仅在**脏数据**上分歧：一行 `scope` 显式为 `'global'` 且 `project_id` 非空时，`getSessionScope()` 返回 `global`（显式优先），而 C# 新判据按 `project` 放行 | 目标 NULL 场景二者一致，无需改；如需绝对对齐可让 C# 侧在 `project_id` 非空时再看 `scope` 是否为 `'global'`。正规路径产不出该组合，属低危，记录备查即可 |
| 4 | ⚠️ | `src/runtime/WishfulClaw.Infrastructure/Db/DbPluginSessionTools.cs:164` | 注释称「与 `DbSessionTools.Create` … 同口径：有 projectId 即项目会话」，但 `DbSessionTools.Create` 写的是渲染端传入的 `scope`（`DbSessionTools.cs:108` `input.Scope`），并非由 `projectId` 派生；引用不准确 | 改成「与 `DbPluginSessionRouting`（`DbPluginSessionRouting.cs:69`）同口径」，或补一句「`DbSessionTools.Create` 的 `scope` 由渲染端归一化后传入」 |
| 5 | ⚠️ | `tests/`（整仓）／`plan.md` 步骤 5 | 本刀无新增自动化断言；`scope='project'` 是否落库、派发是否当场成功**只能实机验证** | 视成本补一条断言：`create_session` 后直接 `SELECT scope …` 应为 `'project'`；并与 #1 的测试修复合并处理 |

## 正面记录

- **改动最小且精准**：A 只补 `scope` 一列，明确不动 `collaboration_mode` / `permission_mode`（其缺省依赖渲染端用户设置），与需求 §四的论证完全吻合，避免了「硬写盖掉用户设置」的反向缺陷。
- **主动发现并修补第三条同类旁路**（`DbPluginSessionTools.CreatePluginSession`），值按 `projectId is not null ? "project" : "global"` 动态判定，未对渠道/普通会话硬写 `project`——与 plan 步骤 3 的自我订正一致。
- **判据与既有口径同源**：`project_id IS NOT NULL` 与 `DbClient.cs:545-547` 启动补写逐字等价，消费方放宽后即使别的路径再漏写 `scope` 也不会当场误判，方向正确。
- **风险边界守得住**：Update（`:193-195`）/ Cancel（`:217-224`）确只按 `id`/`status` 操作，本刀未波及；未新增依赖、未改 DB 迁移、未碰渲染端与主进程。
- **注释可读性好**：三处改动均带说明性注释，除 #4 一处引用外与真实行为一致。

## 结论

**❌ 1 项 / ⚠️ 4 项。**

- ❌ #1（现存 S-115 回归测试因 INSERT 新增 `scope` 而必红）为**阻断项**：代码本身逻辑正确，但提交未同步更新其覆盖的测试夹具，阶段六 `npm test` 会失败。
- 能否进入验证态：**❌ 不为 0，暂不可进入验证态**。修复 #1（在 `CreateSessionInsertTests.cs:33-38` 的 legacy `CREATE TABLE sessions` 中补 `scope varchar(255)`，或让该测试补跑一次列迁移）后，❌ 归零即可进入阶段六门禁与实机验证。⚠️ #2~#5 为可选改进，不阻断。
