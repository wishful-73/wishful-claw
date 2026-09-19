# 探索发现：v2-iter-32

> 阶段一产物。逐需求的详细勘测结论（含实读行号）已登记在 `raw-requirements.md` 的对应小节，
> 本文只做**索引 + 关键结论汇总 + 风险与依赖**，不重复正文。
> 勘测时间：2026-09-18。所有行号均为该时点实读结果。

## 一、当前项目状态

- 分支 `dev/v2-iter-32`（base `main` @ `2498dcae`，v0.2.31，tag `v0.2.31`）。
- 架构：C# Worker（.NET，`src/runtime/`）+ Electron 渲染端（React/TS，`src/renderer/src/`）。
- 本迭代 8 项需求**全部处于登记态，产品代码一行未动**（`git status` 只有未跟踪的 `docs/plans/iter-v2-32/`
  与一处上一轮遗留的 `docs/release-workflow.md` 改动）。
- 工具执行链路的统一入口（S-79 要用）：`ToolCallProcessor.ExecuteAsync`（`src/runtime/WishfulClaw.Agent/ToolCallProcessor.cs:150`），
  全仓唯一调用点 `AgentLoop.cs:470`；路径解析集中在 `Tools/ToolHelpers.cs` 的三个 helper。

## 二、逐需求关键结论

| 需求 | 落点（唯一/主要） | 结论摘要 |
|---|---|---|
| **S-72** 发送/终止按钮语义 | `InputArea/composer-toolbar.tsx:191` `onClick={isStreaming ? onStop : onSend}` | 判据现成（非流式分支已有 `!text.trim() && images === 0`）；上游 `chat-store.sendMessage` 已具备「忙则入队」（iter-30 S-58）。**待核实：点按钮与回车是否完全同路径** |
| **S-73** 会话级上下文上限 | Worker 四处 `contextLength` 读取 + 渲染端 `context-ring.tsx` | cap = `min(真实, 256K)`，只对 >256K 生效；模型档案显示**保持真值**。开关粒度=会话级（比照 S-59 `permissionMode`）。**入口位置未定** |
| **S-74** 工具栏间距 | `InputArea/composer-toolbar.tsx`（外层 + 左右两组 gap） | 控件自带 `px-2`；相邻实际间距 = gap 8 + 8 + 8 = 24px。右侧图标按钮**无 px-2 兜底**，两组需分别取值 |
| **S-75** 聊天窗最低宽度 | `layout/right-panel-defs.ts`（常量 + clamp）+ 布局消费处 | 聊天窗区域现**无最小宽度约束**。判据 = 「输入框不出现滚动条」⇒ 最低宽度必须 ≥ 输入框自然宽度（≈800px 量级，待真机校准）。上限算法改 `视口 − 最低宽度`。拖拽与开关走同一判定 |
| **S-76** 压缩片段时间 | `components/chat/renderable-chat-items.ts`（切分处）+ 消费端 | 根因：`createAssistantFragment` 是**浅拷贝整条消息**，各段共用同一 `createdAt/updatedAt`。压缩工件对**自带 `createdAt`**（数据现成，不需造假）。无切分消息走原路径，天然不受影响 |
| **S-77** todo 面板单行 + 切批 | `components/chat/SessionTodoPanel.tsx` | `:212-228` 折行 → 改单行截断；`:195` `title` 只在 suspended/stale 时有值，需与 `inProgressHint` 合并。**Worker 侧 `TodoTaskList` 同源返回全量**，故切批只能在渲染端过滤 |
| **S-78** 审批弹窗溢出 | `ui/alert-dialog.tsx:41` + `ui/confirm-dialog.tsx` + `lib/tools/sub-agent-approval.ts` | `AlertDialogContent` **只有 `max-w-lg`，无 `max-h`**；`AlertDialogDescription` 无 `whitespace-pre-wrap`。正文 = shell 命令全文。`confirm()` 全仓 28 个调用点 ⇒ 新行为必须是**可选开关** |
| **S-79** 沙箱路径边界 | `Agent/Tools/ToolHelpers.cs` 三个 helper + 开关透传 | 旧路径许可机制已在 iter-29 删净（只剩注释里的 retired 字样）。当前 helper **只拼接、零校验**。边界 = 项目会话单根 / 全局与渠道会话多根并集；SSH 项目不参与 |

