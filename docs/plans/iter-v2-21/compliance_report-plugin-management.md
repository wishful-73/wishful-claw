# 规划合规检查：v2-iter-21 插件管理与 Browser 加载闭环

## 结论

PASS（基于主 Agent 的独立只读检查；外部子 Agent 探测因服务端 HTTP 429 未能启动）。计划可以进入用户确认环节，执行前仍需用户确认范围。

## 检查结果

- [x] 覆盖用户需求：设置页扩展/插件管理、Browser 加载链路修复、并入 v2-iter-21。
- [x] 有明确入口：SettingsPage 的扩展与集成分组。
- [x] 有完整闭环：列表、安装、启用/禁用、配置、打开目录、移除、错误反馈。
- [x] 覆盖当前已存在的后端/IPC/Worker 能力，避免重复实现。
- [x] 明确处理扩展工具刷新 TODO。
- [x] 明确处理 Browser 工具无条件注册和 store hydration 竞态。
- [x] 遵守 7 层依赖方向；本计划主要修改 renderer/main 既有边界，不新增下层逆向引用。
- [x] 遵守 AOT 约束；不引入反射扫描、Activator 或匿名 JSON 序列化。
- [x] 明确保护当前 8 个未提交文件。
- [x] 每一步有 Mini 验证，最终有三配置 TS、C# build、diff check 和可选 AOT 验证。
- [x] 未授权 commit、merge、tag、push 或迭代收尾被纳入暂不做范围。

## 风险与处理

1. OpenCowork ExtensionPanel 较大：迁移时以最小完整闭环为目标，必要时按职责拆分。
2. 扩展工具执行边界：renderer 只注册定义，Native Worker 负责执行。
3. Browser 辅助 IPC：本次不默认扩展 Cookie/profile 范围，先根据目标 UI 实际调用决定。
4. 完整 solution 可能被运行中的 Worker 锁定：验证报告中区分环境锁定与代码编译结果。
