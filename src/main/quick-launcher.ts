/**
 * Quick Launcher — configurable global shortcut launcher (utools-style).
 *
 * Scans Windows Start Menu .lnk files, provides fuzzy search,
 * and launches the selected application.
 *
 * Shortcut is stored in ~/.wishful-claw/launcher-config.json and can be
 * modified from both the main settings page and (future) the launcher window.
 *
 * S-249 拆分（原 2205 行 → 本文件 + `quick-launcher/` 下 10 个模块）：
 *   - `types.ts`            共享类型（只加 export，字段未改）
 *   - `constants.ts`        过滤规则与缓存时长（抽出来是为了打断 app-scan ↔ uwp 的反向依赖）
 *   - `config.ts`           配置持久化 + `getConfig()` / `setConfig()`
 *   - `cache.ts`            合并列表缓存槽（同上，打断 uwp → app-list 的反向依赖）
 *   - `app-scan.ts`         开始菜单 / 桌面 .lnk 扫描与系统设置条目启动
 *   - `uwp.ts`              UWP / 内置应用扫描（含内嵌 C# 图标提取器）
 *   - `app-list.ts`         合并列表、拼音与首字母匹配、评分排序、图标
 *   - `everything-probe.ts` Everything 本体分级探测
 *   - `es-probe.ts`         es.exe 分级探测 + 串行取数 + 自动拉起 Everything
 *   - `file-search.ts`      文件搜索独立窗（窗口、图标、取数、总数）
 *   - `window.ts`           启动器窗口生命周期与全局快捷键
 *   - `ipc.ts`              全部 IPC handler
 *   - `ipc-registrar.ts`    注入线（破 ipc ↔ 窗口模块的环）
 *
 * 对外导出面不变：`createLauncherWindow` / `registerQuickLauncher` 仍在，其余模块的入口按需转发。
 */

import { app } from 'electron'
import { setConfig, loadConfig } from './quick-launcher/config'
import { clearLauncherTimers, unregisterShortcut, registerShortcut } from './quick-launcher/window'
import { registerLauncherIpc } from './quick-launcher/ipc'
import { setLauncherIpcRegistrar } from './quick-launcher/ipc-registrar'

export { createLauncherWindow, getLauncherWindow } from './quick-launcher/window'
export { createFileSearchWindow } from './quick-launcher/file-search'

export function registerQuickLauncher(): void {
  setConfig(loadConfig())
  // 窗口模块通过注入线触发 IPC 注册（见 ipc-registrar.ts 的破环说明）。
  setLauncherIpcRegistrar(registerLauncherIpc)
  registerLauncherIpc()
  registerShortcut()

  app.on('will-quit', () => {
    clearLauncherTimers()
    unregisterShortcut()
  })
}
