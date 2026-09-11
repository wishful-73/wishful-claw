import { normalizeSettingsTab } from '../../src/renderer/src/stores/ui-types'

let assertions = 0
function assert(condition: boolean, message: string): void {
  assertions += 1
  if (!condition) throw new Error(message)
}

const validTabs = [
  'provider',
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
  'extension',
  'mcp',
  'ssh',
  'skills'
] as const

for (const tab of validTabs) {
  assert(normalizeSettingsTab(tab) === tab, `valid settings tab should be preserved: ${tab}`)
}

assert(normalizeSettingsTab('modelManagement') === 'provider', 'legacy model management should open provider')
assert(normalizeSettingsTab('unknown') === 'provider', 'unknown settings tab should open provider')
assert(normalizeSettingsTab(null) === 'provider', 'null settings tab should open provider')
assert(normalizeSettingsTab(42) === 'provider', 'non-string settings tab should open provider')

console.log(`Settings tab normalization checks passed (${assertions} assertions).`)
