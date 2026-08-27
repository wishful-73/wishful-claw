import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronRight, ChevronDown, File, Folder, FolderOpen, ExternalLink,
  Copy, Eye, MessageSquarePlus, Pencil, SquareTerminal, Trash2,
  FilePlus2, FolderPlus, RefreshCw, Code2
} from 'lucide-react'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuItem, ContextMenuSeparator
} from '@renderer/components/ui/context-menu'
import { cn } from '@renderer/lib/utils'
import { AnimatePresence, motion } from 'motion/react'
import type { TreeNode, TreeEditState, TreeActions } from './file-tree-types'
import { fileIcon, DepthGuides, IGNORED_DIRS } from './file-tree-utils'
import { Check } from 'lucide-react'
import { useEffect, useRef } from 'react'

// --- Inline input for rename / new item ---

export function InlineInput({
  defaultValue,
  depth,
  icon,
  onConfirm,
  onCancel
}: {
  defaultValue: string
  depth: number
  icon: React.ReactNode
  onConfirm: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(defaultValue)

  useEffect(() => {
    // Auto-focus and select filename without extension
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = defaultValue.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : defaultValue.length)
  }, [defaultValue])

  return (
    <div
      className="flex items-center gap-1 py-[1px] pr-2 text-[12px]"
      style={{ paddingLeft: `${depth * 14 + 4 + 16}px` }}
    >
      {icon}
      <input
        ref={ref}
        className="workspace-filetree-input flex-1 min-w-0 rounded border px-1 py-0 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-ring"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) onConfirm(value.trim())
          if (e.key === 'Escape') onCancel()
        }}
        onBlur={() => onCancel()}
      />
    </div>
  )
}

