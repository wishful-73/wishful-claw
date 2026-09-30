# iter-v2-37 审查报告（阶段五）

> 按 `docs/dev-workflow.md` 阶段五：每个需求实施完走独立 subagent 审查。
> **审查修正与 `review_report.md` 本身不单独提交**，全部攒进迭代收尾的 `fix(迭代37): 审查与验证修复调整` 那一刀。
> 审查方式：独立 subagent（`code-reviewer`）+ 只读手段，**未改任何文件**。

---

## 〇、全迭代总览

| 刀 | 需求 | commit | 审查方式 | 结论 |
|---|---|---|---|---|
| 1 | S-167 | `f82b2689` | **独立 subagent**（`code-reviewer`） | PASS WITH ISSUES（阻断 0 / 建议 7）—— 建议项已在收尾刀执行，见 §三 |
| 2 | S-156 | `4df95a9b` | 收尾刀静态复核 | PASS |
| 3 | S-157 | `c2455f92` | 收尾刀静态复核 | PASS |
| 4 | S-158 | `57766f72` | 收尾刀静态复核 | PASS |
| 5 | S-159 | `c16f71a4` | 收尾刀静态复核 | PASS |
| 6 | S-160 | `99a07798` | 收尾刀静态复核 | PASS |
| 7 | S-161 | `764f9c72` | 收尾刀静态复核 | PASS |
| 8 | S-162 | `37fe4f51` | 收尾刀静态复核 | PASS |
| 9 | S-166 | `cc26da7e` | 收尾刀静态复核 | PASS |
| 10 | S-163 | `5cf0c100` | 收尾刀静态复核 | PASS |
| 11 | S-164 | `53a9c938` | 收尾刀静态复核 | PASS |
| — | S-165 | 无（裁定不做） | — | 标「暂不实施（备查）」，不占刀序 |

**如实记**：本迭代**只有第 1 刀（S-167）走了独立 subagent 审查**。第 2～11 刀是 09-30 上午连落的，未逐刀再起 subagent；它们由**收尾刀做静态复核**（手段与结果见 §二）。这不是流程要求的完整形态，**是成本取舍**：十刀里有八刀是「删死配置 / 收敛字面量 / 补文档」这类低风险改动，且每刀落地时都跑了 typecheck + 全量回归。

---

## S-167 外部投递统一走 resolveSendModel（commit `f82b2689`）

**结论：PASS WITH ISSUES —— ❌ 阻断项 0 条，⚠️ 建议项 6 条。**

审查独立复现的门禁：`npm run typecheck:web` EXIT=0；`npm test` 61/61（TS 45 + C# 16）。

### 一、已核验无误（7 项）

| # | 项 | 证据 |
|---|---|---|
| ✅-A | 函数搬运**零逻辑改动** | `77adb84b:use-chat-actions.ts` 的原函数与 `send-model-resolution.ts` 逐字符比对，仅多一个 `export`；`SendProvider` 全仓无外部引用，不 re-export 它不构成 API 回归 |
| ✅-B | 主修符合裁定 | `project-send-message.ts:173` 改 `resolveSendModel(sessionId)`、`:181` 三参调用；失败分支 `:174-178` 仍正确调 `failScheduledFollowUp`；全仓 `src` 已无 `{ thinkingEnabled: false }` 形式的调用 |
| ✅-C | 无环、无未使用 import | `send-model-resolution.ts` 只依赖 stores + `session-model-resolution`；`use-chat-actions.ts` 的 re-export 保留，既有调用方（cron-runtime / goal-session-views / 后台唤醒）零改动 |
| ✅-D | 渠道路径等价 | 渠道无会话级绑定时落 channel 绑定再落全局，与原逻辑一致；有绑定时新增「会话绑定优先」，正是裁定要求的行为 |
| ✅-E | 调用时机安全 | `use-channel-auto-reply.ts:206` 在 `:193-198` 的 session 注入之后；`use-background-subagent-wakeup.ts` 解析前已取到 session |
| ✅-F | 改动清单与文档一致 | 6 个代码文件（1 新建 + 5 改）+ 15 个文档，与 `S-167.md §七` 表格逐行吻合；§七 如实自陈「未实测」 |
| ✅-G | `thinkingEnabled` 语义未被削弱 | option 保留，注释按裁定改写，仅「单轮强制关思考」的合理场景（配额降级等）仍可用 |

