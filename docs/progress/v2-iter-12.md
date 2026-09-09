# v2-iter-12：Goal 生命周期一致性、可审计历史与运行态修复

- 状态：已完成，已合并 main
- 分支：dev/v2-iter-12（合并后清理）
- VERDICT: PASS（自动验证；桌面人工冒烟未执行，用户确认先行合并）
- 产品版本: 0.2.12
- Tag: v0.2.12
- 版本纠正：误建的 `v2.12.0` tag 已撤销，以 `v0.2.12` 为准
- Commit: a6cb015
- 日期: 2026-08-14
- 备注：系统性修复 Goal 状态契约、唯一运行循环、取消安全点、精确持久化、终态收尾、工具状态源、历史保留与 Step 9 阻断缺陷。
  - Goal 目标状态与运行状态分离，统一 pending/active/complete/failed/aborted 及 idle/running/paused
  - 单一 owned loop、恢复与取消链路收敛，Pause/Resume/Abort 遵循安全点并同步前端运行态
  - Goal 历史永久保留，项目/会话隔离，稳定游标分页及前端“加载更多”
  - 新增 list_goals、get_goal_history、reopen_goal；重开保持旧 Goal 不变并写入双向审计事件
  - 三个新增 Goal 工具已加入 use_capability 显式代理白名单，未开放其他 Goal 控制工具
  - Goal 分解/评估使用无副作用 provider turn，避免编排阶段误调用工具
  - 验证：TypeScript 3/3 PASS；Agent build 0 错误/0 警告；Goal 回归 91 项 PASS；NativeAOT PASS；git diff --check PASS
