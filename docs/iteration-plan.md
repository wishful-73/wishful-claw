# Wishful Claw 迭代计划

基于 MVP 边界，拆分为多个迭代，每个迭代独立可验证。

> **本文件是总览，只放规则、迭代索引与依赖关系。** 每个迭代的正文（目标 / 需求 / 步骤 / 验证标准）落在 `docs/iterations/{iter-id}.md`。文件组织规范见 `docs/dev-workflow.md` 的「文档组织（总览清单 + 明细子文档）」节。

## 迭代拆分规则

**迭代是版本里程碑，不是单次会话的工作量。** 每个迭代在执行前，必须先拆分为多个 Plan，每个 Plan 是一次会话能吃透的工作单元。不要在一个会话里试图做完整个迭代。

```
迭代（v0.N.0）  — 版本里程碑，定义目标 + 验证标准
  └─ Plan      — 单次会话工作单元，一次会话走完探索→规划→执行→验证
       └─ 步骤  — Plan 内的具体操作，每步 commit + push
```

**Plan 拆分原则**：
- 每个 Plan 有独立的验证检查点（能独立编译/运行/测试）
- 每个 Plan 是一次会话能完成的量（不要贪多）
- Plan 之间有明确的依赖顺序
- 拆分在迭代开始时做，写入 `docs/plans/iter-{N}/plan-{M}.md`

执行迭代时，先在 `docs/plans/iter-{N}/` 下创建 Plan 文件，自行拆分后再逐个执行。

## 迭代完结规则

**迭代是否完结由用户确认，Agent 不得自行判定。**

当迭代内所有 Plan 都完成后，Agent 输出迭代总结（做了什么、验证结果、遗留问题），然后**停下来等用户确认**。

**用户确认完结后，Agent 执行收尾**（完整流程见 `docs/release-workflow.md`）。`v2-iter-{N}` 只是迭代编号；正式版发布前，产品版本为 `0.2.{N}`，tag 为 `v0.2.{N}`：
```bash
# 0. 更新 package.json 版本为 0.2.{N}，同步 README 版本徽章

# 1. 合并到 main
git checkout main
git merge dev/v2-iter-{N} --no-ff -m "merge: v2-iter-{N} - {迭代名称}"

# 2. 打 tag
git tag -a v0.2.{N} -m "v2-iter-{N}: {迭代名称} - 验证通过"

# 3. 推送远程（需要代理）
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin v0.2.{N}

# 4. 删除本地迭代分支
git branch -d dev/v2-iter-{N}

# 5. 删除远程迭代分支（如果之前 push 过）
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin --delete dev/v2-iter-{N}
```

收尾完成后更新 `docs/PROGRESS.md`（状态 + VERDICT + Commit ID + Tag + 日期）。

**关键要求**：收尾完成后，当前会话结束。下个会话直接从 main 拉取最新代码开始新迭代，不需要关心旧分支。

**用户确认未完结**：根据用户反馈继续补充，开启新的 Plan

---

## 迭代索引

> 明细文件统一放在 `docs/iterations/`，命名 `{v1|v2}-iter-{NN}.md`。下表「状态」列**只转录各迭代标题里的显式标注**，未标注的一律留 `—`；**权威状态以 `docs/PROGRESS.md` 与 git tag 为准**。

### MVP v1（迭代一 ~ 十五）

> 迭代一 ~ 十五均已合并 main，tag `v0.15.0`（见文末「迭代依赖关系」）。

