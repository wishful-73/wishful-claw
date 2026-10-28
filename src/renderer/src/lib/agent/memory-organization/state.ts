import { ipcClient } from '@renderer/lib/ipc/ipc-client'

const WATERMARK_CONFIG_KEY = 'memoryOrganizationLastRunAt'

/**
 * Turns a thrown sidecar/provider failure into a short, actionable string. The organisation chain
 * used to swallow the cause and report a bare 'llm_unavailable', which made a deterministic
 * upstream 400 (a missing session id) indistinguishable from "the model is temporarily down" for
 * weeks (S-89).
 */
export function describeOrganizationError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

let organizationRunning = false

export function setOrganizationRunning(value: boolean): void {
  organizationRunning = value
}

// ─── Watermark (last organization time, ~/.wishful-claw/config.json) ───

export async function readOrganizationWatermark(): Promise<number> {
  try {
    const value = await ipcClient.invoke('config:get', WATERMARK_CONFIG_KEY)
    const parsed =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
    return Number.isFinite(parsed) ? parsed : 0
  } catch {
    return 0
  }
}

export async function writeOrganizationWatermark(timestamp: number): Promise<void> {
  try {
    await ipcClient.invoke('config:set', { key: WATERMARK_CONFIG_KEY, value: timestamp })
  } catch (error) {
    console.warn('[MemoryOrganization] Failed to persist watermark:', error)
  }
}

export function isOrganizationRunning(): boolean {
  return organizationRunning
}
