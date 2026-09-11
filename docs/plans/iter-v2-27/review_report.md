# v2-iter-27 独立代码审查报告

## 范围

审查对象为当前工作区相对基线的 Plan F/G/H 与 C3 未提交改动，以及其直接关联的渲染、Provider、输入框和 Worker Agent 代码。审查不包含发布收尾、合并、打 tag、上传 Release 或伪造桌面人工验证。

## 审查结论

当前代码改动未发现新的高严重性阻断项。已修复以下审查问题：

- Agent 错误回复：错误块追加到既有内容之后，保留 text、thinking、toolCalls；同一消息已有错误块时替换而不是重复追加。
- 消息转换缓存：原地修改消息对象时，WeakMap 现在比较可序列化内容签名，避免流式文本、thinking、toolCalls 或错误块因数组引用不变而停留在旧结果。
- 渠道 Provider/模型隔离：仅展示 `enabled === true` 的 Provider，以及 `enabled && category === 'chat'` 的模型；切换到无可用聊天模型时清理旧的 `activeModelId`。
- 输入框粘贴：使用 `FileAwareEditorHandle.focus()` 恢复受控选区；`document.execCommand('insertText')` 返回失败或抛异常时进入原有受控替换路径。（2026-09-11 收尾时点已改为 `insertHTML`，原因见 `verification_report.md` 的「收尾时点复核」节）
- 全局 dispatch 回传：使用 Worker 进程内 `SemaphoreSlim` 串行化读取、幂等判断、写入、事件和反向通知，防止同进程并发重复唤醒；相同状态/报告重试仍返回已记录结果，不重复写入或通知。

## 非阻断风险与边界

- 消息签名使用 `JSON.stringify(messages)`，每次调用会为长会话增加序列化成本；当前 ChatMessage 数据为普通可序列化对象，未发现循环引用或 BigInt。若未来数据契约改变，应改为显式轻量版本号/签名。
- `ReplyGate` 是进程级全局门，会串行化不同 dispatch，并不解决多 Worker 进程间并发；这是当前 C3 同进程幂等保护的保守实现，真实多进程场景仍需集成测试或持久化幂等字段。
- 数据库“记录成功但反向回传失败”后的跨进程重试语义仍受既有“相同状态/报告不重复通知”契约约束；当前没有专门的 delivery 状态字段。
- 取消、网络失败、设置页切换、Provider 实际发送路由以及输入法/剪贴板行为，需要真实 Electron 或专用集成入口验证。

## 分层与 AOT 检查

- C# 改动仍通过既有 Agent → Infrastructure/Worker 调用方向，未新增逆向依赖。
- 新增结果编码使用现有 source-generated JSON context 类型信息。
- Agent/Worker 隔离构建均为 0 warning、0 error。
- Native AOT 发布成功，未见 IL2026、IL3050、IL3051；产物写入既有 `resources/worker`，并捆绑 18 个 CodeGraph grammar。

## 未能在当前环境完成的审查

- 没有真实 Electron `window.api` bridge 可用的自动化入口；Vite 页面不能代表 Electron 桌面运行时。
- 没有低于 0.2.27 的已安装版本及对应发布资产，无法完成 A3/B3/A4 真机升级验证。
- 没有可直接调用的 dispatch → 来源会话/渠道反向回传并发集成入口。

**结论：代码审查无阻断项；发布前仍必须完成真实 Electron、升级资产和 dispatch 集成验证。**
