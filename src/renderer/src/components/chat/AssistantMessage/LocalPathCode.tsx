/**
 * agent 回复里的工作区文件路径 → 可点标签。
 *
 * 只有 stat 确认「存在且是文件」才渲染成标签；否则保持普通行内 code，
 * 避免用户点了才发现路径不存在。点击后按类型分派：图片走全屏预览，
 * 其余交给右侧预览面板（分派逻辑在 lib/preview/local-target.ts）。
 *
 * 标签主体只显示文件名（agent 写的通常是完整路径，直接铺在正文里太长），
 * 完整路径放原生 title —— hover 就能看到。
 */

import * as React from 'react'
import { FileImage, FileText } from 'lucide-react'
import { useChatStore } from '@renderer/stores/chat-store'
import { useLocalTargetAvailable } from '@renderer/hooks/use-local-target-available'
import { isImageFilePath, openLocalTarget } from '@renderer/lib/preview/local-target'

interface LocalPathCodeProps {
  /** 已解析成绝对路径的目标；相对路径的拼接由调用方负责。 */
  resolvedPath: string
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
}

export function LocalPathCode({
  resolvedPath,
  className,
  style,
  children
}: LocalPathCodeProps): React.JSX.Element {
  // 订阅而不是 getState：会话切到别的 SSH 主机时，已存在的标签要重新判定。
  const sshConnectionId = useChatStore(
    (s) => s.sessions.find((session) => session.id === s.activeSessionId)?.sshConnectionId
  )
  const available = useLocalTargetAvailable(resolvedPath, sshConnectionId)

  if (available !== true) {
    return (
      <code className={className} style={style}>
        {children}
      </code>
    )
  }

  const fileName = resolvedPath.split(/[\\/]/).pop() || resolvedPath
  const Icon = isImageFilePath(resolvedPath) ? FileImage : FileText

  return (
    <button
      type="button"
      title={resolvedPath}
      className="not-prose inline-flex max-w-full cursor-pointer items-center gap-1 rounded border border-border/60 bg-muted px-1.5 py-0.5 align-middle font-mono text-xs text-primary transition-colors hover:bg-accent"
      onClick={() => {
        openLocalTarget(resolvedPath, {
          sshConnectionId,
          sessionId: useChatStore.getState().activeSessionId
        })
      }}
    >
      <Icon className="size-3 shrink-0 opacity-70" />
      <span className="max-w-[16rem] truncate">{fileName}</span>
    </button>
  )
}
