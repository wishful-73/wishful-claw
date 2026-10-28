/**
 * 快速启动器的常量与过滤规则。
 *
 * S-249 从 `quick-launcher.ts` 搬出。抽成独立模块的唯一理由是**打断反向依赖**：
 * `SKIP_NAME_PATTERN` 同时被开始菜单扫描（app-scan）和 UWP 缓存读取（uwp）用，
 * 留在任一边都会让两个模块互相 import。
 */

/** 递归开始菜单时跳过的文件夹名（SDK / 文档噪声，不是可启动应用）。Borrowed from ZTools scanner. */
export const SKIP_FOLDERS = ['sdk', 'doc', 'docs', 'samples', 'sample', 'examples', 'example', 'demos', 'demo', 'documentation']

/** 辅助性而非可启动的条目（卸载器、帮助/readme/license 链接）。Borrowed from ZTools scanner. */
export const SKIP_NAME_PATTERN = /^uninstall|^卸载|卸载$|website|网站|帮助|help|readme|read me|文档|manual|license|documentation/i

/** 系统设置/工具条目的标记前缀（不是文件路径）。 */
export const SYS_CMD_PREFIX = 'syscmd:'

/** 合并应用列表的缓存时长。 */
export const CACHE_TTL_MS = 5 * 60 * 1000

/** UWP 应用缓存的时长。 */
export const UWP_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** v3: alpha-preserving icon extraction (v2 wrote black-background PNGs). */
export const UWP_CACHE_VERSION = 3
