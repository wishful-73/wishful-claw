# 会话工具精简分析：作用域 × 协作模式 × 运行角色

> 日期：2026-08-30 ｜ 分支：dev/v2-iter-24 ｜ 性质：**分析建议，未实施**
> 目标：在不损失功能可达性的前提下，精简各组合下静态注入的工具定义，降低每次请求的默认 token 占用。

## 一、现状：注入管线与各组合注入量

注入链：`preset（renderer 决定）→ availableModes → AgentRunContextPolicy(scope/collab/role) 白名单 → webSearchEnabled/codegraphEnabled 开关`，执行期在 `ToolCallProcessor` 还有同等双闸门。

实际发送的 preset 只有 4 种来源：cowork+工作目录 → `coding`；其余聊天 → `chat`；宠物 → `minimal`；技能安装浮窗 → `skill-installer`。`full/channel/automation` 无人主动使用。

| 组合 | preset | mode | 静态注入工具数 |
|------|--------|------|--------------|
| project:chat | chat | normal | ≈18（webSearch 关则 16） |
| global:chat | chat | global | ≈25 |
| project:cowork（sessionAgent） | coding | normal | **≈38** |
| goalRunner | coding | goal | **≈43** |
| subAgent（父为 cowork） | 继承 coding | subAgent | ≈35 |
| goalSubAgent | 继承 coding | goalSubAgent | ≈30 |
| automation（cron 静默） | coding/chat | "agent" | ≈30（见问题 2） |
| pet | minimal | chat | 5 |
| providerTurn / translation | **full 兜底** | global | **≈84** |

全库注册工具共 100 个（15 直接执行器 + 85 个 Provider 占位定义）。MCP/Skill 从不对接静态注入，只走 `use_capability` 代理（防 413，设计正确）。

## 二、关键发现（按浪费量排序）

### 1. providerTurn / translation 兜底到 full，注入 ≈84 个工具 —— 最大浪费点

这两个角色职责单一（协议格式转换 / 翻译），绝大多数场景需要 0~2 个工具。因请求未携带 preset，回退到 full，注入了 Feishu 14 件、Cron 6 件、Desktop 5 件、Goal 9 件等全套定义，估算单请求 **4 万字符以上**。
**建议**：`agent-bridge-streaming.ts`、`translate-agent-service.ts` 显式传 `minimal`（或新建空 `none`）。一项改动节省最大。

### 2. automation 的 sessionMode:"agent" 不匹配任何 availableModes —— 正确性问题（顺带发现）

`cron-runtime.ts:489` 发送 `sessionMode:"agent"`，不匹配任何工具的 modes 声明，导致**所有带模式限制的工具被排除——包括 Cron 工具自己**。当前 cron 静默执行注入 ≈30 个无模式工具，Cron*/Desktop* 反而要靠 use_capability 代理兜底。
**建议**：改为 `sessionMode:"normal"`（或正式引入 `automation` mode 并给 Cron 等工具声明）。这不是精简项，是先决修复。

### 3. cowork（≈38 件）静态注入了大量「已被 use_capability 代理覆盖」的类目 —— 主要精简空间

以下类目全部已在代理的 ProxiedCategories 名单内，静态注入与代理入口**双重提供**。从 `coding` preset 移除这些类目、仅保留代理路径，功能可达性不变：

| 类目 | 工具 | 估算字符 |
|------|------|---------|
| channel-plugin | Feishu 12 + Weixin 2 | ≈5.6K |
| cron | CronAdd/Create/Update（各 >2000）+ 3 小件 | ≈7.5K+ |
| plugin | 6 件渠道无关消息 | ≈2.4K |
| desktop | 5 件桌面自动化 | ≈2.0K |
| team | 4 件多代理团队 | ≈1.6K |
| image-generate / notebook / widget / ssh | 各 1 件 | ≈2.0K |
| **合计** | **35 件** | **≈21K 字符/请求** |

这正好与工具框架的既有设计意图一致：`use_capability` 就是"延迟加载"通道。低频/重 schema 工具全部走代理，高频核心工具保留静态注入。

### 4. 大 schema 工具是字符大头

- `Bash`：>2000 字符（描述 504 + schema 1581），cowork 必需，可评估压缩 schema 文本
- `CronAdd/CronCreate/CronUpdate`：各 >2000（16 字段大 schema）——按第 3 条整体移入代理后即不再静态付费
- `use_capability` 自身 ~1550：代理入口，必须保留

### 5. Task（子代理）工具描述动态增长

`TaskTool.BuildDescription` 随磁盘上子代理定义数增长，除字符增长外还会**破坏工具定义稳定性 → 击穿 prefix cache**。建议限制枚举的子代理数量或简化描述。