export function TreeItem({
  node,
  depth,
  activePath,
  onToggle,
  editState,
  actions,
  agentSurface = false
}: {
  node: TreeNode
  depth: number
  activePath: string | null
  onToggle: (path: string) => void
  editState: TreeEditState
  actions: TreeActions
  agentSurface?: boolean
}): React.JSX.Element {
  const { t } = useTranslation('layout')
  const [copied, setCopied] = useState(false)
  const isDir = node.type === 'directory'
  const isIgnored = isDir && IGNORED_DIRS.has(node.name)
  const safeEditState = editState ?? {
    renamingPath: null,
    newItemParent: null,
    newItemType: 'file' as const
  }
  const isRenaming = safeEditState.renamingPath === node.path
  const isActive = activePath === node.path

  const handleCopy = useCallback(() => {
    actions.onCopyPath(node.path)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }, [actions, node.path])

  const handleAddToChat = useCallback(() => {
    actions.onAddToChat(node.path)
  }, [actions, node.path])

  const rowContent = (
    <div
      className={cn(
        'workspace-filetree-row group relative flex items-center text-[12px] transition-all',
        'cursor-pointer',
        agentSurface
          ? 'workspace-filetree-row--agent gap-0 rounded-none px-0 py-0'
          : 'gap-2 rounded-xl px-2 py-1.5',
        isActive
          ? 'workspace-filetree-row--active text-foreground'
          : isDir && node.expanded
            ? 'workspace-filetree-row--expanded workspace-filetree-row--interactive'
            : 'workspace-filetree-row--interactive',
        isIgnored && 'opacity-40'
      )}
      style={{ paddingLeft: `${depth * 14 + (agentSurface ? 4 : 6)}px` }}
      onClick={() => (isDir && !isIgnored ? onToggle(node.path) : actions.onPreview(node.path))}
      onContextMenu={(event) => event.stopPropagation()}
      title={node.path}
    >
      {!agentSurface ? <DepthGuides depth={depth} /> : null}
      {depth > 0 && !agentSurface && (
        <span
          className="workspace-filetree-guide absolute top-1/2 h-px w-2 pointer-events-none"
          style={{ left: `${(depth - 1) * 14 + 9}px` }}
        />
      )}

      {isDir ? (
        <ChevronRight
          className="workspace-filetree-chevron shrink-0"
          style={{
            transform: node.expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        />
      ) : (
        <span className="w-[13px] h-[13px] shrink-0" />
      )}

      {isDir ? (
        node.expanded ? (
          <FolderOpen className="size-[14px] shrink-0 text-sky-500 dark:text-sky-400" />
        ) : (
          <Folder className="size-[14px] shrink-0 text-sky-500 dark:text-sky-400" />
        )
      ) : (
        fileIcon(node.name)
      )}

      {isRenaming ? (
        <input
          autoFocus
          className="workspace-filetree-input flex-1 min-w-0 rounded border px-1 py-0 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-ring"
          defaultValue={node.name}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const val = (e.target as HTMLInputElement).value.trim()
              if (val && val !== node.name) actions.onRenameConfirm(val)
              else actions.onRenameCancel()
            }
            if (e.key === 'Escape') actions.onRenameCancel()
          }}
          onBlur={() => actions.onRenameCancel()}
          onFocus={(e) => {
            const dot = node.name.lastIndexOf('.')
            e.target.setSelectionRange(0, dot > 0 && !isDir ? dot : node.name.length)
          }}
        />
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={cn(
              'truncate',
              agentSurface
                ? 'font-normal text-agent-files-fg'
                : isDir
                  ? 'font-medium text-foreground/85'
                  : 'text-foreground/80'
            )}
          >
            {node.name}
          </span>
        </div>
      )}

      {!agentSurface && !isDir && !isRenaming && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-all group-hover:opacity-100">
          <button
            className="workspace-filetree-action rounded-md p-1"
            onClick={(e) => {
              e.stopPropagation()
              handleAddToChat()
            }}
            title={t('fileTree.addToChat')}
          >
            <MessageSquarePlus className="size-3" />
          </button>
          <button
            className="workspace-filetree-action rounded-md p-1"
            onClick={(e) => {
              e.stopPropagation()
              handleCopy()
            }}
            title={t('fileTree.copyPath')}
          >
            {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
          </button>
        </div>
      )}
    </div>
  )

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          {!isDir && (
            <ContextMenuItem
              className="gap-2 text-xs"
              onSelect={() => actions.onPreview(node.path)}
            >
              <Eye className="size-3.5" /> {t('fileTree.preview')}
            </ContextMenuItem>
          )}
          <ContextMenuItem className="gap-2 text-xs" onSelect={handleAddToChat}>
            <MessageSquarePlus className="size-3.5" /> {t('fileTree.addToChat')}
          </ContextMenuItem>
          {isDir && !isIgnored && (
            <>
              <ContextMenuItem className="gap-2 text-xs" onSelect={() => onToggle(node.path)}>
                {node.expanded ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
                {node.expanded ? t('fileTree.collapseFolder') : t('fileTree.expandFolder')}
              </ContextMenuItem>
              <ContextMenuItem
                className="gap-2 text-xs"
                onSelect={() => actions.onNewFile(node.path)}
              >
                <FilePlus2 className="size-3.5" /> {t('fileTree.newFile')}
              </ContextMenuItem>
              <ContextMenuItem
                className="gap-2 text-xs"
                onSelect={() => actions.onNewFolder(node.path)}
              >
                <FolderPlus className="size-3.5" /> {t('fileTree.newFolder')}
              </ContextMenuItem>
              <ContextMenuItem
                className="gap-2 text-xs"
                onSelect={() => actions.onRefresh(node.path)}
              >
                <RefreshCw className="size-3.5" /> {t('action.refresh', { ns: 'common' })}
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem className="gap-2 text-xs" onSelect={handleCopy}>
            <Copy className="size-3.5" /> {t('action.copyPath', { ns: 'common' })}
          </ContextMenuItem>
          <ContextMenuItem
            className="gap-2 text-xs"
            onSelect={() => actions.onOpenTerminal(node.path, isDir)}
          >
            <SquareTerminal className="size-3.5" /> {t('fileTree.openTerminal')}
          </ContextMenuItem>
          {actions.localActionsAvailable && !isIgnored && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                className="gap-2 text-xs"
                onSelect={() => actions.onOpenDefault(node.path)}
              >
                <ExternalLink className="size-3.5" /> {t('fileTree.openDefault')}
              </ContextMenuItem>
              <ContextMenuItem
                className="gap-2 text-xs"
                onSelect={() => actions.onOpenWithCode(node.path)}
              >
                <Code2 className="size-3.5" /> {t('fileTree.openWithCode')}
              </ContextMenuItem>
              <ContextMenuItem
                className="gap-2 text-xs"
                onSelect={() => actions.onReveal(node.path)}
              >
                <FolderOpen className="size-3.5" /> {t('fileTree.revealInFinder')}
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            className="gap-2 text-xs"
            onSelect={() => actions.onRenameStart(node.path, node.name)}
          >
            <Pencil className="size-3.5" /> {t('action.rename', { ns: 'common' })}
          </ContextMenuItem>
          <ContextMenuItem
            className="gap-2 text-xs text-destructive focus:text-destructive"
            onSelect={() => actions.onDelete(node.path, node.name, isDir)}
          >
            <Trash2 className="size-3.5" /> {t('action.delete', { ns: 'common' })}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* New item input (shown as first child of this directory) */}
      {isDir && node.expanded && safeEditState.newItemParent === node.path && (
        <InlineInput
          defaultValue={safeEditState.newItemType === 'file' ? 'untitled' : 'new-folder'}
          depth={depth + 1}
          icon={
            safeEditState.newItemType === 'file' ? (
              <File className="size-3.5 text-muted-foreground/60" />
            ) : (
              <Folder className="size-3.5 text-sky-500 dark:text-sky-400" />
            )
          }
          onConfirm={actions.onNewItemConfirm}
          onCancel={actions.onNewItemCancel}
        />
      )}

      {/* Children */}
      <AnimatePresence>
        {isDir && node.expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {node.children?.length ? (
              node.children.map((child) => (
                <TreeItem
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  activePath={activePath}
                  onToggle={onToggle}
                  editState={editState}
                  actions={actions}
                  agentSurface={agentSurface}
                />
              ))
            ) : (
              <div
                className="relative py-1 pl-8 text-[11px] text-muted-foreground/45"
                style={{ paddingLeft: `${(depth + 1) * 14 + 18}px` }}
              >
                <DepthGuides depth={depth + 1} />
                <span className="relative">{t('fileTree.empty')}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

