import * as React from 'react'
import { cn } from '@renderer/lib/utils'
import {
  editorDocumentToPlainText,
  type EditorDocumentNode,
  type EditorFileNode,
  type EditorPluginNode,
  type SelectedFileItem
} from '@renderer/lib/select-file-editor'

export interface EditorSelectionOffsets {
  start: number
  end: number
}

export interface FileAwareEditorHandle {
  focus: () => void
  focusAtEnd: () => void
  setSelectionOffsets: (start: number, end?: number) => void
  getSelectionOffsets: () => EditorSelectionOffsets
  getDocumentSnapshot: () => EditorDocumentNode[]
  /** Commit the current DOM before an action that resets or submits the editor. */
  flushPendingInput: () => void
  getScrollMetrics: () => { scrollHeight: number; clientHeight: number }
  scrollToReference: (fileId: string) => boolean
}

export interface FileAwareEditorProps {
  document: EditorDocumentNode[]
  files: SelectedFileItem[]
  disabled?: boolean
  placeholder?: string
  suggestionText?: string
  showSuggestion?: boolean
  highlightedFileId?: string | null
  onDocumentChange: (document: EditorDocumentNode[]) => void
  onSelectionChange?: (selection: EditorSelectionOffsets) => void
  onFocus?: () => void
  onBlur?: () => void
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
  onPaste?: React.ClipboardEventHandler<HTMLDivElement>
  onUserEdit?: () => void
  onCompositionStart?: React.CompositionEventHandler<HTMLDivElement>
  onCompositionEnd?: React.CompositionEventHandler<HTMLDivElement>
  onReferencePreview?: (fileId: string) => void
  onReferenceLocate?: (fileId: string) => void
  onReferenceDelete?: (nodeId: string) => void
  className?: string
}

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

export function renderDocument(
  root: HTMLDivElement,
  documentNodes: EditorDocumentNode[],
  files: SelectedFileItem[],
  props: Pick<
    FileAwareEditorProps,
    'onReferencePreview' | 'onReferenceLocate' | 'onReferenceDelete' | 'highlightedFileId'
  >
): void {
  root.replaceChildren()

  for (const node of documentNodes) {
    if (node.type === 'text') {
      appendTextContent(root, node.text)
      continue
    }

    if (node.type === 'file') {
      const file = files.find((item) => item.id === node.fileId)
      root.append(
        buildFileChip(node, file, props, props.highlightedFileId),
        document.createTextNode('')
      )
      continue
    }

    root.append(buildPluginChip(node, props), document.createTextNode(''))
  }

  if (documentNodes.length === 0) {
    root.append(document.createElement('br'))
  }
}

export function collectTextContent(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || ''
  }

  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    return Array.from(node.childNodes).map(collectTextContent).join('')
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ''
  }

  const element = node as HTMLElement
  if (element.matches('[data-file-ref="true"]')) {
    return element.dataset.fallbackText || ''
  }

  if (element.matches('[data-plugin-ref="true"]')) {
    return element.dataset.fallbackText || ''
  }

  if (element.tagName === 'BR') {
    return '\n'
  }

  return Array.from(element.childNodes).map(collectTextContent).join('')
}

export function isSameDocument(left: EditorDocumentNode[], right: EditorDocumentNode[]): boolean {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftNode = left[index]
    const rightNode = right[index]
    if (leftNode?.type !== rightNode?.type) return false

    if (leftNode?.type === 'text' && rightNode?.type === 'text') {
      if (leftNode.text !== rightNode.text) return false
      continue
    }

    if (leftNode?.type === 'file' && rightNode?.type === 'file') {
      if (
        leftNode.id !== rightNode.id ||
        leftNode.fileId !== rightNode.fileId ||
        leftNode.fallbackText !== rightNode.fallbackText
      ) {
        return false
      }
    }

    if (leftNode?.type === 'plugin' && rightNode?.type === 'plugin') {
      if (
        leftNode.id !== rightNode.id ||
        leftNode.pluginId !== rightNode.pluginId ||
        leftNode.label !== rightNode.label ||
        leftNode.prompt !== rightNode.prompt
      ) {
        return false
      }
    }
  }

  return true
}

