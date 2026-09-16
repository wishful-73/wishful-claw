import { normalizeSettingsTab } from '../../src/renderer/src/stores/ui-types'

let assertions = 0
function assert(condition: boolean, message: string): void {
  assertions += 1
  if (!condition) throw new Error(message)
}

const validTabs = [
  'provider',
  'modelManagement',
  'runtime',
  'memory',
  'shortcuts',
  'general',
  'persona',
  'about',
  'logs',
  'usage',
  'permission',
  'channel',
  'plugin',
  'webSearch',
  'extension',
  'mcp',
  'ssh',
  'skills',
  'freeChat'
] as const

for (const tab of validTabs) {
  assert(normalizeSettingsTab(tab) === tab, `valid settings tab should be preserved: ${tab}`)
}

assert(normalizeSettingsTab('modelManagement') === 'modelManagement', 'model management settings tab should be preserved')
assert(normalizeSettingsTab('unknown') === 'provider', 'unknown settings tab should open provider')
assert(normalizeSettingsTab(null) === 'provider', 'null settings tab should open provider')
assert(normalizeSettingsTab(42) === 'provider', 'non-string settings tab should open provider')

console.log(`Settings tab normalization checks passed (${assertions} assertions).`)
