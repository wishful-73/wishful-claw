import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { UpdateDistribution, UpdateDistributionInfo } from '../../shared/updater/types'

const RELEASE_URL = 'https://github.com/wishful-73/wishful-claw/releases/latest'
const DISTRIBUTION_METADATA_KEY = 'wishfulClawDistribution'

let cachedDistribution: UpdateDistribution | null = null

function readDistributionMarker(): UpdateDistribution {
  if (!app.isPackaged) return 'installer'

  const packageJsonPath = join(app.getAppPath(), 'package.json')
  if (!existsSync(packageJsonPath)) return 'installer'

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>
    const marker = parsed[DISTRIBUTION_METADATA_KEY]
    return marker === 'green' || marker === 'compat' ? marker : 'installer'
  } catch {
    return 'installer'
  }
}

export function getAppDistribution(): UpdateDistribution {
  cachedDistribution ??= readDistributionMarker()
  return cachedDistribution
}

export function getUpdateDistributionInfo(): UpdateDistributionInfo {
  const distribution = getAppDistribution()
  return {
    distribution,
    supportsAutoInstall: process.platform === 'win32' && distribution === 'installer',
    releaseUrl: RELEASE_URL
  }
}