### 6. global:chat 的 4 个 project 工具可移入代理

`list_projects / get_project_details / create_session / send_session_message` 的类目 `project` 已在代理名单，移入代理节省 ≈2K 字符，全局会话更聚焦。

### 7. 疑似既有隐患：openai-responses 协议聊天流注入 0 工具

聊天主流程不携带 `parameters.tools`，而 Responses 协议的 InputWriter 直接序列化该字段、不走 registry——即 **Responses 协议的聊天会话可能一个工具都注入不到**（只有自带 tools 数组的 cron/translation 路径才有）。此项超出精简范畴，但建议优先核实是否为 bug。

## 三、建议的极简核心工具集（保留清单）

原则：**高频 + 核心闭环 + 代理入口**静态保留；低频、重 schema、渠道类全部移入 use_capability 代理。

### project:cowork（sessionAgent）—— 建议 ≈25 件（现 38）

| 组 | 工具 |
|----|------|
| 文件 | Read / Write / Edit / LS |
| 搜索 | Glob / Grep |
| 执行 | Bash |
| 子代理 | Task / SubAgentStatus / SubAgentDetail |
| 会话 Todo | TaskCreate / TaskGet / TaskUpdate / TaskList |
| Plan | EnterPlanMode / SubmitPlanReview / ExitPlanMode / UpdatePlanStep |
| 交互 | AskUserQuestion |
| 记忆 | memory_hot_read / memory_hot_write / memory_append / memory_update / memory_search |
| 代理入口 | use_capability |
| 开关控制 | WebSearch / WebFetch（webSearchEnabled）、codegraph_explore（codegraphEnabled） |

移出项（代理兜底）：channel-plugin 14、cron 6、plugin 6、desktop 5、team 4、image/notebook/widget/ssh 4。

### global:chat —— 建议 ≈21 件（现 25）

现白名单基础上，把 4 个 project 工具移入代理；记忆写三件（append/hot_write/update）+ 只读两件保留（全局代理的核心能力）。6 个 global-task 工具本就走代理（设计如此），不计入静态。

### project:chat —— 维持 ≈16-18 件

已经由 chat 白名单收窄为只读+问答+Todo，无大块浪费。Plan B 会话 Todo 依赖 Task 四件，保留。

### goalRunner —— ≈34 件（现 43）

随 cowork 基座同步移出低频类目；9 个 Goal 工具中 `get_goal / list_goals / get_goal_history / reopen_goal` 已在代理内置名单，其余 5 个（create/update/pause/resume/abort）也可移入代理（单件 <500 字符，优先级低）。

### subAgent / goalSubAgent

继承父参数，父基座精简后自动受益。另建议评估：subAgent 是否需要 Plan 工具（mode 已限 normal，通常不需要）。

### automation / pet / providerTurn / translation

- automation：先修 sessionMode（问题 2），再用精简版 coding
- pet：维持 5 件
- providerTurn / translation：minimal 或空（问题 1）

## 四、收益估算（粗算）

| 改动 | 单请求节省 | 影响面 |
|------|-----------|--------|
| providerTurn/translation 改 preset | ≈4 万字符 | 每次翻译/协议转换请求 |
| cowork 移出 35 件代理类目 | ≈21K 字符（约 1~1.5 万 token，中英混合口径） | 每次 cowork 请求 |
| global:chat project 4 件入代理 | ≈2K 字符 | 全局会话 |
| goal 5 件入代理 | ≈2.5K 字符 | goal 模式 |

注：字符为描述+schema 的粗略量级估算（盘点基于逐文件测量），非运行时实测；中文描述约 1 字符≈1 token，英文 schema 约 3-4 字符≈1 token。

## 五、实施前提与风险

1. **先修审查发现的 ❌ 阻断项**：use_capability 代理路径当前未套用 `AgentRunContextPolicy`（全局 Agent 可经 `builtin:Task*` 读写会话 Todo）。把更多工具移入代理**必须**在代理补齐 scope/mode/白名单校验之后，否则扩大代理面等于扩大越权面。
2. 代理调用已有 default 权限审批对齐，新增类目入代理需回归验证审批 UX。
3. preset 是 renderer 侧字符串、白名单是后端硬编码，两处清单调整需同步更新文档与测试口径。
4. 工具定义变化会使既有会话的 prefix cache 失效一次，建议合并在一个版本点发布。
5. 建议实施顺序：问题 2（正确性）→ 问题 1（收益最大、风险最低）→ 第 3 条（依赖阻断项修复）→ 其余。
