# 验证报告（阶段六）— iter-v3-1

**验证日期**：2026-10-23
**验证范围**：S-217 / S-218 / S-219 / S-220（S-221 / S-222 尚未实施，不参与）
**结论**：**PARTIAL** —— 编译与测试全绿；**真机验证未做**

## 一、编译与测试门禁

| 项 | 命令 | 结果 |
|---|---|---|
| TypeScript（web） | `npx tsc --noEmit -p tsconfig.web.json` | ✅ 0 错 |
| TypeScript（node） | `npx tsc --noEmit -p tsconfig.node.json` | ✅ 0 错 |
| TypeScript（根配置） | `npx tsc --noEmit -p tsconfig.json` | ⚠️ 0 错，但**是假 0**（见 §四） |
| C# | `dotnet build src\runtime\WishfulClaw.sln` | ✅ 0 警告 0 错误，31.53 s |
| 单元测试 | `npm test` | ✅ **78/78** |

编译前已按 `docs/dev-workflow.md`「编译环境」检查：无 `bin\Debug` 下的 `WishfulClaw.Worker.exe`、无 `node_modules\electron` 下的 `electron.exe`，未发生 `MSB3021` / `MSB3027`。

## 二、验证发现并已修复的问题

### F1 · i18n 键缺失（❌ 必修，已修）

**首轮结果**：`npm test` **77/78**，失败项 `test:i18n-coverage`。

**原因**：S-218 的 `ProviderAuthPanel.tsx` 与 `SettingsPage.tsx` 引用了 18 个 `providerAuth.*` / `tabs.providerAuth.*` 键，全部只给了 `t()` 的 `defaultValue`，`zh/settings.json` 与 `en/settings.json` 里都没有对应条目。中文界面靠 defaultValue 能显示，**英文界面会直接露出中文**。

**修复**：两份语言包各补 17 个键 —— `tabs.providerAuth.{label,desc}` + 顶层 `providerAuth` 块（`connected` / `waiting` / `cancel` / `checkin` / `reauthorize` / `disconnect` / `signIn` / `autoCheckin` / `autoCheckinHint` / `signInSuccess` / `disconnectDone` / `checkinClaimed` / `checkinDone` / `checkinCaptcha` / `checkinFailed` / `description` / `empty`）。插值变量与 defaultValue 保持一致。

**复验**：`npm run test:i18n-coverage` → `i18n coverage checks passed: 2`；`npm test` → **78/78**。

> 这条属于「实现时漏了，验证态才抓到」的典型。若跳过阶段六直接收尾，英文面会带着中文提示发出去。

## 三、未验证项（需老大事后补）

| 需求 | 未验内容 | 为什么验不了 |
|---|---|---|
| S-218 | 登录、对话、签到、令牌续期四条链路的真实行为 | 无有效套餐账号；全部按逆向接口对齐实现，只到「编译通过 + 逻辑对齐」 |
| S-217 | 真实更新安装是否沿用历史路径与范围 | 需先装一个旧版本再跑新安装包 |
| S-219 | 同一 turn 内并发写同一文件不再报 SharingViolation | 需真机跑一次多工具并发写入 |
| S-220 | 点刷新后手输地址不再命中旧缓存 | 需本地起 dev server 并改动页面 |

**按 `AGENTS.md`「迭代交付标准」**（有入口 / 有反馈 / 有闭环 / 能启动 + 核心流程能跑），S-218 目前**不满足闭环**：请求侧修补（步骤 8）未做，真账号也没跑过。

## 四、规范冲突记录

`docs/dev-workflow.md:491` 要求「三个配置必须全部零错误」（含根 `tsconfig.json`），而 `AGENTS.md:216` 明确指出：

> 根 `tsconfig.json` 不要单独跑：它是 references-only 壳（`"files": []` + `references`），对它执行 `tsc -p tsconfig.json` **不检查任何文件**，跑出来的"0 错误"是假的。

本次实测坐实了 AGENTS.md 的说法 —— 根配置 0 错，但它不检查任何文件。**按 AGENTS.md 执行**（以 `tsconfig.web.json` + `tsconfig.node.json` 为准），此处两份文档口径需订正，否则后人会拿假 0 当证据。**本次未改规范文档**，留给老大裁定。

## 五、结论

- 编译与测试：**PASS**
- 真机功能：**PARTIAL**（四条需求全部未在真机跑过）
- 可进入阶段五阻断检查：阶段五报告见 `../review_report.md`

## 六、第二轮验证（阶段五修复后，2026-10-23）

阶段五独立审查判 ❌ 8 条（见 `../review_report.md` §一~§四），修复后复跑全部门禁：

| 项 | 命令 | 结果 |
|---|---|---|
| TypeScript（web） | `npx tsc --noEmit -p tsconfig.web.json` | ✅ 0 错 |
| TypeScript（node） | `npx tsc --noEmit -p tsconfig.node.json` | ✅ 0 错 |
| C# | `dotnet build src\runtime\WishfulClaw.sln` | ✅ 0 警告 0 错误 |
| 单元测试 | `npm test` | ✅ **78/78** |
| 官网 | `cd website; npm run build` | ✅ 0 错误 |

**本轮修复内容**（详见 `../review_report.md` §七）：

| 来源 | 修复 |
|---|---|
| ❌1 / ❌2 | S-219 锁范围提升为「读 → 改 → 写」事务级：`ToolHelpers.WithWriteGateAsync` + 三个读改写工具（`FileEditTool` / `MemoryHotWriteTool` / `AgentRuntimeNotebookEditExecutor`）整段入锁 |
| ❌3 / ❌8 | `BrowserPanel.tsx`（515 行）、`shared/types/provider.ts`（505 行）补 500 行豁免头 |
| ❌4 / ❌5 | S-218 §5.1 三层风险提示 + 勾选门槛、§5.2「第三方」角标，zh/en 各补 6 个键 |
| ❌6 | 主进程签到前续期：`tokenStale` / `expiresAtOf` / `renewTokenIfStale`，续期后回写 provider store |
| ❌7 | `resolveExpiresAt` 统一口径：先认 `expiresAt` 绝对时刻，再认 `expiresIn` / `expires_in` / `expires` |

**新发现的一个经验证据**：修复过程中，同一轮并发两个 `Edit` 打同一文件，仍然复现了 `IO_SharingViolation_File`（`workbuddy-signin.ts`、`workbuddy-checkin-scheduler.ts` 各一次）。原因是**运行中的生产实例加载的仍是修复前的旧 worker 二进制**，编译产物未重启不生效。这反过来印证了 ❌1 的严重性 —— 旧代码下这条并发只报错不丢数据，而新锁若只包写入就会变成静默丢数据。

**遗留未验项不变**：§三 四条真机验证仍需老大补；S-218 真实账号链路仍未跑过。