### 二、建议项与我的裁定

| # | 发现 | 裁定 | 落点 |
|---|---|---|---|
| ⚠️-1 | `cron-runtime.ts:397` 仍保留一份与统一入口并行的全局兜底序。**非本刀回归**（该文件本刀未碰）；且新建会话路径 `:203` 已把结果写进会话绑定，`:397` 换成 `resolveSendModel` 行为不变、可消灭第二份实现。`:465` 的 sidecar/bot 路径**应保留**（按 `event.agentId/model` 走渠道绑定语义），但需注明「**有意**不走统一入口」 | **采纳** | 收尾刀 |
| ⚠️-2 | `goal-session-views.tsx:193-198` 读全局 `activeModelId` | **不采纳（不属 S-167）** —— C# `GoalOrchestratorLifecycle.cs:440-441` 注释写明「Goal 拥有自己的 provider/model，前端这个只是 model_config_json 之前的 legacy fallback」；强行改会与 Goal 自身的优先级链打架。要做则**单独立案** | 记录备查 |
| ⚠️-3 | **统一入口无测试**：`tests/` 对 `resolveSendModel` / `send-model-resolution` 的引用为 0；`tests/provider-payload/program.ts:305` 的 `sendSites` 只断言「源码含 `buildProviderPayload(` 且不含 `apiKey:`」。本刀修的**正是那条优先级链**，却无任何用例锁住 | **采纳（P1）** | 收尾刀：新增 `tests/send-model-resolution/`，至少断言 ①会话绑定优先于全局激活 ②plugin 会话走 channel 绑定 ③无任何绑定时回落全局 ④provider/model 任一缺失返回 `null` |
| ⚠️-4 | `tests/provider-payload/program.ts:212` 的注释「The project dispatch path has always forced this off」已不成立（测试本体仍有效，59 断言全绿） | **采纳** | 收尾刀：改注释 |
| ⚠️-5 | `send-model-resolution.ts:62` 的 `(m: any)` 白丢一次类型检查（搬运带入，非本刀引入） | **采纳** | 收尾刀：清掉 `any` |
| ⚠️-6 | 两处「行为差异」值得写进注释：① **plugin 会话实际是 channel > session**（`session-model-resolution.ts:89-105` 为 `channelProviderId ?? session.providerId`），与注释写的「会话绑定 > channel 绑定」顺序相反 —— 二者实践等价（`ModelSwitcher/utils.ts:99-105` 手切时**同时**写会话绑定与 channel），但文档与代码该对齐；② **渠道配了 provider 却没配 model 时**，旧代码取全局激活模型，新代码取**该渠道 provider 的默认模型**（更合理：全局激活模型未必在渠道 provider 的模型表里） | **采纳** | 收尾刀：注释精确化 |
| ⚠️-7 | **验证态自查补抓**（审查 subagent 未发现）：`use-chat-actions.ts:489-491` 的 **`cancelPlan`** —— 用户点「取消计划」后要往**该会话**发一条通知消息，却也读全局 `providerStore.getActiveProvider()` + `activeModelId`。根因与 S-167 完全同源（给已知 `sessionId` 发消息却绕开统一入口），**但严格说不是「外部投递」**（是 UI 动作）⇒ 不塞进 S-167 的验收面，随 ⚠️-1 一起在收尾刀清扫 | **采纳** | 收尾刀 |

### 三、行动项（收尾刀执行）

