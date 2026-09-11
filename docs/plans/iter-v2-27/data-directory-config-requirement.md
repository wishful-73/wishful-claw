# 需求：数据目录配置化与测试环境隔离（迭代中追加）

- 状态：口径与排期均已确认（dev 目录 `~/.wishful-claw-dev`；跟随 v2-iter-27 实施，排期原因：用户依赖自研可控性，需求紧急）；Plan K 已追加至 `plan.md`
- 需求来源：老大口头提出——生产与开发/测试共用同一份 `~/.wishful-claw`（数据库 + 配置），导致不敢在开发会话里让 Agent 开发自身；需要一个真正隔离开的测试环境
- 本文档仅为需求记录，不含实现

## 背景

当前代码中数据目录解析存在三种状态：

1. **已支持 `WISHFULCLAW_DATA_DIR` 环境变量覆盖**（smoke test / GoalRegressionTests 使用中）：
   - TS：`src/main/index.ts:184`（重定向 Electron userData，且在 `requestSingleInstanceLock()` 之前执行，dev 与生产实例的单实例锁天然分离，可同时运行）、`src/main/ipc/input-draft-handlers.ts`、`src/main/ipc/mcp-handlers.ts`、`src/main/lib/ai-provider-store.ts`、`src/main/lib/settings-store.ts`、`src/main/lib/logger.ts`
   - C#：`WishfulClaw.Infrastructure/Db/DbClient.cs`（index.db）、`ConfigStore.cs`、`ProviderStore.cs`、`WishfulClaw.Agent/Modules/Channels/ChannelConfigStore.cs`
2. **TS 侧硬编码 `~/.wishful-claw`**（约 8 处）：`clipboard-enhancer.ts`、`quick-launcher.ts`、`ipc/extension-plugin-sync.ts`、`ipc/video-handlers.ts`、`ipc/misc-handlers.ts`（生成图片，需核实）、`lib/agent-history-store.ts`、`lib/codegraph-assets.ts`、`mcp/mcp-client.ts`
3. **C# 侧硬编码 `UserProfile + ".wishful-claw"`**（约 15 处）：`SubAgentDefinition`、`SystemPromptCache`、`PersonaStore`、`MemoryPathResolver`、`SkillCatalog`、`SkillConfigStore`、`AgentRuntimeSkillExecutor`、`QqSessionStore`、`ExtensionManifestHelpers`、`OpenAIAudioTools`、`SeedanceVideoTools`、`XaiVideoTools`、`CodeGraphDataDir`、`CodeGraphDataRootRegistry`、`CodeGraphToolHandler` 等

现状结论：环境变量覆盖机制已存在，但只隔离了约 70%（DB、主配置、日志、MCP、provider）。personas、agents、skills、记忆、codegraph 索引等仍指向生产目录。**半隔离比不隔离更危险**——使用者会误以为已隔离。

## 需求动机（已确认）

本需求的最终目的：**让 WishfulClaw 可以自己开发自己**。此前生产与开发共用同一份 `~/.wishful-claw`（SQLite 数据库 + 配置 + 记忆/人格文件），开发会话中运行 Agent 操作自身源码时，一旦写坏数据库或配置，应用本身就无法启动，且无法恢复到开发前状态，因此不敢执行。隔离完成后，dev 实例使用独立的 `~/.wishful-claw-dev`，写坏只影响测试环境，生产数据不受波及。

## 目标

1. 数据目录解析收敛为**唯一一处**（TS 一个 resolver、C# 一个 helper），所有 `.wishful-claw` 引用全部改走统一解析，消灭散落的硬编码。
2. 目录名走配置级别，不在多处写死：
   - 显式：环境变量 `WISHFULCLAW_DATA_DIR`（优先级最高，CI / smoke test / 手动指定均可）。
   - 开发态默认：未打包（`!app.isPackaged`，即 `npm run dev`）时，默认使用 `~/.wishful-claw-dev`（默认名只在该 resolver 中定义一次，不在各模块重复出现）。
   - 打包生产：`~/.wishful-claw`，行为不变。
3. C# Worker 不重复实现 dev 判断：dev 目录由 Electron Main 解析后，经现有 worker 启动链路（`native-worker.ts` 已使用 `env: workerEnv` 继承主进程环境）通过 `WISHFULCLAW_DATA_DIR` 传入；C# 侧只认环境变量，否则回退默认目录。
4. Electron `userData` 重定向与单实例锁顺序保持现状（先 `setPath` 后 `requestSingleInstanceLock`），确保 dev 与生产实例可并存。

## 进程并发与冲突分析（已核实）

使用模式已确认：开发主力为**生产安装版**（Agent 在生产实例中开发自身源码），`npm run dev` 拉起第二实例验证改动。因此两实例并发是常态，不是异常。

- **现状**：单实例锁按 userData 路径 scope，dev 与生产同走 `%APPDATA%/WishfulClaw`（`app.setName('WishfulClaw')` 之后），锁 key 相同——生产运行时 `npm run dev` 会被拒并触发生产的 `second-instance`。当前无法双开。
- **隔离后**：`src/main/index.ts:184` 的 `setPath('userData', …)` 已在 `requestSingleInstanceLock()`（:190）之前执行，dev 的 userData 重定向到 `~/.wishful-claw-dev/electron-user-data`，锁 scope 分离，两实例可并存。实现时必须保持这一顺序，并把该处 userData 重定向改走统一 resolver。
- Worker IPC 管道名含 `{pid}-{timestamp}-{uuid}`（`native-worker.ts:452`），两实例天然不冲突。
- Main 进程无本地固定端口监听；SSH/MCP/渠道均为出站连接。
- 无 `setAsDefaultProtocolClient` 注册，不存在深链抢占。
- 数据文件（index.db、config、日志、personas、记忆）在目录隔离后不再跨实例共享——这是当前最实际的并发写风险（SQLite 并发打开、config 互写），隔离即消除。

