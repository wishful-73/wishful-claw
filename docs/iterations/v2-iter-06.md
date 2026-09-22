# v2-iter-6：SSH 远程执行测试与完善


**目标**：SSH 连接 → 项目绑定 → Agent 远程执行 → 终端旁观，全链路通过。

| 步骤 | 内容 |
|------|------|
| 1 | SSH 连接创建验证：配置 host/port/user/authType → 密码或密钥认证 → 连接测试通过 |
| 2 | 项目绑定验证：项目设置关联 connectionId → Agent 自动使用 |
| 3 | Agent 远程执行验证：Bash 工具带 sshConnectionId 走 SSH 通道 → 返回结构化 stdout/stderr/exitCode |
| 4 | 终端旁观验证：Agent SSH 执行时终端面板实时显示命令和输出 |
| 5 | 长连接复用验证：多次命令执行复用同一连接，断线重连 |
| 6 | 修复测试中发现的问题 |

**验证标准**：配置 SSH 连接 → 项目绑定 → Agent 远程执行 → 终端旁观，全链路无手动干预。

**分支**：`dev/v2-iter-6`　**Tag**：`v2.6.0`