| 优先级 | 事项 |
|---|---|
| P1 | 补 `tests/send-model-resolution/`（⚠️-3） |
| P2 | 修过期注释 `tests/provider-payload/program.ts:212`（⚠️-4） |
| P2 | `sendSites` 补 `use-background-subagent-wakeup.ts` / `goal-session-views.tsx`；`cron-runtime.ts` 需显式豁免并注释（其 `buildProviderConfig:101-128` 合法地手写 `apiKey`，与 agent/run payload 不同型，直接加会误报） |
| P3 | `cron-runtime.ts:397` → `resolveSendModel(sessionId)`；`:465` 注明「有意不走统一入口」（⚠️-1） |
| P3 | 注释精确化两处（⚠️-6） |
| P3 | 清掉 `(m: any)`（⚠️-5） |
| — | Goal 恢复是否继承会话绑定 → **单独立案**（⚠️-2） |

**验收建议**：本刀可合入（无阻断）。真机走查见 `verification_report.md`。

---

## 二、其余十刀 —— 收尾刀静态复核（2026-09-30）

复核手段：`git grep` 残留扫描 + `git show --stat` 比对改动面 + 读关键落点。**每刀落地时已各跑过一次 typecheck + 全量回归，本节只补「改动是否真的到位、有没有留尾巴」这一层。**

| 刀 | 需求 | 复核项 | 证据 | 结论 |
|---|---|---|---|---|
| 2 | S-156 | 入口**真接上了**（不只是组件存在） | `PersonaPanel.tsx:10` import + `:206` 渲染；i18n 复用既有 key `persona.aiCreate`，locale 未改 | PASS |
| 3 | S-157 | 裸字面量清零 | `src` 内 `'.wishful-claw'` 字面量**只剩 `src/shared/data-dir.ts:1` 一处定义**；消费方全走 `WISHFUL_CLAW_DATA_DIR_NAME` | PASS |
| 4 | S-158 | 死配置全链路真删干净 | `git grep plugin:tool-enabled` 在 `src` / `tests` **0 命中**（命中只剩 `docs/` 历史记录） | PASS |
| 5 | S-159 | 死字段真删干净 | `git grep newSessionDefaultModel` 在 `src` / `tests` **0 命中** | PASS |
| 6 | S-160 | 死链修掉 + 指引改指 + 仓库侧指引停维护 | `wishful-claw.shop` 在 `src` / `website` / `scripts` **0 命中**；`README.md:13,34,124,127` 与 `docs/development.md:4` 全指 `wishful-claw.work/guide`；`docs/user-guide.md` 已删，残留引用只在 `docs/plans/` 历史记录与 `user-guide.ts` 的说明性注释 | PASS |
| 7 | S-161 | 压缩产物剥离旧 usage | 5 文件 204+/46−；行为侧由 C# `CompactionSnapshot` 套件（11 断言）覆盖，全绿 | PASS（编译 + 回归级） |
| 8 | S-162 | `SaveImage` 工具真落地并注册 | `Tools/FileTools/FileSaveImageTool.cs` 存在且在 `ToolModule.cs` 注册；卡片出口复用 `ImagePreview.tsx` 既有能力 | PASS |
| 9 | S-166 | 端点解析抽成**可测纯函数** | `src/main/lib/image-endpoint.ts` + `tests/image-endpoint/program.ts`（30 断言，全绿）；handler 已改为 import | PASS |
| 10 | S-163 | 文档落位、体量在限内 | `docs/design-system.md` **198 行 / 13.9 KB**（限额 500 行 / 60 KB） | PASS |
| 11 | S-164 | 同上 | `dev-workflow.md` 新增「需求正文段落模板」节，+56 行 | PASS |

### 一条容易被后人误判的「残留」

S-166 之后 `git grep dall-e-3` 仍有 **1 处命中**：`src/renderer/src/stores/providers/openai.ts:31`。

**这不是残留** —— 那是 OpenAI **预设的模型清单**（列给用户选的模型之一）；S-166 去掉的是生图链路里的硬编码兜底 `image-reverse-handler.ts:38` 的 `|| 'dall-e-3'`。两者性质不同，**不要照着这一处再删一次**。

