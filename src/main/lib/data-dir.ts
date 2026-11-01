import { app } from 'electron'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { pickDataDir, WISHFULCLAW_DATA_DIR_ENV } from '../../shared/data-dir'
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