## 三、参考源码的关键位置

- **`D:\claw\OpenCowork`**（布局与聊天窗组件的移植来源）
  - S-74 / S-75：容器与工具栏结构可对照，但**本仓已改过多轮**（iter-30 的 `STREAMING_BOTTOM_FOLLOW_*`、
    iter-31 的侧栏组合按钮），移植时以本仓现状为准，不照搬。
  - 注意：本仓 `toolPreset` 已在 iter-31 S-43 整体退役，`AvailableScopes` 已是唯一的场景可见性机制。
- **`D:\claw\deepseek-harness`**（子系统文档写法可借鉴）
  - S-79：路径/沙箱语义参考；其 `docs/subsystems/*.zh.md` 的**契约式写法**（不变量 + 失败语义）适合照搬到本仓需求文档。
- 本仓既有先例（**优先照本仓风格**）
  - S-73 的「会话级设置」形态 → S-59 `permissionMode`（DB 加列 + 会话读写 + 渲染端归一化）
  - S-79 的「判据收进单一谓词」→ S-51 `AgentRunContextPolicy.IsToolAllowed`
  - S-77 的「渲染端过滤、数据不动」→ S-34 会话 todo 三态

## 四、潜在风险与依赖

| # | 风险 / 依赖 | 说明 |
|---|---|---|
| 1 | **S-74 → S-75 强依赖** | 间距直接决定「输入框自然宽度」，必须先做 S-74 再定 S-75 的常量，否则阈值要返工 |
| 2 | **S-75 阈值需真机校准** | 粗估 ≈800px，误差 ±100px；1366px 屏两侧面板同开（272+280+800≈1352）几乎必然触发收面板 —— 是判据严厉的必然后果，需老大确认可接受 |
| 3 | **S-75 退化分支** | 窗口极窄时「两侧都收完仍不够」→ 按「保持现状不再动」处理，否则会抖动 |
| 4 | **S-78 影响 28 个调用点** | 通用原语加行为必须走**可选开关**（`descriptionVariant`），默认行为一字不改 |
| 5 | **S-78 的 `grid` 行高陷阱** | `AlertDialogContent` 是 grid，隐式行默认 `auto`，**光加 `max-h` 压不住**，需配显式 `grid-rows` + `overflow-hidden` |
| 6 | **S-73 四处读取点** | Worker 侧 `contextLength` 独立读四次，必须一并罩住；倾向「在读取层统一替换」以免漏 |
| 7 | **S-73 的省钱账** | 压缩本身也是 LLM 调用（花钱）；1M→256K 净省成立，但砍到更小需重算 —— 已提示老大，未反对 |
| 8 | **S-79 覆盖面** | 经 helper 的工具（File*/Glob/Grep/ShellExecute）天然覆盖，但需另核 `Monitor`、`use_capability` 代理路径、子代理/cron/skill 内部调用、MCP 工具自身路径参数 |
| 9 | **S-79 越界语义** | 直接拒绝、**绝不静默回退**到工作目录；文案要给出路（关开关 / 改工作目录） |
| 10 | **尚未裁定项** | S-73 的 UI 入口位置与默认态；S-77 的切批规则；S-75 的最低宽度数值；`::-webkit-scrollbar` 那条全局规则修不修（它让 `[scrollbar-width:none]` 失效，且有 5px 占位撑高工具栏） |

## 五、环境事实（影响实施与验证）

- **C# 编译门禁**：dev 实例会锁 dll（MSB3021/MSB3027），必须用 `-p:BaseOutputPath=` 外置输出；
  该临时输出目录**用完即删**（已写进 `release-workflow.md` 第七节）。
- **主进程改动需重启 Electron**（`Ctrl+R` 不够）；渲染端改动 HMR/刷新即可。
- **BOM**：所有触碰文件必须 clean（首三字节非 `EF BB BF`）。
- **网络**：直连波动极大，代理 `http://127.0.0.1:7897` 备用（Clash Verge 平时关着，授权可自行启动）。
