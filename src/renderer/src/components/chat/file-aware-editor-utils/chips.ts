import { cn } from '@renderer/lib/utils'
import { translateOr } from '@renderer/lib/i18n-text'
import type {
  EditorFileNode,
  EditorPastedBlockNode,
  EditorPluginNode,
  SelectedFileItem
} from '@renderer/lib/select-file-editor'
import type { FileAwareEditorProps } from './types'

export function appendTextContent(target: HTMLElement, text: string): void {
  const parts = text.split('\n')
  parts.forEach((part, index) => {
    if (part) {
      target.append(document.createTextNode(part))
    }
    if (index < parts.length - 1) {
      target.append(document.createElement('br'))
    }
  })
}

export function getFileChipLabel(file: SelectedFileItem | undefined, fallbackText: string): string {
  if (file?.name) return file.name
  const normalized = fallbackText.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  return segments[segments.length - 1] || fallbackText
}

export function buildFileChip(
  node: EditorFileNode,
  file: SelectedFileItem | undefined,
  handlers: Pick<
    FileAwareEditorProps,
    'onReferencePreview' | 'onReferenceLocate' | 'onReferenceDelete'
  >,
  highlightedFileId?: string | null
): HTMLElement {
  const wrapper = document.createElement('span')
  wrapper.setAttribute('data-file-ref', 'true')
  wrapper.setAttribute('data-node-id', node.id)
  wrapper.setAttribute('data-file-id', node.fileId)
  wrapper.setAttribute('data-fallback-text', node.fallbackText)
  wrapper.setAttribute('contenteditable', 'false')
  wrapper.className = cn(
    'composer-file-ref group/file-ref mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 align-baseline text-[12px] font-medium',
    highlightedFileId && highlightedFileId === node.fileId ? 'composer-file-ref--highlighted' : ''
  )

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'inline-flex min-w-0 items-center gap-1'
  trigger.title = file?.previewPath || file?.originalPath || node.fallbackText
  trigger.addEventListener('mousedown', (event) => {
    event.preventDefault()
  })
  trigger.addEventListener('click', (event) => {
    event.preventDefault()
    handlers.onReferencePreview?.(node.fileId)
  })

  const icon = document.createElement('span')
  icon.className = 'pointer-events-none'
  const iconRoot = document.createElement('span')
  iconRoot.className = 'inline-flex items-center'
  icon.append(iconRoot)
  iconRoot.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>'
  const label = document.createElement('span')
  label.className = 'truncate max-w-[240px]'
  label.textContent = getFileChipLabel(file, node.fallbackText)
  trigger.append(icon, label)

  const actions: HTMLElement[] = []

  if (handlers.onReferenceLocate) {
    const locateBtn = document.createElement('button')
    locateBtn.type = 'button'
    locateBtn.className =
      'composer-file-ref-action inline-flex size-4 items-center justify-center rounded-sm'
    locateBtn.title = 'Locate file entry'
    locateBtn.addEventListener('mousedown', (event) => {
      event.preventDefault()
    })
    locateBtn.addEventListener('click', (event) => {
      event.preventDefault()
      handlers.onReferenceLocate?.(node.fileId)
    })
    locateBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="1"></circle><line x1="12" y1="2" x2="12" y2="5"></line><line x1="12" y1="19" x2="12" y2="22"></line><line x1="2" y1="12" x2="5" y2="12"></line><line x1="19" y1="12" x2="22" y2="12"></line></svg>'
    actions.push(locateBtn)
  }

  if (handlers.onReferenceDelete) {
    const deleteBtn = document.createElement('button')
    deleteBtn.type = 'button'
    deleteBtn.className =
      'composer-file-ref-action inline-flex size-4 items-center justify-center rounded-sm'
    deleteBtn.title = 'Delete reference'
    deleteBtn.addEventListener('mousedown', (event) => {
      event.preventDefault()
    })
    deleteBtn.addEventListener('click', (event) => {
      event.preventDefault()
      handlers.onReferenceDelete?.(node.id)
    })
    deleteBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>'
    actions.push(deleteBtn)
  }

  wrapper.append(trigger)

  if (actions.length > 0) {
    const actionsContainer = document.createElement('span')
    actionsContainer.className = 'hidden items-center gap-0.5 group-hover/file-ref:inline-flex'
    actionsContainer.append(...actions)
    wrapper.append(actionsContainer)
  }

  return wrapper
}