## 已知共存外观问题（本迭代不处理）

- AUMID 相同（`com.wishfulclaw.app`）：dev 与生产任务栏图标分组到一起、Windows 通知共用标识。仅外观，不影响功能。
- 托盘双图标：两实例各一个，属预期。

## 已确认口径

- 默认 dev 目录名：`~/.wishful-claw-dev`（已确认），resolver 中作为唯一常量存在。
- 不做生产 → dev 数据自动复制迁移；dev 目录首次启动为空，provider key 等手动复制一次配置文件。隔离必须隔干净，避免「两份数据哪份是真」。
- 项目级 `{工作区}/.wishful-claw/` 目录不在本需求范围内（已有 .gitignore 兜底，且与全局目录机制不同）。

## 步骤草案（进入 plan.md 前仅供讨论）

- K1：TS 统一 resolver（新建 `src/main/lib/data-dir.ts` 或复用现有 lib 位置），实现优先级链 `WISHFULCLAW_DATA_DIR` > dev 默认 > 生产默认；替换上述 TS 硬编码点。Mini：三套 TypeScript、`git diff --check`。
- K2：C# 侧统一 helper（`WishfulClaw.Infrastructure` 内），替换上述 C# 硬编码点；确认 Main → Worker 环境变量传递。Mini：C# build、`npm run build:worker:prod`（AOT 无 IL 警告）、`git diff --check`。
- K3：验证（核心验收）：
  1. 生产 `~/.wishful-claw` 用 `icacls` 设为拒绝写入，跑 `npm run dev`，全功能走查（聊天、记忆、personas、skills、codegraph、剪贴板、MCP、渠道）后日志无写入报错——证明 dev 全部数据落在 `~/.wishful-claw-dev`。
  2. dev 与生产实例同时运行，单实例锁互不抢占。
  3. 打包版启动时数据目录仍为 `~/.wishful-claw`，行为不回归。
  4. `WISHFULCLAW_DATA_DIR` 显式指定时三方（Main / Renderer 间接 / Worker）全部跟随。

## 边界（不纳入）

- 不迁移、不同步生产数据到 dev 目录。
- 不改项目级 `{工作区}/.wishful-claw/` 机制。
- 不新增设置页面 UI；目录选择属开发/测试基建，走环境变量与 dev 态默认值。
- 不为 SSH/远程项目场景调整全局目录逻辑（`~/.wishful-claw/projects/{id}/` 现有机制保持）。

## 清单核实更正（2026-09-10）

上文「背景」中的"约 8 处 / 约 15 处"为口头估算，已被全仓实测取代：**代码内 36 处字面量，其中 16 处是各自独立定义的重复常量**。权威清单见 `plan.md` 的「Plan K · 实测清单」，本文档不再单独维护，以免两处漂移。

本清单中的误报项（按原文去找会找不到）：

- `SkillCatalog.cs`、`SkillConfigStore.cs` —— 存在，但在 `WishfulClaw.Agent/Modules/Skills/` 下（原文按根目录写法找不到）；且它们硬编码的是 `.agents` 而非 `.wishful-claw`，不属于本需求的数据目录收敛范围。
- `lib/codegraph-assets.ts` —— 其 `homedir()` 指向 `~/.nuget/packages`，非数据目录。
- `ipc/misc-handlers.ts`（生成图片）—— 实际是 `join(homedir(), 'wishful-claw', 'image')`，**无前导点**，非数据目录。
- `CodeGraphDataRootRegistry.cs`、`CodeGraphToolHandler.cs`、`ExtensionManifestHelpers.cs` —— 仅注释提及或已引用常量，无字面量。
- `AgentRuntimeSkillExecutor` —— 用 `~/.agents/skills`，**根本不是 `.wishful-claw`**。因此上文「skills 会被 dev 目录承接」的说法不成立。

## skills 目录的归属（老大已定：略过不处理）

`~/.agents/skills` 实测 41 个技能，与 Qoder 当前会话可用技能同名同集合，属**多 Agent 工具共用的约定目录**，不是"我们软件自己放文件的地方"。迁入数据目录会连带波及其它工具，与"其它东西不受影响"的口径冲突。**结论：`.agents` 整体略过——不迁移、不改名、不做双源扫描。**

因此以下两项作为已知遗留问题记录，本迭代不修（详见 `plan.md` 的 Plan K 记账）：

- `~/.agents/skills-config.json`（`disabledSkills`）是 Wishful Claw 自有状态，落在共用目录内会被 dev 与生产实例互写。
- `SkillsMenu.tsx:416` 宣称技能在 `~/.wishful-claw/skills/`，代码实际读 `~/.agents/skills` → 文案与实现不一致。

## 风险

- 漏改一处硬编码即造成共用文件：验收以「生产目录只读 + 全功能走查」为准，不以代码走查代替。
- `ipc/misc-handlers.ts`（生成图片）、`terminal-handlers.ts:180`、`ShellExecuteTool.Helpers.cs:42` 等引用 home 目录的点，需在实现期逐一核实是否属于数据目录范畴，避免误改 shell home 语义。