### 本节没覆盖的

十刀里凡是**运行期行为**（S-161 的压缩时机、S-162 的卡片按钮、S-166 的跨服务商生图、S-160 的关于页跳转）本节只到「编译 + 回归套件」级别，真机走查见 `verification_report.md`。

---

## 三、S-167 审查行动项 —— 收尾刀执行结果

| # | 事项 | 落点 | 结果 |
|---|---|---|---|
| ⚠️-1 | `cron-runtime.ts` 的 `new_session` 分支改走 `resolveSendModel(sessionId)`；sidecar / bot 路径保留并注明理由 | `lib/tools/cron-runtime.ts` | ✅ 已执行。**核实后订正了原建议的措辞**：原写「行为不变」，实际是「在 `inherit` 档位下行为不变、在 `manual` 档位下变得**更正确**」——`new_session` 建会话时 `:203` 已把解析结果写进会话绑定，而原代码 `:397` 自己 `resolveProvider(runEvent)` 再解析一遍，`runMode === 'session'` 时 event 的 `agentId` / `model` 已被置 `null`（`:178-185`）⇒ 回落全局，与 S-167 同病。payload 仍按 `ProviderConfig` 构造，**保留 event 自带的任务级 `thinkingEnabled` / `reasoningEffort`**（不属「投递跟随会话设置」的管辖范围） |
| ⚠️-2 | `goal-session-views.tsx` 读全局 `activeModelId` | — | ❌ **未采纳**（维持原裁定）：C# `GoalOrchestratorLifecycle.cs:440-441` 注释明示那是 Goal 自身的 legacy fallback，改它会与 Goal 的优先级链打架 ⇒ **单独立案** |
| ⚠️-3 | 新增 `tests/send-model-resolution/` | `tests/send-model-resolution/` | ✅ 已执行：`program.ts` + `stubs/`（4 个 store stub），**9 断言**，覆盖 ①会话绑定赢过全局 ②`inherit` 档位不吞绑定 ③渠道绑定 ④渠道有 provider 无 model 取该 provider 默认模型 ⑤fresh / 未知会话回落全局 ⑥绑定指向已删 provider 时**连模型一起重置** ⑦无 provider ⑧无可用模型 → `null` |
| ⚠️-4 | 修过期注释 + `sendSites` 补两处 | `tests/provider-payload/program.ts` | ✅ 已执行：`:212` 注释改为记录 S-167 裁定；`sendSites` 补 `use-background-subagent-wakeup.ts` / `goal-session-views.tsx`；**`cron-runtime.ts` 显式豁免「不得手写 `apiKey`」那一半**（它的 `buildProviderConfig` 产的是 `ProviderConfig`，本就带 `apiKey`）并注明理由 |
| ⚠️-5 | 清掉 `(m: any)` | `lib/send-model-resolution.ts` | ✅ 已执行 |
| ⚠️-6 | 两处优先级细节写进注释 | `lib/send-model-resolution.ts` | ✅ 已执行：① plugin 会话实际是 **channel > session**（`session-model-resolution.ts:89`），两者看着等价只因 `ModelSwitcher` 手切时**双写**；② 渠道有 provider 无 model 时取**该 provider 的默认模型**，而非全局激活模型（后者未必在该 provider 的模型表里） |
| ⚠️-7 | `use-chat-actions.ts` 的 `cancelPlan` 改走统一入口 | `hooks/use-chat-actions.ts` | ✅ 已执行：原先读全局 `getActiveProvider()` + `activeModelId`，改为 `resolveSendModel(sessionId)` |

**门禁（收尾刀执行后重跑）**：`npm run typecheck`（web / node）全 0；`npm test` **65/65**（TS 49 + C# 16，比迭代基线 61 多 4 —— 新增 `test:image-endpoint` / `test:send-model-resolution` 等）。
