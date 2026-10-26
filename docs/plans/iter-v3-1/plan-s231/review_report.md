# S-231 阶段五 审查报告

> 审查日期：2026-10-26
> 分支：`dev/v3-iter-1`
> 审查方式：独立审查员只读审查（禁止写文件 / 禁跑脚本），主 agent 不参与打分

## 一、规划阶段（阶段三）共三轮

| 轮次 | 结论 | 主要问题 |
|---|---|---|
| 第 1 轮 | ❌2 / ⚠️9 | ①缺「抓真实出站请求体」的验收落点；②plan 无阶段五/六步骤 |
| 第 2 轮 | ❌1 / ⚠️13 | ①§7 #4「两轮历史段字节不变」无落点；②`AgentRuntimeRunState.cs:80-81` 注释漏改；③`TrimEnd()` 无断言；④存量形状口径与 findings §5 打架 |
| 第 3 轮 | ❌0 / ⚠️1 / ✅13 | 仅剩反向验证②不可达（`TryInjectMemoryRecallAsync` 是 private） |

**⚠️1 的修法**：把分隔符规则抽成 `internal static AppendTransientBlock`，两处拼接点共用，
测试直调 helper 锁方向 —— 因为调用点在 private 方法内，不抽出来就永远测不到。

## 二、代码阶段（阶段五）审查结论

**❌ 阻断 0 条 / ⚠️ 建议 11 条 / ✅ 通过 14 条**

审查员用 `git diff` 逐文件核对，重点验证了：方向一致性（全树仅两处拼接点，均已后置，无第三处遗漏）、
去重守卫后置后仍正确、`OriginalText` 不会拿到脏值、双注入风险、行数上限、渠道 / 子 agent / 重试 / 压缩
四条边界路径。

### ⚠️ 处置（全部已修，除 2 条明确不做）

| # | 问题 | 处置 |
|---|---|---|
| 1 | `Helpers.cs` 旧 `<summary>` 仍写「transient prefix」，且与方法上重复的第二个 `<summary>` | ✅ 删旧块、合并重写，注明「方法名 `Prefix` 为历史遗留」 |
| 2 | helper 的 `block` 参数直接 `.TrimEnd()`，传 null 会 NRE 且无警告 | ✅ 加 `if (string.IsNullOrEmpty(block)) return text ?? string.Empty;` |
| 3 | `Helpers.cs` 说「permanent history」，`RunState.cs` 说「in-memory only、落库永不含」 | ✅ 统一为「in-memory，落库不含，重启消失」 |
| 4 | `StripInjectedBlocks` 注释说「apart from trimming」，但含 `<` 才 Trim、不含则原样返回 | ✅ 注释改准（不改行为：统一 Trim 会动 S-92 的存量语义，超范围） |
| 5 | 守卫早退在 `Drain` 之前，笔记顺延下一轮但无注释 | ✅ 加注释固定意图 |
| 6 | `PendingMemoryRecall` 消费后不清空，state 若跨 run 复用在尾部叠旧块 | ⏭ **不做**：`AgentRuntimeRunState` 每 run 新建，改清空属另行动作，已由 ⚠️3 的注释覆盖语义 |
| 7 | `conv` 上断言「不含 `<memory-recall>`」是空断言（该会话本就没有召回块） | ✅ 挪到 `convRecall`，走真实 `BuildRequestBodyForTests` 断言 |
| 8 | 3f 近乎恒真（同一 record 实例）、第二条断言冗余 | ✅ 保留 3f（能抓「注入改遍历全表」类错误），另补 3f-2 幂等断言：二次注入字节不变 + `<current_time>` 只出现一次 |
| 9 | `<memory-update>` 块零覆盖（需求搬了三个块，只测两个） | ✅ 补 3f-3：`Enqueue` 后断言 `原话\n\n<memory-update>`、无尾随空行、位置在 `<current_time>` 之前 |
| 10 | 测试注释「调用点本身在 private 方法里，测不到」与同套件直调 `internal` 自相矛盾 | ✅ 改准（测不到的只有 `TryInjectMemoryRecallAsync`） |
| 11 | `ContextCompression.UserSnapshot.cs:58-60` 写「那些行落库时就带着运行时块」，与 §4.4 / 落库事实相反 | ✅ 改为防御性兜底口径 |

### 明确不做（不属本需求范围）

- 把 `InjectTransientPrefix` 重命名为 `InjectTransientBlocks`：牵动 6 处引用注释 + 方法名，
  属独立清理，本需求已在 XML 注释里注明「`Prefix` 为历史遗留」。
- 把 `StripInjectedBlocks` 的 `return text` 统一成 `return text.Trim()`：会改变 S-92 存量语义。
- 测试文件拆 partial（393/500 只剩 107 行余量）：属技术债，记入迭代收尾评估。

## 三、复核后的门禁

| 项 | 结果 |
|---|---|
| `dotnet build src\runtime\WishfulClaw.sln` | 0 警告 / 0 错误 |
| `npm test`（全量） | **83/83 通过** |
| `MemoryRecall` 套件 | **77 assertions**（原 10 → 77） |
| `npx tsc --noEmit` ×3（`tsconfig.json` / `.web.json` / `.node.json`） | 全部零错误 |
| 反向验证三轮 | ①改回前置 → 红；②helper 改前置 → 红；③去掉 `TrimEnd()` → 红 |
