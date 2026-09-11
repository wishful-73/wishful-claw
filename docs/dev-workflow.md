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

**核心原则：一个需求一个提交，迭代收尾再统一一次修复调整提交。**

即 **迭代提交数 = 需求数 + 1**。例：迭代 28 共 7 项需求（模型请求日志与统计面板、更新弹窗与悬浮窗、编辑器撤销选中态、R-1 补位模型、R-2 渠道设置全局化、R-3 工具可见性声明、R-4 使用指引与入口）→ 7 个需求提交 + 1 个收尾修复调整提交 = **8 个提交**。

- 每个需求提交的是它的**第一版完整实现**：该需求所有步骤的代码 + 该需求的文档改动（plan 勾选、验证记录）一起进这一个提交。
- **规划态、审查态、验证态本身不产生提交**。探索不提交；规划文档、审查报告、验证报告都并入所属需求的提交。
- 审查和验证阶段发现的问题**不逐条提交**，全部攒到收尾那一次修复调整提交。
- **测通即提交，由 agent 自判**：编译零错误 + 能启动 + 该需求核心流程跑得通 + 所有步骤 Mini 验证已过 → 直接 commit，**不逐需求停下等用户说 OK**。用户只在迭代收尾时裁定。

```
探索态（只读，不提交）
    ↓
规划态（写文档，不提交）
    ↓
需求 1 → 逐步实现 + 每步 Mini 验证 → 整体测通 → commit
需求 2 → 同上 → commit
  ...      ↘ 某步搞砸 → 工作区回退该步改动重来（需求内没有 commit 检查点）
需求 N → commit
    ↓
审查态 + 验证态 → 问题攒齐 → commit: "fix(迭代N): 审查与验证修复调整"
    ↓
用户确认 PASS → 打 tag → 合并 dev/iter-{N} → main → push main + tags
```

> 一个需求的提交要能独立编译通过、能看出这个需求做了什么。提交简述按需求写（`feat(usage): 模型请求日志与统计面板`），不按步骤写。

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

1. **需求开工前**：确保工作区干净（`git status` 无未提交改动）。上一需求已测通就先提交它，没测完就 `git stash` 存现场。
2. **需求内没有 commit 检查点**——这是粗粒度提交换来的代价。安全点是"上一个需求的提交"，所以需求内每完成一步都要立刻做 Mini 验证，不要把未验证的改动一路攒下去。
3. **风险大的需求允许内部临时多提交几刀**（大重构、跨层改动），但收尾进下一个需求前必须 `git reset --soft HEAD~K` 折叠回该需求的单个提交，别把中间提交留进历史。
4. **验证态失败**：`git reset --hard` 回到上一个需求提交，不要在失败的代码上继续打补丁。
5. **需求提交后不 push**：本地提交只防误操作。
6. **Plan 完成后才 push**：该 Plan 覆盖的需求提交（正常就一两个）一次性 push。
7. **push 失败不阻塞**：网络问题 push 失败时，记录待推送状态，继续后续工作，不为此停下来问用户
8. **每天开工**：先 `git pull`，确保本地和远程同步

### Push 规则

**原则：Plan 内只 commit，Plan 完成才 push。**

```
需求测通 → commit（不 push）→ 下一个需求 → ... → Plan 覆盖的需求全部完成并通过验证 → git push
```

- Plan 执行期间：只在需求测通时 commit，不 push
- Plan 完成并通过验证后：一次性 push 该 Plan 的所有 commit
- 规划/审查/验证文档：并入所属需求的提交，随当前 Plan 一起 push，不单独提交不单独 push
- 验证态合并 main 后：push main + tags
- push 失败（网络超时、连接重置等）：记录"待推送"，继续干活，不阻塞、不提问
- 会话结束前：检查是否有未推送的 commit，尝试一次性 push

**绝对不要问用户"要不要先 push"**——这是规则，不是选项。

### 用户介入点

**AI 助手只在这几个节点停下来等用户确认，其余自动执行：**

| 节点 | 必须停 | 原因 |
|------|--------|------|
| 规划验证通过后、执行前 | ✅ | 用户确认计划方向，避免白干 |
| 迭代收尾（合并 main） | ✅ | **用户唯一的裁定点**，且由他手动发起（"进行 xxx 迭代收尾"）。Agent 不得自行判定迭代完成，也不得提前催 |
| 步骤反复失败（同一步骤 3 次未过） | ✅ | 超出自动修复能力，需要用户决策 |
| 需要用户手动操作（如调整目录结构、填 API Key、真机装机、真实扫码） | ✅ | AI 无法替代 |

