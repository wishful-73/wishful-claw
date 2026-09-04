# 开发工作流（SOP）

> 纯工作流文档，定义 AI 执行任务的六阶段流程。
> 各阶段的具体规范标准请查阅对应的规范文档。

---

## Git 工作流总则

### 分支策略

| 分支 | 用途 | 规则 |
|------|------|------|
| `main` | 稳定主线 | 只接受 merge，禁止直接 push commit |
| `dev/iter-{N}` | 迭代开发分支 | 每个迭代开一条，从 main 切出 |
| `dev/iter-{N}/plan-{NNN}` | 计划分支（可选） | 复杂计划单独开分支，从 dev/iter-{N} 切出 |

> 单人项目分支不需要太重。简单迭代直接在 `dev/iter-{N}` 上提交；迭代内拆了多个 plan 且怕互相干扰时才开 plan 分支。

### 提交节奏

**核心原则：小步提交，每一步都是可回滚的检查点。**

```
探索态（只读，不提交）
    ↓
规划态 → commit: "plan(迭代N): 规划文档 + 步骤清单"
    ↓
执行态 → 每完成一个步骤 [✓] 立即 commit
    ↓        ↘ 步骤失败 [✗] → git reset 回上一个 [✓] 的 commit
    ↓
审查态 → commit: "review(迭代N): 审查修正"（如有改动）
    ↓
验证态 → PASS 打 tag: v0.{N}.0
         合并 dev/iter-{N} → main
         push main + tags
```

### 提交规范

```
<type>(<scope>): <简述>

<可选正文：为什么改、改了什么关键逻辑>
```

| type | 含义 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(provider): 接入 OpenAI Provider 配置页面` |
| `fix` | 修 bug | `fix(loop): 修复流式输出截断问题` |
| `refactor` | 重构 | `refactor(runtime): 拆分 OpenAIChatRuntime` |
| `docs` | 文档 | `docs(plan): 迭代二规划文档` |
| `chore` | 构建/配置 | `chore: 配置 .editorconfig` |
| `test` | 测试 | `test(core): 记忆检索单元测试` |

### 防误操作规则

1. **执行态开始前**：确保工作区干净（`git status` 无未提交改动），否则先 stash 或 commit
2. **每步执行前**：如果上一步的 commit 存在，当前就是安全点——搞砸了随时 `git reset --hard` 回来
3. **大改动前**：先 commit 当前状态，打一个临时标记 `git tag wip-{描述}`，方便回滚
4. **验证态失败**：`git reset --hard` 回到审查态提交，不要在失败的代码上继续打补丁
5. **Plan 执行期间只 commit 不 push**：每个步骤 commit 后不 push，本地 commit 就是防误操作的检查点
6. **Plan 完成后才 push**：一个 Plan 的所有步骤都完成并通过验证后，一次性 push 该 Plan 的所有 commit
7. **push 失败不阻塞**：网络问题 push 失败时，记录待推送状态，继续后续工作，不为此停下来问用户
8. **每天开工**：先 `git pull`，确保本地和远程同步

### Push 规则

**原则：Plan 内只 commit，Plan 完成才 push。**

```
步骤完成 → commit（不 push）→ 下一步 → ... → Plan 所有步骤完成并通过验证 → git push
```

- Plan 执行期间：每步 commit，不 push
- Plan 完成并通过验证后：一次性 push 该 Plan 的所有 commit
- 规划态/审查态提交文档：随当前 Plan 一起 push，不单独 push
- 验证态合并 main 后：push main + tags
- push 失败（网络超时、连接重置等）：记录"待推送"，继续干活，不阻塞、不提问
- 会话结束前：检查是否有未推送的 commit，尝试一次性 push

**绝对不要问用户"要不要先 push"**——这是规则，不是选项。

### 用户介入点

**AI 助手只在这几个节点停下来等用户确认，其余自动执行：**

| 节点 | 必须停 | 原因 |
|------|--------|------|
| 规划验证通过后、执行前 | ✅ | 用户确认计划方向，避免白干 |
| 验证态出结果后（PASS/FAIL/PARTIAL） | ✅ | 用户确认 Plan 是否达标，Agent 不得自行判定完成 |
| 步骤反复失败（同一步骤 3 次未过） | ✅ | 超出自动修复能力，需要用户决策 |
| 需要用户手动操作（如调整目录结构、填 API Key） | ✅ | AI 无法替代 |

**不需要停的情况：**
- Plan 内步骤完成后是否继续下一步 → 自动继续
- Plan 完成后是否 push → 自动 push
- push 失败后是否继续 → 自动继续
- 规划文档写完是否进入验证 → 自动进入验证

> 一句话：**工作流里有规则的事，按规则走，不要问。只有规则没覆盖、需要人类判断的事，才停下来问。**

### 会话边界

**会话开始时（AI 助手的第一件事）：**

1. `git status` — 检查工作区状态
2. `git log --oneline -10` — 看最近提交，定位进度
3. `git push` — 推送上次会话遗留的未推送 commit（如果有）
4. 读 `docs/PROGRESS.md` — 确认当前迭代和步骤
5. 读对应 plan.md — 确认从哪个步骤继续
6. 报告进度摘要，然后继续执行

**会话即将结束时（上下文快满或用户要离开）：**

1. 当前步骤如果做完 → commit
2. 当前 Plan 如果完成 → push
3. 当前步骤如果没做完 → `git stash` 保存现场（或 commit 为 WIP）
4. 更新 `docs/PROGRESS.md` — 标记当前进度和下次继续的步骤
5. `git add docs/PROGRESS.md && git commit -m "docs: 更新进度 - 下次从步骤N继续"`
6. `git push` — 确保远程是最新
7. 输出简要总结：完成了什么、下次从哪继续

**不要在会话结束时问用户"要不要继续"**——直接按上面流程收工，把状态留在 Git 和 PROGRESS.md 里，下次会话自动恢复。

### 应急回滚

```bash
# 查看提交历史，找到要回滚的点
git log --oneline -20

