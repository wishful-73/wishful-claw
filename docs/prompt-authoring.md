# 提示词写作约定

> 来源：老大 2026-09-12 提供的《提示词优化》原则（原文另存 `docs/提示词优化.md`）。
> 原文讲的是「往系统提示词里加一行之前先过哪几关」；本文是它在本仓库的落地版，补上
> 「本仓库的提示词都在哪、现状如何、改的时候照着什么做」。

## 两条硬约定

### 1. 提示词一律英文，代码注释一律中文

不是偏好问题。系统提示词**每一轮都重发**，而且是 prompt cache 的前缀 —— 同一句约束用中文写要多花约
1.6 倍 token，而模型对英文指令的服从度在同等长度下更高。两件事叠起来，中文提示词是「更贵而且更松」。

**例外只有一类**：提示词里**被引用的、面向用户的字面量**保持其原语言 —— 语言名（`简体中文`）、人格的
说话示例、报错文案。把 `简体中文` 改写成 `Simplified Chinese` 不会让模型的中文更好，只会让那条规则
自己说不通。

### 2. 结构是分节的行为规则，不是一段自我介绍

照 Claude Code：`## 小节标题` + 每条一句可执行的规则。不要「你是 XX 型助手，你热情、专业、友好」
这类性格描述 —— 那是自我介绍，不是行为约束。

## 往提示词里加一行之前，先过四关

1. **说得出没有它模型会做错的那件具体事**。说不出就删掉。
   「简洁一点」说不出；「回答不要以 Here's what I found 开头」说得出。
2. **形容词换成阈值或例子**。「be concise」没有下限，模型会拿自己那个啰嗦的先验去对齐；
   「under 4 lines」+ 两条例子才咬得住。
3. **能变成事实就不要写成规则，能变成工具描述就不要写在这里，能在代码里强制就不要靠嘱咐**。
   三者的共同点：提示词是最贵、也最容易被忽略的那个位置，排在最后选。
4. **对着真实的失败写**，不是对着「理想的助手」写。

## 本仓库的提示词都在哪

| 位置 | 内容 | 现状 |
|---|---|---|
| `src/runtime/WishfulClaw.Persona/PromptBuilder.cs` | 系统提示词的分段组装（每轮重发） | 英文、分节 |
| `src/runtime/WishfulClaw.Persona/PersonaGenerationPrompt.cs` | AI 生成人格用的元提示词 | 英文、分节 |
| `src/runtime/WishfulClaw.Persona/Resources/Personas/*/*.md` | 6 套预置人格文档（每轮重发，**体量最大的一块**） | 中文，见「已知偏离」 |
| `src/runtime/WishfulClaw.Agent/Tools/**/*.cs` 的 `Description` | 工具描述 | 英文 |
| `src/runtime/WishfulClaw.Core/Tools/ToolCategoryCatalog.cs` | 27 个工具类别的一行描述 | 英文 |
| `Agent/Goal/GoalPromptTemplates.cs` | Goal 模式的 6 份提示词 | 英文、分节 |
| `Agent/AgentRuntimePlanExecutor.cs` | 计划模式工作流（`PlanModeWorkflow` 常量） | 英文、分节 |
| `Agent/ContextCompression.cs` | 上下文压缩提示词 | 英文、分节 |
| `Workspace/Memory/MemoryRecallService.cs` | 记忆召回的防注入包装 | 英文 |

> `src/runtime/WishfulClaw.CodeGraph/**` 是 vendored 的上游代码，其中的关键词表与提示词与上游逐字对齐，
> **不要动**（改动会在下次同步时被冲掉，也失去与上游对账的能力）。

## 临时文档的去处

派发任务或执行任务时产生的临时文档（任务说明、brief、笔记）统一放项目下的 `.wishful-claw/notes/`，
不要散落在项目树里。这条约定写在三处，**改的时候必须同改**：

| 位置 | 面向谁 |
|---|---|
| 系统提示词 `## Project` 段（`PromptBuilder.BuildProjectContext`，本地 + SSH 两个分支） | 所有会话 |
| `send_work_request` 工具描述（`Agent/Tools/Providers/GlobalTaskToolsProvider.cs`） | 全局 PM |
| work request 投递消息（`Agent/AgentRuntimeGlobalTaskExecutor.cs` **与** `renderer/src/stores/task-board-store.ts`） | 目标会话 |

> ⚠️ work request 文案有**两份**（C# 与 TS，TS 侧注释写明 `mirrors`），**改一处必须改另一处**，
> 否则任务看板派发与全局 PM 派发的措辞会漂移。

## 已知偏离（登记在案，**不是范例**）

1. **6 套预置人格文档是中文 + 形容词式自我介绍**。`default`（小爪）最典型：「均衡但不平庸」
   「信息密度中等」「友好但有分寸」—— 说不出没有它们模型会做错什么，也过不了第二关。
   2026-09-12 老大裁定**暂不处理**（语言与产品调性两件事都还没有好方案），故此处只登记、不修改。
2. **`<tool_calling>` 渲染的是全量 27 个类别**。`ToolCategoryCatalog.All` 是静态目录，而 R-3 的可见性策略
   会按运行档位隐藏其中一部分 —— 于是提示词会列出模型**当前根本调不到**的类别。
   修法需要把「本档位可见的类别」算出来交给 Persona：判定逻辑 `ToolVisibilityPolicy` 在 Agent 层、
   `AgentRunContext` 是 Agent internal，Persona **不能反向依赖**，因此必须由 Agent 侧把列表塞进 run 参数
   或由 Core 承载判定。**未做**（见 `plan.md` R-6 的后续项）。
3. **计划模式工作流文本曾有三份**。两条入口消息（新建 / 恢复草稿）已收敛为 `PlanModeWorkflow` 一份常量；
   「计划批准后」那条消息仍自带一份执行阶段描述，与入口消息里的 EXECUTION PHASE 有重叠。合并会改动
   模型看到的行为，**未做**。

## 提交前自查清单

- [ ] 新增/修改的提示词是英文（除被引用的用户可见字面量）
- [ ] 每一行都能说出「没有它模型会做错什么」
- [ ] 形容词都换成了阈值或例子
- [ ] 没有把工具路由、代码已强制的约束、注册表里已有的目录再抄一遍
- [ ] 提示词文本放在模板或常量里，不散落在执行逻辑的字符串拼接中
- [ ] 事实类陈述（操作系统、shell、路径）与实际运行行为一致 —— 假事实比不写更糟
