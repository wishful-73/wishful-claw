# S-225 实施规划：聊天窗渲染详细度分级（3 档）

> 分支 `dev/v3-iter-2`。本文件是阶段二产物，实施前须确认 §5 三个默认值。

## 一、目标重述

把散落在 7 个组件里的「默认展开 / 折叠」策略收敛成一个**全局档位**，并保证**切档立即生效**。

不是新增渲染器，是**关系统一**。

## 二、现状勘察（阶段一结论）

### 2.1 七个决策点（全部实查）

| # | 渲染单元 | 位置 | 现有默认 |
|---|---|---|---|
| 1 | 工具 run 分组折叠 | `execution-outline.ts:314-315` | `defaultCollapsed = ordinary>0 && active==0` |
| 2 | 工具可见性分级 | `execution-outline.ts:222-233` | context/mcp/command/file-change → `ordinary`（可折叠）；其余 `force`；黑名单 `hidden` |
| 3 | 单个工具卡输出区 | `ToolCallCard/index.tsx:75-77` | `useState(forceOpen \|\| isLiveCommandTool \|\| hasVisualOutput)` |
| 4 | 思考块 | `ThinkingBlock.tsx:66` | `defaultCollapsed = !isThinking && hasThinkingContent` |
| 5 | 子 Agent 卡 | `SubAgentCard.tsx:310, 314-324` | 初始 `!isBackground`；跑完**自动折叠** |
| 6 | 文件变更卡 | `FileChangeCard.tsx:34` | `useState(!forceOpen)` |
| 7 | 压缩卡 | `ContextCompressionMessage.tsx:79` | `useState(false)` |

补充：输出块内部还有长度阈值（`output-blocks/text-output.tsx:91,132,173` —— 16 行 / 500 字符 / 40 行），**属输出自身截断，不归档位管**，保持不动。

### 2.2 关键发现：现有代码已有正确范式

`AssistantMessage/index.tsx:299-327` 的 `toolRunCollapseState` 已经是
**「用户覆盖 Map ?? 档位派生默认值」** 结构：

```ts
collapsedByRunId[run.id] ?? run.defaultCollapsed
```

⇒ 本需求的实施主线不是发明新机制，而是**把这个范式推广到另外 6 个单元**。

### 2.3 硬骨头：`useState` 初值不会跟档位变

#3 ~ #7 全部是 `useState(初始值)`。React 只在挂载时取一次初值 ⇒ 用户切档后，
已挂载的卡片**不会重新折叠/展开**，只能靠刷新页面。这是必须解决的，否则功能等于半残。

**否决的两个做法**：

- 把档位塞进 `key` 强制重挂载 —— 简单，但整列消息重挂载会丢滚动位置、丢流式渲染池，观感极差
- 每个组件 `useEffect` 监听档位再 `setState` —— 五处各写一遍，且会覆盖用户手动的展开状态

**采用：受控派生 hook（`use-density-override.ts`）**

```ts
function useDensityOverride<T>(derive: () => T): [T, (next: T) => void]
```

- 内部持 `override: { density: Density; value: T } | null`
- 取值：`override && override.density === density ? override.value : derive()`
- **切档时 override 自然失效**（密度不等即回落到新档位派生值）⇒ 立即生效，且不回写
- 用户手动点击照旧生效，仅在本档内有效

与 §2.2 的既有范式语义一致，只是把「按 runId 覆盖」泛化成「按档位覆盖」。

## 三、三档定义

| 档 | 名称 | 工具 run | 思考块 | 子 Agent | 文件变更卡 | 工具卡输出 |
|---|---|---|---|---|---|---|
| 1 | 纯文本 | 恒折叠（执行中也折叠） | 恒折叠 | 恒折叠 | 恒折叠 | 不展开 |
| 2 | 紧凑（默认） | 执行中展开、结束折叠 | 执行中展开、结束折叠 | 执行中展开、结束折叠 | 折叠 | 不展开 |
| 3 | 详情 | 恒展开 | 恒展开 | 恒展开、不自动折叠 | 展开 | 展开 |

