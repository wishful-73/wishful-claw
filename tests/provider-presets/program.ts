// provider-presets 套件入口：按原顺序驱动各 suite，输出断言汇总。
// 拆分自原单文件 program.ts（S-252，2026-10-28）。

import { builtinProviderPresets } from '../../src/renderer/src/stores/providers'
import { checks } from './checks'
import { runRegistrySuite } from './registry-suite'
import { runUpgradeSuite } from './upgrade-suite'
import { runProjectionSuite } from './projection-suite'
import { runLegacyUpgradeSuite } from './legacy-upgrade-suite'

runRegistrySuite()
runUpgradeSuite()
runProjectionSuite()
runLegacyUpgradeSuite()

console.log(`Provider preset consistency checks passed (${checks} assertions, ${builtinProviderPresets.length} presets).`)
