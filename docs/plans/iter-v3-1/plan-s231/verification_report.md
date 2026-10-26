# S-231 阶段六 验证报告

> 验证日期：2026-10-26
> 分支：`dev/v3-iter-1`
> 结论：**门禁全绿；真机项待老大在 dev 实例上跑一遍**（本报告第 3 节列清单）

## 1. 自动化门禁（已跑，全绿）

| 项 | 命令 | 结果 |
|---|---|---|
| 编译 | `dotnet build src\runtime\WishfulClaw.sln` | **0 警告 / 0 错误** |
| 全量测试 | `npm test` | **83/83 通过** |
| 本需求套件 | `npm test -- --csharp-only --filter Memory` | **77 assertions 全绿**（原有 10 → 77） |
| TS 类型 | `npx tsc --noEmit -p tsconfig.json` / `.web.json` / `.node.json` | 三配置零错误 |

### 断言有效性的反向验证（三轮，验完已还原）

| 轮次 | 人为引入的回退 | 结果 |
|---|---|---|
| ① | `Helpers.cs` 拼回 `parts + msg.Text`（前置） | ✅ 变红：`injected text starts with the user's own words` |
| ② | helper 改成 `blocks + "\n\n" + text`（前置） | ✅ 变红：helper 单元断言 |
| ③ | 去掉 helper 里的 `TrimEnd()` | ✅ 变红：`does not end with a blank line` |

三轮均如期变红 ⇒ 断言不是自我实现，能抓住真实回退。

## 2. 覆盖范围

新增测试落在 `tests/WishfulClaw.MemoryRecallRegressionTests/Program.cs` 的
`RunTransientBlockPlacementSuite`（77 断言中含本套件 28 条），覆盖：

| 层 | 断言内容 |
|---|---|
| helper 单元 | 后置拼接、`TrimEnd`、空串 / 纯空白 / 尾随空白保留 |
| 组合层（直调 `InjectTransientPrefix`） | 以原话开头、不以 `\n` 开头/结尾、恰一空行、`OriginalText`、`SentAt` |
| 剥离层 | 尾部形状、尾部 recall + time 组合都能剥回原话 |
| 真实出站请求体 | `BuildRequestBodyForTests` ⇒ 首条 `role == "user"` 的 `content` 以原话开头（普通轮 + 召回轮各一次） |
| 守卫幂等 | 二次注入字节不变、`<current_time>` 只出现一次 |
| 三个块全覆盖 | `<current_time>` / `<memory-update>` / `<memory-recall>` 各自后置且互相位置正确 |
| 缓存稳定 | 第二轮注入后历史段字节不变 |

## 3. 真机验证清单（**待跑**，对应 `requirements/S-231.md §7`）

需在 dev 实例上逐条确认，跑完把结果回填本表：

| # | 验收项 | 步骤 | 结果 |
|---|---|---|---|
| 1 | WorkBuddy **国内版**会话标题 | 新建会话发「测试标题 A」⇒ 标题应是「测试标题 A」开头，**不含** `<current_time>` | ☐ 待跑 |
| 2 | WorkBuddy **国际版**同上 | 同上 | ☐ 待跑 |
| 3 | 首轮命中记忆召回的会话标题 | 构造一个会触发 `memory-recall` 的会话 ⇒ 标题不含 `<memory-recall>` | ☐ 待跑 |
| 4 | OpenAI 兼容路时间感知 | 问「现在几点」⇒ 答对（尾部块可读性未退化） | ☐ 待跑 |
| 5 | Anthropic 路时间感知 | 同上 | ☐ 待跑 |
| 6 | 纯图片消息出站形状 | 只发图不发字 ⇒ 请求体 `content` 为数组、不含空 text 片段 | ☐ 待跑 |
| 7 | 压缩快照「你上次发言」 | 触发压缩 ⇒ 快照里是用户原话，不带标签 | ☐ 待跑 |

> 第 4/5 项是本需求**唯一非确定性风险**（块从头部挪到尾部后，模型对时间的注意力是否仍足够），
> 只能真机判断，无法自动化。

## 4. 遗留与已知边界

- **不迁移存量数据**：注入块从不入 DB（`AgentLoop.cs:130-131` 的 `wireConversation` 是落库来源，
  注入只改 `conversation` 活引用）⇒ 前置形状只活在旧进程内存，重启即消失。
- **方法名保留**：`InjectTransientPrefix` 名字里的 `Prefix` 已是历史遗留，XML 注释已注明；
  重命名牵动 6 处引用，记为独立清理。
- **测试文件行数**：`Program.cs` 393/500，余量 107 行，下个套件建议先拆 partial。
- **`raw-requirements.md` 未随本刀提交**：该文件混了 S-225~S-231 七段登记，
  按「一需求一刀」的纪律留到迭代收尾统一提交。
