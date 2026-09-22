# v2-iter-25：集中修复、完整回归与 Release Candidate 准备（规划中）


**目标**：冻结新增大功能，集中处理高优先级缺陷、静默失败、兼容性和安装链问题；完成全量回归、真实 Electron 进程级覆盖、Native AOT/NSIS 验证，并产出可供持续人工使用观察的 Release Candidate。

**进入条件**：v2-iter-24 的目标功能已完成，阻断性功能缺口已关闭，剩余问题有明确风险分级和处置结论。

**验证标准**：TypeScript 三配置、C# solution、Native AOT、数据库迁移、Electron 隔离冒烟、Windows 安装/覆盖升级/卸载重装及核心业务链通过；Release Candidate 经一段实际使用观察，无阻断发布的问题。
