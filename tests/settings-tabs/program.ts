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
  'skills'
] as const

for (const tab of validTabs) {
  assert(normalizeSettingsTab(tab) === tab, `valid settings tab should be preserved: ${tab}`)
}

assert(normalizeSettingsTab('modelManagement') === 'modelManagement', 'model management settings tab should be preserved')
// 免费对话清单已挪进免费对话页（S-41），「freeChat」成为已退役的 tab：
// 必须回落到默认页，不能渲染空白。
assert(normalizeSettingsTab('freeChat') === 'provider', 'retired freeChat tab should fall back to provider')
assert(normalizeSettingsTab('unknown') === 'provider', 'unknown settings tab should open provider')
assert(normalizeSettingsTab(null) === 'provider', 'null settings tab should open provider')
assert(normalizeSettingsTab(42) === 'provider', 'non-string settings tab should open provider')

console.log(`Settings tab normalization checks passed (${assertions} assertions).`)
