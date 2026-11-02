import { app } from 'electron'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import {
  assessDataDirRisk,
  pickDataDir,
  WISHFULCLAW_ALLOW_SHARED_DATA_DIR_ENV,
  WISHFULCLAW_DATA_DIR_ENV,
  type DataDirProbe,
  type DataDirRisk
} from '../../shared/data-dir'
import { WISHFULCLAW_PROJECT_DIR_ENV, pickProjectDirName } from '../../shared/project-dir'

/**
 * Resolve the application-owned global data root once for every main-process caller.
 *
 * S-282：决定「用哪个目录」的那一步抽到了 `pickDataDir`（纯函数、不碰 electron，可直接单测）；
 * 这里只负责把决定落成绝对路径 —— 环境变量是完整路径语义，默认值只是目录名、拼到 home 下。
 */
export function resolveDataDir(): string {
  const decision = pickDataDir(process.env[WISHFULCLAW_DATA_DIR_ENV], app.isPackaged)
  return decision.fromEnv ? resolve(decision.value) : join(homedir(), decision.value)
}

export function resolveDataPath(...segments: string[]): string {
  return join(resolveDataDir(), ...segments)
}

/**
 * S-293：启动前探一次「这个数据目录会不会改到一份已有的生产库」。
 *
 * 判据在 `assessDataDirRisk`（纯函数、可单测），这里只负责 fs 探测 —— `shared` 层
 * 同时被 `tsconfig.web.json` 编译，引 `node:fs` 会挂。
 *
 * 只在启动序列调用一次：每次 `resolveDataDir()` 都探盘没有意义，而且弹窗只该弹一次。
 */
export function inspectDataDirRisk(): DataDirRisk {
  const decision = pickDataDir(process.env[WISHFULCLAW_DATA_DIR_ENV], app.isPackaged)
  const dir = decision.fromEnv ? resolve(decision.value) : join(homedir(), decision.value)
  const probe: DataDirProbe = {
    exists: existsSync(dir),
    hasDatabase: existsSync(join(dir, 'index.db'))
  }
  const risk = assessDataDirRisk(decision, app.isPackaged, probe)
  if (
    risk.level === 'block' &&
    process.env[WISHFULCLAW_ALLOW_SHARED_DATA_DIR_ENV]?.trim() === '1'
  ) {
    return { level: 'warn', reason: `${risk.reason ?? ''}（已由逃生舱放行）` }
  }
  return risk
}

/**
 * The project-level data directory name (S-223): `.wishful-claw` when packaged,
 * `.wishful-claw-dev` for a dev instance, overridable by `WISHFULCLAW_PROJECT_DIR`.
 *
 * Deliberately a thin shell — the decision lives in `pickProjectDirName` so it stays
 * testable without electron, and every main-process caller reads it from here so the
 * "env var wins" rule cannot drift between worker / IPC / renderer bootstrap.
 */
export function resolveProjectDirName(): string {
  return pickProjectDirName(process.env[WISHFULCLAW_PROJECT_DIR_ENV], app.isPackaged)
}
