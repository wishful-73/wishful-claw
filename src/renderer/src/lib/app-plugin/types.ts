/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

export const IMAGE_PLUGIN_ID = 'image' as const
export const BROWSER_PLUGIN_ID = 'browser' as const
export const DESKTOP_CONTROL_PLUGIN_ID = 'desktop-control' as const
export const CODEGRAPH_PLUGIN_ID = 'codegraph' as const

export const CODEGRAPH_EXPLORE_TOOL_NAME = 'codegraph_explore' as const
export const IMAGE_GENERATE_TOOL_NAME = 'ImageGenerate' as const
export const BROWSER_NAVIGATE_TOOL_NAME = 'BrowserNavigate' as const
export const BROWSER_GET_CONTENT_TOOL_NAME = 'BrowserGetContent' as const
export const BROWSER_SCREENSHOT_TOOL_NAME = 'BrowserScreenshot' as const
export const BROWSER_SNAPSHOT_TOOL_NAME = 'BrowserSnapshot' as const
export const BROWSER_CLICK_TOOL_NAME = 'BrowserClick' as const
export const BROWSER_TYPE_TOOL_NAME = 'BrowserType' as const
export const BROWSER_SCROLL_TOOL_NAME = 'BrowserScroll' as const
export const BROWSER_SET_DEVICE_TOOL_NAME = 'BrowserSetDevice' as const
export const DESKTOP_SCREENSHOT_TOOL_NAME = 'DesktopScreenshot' as const
export const DESKTOP_LIST_WINDOWS_TOOL_NAME = 'DesktopListWindows' as const
export const DESKTOP_CLICK_TOOL_NAME = 'DesktopClick' as const
export const DESKTOP_TYPE_TOOL_NAME = 'DesktopType' as const
export const DESKTOP_SCROLL_TOOL_NAME = 'DesktopScroll' as const
export const DESKTOP_WAIT_TOOL_NAME = 'DesktopWait' as const

/**
 * S-294（2026-10-31）：后端 `AgentRuntimeDesktopExecutor.DesktopToolNames` 含 `CaptureAppWindow`
 * （它借用桌面 transport 回主进程截本应用自己的窗口），但**桌面控制插件的 toolNames 里没有它**
 * —— 所以它不是一个 app-plugin 工具，故意不进下面的 `AppPluginToolName` 联合类型。
 *
 * 只给渲染层当路由判据用：以前 `tool-block-renderer` 的桌面 if 只列了 6 个，它掉进通用卡片
 * 按裸 JSON 文本渲染，紧凑档也一样。
 */
export const DESKTOP_CAPTURE_WINDOW_TOOL_NAME = 'CaptureAppWindow' as const

export type AppPluginId =
  | typeof IMAGE_PLUGIN_ID
  | typeof BROWSER_PLUGIN_ID
  | typeof DESKTOP_CONTROL_PLUGIN_ID
  | typeof CODEGRAPH_PLUGIN_ID
export type AppPluginToolName =
  | typeof CODEGRAPH_EXPLORE_TOOL_NAME
  | typeof IMAGE_GENERATE_TOOL_NAME
  | typeof BROWSER_NAVIGATE_TOOL_NAME
  | typeof BROWSER_GET_CONTENT_TOOL_NAME
  | typeof BROWSER_SCREENSHOT_TOOL_NAME
  | typeof BROWSER_SNAPSHOT_TOOL_NAME
  | typeof BROWSER_CLICK_TOOL_NAME
  | typeof BROWSER_TYPE_TOOL_NAME
  | typeof BROWSER_SCROLL_TOOL_NAME
  | typeof BROWSER_SET_DEVICE_TOOL_NAME
  | typeof DESKTOP_SCREENSHOT_TOOL_NAME
  | typeof DESKTOP_LIST_WINDOWS_TOOL_NAME
  | typeof DESKTOP_CLICK_TOOL_NAME
  | typeof DESKTOP_TYPE_TOOL_NAME
  | typeof DESKTOP_SCROLL_TOOL_NAME
  | typeof DESKTOP_WAIT_TOOL_NAME

export function isAppPluginEnabledByDefault(id: AppPluginId): boolean {
  return id === IMAGE_PLUGIN_ID || id === BROWSER_PLUGIN_ID
}

export interface AppPluginDescriptor {
  id: AppPluginId
  builtin: true
  toolNames: AppPluginToolName[]
  requiresModelConfig: boolean
  // Optional readiness gate for plugins whose assets are not part of the app bundle.
  requiresDownload?: boolean
  hidden?: boolean
}

export interface AppPluginInstance {
  id: AppPluginId
  enabled: boolean
  useGlobalModel: boolean
  providerId: string | null
  modelId: string | null
  browserAllowedDomains?: string[]
  browserBlockedDomains?: string[]
}

export const APP_PLUGIN_DESCRIPTORS: AppPluginDescriptor[] = [
  {
    id: IMAGE_PLUGIN_ID,
    builtin: true,
    toolNames: [IMAGE_GENERATE_TOOL_NAME],
    requiresModelConfig: true
  },
  {
    id: BROWSER_PLUGIN_ID,
    builtin: true,
    toolNames: [
      BROWSER_NAVIGATE_TOOL_NAME,
      BROWSER_GET_CONTENT_TOOL_NAME,
      BROWSER_SCREENSHOT_TOOL_NAME,
      BROWSER_SNAPSHOT_TOOL_NAME,
      BROWSER_CLICK_TOOL_NAME,
      BROWSER_TYPE_TOOL_NAME,
      BROWSER_SCROLL_TOOL_NAME,
      BROWSER_SET_DEVICE_TOOL_NAME
    ],
    requiresModelConfig: false
  },
  {
    id: DESKTOP_CONTROL_PLUGIN_ID,
    builtin: true,
    toolNames: [
      DESKTOP_SCREENSHOT_TOOL_NAME,
      DESKTOP_LIST_WINDOWS_TOOL_NAME,
      DESKTOP_CLICK_TOOL_NAME,
      DESKTOP_TYPE_TOOL_NAME,
      DESKTOP_SCROLL_TOOL_NAME,
      DESKTOP_WAIT_TOOL_NAME
    ],
    requiresModelConfig: false,
    hidden: true
  },
  {
    id: CODEGRAPH_PLUGIN_ID,
    builtin: true,
    toolNames: [CODEGRAPH_EXPLORE_TOOL_NAME],
    requiresModelConfig: false,
    // Opt-in and disabled by default; language grammars ship with the app.
    requiresDownload: false
  }
]
