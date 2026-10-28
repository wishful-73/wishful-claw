/**
 * 优先快捷键的 Windows 桥接进程（PowerShell + C# 热键钩子）。
 *
 * S-249 从 `priority-shortcuts.ts` 搬出。原文件里这块与「注册表」互相看得见，搬完依赖方向收敛为：
 *   `types` ← `registry` ← `bridge` ← 调用方
 * 桥接进程只管起停与消息泵，注册表状态一律从 `./registry` 读，不在本文件另存一份。
 */

import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs'
import { join } from 'path'
import { logWarn } from '../lib/logger'
import { WINDOWS_BRIDGE_SCRIPT } from '../priority-hotkey-bridge-script'
import { getWinningRegistrations, registerAllFallbacks, registrations, unregisterAllFallbacks } from './registry'
import type { BridgeMessage } from './types'

export let bridge: ChildProcessWithoutNullStreams | null = null
let stdoutBuffer = ''
let appQuitting = false
let bridgeScriptPath: string | null = null
// Restart budget: a permanently crashing bridge must not loop forever.
const MAX_BRIDGE_RESTART_ATTEMPTS = 5
let bridgeRestartAttempts = 0
let bridgeRestartTimer: NodeJS.Timeout | null = null

app.on('will-quit', () => {
  appQuitting = true
  if (bridgeRestartTimer) {
    clearTimeout(bridgeRestartTimer)
    bridgeRestartTimer = null
  }
  cleanupBridgeScript()
})

export function sendToBridge(message: object): boolean {
  if (!bridge?.stdin.writable) return false
  bridge.stdin.write(`${JSON.stringify(message)}\n`)
  return true
}

export function syncBridge(): void {
  if (process.platform !== 'win32') return
  sendToBridge({ type: 'configure', shortcuts: getWinningRegistrations() })
}

/**
 * 主动收掉桥接进程（最后一个快捷键注销时调用）。
 *
 * 必须有这个访问器：`bridge` 是本模块的私有可变状态，调用方要置空它只能经此一跳 ——
 * ES module 的导入绑定是只读的，直接赋 `null` 编译不过。
 */
export function closeBridge(): void {
  if (!bridge) return
  bridge.stdin.end()
  bridge = null
}

function handleBridgeOutput(chunk: Buffer): void {
  stdoutBuffer += chunk.toString('utf8')
  let newlineIndex = stdoutBuffer.indexOf('\n')
  while (newlineIndex >= 0) {
    const line = stdoutBuffer.slice(0, newlineIndex).trim()
    stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
    if (line) {
      try {
        const message = JSON.parse(line) as BridgeMessage
        if (message.type === 'ready') {
          // The bridge is healthy again — drop restart accounting and any
          // degraded globalShortcut fallbacks so hotkeys don't fire twice.
          bridgeRestartAttempts = 0
          unregisterAllFallbacks()
          syncBridge()
        } else if (message.type === 'pressed' && message.id) {
          registrations.get(message.id)?.callback({
            foregroundWindow: message.foregroundWindow ?? null,
            focusWindow: message.focusWindow ?? null,
            foregroundWindowRect: message.foregroundWindowRect ?? null,
            focusWindowRect: message.focusWindowRect ?? null,
            caretRect: message.caretRect ?? null,
            mousePoint: message.mousePoint ?? null
          })
        }
      } catch {
        logWarn('main', `Invalid priority shortcut bridge output: ${line}`)
      }
    }
    newlineIndex = stdoutBuffer.indexOf('\n')
  }
}

function getBridgeScriptPath(): string {
  if (!bridgeScriptPath) {
    bridgeScriptPath = join(app.getPath('temp'), `wishful-claw-priority-shortcuts-${process.pid}.ps1`)
  }
  return bridgeScriptPath
}

function cleanupBridgeScript(): void {
  if (!bridgeScriptPath) return
  try {
    fs.unlinkSync(bridgeScriptPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') logWarn('main', `Failed to clean priority shortcut bridge script: ${String(error)}`)
  }
  bridgeScriptPath = null
}

export function ensureWindowsBridge(): boolean {
  if (process.platform !== 'win32') return false
  if (bridge) return true
  if (registrations.size === 0) return false

  try {
    const scriptPath = getBridgeScriptPath()
    fs.writeFileSync(scriptPath, WINDOWS_BRIDGE_SCRIPT, 'utf8')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    bridge = child
    // Writing to a dead bridge's stdin raises an 'error' event; without a
    // listener that throws uncaught in the main process.
    child.stdin.on('error', (error) => {
      logWarn('main', `Priority shortcut bridge stdin error: ${error.message}`)
    })
    child.stdout.on('data', handleBridgeOutput)
    child.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim()
      if (message) logWarn('main', `Priority shortcut bridge: ${message}`)
    })
    child.on('error', (error) => {
      if (bridge === child) bridge = null
      logWarn('main', `Priority shortcut bridge failed: ${error.message}`)
    })
    child.on('exit', (code) => {
      if (bridge === child) bridge = null
      stdoutBuffer = ''
      if (bridgeRestartTimer || registrations.size === 0 || appQuitting) return
      if (bridgeRestartAttempts >= MAX_BRIDGE_RESTART_ATTEMPTS) {
        // Budget exhausted — stop restarting and degrade to globalShortcut
        // so the hotkeys keep working (a crashing bridge would otherwise
        // silently disable them forever).
        logWarn(
          'main',
          `Priority shortcut bridge exited: code=${String(code)}; restart budget exhausted, falling back to globalShortcut`
        )
        registerAllFallbacks()
        return
      }
      bridgeRestartAttempts += 1
      const delay = Math.min(1000 * 2 ** (bridgeRestartAttempts - 1), 30_000)
      logWarn(
        'main',
        `Priority shortcut bridge exited: code=${String(code)}; restart #${bridgeRestartAttempts} in ${delay}ms`
      )
      bridgeRestartTimer = setTimeout(() => {
        bridgeRestartTimer = null
        if (!appQuitting) ensureWindowsBridge()
      }, delay)
    })
    return true
  } catch (error) {
    bridge = null
    logWarn('main', `Priority shortcut bridge could not start: ${String(error)}`)
    return false
  }
}
