import { app } from 'electron'
import { homedir } from 'os'
import { join, resolve } from 'path'
import {
  WISHFUL_CLAW_DATA_DIR_NAME,
  WISHFULCLAW_DATA_DIR_ENV
} from '../../shared/data-dir'
import { WISHFULCLAW_PROJECT_DIR_ENV, pickProjectDirName } from '../../shared/project-dir'

/** Resolve the application-owned global data root once for every main-process caller. */
export function resolveDataDir(): string {
  const configured = process.env[WISHFULCLAW_DATA_DIR_ENV]?.trim()
  if (configured) return resolve(configured)

  const directoryName = app.isPackaged
    ? WISHFUL_CLAW_DATA_DIR_NAME
    : `${WISHFUL_CLAW_DATA_DIR_NAME}-dev`
  return join(homedir(), directoryName)
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
