#!/usr/bin/env node
/**
 * 官网本地一键启动：前端 + 反馈服务（S-226）
 * ============================================================================
 *
 * 用法（在 website/ 下）：
 *   npm run dev                 前端 + 反馈服务
 *   npm run dev -- --web-only   只前端（不改反馈那块时够用）
 *   npm run dev:api             只反馈服务
 *   npm run preview             预览构建产物 + 反馈服务
 *
 * ── 为什么是「一条命令、两个进程」而不是「一个进程」─────────────────────
 *   官网是纯静态产物，反馈是 node 服务，线上本来就是这么分的：
 *   nginx 托管 `/data/sites/wishfulclaw`，`/api/` 反代到 127.0.0.1:7860。
 *   本地照搬同一套结构，才不会「本地能跑、线上对不上」。
 *
 *   对外仍然只有一个地址 —— http://localhost:5280/ ，`/api` 由 vite 代理转过去
 *   （见 vite.config.ts 的 apiProxy）。所以从用的人角度看，就一个站。
 *
 *   硬拧成一个进程（把后端挂成 vite 中间件）也做得到，代价是 dev 与线上走两条
 *   不同的入口链：本地不再经过 HTTP 反代，路径 / 头 / 限流取 IP 的行为都会漂，
 *   这类漂移最难查。**结构一致比进程数少重要。**
 *
 * ── 约定 ──────────────────────────────────────────────────────────────────
 *   · 后端数据落 `.wishful-claw-dev/feedback/`，与 dev 实例隔离目录同源，
 *     绝不碰生产实例的库（老大 2026-10-26 定：dev 只需项目隔离）。
 *   · 7860 已被占用（比如你手动起过一个）时**直接复用**，不重复起第二份 ——
 *     重复起只会抢端口失败，看着像脚本坏了。
 *   · 后端依赖 `better-sqlite3` 缺了就自动装一次（Node 24 有预编译，约 30 秒）。
 * ============================================================================
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const API_DIR = join(HERE, '..', 'server', 'feedback')
const DATA_DIR = join(HERE, '..', '.wishful-claw-dev', 'feedback')
const VITE_BIN = join(HERE, 'node_modules', 'vite', 'bin', 'vite.js')

const API_PORT = Number(process.env.WC_FEEDBACK_PORT || 7860)

const args = process.argv.slice(2)
const preview = args.includes('--preview')
const apiOnly = args.includes('--api-only')
const webOnly = args.includes('--web-only')

const log = (msg) => console.log(msg)

/** 端口被占（有人在监听）= 已经在跑，别起第二份 */
function isPortBusy(port) {
  return new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(true))
    srv.once('listening', () => srv.close(() => resolve(false)))
    srv.listen(port, '127.0.0.1')
  })
}

/** 子进程登记表：任一退出，其余全收 */
const children = []
let shuttingDown = false

function start(name, cmd, cmdArgs, opts = {}) {
  const child = spawn(cmd, cmdArgs, { stdio: 'inherit', ...opts })
  children.push({ name, child })
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    // 前端 Ctrl+C 在 Windows 上会同时打到两个孩子，先走的那个不算异常
    const clean = code === 0 || signal === 'SIGINT' || signal === 'SIGTERM'
    shutdown(clean ? 0 : code ?? 1)
  })
  child.on('error', (err) => {
    console.error(`\n✗ ${name} 启动失败：${err.message}`)
    shutdown(1)
  })
  return child
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const { child } of children) {
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill()
      } catch {
        // 已经没了就算了
      }
    }
  }
  process.exit(code)
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(0))

function runOnce(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    // Windows 上 npm 是 npm.cmd，shell:false 直接 spawn 会 ENOENT
    const child = spawn(cmd, cmdArgs, { stdio: 'inherit', shell: true, ...opts })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}`))))
  })
}

/** 起反馈服务；返回 true 表示这次真的起了新进程 */
async function startApi() {
  if (await isPortBusy(API_PORT)) {
    log(`  · ${API_PORT} 已在监听，复用现有反馈服务（不重复起）`)
    return false
  }

  if (!existsSync(join(API_DIR, 'node_modules', 'better-sqlite3'))) {
    log('  · 首次运行，装反馈服务依赖（better-sqlite3，约 30 秒）')
    await runOnce('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: API_DIR })
    log('  · 依赖就绪')
  }

  mkdirSync(DATA_DIR, { recursive: true })
  log(`  · 反馈服务 → 127.0.0.1:${API_PORT}（数据 ${DATA_DIR}）`)
  start('api', process.execPath, ['app.mjs'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      WC_FEEDBACK_DIR: DATA_DIR,
      WC_FEEDBACK_PORT: String(API_PORT)
    }
  })
  return true
}

function startWeb() {
  if (!existsSync(VITE_BIN)) {
    console.error(`\n✗ 找不到 ${VITE_BIN} —— 先在 website/ 下跑 npm install`)
    shutdown(1)
    return
  }
  const mode = preview ? ['preview'] : []
  log(`  · 官网${preview ? '产物预览' : '开发服务'} → 由 vite 输出地址`)
  start('web', process.execPath, [VITE_BIN, ...mode], { cwd: HERE })
}

async function main() {
  log(`\n官网本地启动${apiOnly ? '（仅反馈服务）' : webOnly ? '（仅前端）' : ''}`)

  if (!webOnly) await startApi()

  if (apiOnly) {
    log('\n  反馈服务已起，Ctrl+C 退出\n')
    return
  }

  startWeb()
  log('')
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`)
  shutdown(1)
})
