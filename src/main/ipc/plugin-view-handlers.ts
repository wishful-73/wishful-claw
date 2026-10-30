/*
 * 插件视图 IPC（S-241）。四个动作：open / close / list / status。
 *
 * 参数一律只收插件 id —— 清单里的 view 定义（标题、尺寸、entry）由主进程
 * 自己去 `extension/list` 查。让渲染端把 entry 路径传上来看着省一次请求，
 * 但那等于让渲染端决定主进程加载哪个本地文件，权限全开不该从这扇门漏出去。
 */

import { registerMessagePackHandler } from './messagepack-handler'
import {
  closePluginView,
  getPluginViewStatus,
  listPluginViews,
  openPluginView,
  type PluginViewOpenArgs,
  type PluginViewOpenResult,
  type PluginViewStatus
} from '../plugins/plugin-window'

/** close / status 两种入参形态都收（裸字符串或 { pluginId }）。 */
function readPluginId(args: string | { pluginId?: string; id?: string } | undefined): string {
  if (typeof args === 'string') return args.trim()
  return (args?.pluginId ?? args?.id ?? '').trim()
}

export function registerPluginViewHandlers(): void {
  registerMessagePackHandler<PluginViewOpenArgs, PluginViewOpenResult>(
    'plugin-view:open',
    async (args) => openPluginView(args)
  )

  registerMessagePackHandler<string | { pluginId?: string }, { success: boolean; error?: string }>(
    'plugin-view:close',
    async (args) => closePluginView(readPluginId(args))
  )

  registerMessagePackHandler<undefined, PluginViewStatus[]>('plugin-view:list', async () =>
    listPluginViews()
  )

  registerMessagePackHandler<string | { pluginId?: string }, PluginViewStatus | null>(
    'plugin-view:status',
    async (args) => getPluginViewStatus(readPluginId(args))
  )
}
