/**
 * 占位，未实现（S-330 登记，2026-11-06）。
 *
 * 项目首页的终端停靠区。上层两个渲染点都已接好（`ChatHomePage.tsx:331` /
 * `ProjectHomePage.tsx:152`，受 `terminalDockOpen && (workingFolder || sshConnectionId)`
 * 控制），但组件本体从来只有 `return null` —— 用户点开终端按钮看到的是空白。
 *
 * 保留而不连入口一起删：删入口是产品决策（项目终端到底做不做），不属于清死代码。
 * 真正实现时从这里起步，入口不用重造。
 */
import * as React from 'react'

interface ProjectTerminalDockProps {
  projectName?: string
  workingFolder?: string | null
  sshConnectionId?: string | null
  projectId: string
}

export function ProjectTerminalDock(_props: ProjectTerminalDockProps): React.JSX.Element | null {
  // TODO: implement terminal dock
  return null
}