# 回滚到指定 commit，丢弃之后所有改动（危险！确认后再用）
git reset --hard <commit-hash>

# 只回退某个文件到指定版本
git checkout <commit-hash> -- <file-path>

# 不确定要不要丢？先 stash 保存现场
git stash
# 后悔了可以恢复
git stash pop
```

---

## 六阶段工作流

### 阶段一：探索态（只读探测）

摸清环境现状。主 agent 委托 subagent 只读探测，禁止修改任何文件。

**任务**：
- 探测项目当前结构、已有代码、依赖状态
- 阅读相关参考项目源码（路径见 AGENTS.md）
- 确认当前迭代目标（见 docs/iteration-plan.md）

**Git 操作**：无（只读阶段）

**输出**：`docs/plans/plan_XXX/exploration_findings.md`

**内容要求**：
- 当前项目状态概述
- 参考源码的关键文件和位置
- 潜在风险和依赖

---

### 阶段二：规划态（写计划）

想清楚再动手。

**步骤**：
1. 创建 `docs/plans/plan_XXX/`
2. 读取相关规范文档（AGENTS.md / docs/data-storage.md / docs/mvp-scope.md / docs/iteration-plan.md）
3. 写 `plan.md`，包含：
   - 任务目标
   - 步骤清单（每步带验证检查点）
   - 涉及的文件和模块
   - 参考源码的具体文件路径
4. 启动规划验证 → 用户确认后才能执行

**Git 操作**：
```bash
# 新迭代：从 main 切开发分支
git checkout main
git checkout -b dev/iter-{N}

# 提交规划文档
git add docs/plans/plan_XXX/
git commit -m "docs(plan): 迭代{N}规划文档 + 步骤清单"
```

**plan.md 格式**：

```markdown
# Plan: XXX

## 目标
一句话描述本计划要完成什么。

## 步骤清单
- [ ] 步骤1：描述 + 验证检查点
- [ ] 步骤2：描述 + 验证检查点
- ...

## 涉及文件
- src/runtime/.../xxx.cs — 新建/修改
- src/renderer/.../xxx.tsx — 新建/修改

## 参考源码
- OpenCowork: D:\gy\OpenCowork\... — 具体参考什么
- KodaClaw: D:\gy\koda-claw\koda-claw\... — 具体参考什么
```

---

### 阶段三：规划验证

启动独立 subagent 检查 plan.md 是否符合规范，输出 `compliance_report.md`。

**检查项**：
- 步骤是否完整覆盖任务目标
- 每步是否有明确的验证检查点
- 文件路径是否符合项目结构（AGENTS.md）
- 分层依赖是否正确（Core 不依赖 Workspace 等）
- 是否参考了正确的源码文件

**输出**：`docs/plans/plan_XXX/compliance_report.md`

**Git 操作**：
```bash
git add docs/plans/plan_XXX/compliance_report.md
git commit -m "docs(plan): 迭代{N}规划验证报告"
```

**完成后**：更新 `docs/PROGRESS.md`，commit + push

**阻断规则**：❌ 项 > 0 时禁止进入用户确认环节

**用户确认后**：进入执行态，不需要再确认其他事情，自动连续执行所有步骤

---

### 阶段四：执行态（循环执行）

```
fs_read(plan.md) → 找到 [ ] 步骤 → 执行 → Mini 验证 → 标记 [✓] → commit → 重复
```

**执行规则**：
- 每次只执行一个步骤
- 执行完立即做 Mini 验证：
  - **TS 编译零错误**：`npx tsc --noEmit -p tsconfig.web.json` + `npx tsc --noEmit -p tsconfig.node.json`（两个配置都必须零错误，不允许留坑）
  - 能跑？符合预期？
- 验证通过标记 [✓]，**立即 commit**
- 验证失败标记 [✗]，记录原因，`git reset --hard` 回上一个 [✓] 的 commit，修复后重试
- 从 OpenCowork / KodaClaw / OpenClaw.net 搬代码时，必须适配项目命名空间和分层约定
- 新建文件必须符合 AGENTS.md 中的目录结构

**搬入代码必须遵守两个拆分原则**：

1. **大文件拆分**：参考项目单文件过大（如 OpenCowork 的 `OpenAIChatRuntime.cs` 3828 行）时，搬入时必须按职责拆分为多个文件，每个文件 200~500 行为宜。拆分后保持逻辑等价，不改变行为，只改组织结构。不要为了拆而拆导致过度碎片化。
2. **耦合文件拆分**：参考项目有些文件本身不大，但塞了多个逻辑不相关的东西。判断标准：如果两个类/方法之间没有调用关系或数据依赖，只是参考方随手放在一起，就必须拆开，分到各自的文件中，放入 AGENTS.md 项目结构中对应的目录。

示例：OpenCowork 某个文件里同时放了 Provider 配置模型 + Provider 服务逻辑 + Provider API 客户端 → 搬入时拆为 `ProviderConfig.cs`（模型）+ `ProviderService.cs`（逻辑）+ `ProviderApiClient.cs`（客户端），分别放入 Contracts 和 Core。

**Git 操作（每步一个 commit）**：
```bash
# 执行前确认工作区干净
git status