- **正文消息三档全部始终显示**（OpenCode「消息始终可见」口径）
- **压缩卡（#7）不参与档位** —— 它是分隔卡不是活动，恒折叠，三档一致
- **错误 / 待审批（`attention` 类）三档全部强制展开** —— 这是安全底线，档位不得藏错误

## 四、落点清单

| 动作 | 文件 |
|---|---|
| 新增类型 `ChatRenderDensity` | `stores/settings-store-types.ts` |
| 新增字段 `chatRenderDensity` + 默认值 + persist | `stores/settings-store.ts`（`:214-219` 区、`:368-377` 区、`:536-546` 区） |
| 迁移兜底默认值 | `stores/settings-store-migrate.ts`（仿 `:232-238` 的 `liveOutputAnimationStyle` 写法） |
| 新增受控 hook | `components/chat/use-density-override.ts`（新文件） |
| 新增档位派生纯函数 + 矩阵 | `components/chat/render-density.ts`（新文件，便于单测） |
| 改 #1 #2 | `components/chat/execution-outline.ts`（`buildToolExecutionOutline` 增 `density` 入参） |
| 改 #3 | `components/chat/ToolCallCard/index.tsx` |
| 改 #4 | `components/chat/ThinkingBlock.tsx` |
| 改 #5 | `components/chat/SubAgentCard.tsx` |
| 改 #6 | `components/chat/FileChangeCard.tsx` |
| 设置页 UI | `components/settings/GeneralPanel.tsx`（`sec-general-appearance` 内，3 刻度 `Slider`） |
| 文案 | `locales/zh/general.json` + `locales/en/general.json` |
| 聊天窗快捷入口 | 待定（§5-3） |

## 五、待确认（默认值 —— 不同意再改，不点头就按这个做）

| # | 问题 | 我的建议 | 理由 |
|---|---|---|---|
| 1 | 第 1 档叫「纯文本」还是 OpenCode 的「安静」 | **纯文本** | 老大首轮原话就是「纯文本，只看消息」；OpenCode 的「安静」自己都写了「隐藏其他活动」，与「只看消息」不是一回事 |
| 2 | 默认档 | **紧凑**（= 当前线上行为） | 升级后观感零变化，不惊动存量用户 |
| 3 | 聊天窗入口落点 | **甲：导轨上方独立齿轮钮** | 丙在输入框工具条 —— 老大 10-26 上午刚说「输入框上方需要显示的东西太多了」，直接否；乙要新起悬浮块，与 S-221 官网那套概念混 |

「高级」区（OpenCode 截图里那块细化开关）**不做** —— 老大明确说「不需要这么多颗粒细化」，高级区正是往细颗粒走。

## 六、风险与处置

| # | 风险 | 处置 |
|---|---|---|
| 1 | `attention` 类被档位折叠 ⇒ 错误看不出来 | §三 已写死「三档强制展开」；单测覆盖 |
| 2 | 流式中途切档 ⇒ 渲染池 / 滚动位置抖动 | 只切 `open` 布尔，不换组件树；`CollapsibleHeightPanel` 已有高度动画 |
| 3 | `buildToolExecutionOutline` 是 memo 依赖链上游（`AssistantMessage/index.tsx:252`） | 把 `density` 加进 deps，注意别让每次渲染重建 outline |
| 4 | 总部 500 行硬上限 | `execution-outline.ts` 388 → +15 左右；`ToolCallCard/index.tsx` 565 **已越线**，改动须带豁免头 |
| 5 | 与 S-210 / S-215 收尾口径 | 档位只控过程层折叠，**不改收尾文案与耗时统计** |

## 七、阶段计划

| 阶段 | 产出 |
|---|---|
| 三 · 实施 | 按 §四 清单落代码 + `render-density.ts` 纯函数 + 单测 |
| 四 · 自查 | 七处决策点逐一复核「切档是否立即生效」 |
| 五 · 审查 | 重点看 `attention` 例外、memo 依赖、500 行 |
| 六 · 验证 | 真机：三档 × 执行中 / 结束 / 中断 / 报错 四态 |
