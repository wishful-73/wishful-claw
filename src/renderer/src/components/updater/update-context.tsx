import { createContext, useContext } from 'react'
import type { RendererUpdateState } from '@shared/updater/types'

/**
 * 顶栏更新图标长在 `TitleBar` 里，而更新状态归 `App` 持有 —— 两者之间隔着一层 `MainLayout`。
 * 走 props 就得让布局组件替业务字段做透传，所以这里开一个窄口子，只暴露图标真正需要的两样东西。
 */
export interface UpdateContextValue {
  state: RendererUpdateState
  /** 打开更新弹窗，并顺带把状态刷新到最新。 */
  showDetails: () => void
}

const UpdateContext = createContext<UpdateContextValue | null>(null)

export const UpdateProvider = UpdateContext.Provider

/**
 * 没挂 Provider 时返回 `null` 而不是抛错：`TitleBar` 是通用布局组件，更新图标只是它的可选内容，
 * 不该让任何一个只想要一条顶栏的调用方被这个 context 绑住。
 */
export function useUpdateContext(): UpdateContextValue | null {
  return useContext(UpdateContext)
}