# 执行步骤，Mini 验证通过后
git add <涉及的文件>
git commit -m "feat(scope): 步骤N - 简述"

# 如果搞砸了，回滚到上一步
git reset --hard HEAD~1
```

**大步骤拆 commit**：如果一个步骤涉及多个文件且逻辑独立，拆成多个 commit，每个 commit 能独立编译通过。

**每步 commit 后**：不 push，留在本地（Plan 完成后才统一 push）

**终止检查**：所有步骤均为 [✓] / [✗]，0 个 [ ] 残留 → 自动进入审查态，不停下来问。

---

### 阶段五：审查态

启动独立 subagent 审查代码是否满足需求和规范，输出 `review_report.md`。

**审查项**：
- 代码是否符合分层约定（Core / Workspace / Worker / Contracts）
- 是否有硬编码路径、密钥等
- 是否正确实现参考源码的逻辑（不是照搬，是适配）
- 错误处理是否充分
- 是否引入了不需要的依赖

**输出**：`docs/plans/plan_XXX/review_report.md`

**Git 操作**：
```bash
# 审查如有修正
git add <修正的文件>
git commit -m "review(迭代N): 审查修正 - 简述"

# 提交审查报告
git add docs/plans/plan_XXX/review_report.md
git commit -m "docs(review): 迭代{N}审查报告"
```

**阻断规则**：❌ 项 > 0 时禁止进入验证态

---

### 阶段六：验证态

独立验证，避免自欺欺人。能跑必须跑，必须有工具证据。

**验证方式**：
- 编译通过：
  - C#：`dotnet build src/runtime/WishfulClaw.sln`
  - TypeScript：`npx tsc --noEmit -p tsconfig.web.json` + `npx tsc --noEmit -p tsconfig.node.json` + `npx tsc --noEmit -p tsconfig.json` **三个配置必须全部零错误**
- 运行通过（启动应用，执行对应迭代的验证标准）
- 产出截图或日志作为证据

**输出**：`docs/plans/plan_XXX/verification_report.md`

**验证结果出来后**：停下来等用户确认。**Agent 不得自行判定 Plan 完成。**

**用户确认 PASS**：Plan 完成，push 该 Plan 的所有 commit

**用户确认 FAIL**：`git reset --hard` 回到审查态提交，修复后重新验证

**用户确认 PARTIAL**：由用户决定保留哪些成果、是否继续补充

**最终裁定**：`PASS` / `FAIL` / `PARTIAL`（由用户裁定，不是 agent 自行确认）

---

## PROGRESS.md 格式

```markdown
# 开发进度

## 迭代一：项目骨架
- 状态：已完成
- 分支：dev/iter-1
- Plan: docs/plans/plan_001/
- VERDICT: PASS
- Tag: v0.1.0
- Commit: a1b2c3d
- 日期: 2026-07-20

## 迭代二：AI 服务商管理
- 状态：进行中
- 分支：dev/iter-2
- Plan: docs/plans/plan_002/
- VERDICT: —
- Tag: —
- Commit: —
- 日期: —
...
```

## 注意事项

- 参考源码路径以 AGENTS.md 中的为准
- 搬代码时注意 .NET 命名空间统一为 WishfulClaw.*
- 前端代码注意去掉 OpenCowork 特有的频道、CodeGraph 等不需要的功能
- 每个 plan 编号递增（plan_001, plan_002, ...）
- 验证报告必须有实际证据，不能只写"应该没问题"
- **commit 粒度宁小勿大**——每步一个 commit 是底线，不是上限
- **不要攒一堆改动再提交**——攒得越多，回滚越难，一天白搞的风险越大
- **push 是最后的保险**——本地 commit 只防误操作，push 到远程才防丢数据