**不需要停的情况：**
- Plan 内步骤完成后是否继续下一步 → 自动继续
- **需求测通后是否 commit** → 自动 commit，不逐需求等"OK"（测通标准见「提交节奏」）
- **Plan 验证结论出来后是否继续下一个需求** → 照实报告 PASS/FAIL/PARTIAL 与证据，**不停等裁定**，继续迭代内剩余需求；最终裁定留到收尾
- Plan 完成后是否 push → 自动 push
- push 失败后是否继续 → 自动继续
- 规划文档写完是否进入验证 → 自动进入验证

> 一句话：**工作流里有规则的事，按规则走，不要问。只有规则没覆盖、需要人类判断的事，才停下来问。**

### 会话边界

**会话开始时（AI 助手的第一件事）：**

1. `git status` — 检查工作区状态
2. `git stash list` — 上次会话可能把未完成的改动存在 stash 里（命名形如 `iter{N}-{需求名}-WIP`）。**不要裸 `git stash pop`**，多条 stash 时会弹错；按 list 里的消息找到对应序号，再 `git stash pop stash@{N}`
3. `git log --oneline -10` — 看最近提交，定位进度
4. `git push` — 推送上次会话遗留的未推送 commit（如果有）
5. 读 `docs/PROGRESS.md` — 确认当前迭代和步骤
6. 读对应 plan.md — 确认从哪个步骤继续
7. 报告进度摘要，然后继续执行

**会话即将结束时（上下文快满或用户要离开）：**

1. 当前**需求**整体测通 → commit；只是某个步骤做完 → 不 commit
2. 当前 Plan 如果完成 → push
3. 更新 `docs/PROGRESS.md` — 标记当前进度和下次继续的步骤
4. 需求没做完 → 把未提交改动连同 PROGRESS.md 一起存现场：`git stash push -u -m "iter{N}-{需求名}-WIP"`。**不要用 WIP 提交占位**，那等于回到碎片化提交
5. 有已提交内容 → `git push` 确保远程是最新
6. 输出简要总结：完成了什么、下次从哪继续、现场存在哪个 stash 里

**不要在会话结束时问用户"要不要继续"**——直接按上面流程收工，把状态留在 Git 和 PROGRESS.md 里，下次会话自动恢复。

### 应急回滚

```bash
# 查看提交历史，找到要回滚的点
git log --oneline -20

# 回滚到指定 commit，丢弃之后所有改动（危险！确认后再用）
git reset --hard <commit-hash>

# 只回退某个文件到指定版本
git checkout <commit-hash> -- <file-path>

# 不确定要不要丢？先带名字存现场
git stash push -u -m "{迭代}-{需求}-{描述}"
# 后悔了按 list 里的序号恢复，不要裸 pop
git stash pop stash@{N}
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
```

规划文档**不单独提交**，留在工作区，随本迭代第一个需求的提交一起入库（`git add` 时把 `docs/plans/...` 一并加上）。

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

**Git 操作**：无。合规报告与规划文档一样留在工作区，随所属需求的提交一起入库，本阶段不 commit、不 push。

**完成后**：更新 `docs/PROGRESS.md`，改动同样并入需求提交，不单独提交。

**阻断规则**：❌ 项 > 0 时禁止进入用户确认环节

**用户确认后**：进入执行态，不需要再确认其他事情，自动连续执行所有步骤

---

### 阶段四：执行态（循环执行）

```
fs_read(plan.md) → 找到 [ ] 步骤 → 执行 → Mini 验证 → 标记 [✓] → 下一个步骤 → ... → 整个需求测通 → commit
```

**执行规则**：
- 每次只执行一个步骤
- 执行完立即做 Mini 验证：
  - **TS 编译零错误**：`npx tsc --noEmit -p tsconfig.web.json` + `npx tsc --noEmit -p tsconfig.node.json`（两个配置都必须零错误，不允许留坑）
  - 能跑？符合预期？
- 验证通过标记 [✓]，**不 commit**，直接进下一个步骤
- 验证失败标记 [✗]，记录原因，**只回退该步骤的工作区改动**（`git checkout -- <文件>` 或 `git stash`），修复后重试
- **commit 时机只有一个**：本需求所有步骤均为 [✓]、整体测通（编译零错误 + 核心流程跑得通）之后
- 从 OpenCowork / KodaClaw / OpenClaw.net 搬代码时，必须适配项目命名空间和分层约定
- 新建文件必须符合 AGENTS.md 中的目录结构

**搬入代码必须遵守两个拆分原则**：

1. **大文件拆分**：参考项目单文件过大（如 OpenCowork 的 `OpenAIChatRuntime.cs` 3828 行）时，搬入时必须按职责拆分为多个文件，每个文件 200~500 行为宜。拆分后保持逻辑等价，不改变行为，只改组织结构。不要为了拆而拆导致过度碎片化。
2. **耦合文件拆分**：参考项目有些文件本身不大，但塞了多个逻辑不相关的东西。判断标准：如果两个类/方法之间没有调用关系或数据依赖，只是参考方随手放在一起，就必须拆开，分到各自的文件中，放入 AGENTS.md 项目结构中对应的目录。