| 迭代 | 标题 | 状态 | 明细 |
|---|---|---|---|
| 一 | 项目骨架 | — | [v1-iter-01](iterations/v1-iter-01.md) |
| 二 | AI 服务商 + 模型管理 | — | [v1-iter-02](iterations/v1-iter-02.md) |
| 三 | Agent Loop + 对话 | — | [v1-iter-03](iterations/v1-iter-03.md) |
| 四 | 工具链（最小集） | — | [v1-iter-04](iterations/v1-iter-04.md) |
| 五 | 项目注册 + 会话历史 | — | [v1-iter-05](iterations/v1-iter-05.md) |
| 六 | 人格系统 | — | [v1-iter-06](iterations/v1-iter-06.md) |
| 七 | 记忆系统 | — | [v1-iter-07](iterations/v1-iter-07.md) |
| 八 | 集成验证 | — | [v1-iter-08](iterations/v1-iter-08.md) |
| 九 | 输入框修复 + 提示词优化器 | 已完成 | [v1-iter-09](iterations/v1-iter-09.md) |
| 十 | 子 Agent（Sub-Agent） | 已完成 | [v1-iter-10](iterations/v1-iter-10.md) |
| 十一 | 右侧面板 + 子 Agent 架构增强 + 终端/文件管理 | 已完成（待合并 main） | [v1-iter-11](iterations/v1-iter-11.md) |
| 十二 | SSH 远程执行 + Agent 终端旁观 | — | [v1-iter-12](iterations/v1-iter-12.md) |
| 十三 | 聊天窗渲染调整（参考灵犀） | — | [v1-iter-13](iterations/v1-iter-13.md) |
| 十四 | Skill 市场 | — | [v1-iter-14](iterations/v1-iter-14.md) |
| 十五 | MCP 管理 | — | [v1-iter-15](iterations/v1-iter-15.md) |

### MVP v2（v2-iter-1 ~ v2-iter-26）

> MVP v1（迭代一~十五）已全部合并 main。以下为 MVP v2 阶段的迭代拆分，分支命名 `dev/v2-iter-{N}`；`v2-iter-{N}` 仅是迭代编号。正式版发布前，产品版本命名 `0.2.{N}`，tag 命名 `v0.2.{N}`。历史上已存在的旧式 tag 保留，不再用于后续迭代。详细需求见 `docs/mvp-v2.md`。
>
> `v2-iter-20` ~ `v2-iter-22` 本文档未单列小节（历史上未展开，只作为整段并入「迭代依赖关系」的已完成记录）。

| 迭代 | 标题 | 状态 | 明细 |
|---|---|---|---|
| 1 | Runtime 分层架构重构 | — | [v2-iter-01](iterations/v2-iter-01.md) |
| 2 | 缓存命中率修复 | — | [v2-iter-02](iterations/v2-iter-02.md) |
| 3 | Infrastructure 层拆分 | — | [v2-iter-03](iterations/v2-iter-03.md) |
| 4 | Skill 本地文件安装测试 | — | [v2-iter-04](iterations/v2-iter-04.md) |
| 5 | 渠道配置测试与完善 | — | [v2-iter-05](iterations/v2-iter-05.md) |
| 6 | SSH 远程执行测试与完善 | — | [v2-iter-06](iterations/v2-iter-06.md) |
| 7 | 主聊天折叠块模式 | 已完成（tag v2.7.0） | [v2-iter-07](iterations/v2-iter-07.md) |
| 8 | 计划模式（人机协同执行引擎） | — | [v2-iter-08](iterations/v2-iter-08.md) |
| 9 | Goal 模式（自主跑完迭代） | — | [v2-iter-09](iterations/v2-iter-09.md) |
| 10 | 全局会话 + 项目编排工具 | — | [v2-iter-10](iterations/v2-iter-10.md) |
| 11 | Native AOT 打包（SqlSugar → Dapper 迁移） | — | [v2-iter-11](iterations/v2-iter-11.md) |
| 12 | Goal 系统全面修复 — 自动编排 + 中断重启 | — | [v2-iter-12](iterations/v2-iter-12.md) |
| 13 | OpenAI Responses API + 请求超时配置 + 文件树/输入框/设置页收口 | 已完成 | [v2-iter-13](iterations/v2-iter-13.md) |
| 14 | 历史消息反向分页 | — | [v2-iter-14](iterations/v2-iter-14.md) |
| 15 | 快捷键系统 + 快速启动器 + 剪贴板增强 + 开机启动 | 已完成 | [v2-iter-15](iterations/v2-iter-15.md) |
| 16 | 左侧面板整理 + use_capability 工具发现增强 | — | [v2-iter-16](iterations/v2-iter-16.md) |
| 17 | 工具调用权限 | — | [v2-iter-17](iterations/v2-iter-17.md) |
| 18 | Cron 自动化验证 | — | [v2-iter-18](iterations/v2-iter-18.md) |
| 19 | Goal 编排记录可视化 | — | [v2-iter-19](iterations/v2-iter-19.md) |
| 23 | 会话可靠性与缺陷收口 | 执行中 | [v2-iter-23](iterations/v2-iter-23.md) |
| 24 | 全局产品经理 Agent + 会话临时 Todo + 上下文恢复可靠性 | 进行中（需求重写中） | [v2-iter-24](iterations/v2-iter-24.md) |
| 25 | 集中修复、完整回归与 Release Candidate 准备 | 规划中 | [v2-iter-25](iterations/v2-iter-25.md) |
| 26 | 正式版发布与收尾 | 规划中 | [v2-iter-26](iterations/v2-iter-26.md) |

