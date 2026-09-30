# iter-v2-37 验证报告（阶段六）

> 按 `docs/dev-workflow.md` 阶段六：独立验证，能跑必须跑，必须有工具证据。
> **本文件与验证期间发现的修正不单独提交**，攒进迭代收尾的 `fix(迭代37): 审查与验证修复调整` 那一刀。

---

## 〇、全迭代总览（2026-09-30 收尾刀重跑）

| 门禁 | 命令 | 结果 |
|---|---|---|
| TypeScript | `npm run typecheck`（= `typecheck:node` + `typecheck:web`） | **EXIT=0**，无错误输出 |
| 全量回归 | `npm test` | **65 / 65 通过**（TS 49 套 + C# 16 套） |

> 口径订正：`package.json` 的 `typecheck` 脚本只串了 **`typecheck:node` + `typecheck:web`** 两个 tsc 配置（无第三个 `tsconfig.json` 那一跑）—— 本报告下文出现「三配置」是早先的写法，以本节为准。

迭代基线是 61/61；收尾时为 65/65，多出的 4 套来自 S-166（`test:image-endpoint`）与收尾刀（`test:send-model-resolution`）等新增。

**验证覆盖面**：11 刀全部到达「编译 + 回归套件」级别。**没有任何一刀做过真机走查** —— 详见 §五。

---

## S-167 外部投递统一走 resolveSendModel（commit `f82b2689`）

**结论：PARTIAL** —— 编译与回归套件全绿（工具证据齐），**运行期六条走查未实测**（需真机多会话操作，无法自动化）。

### 一、编译证据（三配置全 0）

| 命令 | 结果 |
|---|---|
| `npx tsc --noEmit -p tsconfig.web.json` | EXIT=0 |
| `npx tsc --noEmit -p tsconfig.node.json` | EXIT=0 |
| `npx tsc --noEmit -p tsconfig.json` | EXIT=0 |

### 二、回归套件证据

`npm test` → **61/61 通过**（TS 45 + C# 16），与迭代基线一致，无新增失败。

### 三、静态收口证据（本次新增的调用点）

`resolveSendModel` 的生产调用点（Grep 全仓 `src`）：

| 调用点 | 归属 |
|---|---|
| `use-chat-actions.ts:117 / 347 / 406 / 603` | UI 发送路径（本就正确） |
| `cron-runtime.ts:393` | cron（本就正确） |
| **`project-send-message.ts:173`** | **本次新增** —— 覆盖派工单 + 回复全局两个方向 |
| **`use-background-subagent-wakeup.ts:87`** | **本次新增** |
| **`use-channel-auto-reply.ts:206`** | **本次新增** |

`getActiveProvider()` 残留面（Grep 全仓 `src`，逐个定性）：

| 位置 | 定性 |
|---|---|
| `send-model-resolution.ts:54` | 统一入口**内部**的兜底 —— 正确 |
| `use-chat-actions.ts:489` | **`cancelPlan`**，同族漏网（见 `review_report.md` ⚠️-7）⇒ 收尾刀 |
| `goal-session-views.tsx:194` | Goal 恢复的 legacy fallback（C# 侧 `GoalOrchestratorLifecycle.cs:440-441` 注释明示）⇒ 不属本需求 |
| `PersonaGeneratorDialog.tsx:37` | AI 生成人格（utility 调用，非聊天发送） |
| `use-prompt-optimizer.ts:59` | 提示词优化（utility 调用，非聊天发送） |

### 四、未实测项（需真机）

`S-167.md §六` 的六条均为运行期行为，本刀只到「编译 + 回归套件」级别：

1. 会话 A 配 M1（付费）、B 配 M2（免费）→ 从 A 给 B 派工单，**B 用 M2**。
2. **反向**：项目会话回复全局任务进度 → 全局助理用**它自己**的绑定（`inherit` 则回落全局）。
3. 手动把 B 切到 Mx → 外部投递一轮后 DB `sessions.modelId` 仍是 Mx，`ModelSwitcher` 显示 Mx。
4. 会话无绑定（fresh）→ 回落全局。
5. 思考档位：会话开思考 → 投递轮**实际带思考**，与 UI 显示一致；会话关思考、或模型不支持思考 → 投递轮**也不带**。
6. `npm run typecheck` 0 错误 + `npm test` 全绿 —— **已达成**（见第一、二节）。

**为何未实测**：需要起 dev 实例 + 两个会话互相投递 + 查 DB，属交互式走查，本会话无自动化手段；改的又是运行期取模型逻辑，静态无法证伪。**待老大真机走查。**

---

## 五、全迭代未实测清单（待真机走查）

| 刀 | 需求 | 待走查项 | 风险 |
|---|---|---|---|
| 1 | S-167 | 见 §四 的六条（多会话互投、反向回复、手切后不被顶、思考档位跟随） | **高** —— 老大报的原始 bug，改的是运行期取模型逻辑 |
| 2 | S-156 | 设置页人格区点「AI 创建人格」→ 生成 → 四段预览 → 保存 | 低 |
| 4 | S-158 | 渠道列表与工具可见性无回归（删的是**恒不生效**的死配置，预期行为不变） | 低 |
| 5 | S-159 | 设置页无残留控件、新会话仍跟随全局激活模型（`inherit` 档） | 低 |
| 6 | S-160 | 关于页官网链接跳转、顶栏 / 关于页「查看指引」跳到官网 `/guide` | 低 |
| 7 | S-161 | **压缩刚完成 → 中断执行 → 重新发送 → 不再触发压缩**；且复发那轮**复用已压快照** | **高** —— 老大报的原始 bug |
| 8 | S-162 | 生图卡片上复制 / 下载；agent 调 `SaveImage` 存图进工作区；无扩展名 / 错扩展名的图按字节魔数判对 | 中 |
| 9 | S-166 | 用 **DeepSeek v4.1 flash / GLM-5.3 Flash** 这类 chat 模型能生图成功；无图像能力时给的是**可操作的**报错而非原始报文 | 中 |
| 10 / 11 | S-163 / S-164 | 文档类，无运行期行为，无需走查 | — |

**S-157 / S-158 / S-159 的「未实测」性质不同**：它们删的是**恒不生效**的死配置 / 收敛的是字面量，正确性由「残留扫描 0 命中 + 回归套件全绿」证明，不需要真机确认行为。

**S-165 无实测项** —— 裁定不做。
