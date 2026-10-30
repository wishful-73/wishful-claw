/*
 * 插件视图生命周期（S-241）—— 空闲回收 + 退出时按 pid 树收子进程。
 *
 * 空窗回收解决的是「开过就忘」：插件窗口关掉不销毁很正常，但用户拖到副屏、
 * 最小化、或者干脆忘了它，窗口和它背后的渲染进程会一直占内存。这里只做一件
 * 事：失焦超过阈值的窗口销毁掉，插件自己的常驻子进程由插件按需重启。
 *
 * pid 树回收解决的是另一件事：权限全开意味着插件可以自己 `spawn`，
 * 那些子进程不归 Electron 管，主程序退出时不清就永远留在后台。
 */

import { app } from 'electron'
import { spawn } from 'child_process'
import { logInfo, logWarn } from '../lib/logger'
import { destroyAllPluginViews, sweepIdlePluginViews } from './plugin-window'

/** 空闲阈值：失焦多久之后销毁窗口。缺省 15 分钟（需求 §4.2）。 */
export const PLUGIN_VIEW_IDLE_MS = 15 * 60_000

/** 扫描周期。不需要更密 —— 回收是省内存，不是实时行为。 */
const IDLE_SWEEP_INTERVAL_MS = 60_000

let sweepTimer: NodeJS.Timeout | null = null
let quitHookInstalled = false

/**
 * 按 pid 树杀进程。
 *
 * Windows 用 `taskkill /T /F`：插件窗口的渲染进程被杀时，它 `spawn` 出来的
 * 子进程默认不会跟着走（Windows 没有进程组语义），`/T` 是唯一可靠的办法。
 * 其它平台只杀本身 —— 那边的常驻插件进程会随父进程的会话退出，够用；
 * 本项目的主战场是 Windows（老大 2026-10-27 定）。
 */
function killProcessTree(pid: number): void {
  if (!pid || pid === process.pid) return

  if (process.platform === 'win32') {
    const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    })
    child.on('error', (error) => {
      logWarn('main', `plugin-view: taskkill failed for pid ${pid}: ${String(error)}`)
    })
    return
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    logWarn('main', `plugin-view: kill failed for pid ${pid}: ${String(error)}`)
  }
}

/** 扫一遍空闲窗口。导出给单测与手动排查用。 */
export function sweepPluginViewIdle(idleMs = PLUGIN_VIEW_IDLE_MS): string[] {
  return sweepIdlePluginViews(idleMs)
}

/**
 * 退出前收尾：先杀进程树、再销毁窗口。
 *
 * 顺序不能反 —— 窗口一销毁，renderer 的 pid 就没了，那时再想找它拉起的
 * 子进程只能靠遍历全系统。所以先把 pid 拿到手。
 */
export function shutdownPluginViews(): void {
  const pids = destroyAllPluginViews()
  if (pids.length === 0) return
  logInfo('main', `plugin-view: shutdown: reclaiming ${pids.length} plugin window(s)`)
  for (const pid of pids) killProcessTree(pid)
}

/**
 * 注册生命周期钩子。`app.whenReady()` 之后调用一次即可，重复调用无副作用。
 */
export function registerPluginLifecycle(): void {
  if (quitHookInstalled) return
  quitHookInstalled = true

  sweepTimer = setInterval(() => {
    sweepPluginViewIdle()
  }, IDLE_SWEEP_INTERVAL_MS)
  // 别为了省内存的定时器把进程钉住不退出
  sweepTimer.unref?.()

  app.on('before-quit', () => {
    stopPluginViewIdleSweeper()
    shutdownPluginViews()
  })
}

/** 停掉扫描定时器（退出钩子与测试清理用）。 */
export function stopPluginViewIdleSweeper(): void {
  if (!sweepTimer) return
  clearInterval(sweepTimer)
  sweepTimer = null
}