## 迭代依赖关系

```
=== MVP v1（已完成，已合并 main，tag v0.15.0）===
迭代一（骨架）→ 二（Provider）→ 三（Agent Loop）→ 四（工具链）→ 五（项目+会话）
  → 六（人格）→ 七（记忆）→ 八（集成验证）
  → 九（输入框修复 + 提示词优化器）→ 十（子 Agent）
  → 十一（右侧面板 + 子 Agent 架构增强 + 终端/文件管理）
  → 十二（SSH 远程执行 + Agent 终端旁观）
  → 十三（聊天窗渲染调整）→ 十四（Skill 市场）→ 十五（MCP 管理）

=== MVP v2（进行中）===
v2-iter-1（Runtime 分层架构重构）✅
  ↓
v2-iter-2（缓存命中率修复）✅
  ↓
v2-iter-3（Infrastructure 层拆分）✅
  ↓
v2-iter-4（Skill 本地文件安装测试）  ┐
v2-iter-5（渠道配置测试与完善）      ├─ 三者可并行，互不依赖，均已完成 ✅
v2-iter-6（SSH 远程执行测试与完善）  ┘
  ↓
v2-iter-7（主聊天接入工作台模式）  ← 当前最高优先级，无前置依赖
  ↓
v2-iter-8（计划模式 — 人机协同执行引擎）  ← 当前最高优先级，依赖现有 Agent Loop
  ↓
v2-iter-9（Goal 模式 — 自主跑完迭代）✅  ← 依赖计划模式就绪（复用 + 去掉人工确认 + 多计划编排）
  ↓
v2-iter-10（全局会话 + 项目编排工具）✅  ← 依赖计划模式的任务文件可读
v2-iter-11（Native AOT 打包）✅  ← 基础设施改造，无功能前置依赖
v2-iter-12（Goal 生命周期一致性修复）✅  ← 依赖 Goal 模式就绪
v2-iter-13（Responses API + 超时 + 文件树/输入框/设置页收口）✅

v2-iter-14 ~ v2-iter-22 ✅ 已完成并合并 main
  ↓
v2-iter-23（会话可靠性与缺陷收口，执行中）
  ↓
v2-iter-24（功能补齐与遗留问题推进）
  ↓
v2-iter-25（集中修复、完整回归与 Release Candidate 准备）
  ↓
v2-iter-26（正式版发布与收尾；需老大最终确认）
```

v2-iter-1 ~ v2-iter-23 已完成；v2-iter-24（全局产品经理 Agent + 会话临时 Todo）当前处于需求重写中，待确认后执行。
v2-iter-24 ~ v2-iter-26 按“功能补齐 → 候选版稳定性门槛 → 正式版发布”顺序推进，不提前把某个开发迭代视为正式版。
每个迭代仍需老大确认具体范围后，再从最新 main 拆分支 `dev/v2-iter-{N}` 开始。
