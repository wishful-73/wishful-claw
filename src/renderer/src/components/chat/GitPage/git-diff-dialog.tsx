import * as React from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Maximize2, Minimize2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent } from '@renderer/components/ui/dialog'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'

export interface GitDiffDialogRow {
  key: string
  path: string
  /** 行尾徽标（staged / unstaged / untracked 之类） */
  badge?: string
}

export interface GitDiffDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rows: GitDiffDialogRow[]
  activeKey: string | null
  onSelect: (key: string) => void
  /** 顶栏「打开文件」的目标路径；为 null 时按钮禁用 */
  previewPath: string | null
  /** 当前文件在顶栏显示的标题（默认取行 path） */
  title?: string
  /** 顶栏标题右侧的附加信息（例如任务描述或历史提交） */
  meta?: React.ReactNode
  children: React.ReactNode
}

/**
 * 右侧面板的 diff 弹窗外壳：左侧文件列表 + 顶栏翻页/计数/打开文件/全屏。
 * 差异正文由调用方通过 children 提供，git 面板与变更面板共用同一套交互。
 */
export function GitDiffDialog({
  open,
  onOpenChange,
  rows,
  activeKey,
  onSelect,
  previewPath,
  title,
  meta,
  children
}: GitDiffDialogProps): React.JSX.Element {
  const { t } = useTranslation('layout')
  const openFilePreview = useUIStore((state) => state.openFilePreview)
  const [fullscreen, setFullscreen] = React.useState(false)

  const selectedIndex = Math.max(
    0,
    rows.findIndex((row) => row.key === activeKey)
  )
  const selected = rows[selectedIndex] ?? null

  const go = (delta: number): void => {
    if (rows.length === 0) return
    const next = rows[(selectedIndex + delta + rows.length) % rows.length]
    if (next) onSelect(next.key)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          'grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0',
          fullscreen
            ? 'h-[92vh] !w-[96vw] !max-w-[96vw] sm:!max-w-[96vw]'
            : 'h-[82vh] !w-[96vw] !max-w-[96vw] sm:!max-w-[96vw]'
        )}
      >
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            {title ?? selected?.path ?? ''}
          </span>
          {meta}
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {rows.length > 0 ? `${selectedIndex + 1} / ${rows.length}` : '0'}
          </span>
          <Button variant="ghost" size="icon-xs" onClick={() => go(-1)}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={() => go(1)}>
            <ChevronRight className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={!previewPath}
            title={t('agentFiles.openFile', { defaultValue: 'Open file' })}
            onClick={() => {
              if (previewPath) openFilePreview(previewPath)
            }}
          >
            <ExternalLink className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={() => setFullscreen((value) => !value)}>
            {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={() => onOpenChange(false)}>
            <X className="size-3.5" />
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] bg-background">
          <div className="min-h-0 overflow-y-auto border-r border-border py-1">
            <div className="px-3 py-1 text-[11px] font-semibold text-muted-foreground">
              {t('agentFiles.changedFiles', { defaultValue: 'Changed files' })}
            </div>
            {rows.map((row) => (
              <button
                key={row.key}
                type="button"
                onClick={() => onSelect(row.key)}
                title={row.path}
                className={cn(
                  'flex w-full items-center gap-2 border-0 px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted',
                  row.key === selected?.key && 'bg-muted'
                )}
              >
                <span className="truncate font-mono">{row.path}</span>
                {row.badge ? (
                  <span className="ml-auto shrink-0 text-[10px] uppercase text-muted-foreground">
                    {row.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-col overflow-hidden p-3">{children}</div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