/**
 * Chip for a collapsed long paste. Only the caption lives in the DOM — the
 * verbatim text stays in `pastedBlockTextById` (see `dom.ts`) so a multi-hundred
 * -kilobyte paste never lands in an attribute.
 *
 * `data-fallback-text` intentionally holds the caption, matching the label the
 * plain-text layer uses as this node's token in DOM-side traversals.
 */
export function buildPastedChip(
  node: EditorPastedBlockNode,
  handlers: Pick<FileAwareEditorProps, 'onReferenceDelete' | 'onPastedBlockExpand'>
): HTMLElement {
  const wrapper = document.createElement('span')
  wrapper.setAttribute('data-pasted-ref', 'true')
  wrapper.setAttribute('data-node-id', node.id)
  wrapper.setAttribute('data-label', node.label)
  wrapper.setAttribute('data-fallback-text', node.label)
  wrapper.setAttribute('contenteditable', 'false')
  wrapper.className =
    'composer-file-ref group/file-ref mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 align-baseline text-[12px] font-medium'
  wrapper.title = node.text

  const icon = document.createElement('span')
  icon.className = 'pointer-events-none inline-flex items-center'
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>'

  const label = document.createElement('span')
  label.className = 'truncate max-w-[240px]'
  label.textContent = node.label

  wrapper.append(icon, label)

  if (handlers.onPastedBlockExpand) {
    const expandBtn = document.createElement('button')
    expandBtn.type = 'button'
    expandBtn.className =
      'pointer-events-auto inline-flex items-center rounded px-1 text-muted-foreground transition-colors hover:text-foreground'
    expandBtn.title = translateOr('input.pastedBlock.expandTitle', { ns: 'chat' }, '展开为原文')
    expandBtn.textContent = translateOr('input.pastedBlock.expand', { ns: 'chat' }, '展开')
    expandBtn.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      handlers.onPastedBlockExpand?.(node.id)
    })
    wrapper.append(expandBtn)
  }

  if (handlers.onReferenceDelete) {
    const deleteBtn = document.createElement('button')
    deleteBtn.type = 'button'
    deleteBtn.className =
      'pointer-events-auto inline-flex items-center rounded px-1 text-muted-foreground transition-colors hover:text-destructive'
    deleteBtn.title = translateOr('input.pastedBlock.remove', { ns: 'chat' }, '移除')
    deleteBtn.textContent = '×'
    deleteBtn.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      handlers.onReferenceDelete?.(node.id)
    })
    wrapper.append(deleteBtn)
  }

  return wrapper
}

export function buildPluginChip(
  node: EditorPluginNode,
  handlers: Pick<FileAwareEditorProps, 'onReferenceDelete'>
): HTMLElement {
  const wrapper = document.createElement('span')
  wrapper.setAttribute('data-plugin-ref', 'true')
  wrapper.setAttribute('data-node-id', node.id)
  wrapper.setAttribute('data-plugin-id', node.pluginId)
  wrapper.setAttribute('data-label', node.label)
  wrapper.setAttribute('data-prompt', node.prompt)
  wrapper.setAttribute('data-fallback-text', node.label || node.pluginId)
  wrapper.setAttribute('contenteditable', 'false')
  wrapper.className =
    'composer-file-ref group/file-ref mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 align-baseline text-[12px] font-medium'
  wrapper.title = node.prompt

  const icon = document.createElement('span')
  icon.className = 'pointer-events-none inline-flex items-center'
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3"><path d="M19.4 7.34 16.66 4.6a2 2 0 0 0-2.82 0l-1.08 1.08 5.56 5.56 1.08-1.08a2 2 0 0 0 0-2.82Z"></path><path d="m14.5 7.5-8 8"></path><path d="m5 19 3.5-1 8-8L14 7.5l-8 8L5 19Z"></path></svg>'

  const label = document.createElement('span')
  label.className = 'truncate max-w-[240px]'
  label.textContent = node.label || node.pluginId

  wrapper.append(icon, label)

  if (handlers.onReferenceDelete) {
    const deleteBtn = document.createElement('button')
    deleteBtn.type = 'button'
    deleteBtn.className =
      'composer-file-ref-action hidden size-4 items-center justify-center rounded-sm group-hover/file-ref:inline-flex'
    deleteBtn.title = 'Delete plugin reference'
    deleteBtn.addEventListener('mousedown', (event) => {
      event.preventDefault()
    })
    deleteBtn.addEventListener('click', (event) => {
      event.preventDefault()
      handlers.onReferenceDelete?.(node.id)
    })
    deleteBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>'
    wrapper.append(deleteBtn)
  }

  return wrapper
}