export function parseDomToDocument(root: HTMLDivElement): EditorDocumentNode[] {
  if (
    root.childNodes.length === 1 &&
    root.firstChild?.nodeType === Node.ELEMENT_NODE &&
    (root.firstChild as Element).tagName === 'BR'
  ) {
    return []
  }

  const nextDocument: EditorDocumentNode[] = []

  const appendText = (text: string): void => {
    if (!text) return
    const last = nextDocument[nextDocument.length - 1]
    if (last?.type === 'text') {
      last.text += text
      return
    }
    nextDocument.push({ type: 'text', id: crypto.randomUUID(), text })
  }

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.textContent || '')
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return

    const element = node as HTMLElement
    if (element.matches('[data-file-ref="true"]')) {
      const fileId = element.dataset.fileId
      const nodeId = element.dataset.nodeId
      const fallbackText = element.dataset.fallbackText || ''
      if (fileId && nodeId) {
        nextDocument.push({
          type: 'file',
          id: nodeId,
          fileId,
          fallbackText
        })
      }
      return
    }

    if (element.matches('[data-plugin-ref="true"]')) {
      const nodeId = element.dataset.nodeId
      const pluginId = element.dataset.pluginId
      const label = element.dataset.label || pluginId || ''
      const prompt = element.dataset.prompt || ''
      if (nodeId && pluginId && prompt) {
        nextDocument.push({
          type: 'plugin',
          id: nodeId,
          pluginId,
          label,
          prompt
        })
      }
      return
    }

    if (element.tagName === 'BR') {
      appendText('\n')
      return
    }

    Array.from(element.childNodes).forEach(visit)
    if (element !== root && /^(DIV|P|LI)$/.test(element.tagName)) {
      appendText('\n')
    }
  }

  Array.from(root.childNodes).forEach(visit)

  return nextDocument.filter((node) => node.type !== 'text' || node.text.length > 0)
}

export function getSelectionOffsets(
  root: HTMLDivElement,
  files: SelectedFileItem[],
  fallback?: EditorSelectionOffsets
): EditorSelectionOffsets {
  const plainText = editorDocumentToPlainText(parseDomToDocument(root), files)
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return fallback ?? { start: plainText.length, end: plainText.length }
  }

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return fallback ?? { start: plainText.length, end: plainText.length }
  }

  const toOffset = (container: Node, offset: number): number => {
    const tempRange = document.createRange()
    tempRange.selectNodeContents(root)
    tempRange.setEnd(container, offset)
    return collectTextContent(tempRange.cloneContents()).length
  }

  return {
    start: toOffset(range.startContainer, range.startOffset),
    end: toOffset(range.endContainer, range.endOffset)
  }
}

export function setSelectionFromPoint(root: HTMLDivElement, clientX: number, clientY: number): boolean {
  const doc = root.ownerDocument
  const anyDoc = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }

  let container: Node | null = null
  let offset = 0

  const caretPosition = anyDoc.caretPositionFromPoint?.(clientX, clientY)
  if (caretPosition) {
    container = caretPosition.offsetNode
    offset = caretPosition.offset
  } else {
    const caretRange = anyDoc.caretRangeFromPoint?.(clientX, clientY)
    if (caretRange) {
      container = caretRange.startContainer
      offset = caretRange.startOffset
    }
  }

  if (!container || !root.contains(container)) return false

  const selection = doc.getSelection()
  if (!selection) return false

  const range = doc.createRange()
  range.setStart(container, offset)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

export function setSelectionOffsets(root: HTMLDivElement, start: number, end: number): void {
  const selection = window.getSelection()
  if (!selection) return

  const locate = (
    target: number
  ): {
    container: Node
    offset: number
  } => {
    let cursor = 0
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL)
    let current: Node | null = walker.nextNode()

    while (current) {
      if (current.nodeType === Node.TEXT_NODE) {
        const text = current.textContent || ''
        const nextCursor = cursor + text.length
        if (target <= nextCursor) {
          return { container: current, offset: Math.max(0, target - cursor) }
        }
        cursor = nextCursor
        current = walker.nextNode()
        continue
      }

      if (current.nodeType === Node.ELEMENT_NODE) {
        const element = current as HTMLElement
        if (element.matches('[data-file-ref="true"], [data-plugin-ref="true"]')) {
          const fallbackText = element.dataset.fallbackText || ''
          const nextCursor = cursor + fallbackText.length
          const parent = element.parentNode || root
          const index = Array.from(parent.childNodes).indexOf(element)
          if (target <= nextCursor) {
            const offset = target - cursor <= fallbackText.length / 2 ? index : index + 1
            return { container: parent, offset }
          }
          cursor = nextCursor
          current = walker.nextSibling()
          continue
        }

        if (element.tagName === 'BR') {
          const nextCursor = cursor + 1
          if (target <= nextCursor) {
            const parent = element.parentNode || root
            const index = Array.from(parent.childNodes).indexOf(element)
            return { container: parent, offset: index + 1 }
          }
          cursor = nextCursor
          current = walker.nextSibling()
          continue
        }
      }

      current = walker.nextNode()
    }

    return { container: root, offset: root.childNodes.length }
  }

  const startPoint = locate(start)
  const endPoint = locate(end)
  const range = document.createRange()
  range.setStart(startPoint.container, startPoint.offset)
  range.setEnd(endPoint.container, endPoint.offset)
  selection.removeAllRanges()
  selection.addRange(range)
}


export { editorDocumentToPlainText } from '@renderer/lib/select-file-editor'