示例：OpenCowork 某个文件里同时放了 Provider 配置模型 + Provider 服务逻辑 + Provider API 客户端 → 搬入时拆为 `ProviderConfig.cs`（模型）+ `ProviderService.cs`（逻辑）+ `ProviderApiClient.cs`（客户端），分别放入 Contracts 和 Core。

**Git 操作（一个需求一个 commit）**：
```bash
# 需求开工前确认工作区干净
git status

# 本需求全部步骤 [✓] 且整体测通后，一次提交
git add <本需求涉及的全部文件 + 该需求的 plan/验证文档>
git commit -m "feat(scope): {需求名} - {一句话说明}"

# 需求内某步搞砸：只丢该步的工作区改动，不要 reset --hard 回上一个需求
git checkout -- <该步涉及的文件>
```

**大需求允许临时中间提交**：一个需求跨多个会话、或改动量大到怕丢时，可以在需求内部先 commit 几刀做保险，但在进下一个需求前用 `git reset --soft HEAD~K` + 重新 commit 折叠成该需求的单个提交。历史里留下的必须是一需求一刀。

**需求 commit 后**：不 push，留在本地（Plan 完成后才统一 push）

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

**Git 操作**：无独立提交。审查产生的修正、以及 `review_report.md` 本身，全部攒进迭代收尾那一次 `"fix(迭代N): 审查与验证修复调整"` 提交。

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

**验证结果出来后**：报告 PASS / FAIL / PARTIAL 与证据，**不停等用户裁定**，继续迭代内剩余需求。用户的裁定集中在迭代收尾（合并 main）那一次。

**FAIL 的处理**：先自行修复并重新验证，修正攒进收尾的 `"fix(迭代N): 审查与验证修复调整"` 提交；只有失败到无法在其上继续时，才 `git reset --hard` 回上一个需求提交。

**验证产物归属**：`verification_report.md` 与验证期间发现的修正，一并进收尾的 `"fix(迭代N): 审查与验证修复调整"` 提交；该提交是本迭代最后一刀。

**收尾时**：把本迭代各需求 / 各 Plan 的 VERDICT 汇总给用户，由他裁定是否收尾。**Agent 不得自行判定迭代完成，也不得提前催收尾。**

**最终裁定**：`PASS` / `FAIL` / `PARTIAL`（在收尾时由用户裁定，不是 agent 自行确认；但结论的**给出**不需要等用户）

---

## 进度文档结构（PROGRESS.md + docs/progress/）

- `docs/PROGRESS.md` — 总览：每个迭代一行（迭代号 + Tag + 日期 + 简述），链接到明细文件
- `docs/progress/v2-iter-{N}.md` — 迭代明细：状态、分支、Plan、VERDICT、Tag、Commit、日期、范围、验证、遗留

迭代收尾时两步：

1. `docs/PROGRESS.md` 对应表格新增一行
2. 创建 `docs/progress/v2-iter-{N}.md` 明细

明细文件格式：

```markdown
# v2-iter-{N}：{迭代标题}
- 状态：已完成，已合并 main
- 分支：dev/v2-iter-{N}（合并后清理）
- Plan: docs/plans/iter-v2-{N}/plan.md
- VERDICT: PASS（编译验证 + 用户人工验证）
- 产品版本: 0.2.{N}
- Tag: v0.2.{N}
- Commit: {merge commit}
- 日期: {YYYY-MM-DD}
- 范围与功能单元：
  - ...
- 验证：...
- 遗留：...
```

## 注意事项

- 参考源码路径以 AGENTS.md 中的为准
- 搬代码时注意 .NET 命名空间统一为 WishfulClaw.*
- 前端代码注意去掉 OpenCowork 特有的频道、CodeGraph 等不需要的功能
- 每个 plan 编号递增（plan_001, plan_002, ...）
- 验证报告必须有实际证据，不能只写"应该没问题"
- **commit 粒度按需求，不按步骤**——一个迭代的历史提交数应当是"需求数 + 1（收尾修复调整）"
- **不要按步骤刷提交**——步骤只跑 Mini 验证，提交时机是整需求测通；需求内的中间提交必须在进下一个需求前 `git reset --soft` 折叠掉
- **push 是最后的保险**——本地 commit 只防误操作，push 到远程才防丢数据
- **C# 文件多为 CRLF 行尾**——批量替换用 Python 脚本处理，file 工具的 edit 容易因行尾不匹配失败
