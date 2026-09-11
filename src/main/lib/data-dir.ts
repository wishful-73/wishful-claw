import { app } from 'electron'
import { homedir } from 'os'
import { join, resolve } from 'path'
import {
  WISHFUL_CLAW_DATA_DIR_NAME,
  WISHFULCLAW_DATA_DIR_ENV
} from '../../shared/data-dir'

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
