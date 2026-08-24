# 验证报告：v2-iter-20

> 日期：2026-08-24
> 分支：dev/v2-iter-20
> 验证人：Agent（最终裁定权在用户）

## 编译验证（工具证据）

| 检查 | 命令 | 结果 |
|---|---|---|
| C# 全解决方案 | `dotnet build src/runtime/WishfulClaw.sln --nologo -v q` | ✅ 0 错误 / 0 警告 |
| TS 渲染进程 | `npx tsc --noEmit -p tsconfig.web.json` | ✅ 0 错误 |
| TS 主进程 | `npx tsc --noEmit -p tsconfig.node.json` | ✅ 0 错误 |
| TS 根配置 | `npx tsc --noEmit -p tsconfig.json` | ✅ 0 错误 |

## 行为级核验（静态证据）

| 项 | 核验方式 | 结果 |
|---|---|---|
| PV-1 | 全仓 grep `ServerCertificateCustomValidationCallback` = 0 处；工厂仅在 `allowInsecureTls=true` 时挂回调 | ✅ |
| MB-1 | ResolveRoot SSH 分支：拒绝分隔符/rooted/`..`，GetFullPath 后前缀比较含 OrdinalIgnoreCase | ✅ |
| AL-1 | session 槽位在 RunAsync 入口 TryAdd、ExecuteRunAsync finally TryRemove（审查修正后覆盖正常完成路径）；子 agent 绕过 RunAsync 不受影响（iter-19 已隔离会话键） | ✅ |
| SA-1/SA-7 | Complete/Fail/Cancel 三终态均触发 EvictOldTerminalRecords；GetAll 按 StartedAt 倒序 | ✅ |
| SA-2 | cancellationRegistration 在后台任务 finally Dispose | ✅ |
| SA-3 | ConcurrentDictionary + TryRemove + 缓存锁 | ✅ |
| MB-3 | Write/Upsert/Delete 全部持 per-scope SemaphoreSlim | ✅ |
| AL-2 | ComputeKey 尾部追加 persona md 文件最大 mtime ticks；文件变更 → key 变化 → 必然 miss | ✅ |
| TL-5/PV-2/DB-3/GL-3 | 见 review_report.md 各项 ✅ | ✅ |
| RC-1 | 信封 sessionId 优先（Worker 端 envelope.sessionId=state.SessionId 与渲染端会话 id 相等，reviewer 已核验），反查降级兜底 | ✅ |

## 运行时冒烟

- ⚠️ 未执行：本机未启动完整 Electron+Worker 冒烟（涉及真实 provider 调用）。建议用户启动应用做一轮常规对话 + 后台子 agent + Goal 面板检查。

## 提交清单（main..HEAD）

- 06287b1 fix(security) PV-1a 工厂 allowInsecureTls
- 54e0a12 fix(security) PV-1b 四 provider 收口工厂
- fb64e2e fix(security) MB-1 记忆 scope 校验
- 1c88b81 fix(security) TL-6 NotebookEdit 审批
- fab8710 fix(concurrency) AL-1 session 互斥
- 442207b fix(concurrency) DB-1 初始化加锁
- e97b6b0 fix(concurrency) SA-1 SA-7 淘汰排序
- 1c7ee53 fix(concurrency) SA-2 SA-6 注册释放与 emit 兜底
- a648867 fix(concurrency) SA-3 线程安全 registry
- 064fef7 fix(concurrency) MB-3 MemoryStore 锁
- 9e06246 fix(correctness) AL-2 persona 指纹 key
- 733eddd fix(correctness) GL-3 状态常量
- d6962a2 fix(correctness) PV-2 await emit
- de80390 fix(correctness) TL-5 IsJsonError
- 23c58b4 fix(correctness) RC-1 信封路由
- 1319b2f fix(correctness) DB-3 QueryScalar Nullable
- fd3382e review(iter-20) 审查阻断项修复（AL-1 清理路径 + SA-3 Unregister）

## 结论

编译与静态行为核验全部通过；运行时冒烟待用户实测。
**建议 VERDICT：待用户裁定 PASS / FAIL / PARTIAL。**
