/*
 * 插件 id 与分区名的纯判据（S-244）。
 *
 * 单独放一个不 import electron 的文件，是因为这些字符串会被**直接拼成删除目标**：
 *   - `persist:plugin-<id>` 是 Electron 分区名
 *   - `{userData}/Partitions/plugin-<id>` 是要 `rm -rf` 的目录
 *
 * 一个字符校验写漏，卸载就会删到别人的分区。所以它有独立回归套件
 * （`tests/plugin-cleanup`），不依赖 Electron 运行时。
 */

/** 与 `plugin-window.ts` 建分区时必须用同一个常量，两边不许各写一遍字面量。 */
export const PLUGIN_PARTITION_PREFIX = 'persist:plugin-'

/** 磁盘上的分区目录名（Electron 去掉 `persist:` 之后的形态）。 */
export const PLUGIN_PARTITION_DIR_PREFIX = 'plugin-'

/** 与 C# `ExtensionManifestHelpers.ExtensionIdRegex` 完全一致：2~64 位小写字母数字 `_` `-`。 */
const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/

export function isValidExtensionId(id: string | null | undefined): boolean {
  return EXTENSION_ID_PATTERN.test((id ?? '').trim().toLowerCase())
}

/** 插件 id → Electron 分区名；id 不合法返回 null（调用方必须当失败处理，不许兜底拼字符串）。 */
export function pluginPartitionName(id: string | null | undefined): string | null {
  const normalized = (id ?? '').trim().toLowerCase()
  return isValidExtensionId(normalized) ? `${PLUGIN_PARTITION_PREFIX}${normalized}` : null
}

/** 插件 id → 分区目录名（不是全路径，全路径要 userData，只有主进程知道）。 */
export function pluginPartitionDirName(id: string | null | undefined): string | null {
  const normalized = (id ?? '').trim().toLowerCase()
  return isValidExtensionId(normalized) ? `${PLUGIN_PARTITION_DIR_PREFIX}${normalized}` : null
}
