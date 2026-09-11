# v2-iter-17：缺陷修复迭代

- 状态：已完成，已合并 main
- 分支：dev/v2-iter-17（合并后清理）
- VERDICT: PASS（编译验证 + 用户人工验证）
- 产品版本: 0.2.17
- Tag: v0.2.17
- Commit: 30814e6
- 日期: 2026-08-20
- 备注：
  - **#1 左侧面板收起报 React error #300** — useState(searchOpen) 移到早退 return 之前，hooks 调用数量一致
  - **#2 启动器焦点偶发丢失** — show 事件驱动 + focus 重试至落位(800ms) + 窗口重获焦点自动聚焦
  - **#3 剪贴板粘贴未到目标/网页焦点丢失** — 激活确认轮询 + GetGUIThreadInfo 焦点捕获 + RestoreFocus + Alt 系快捷键兼容层（clearMenu + Esc 清除 Chrome 菜单态）；五轮排查定位真正根因为 Alt 系快捷键漏给应用
  - **#4 扩展菜单子项闪烁** — 非 modal 化 + hover 桥接死区 + 阻止外部交互误关闭
  - **#5 提示词优化永久卡死** — AbortController + 120s 超时 + 取消/关闭弹窗即中断并复位状态
  - **#6 剪贴板交互增强** — 单击选中/双击粘贴 + window 级方向键导航 + 置顶/删除按钮 stopPropagation
  - **#7 日志分级** — 打包版仅 error/开发版全量 + WISHFUL_CLAW_LOG_LEVEL 覆盖 + debug 级与 log:write 支持
  - **#8 快速搜索匹配增强** — UWP 应用扫描(PowerShell Shell.Application + GBK 解码 + 内联 C# 图标提取 alpha 保留) + ~90 项系统设置入口(ms-settings URI/控制面板/管理工具) + 拼音全拼/首字母/驼峰首字母分层评分 + 启动历史优先 + .lnk target 去重 + 桌面快捷方式扫描 + PE 图标提取器(PNG 压缩图标) + ZTools 扫描器过滤采纳
  - **BOM 回归修复** — 156 个文件被重新加了 UTF-8 BOM，批量去除
  - 验证：TypeScript 3/3 PASS；BOM 扫描 0 残留
