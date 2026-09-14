import type { EditorDocumentNode, SelectedFileItem } from '@renderer/lib/select-file-editor'
import { appendTextContent, buildFileChip, buildPastedChip, buildPluginChip } from './chips'
import type { FileAwareEditorProps } from './types'

/**
 * Verbatim text of collapsed pastes, keyed by node id.
 *
 * Kept out of the DOM on purpose: a long paste can be hundreds of kilobytes and
 * does not belong in an attribute. `renderDocument` refills it, and both
 * `parseDomToDocument` and `collectTextContent` read it back so the DOM and the
 * document state agree on what a chip contributes to the plain text.
 *
 * Deliberately append-only: several editors can be mounted at once and share
 * this module, so clearing it on render would silently drop another editor's
 * chips. Ids are nanoid-unique, so stale entries are only a little memory.
 */
const pastedBlockTextById = new Map<string, string>()

export function pastedTextOf(element: HTMLElement): string | undefined {
  const nodeId = element.dataset.nodeId
  return nodeId ? pastedBlockTextById.get(nodeId) : undefined
}

export function renderDocument(
  root: HTMLDivElement,
  documentNodes: EditorDocumentNode[],
  files: SelectedFileItem[],
  props: Pick<
    FileAwareEditorProps,
    | 'onReferencePreview'
    | 'onReferenceLocate'
    | 'onReferenceDelete'
    | 'onPastedBlockExpand'
    | 'highlightedFileId'
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

    if (node.type === 'pasted') {
      pastedBlockTextById.set(node.id, node.text)
      root.append(buildPastedChip(node, props), document.createTextNode(''))
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

  if (element.matches('[data-pasted-ref="true"]')) {
    return pastedTextOf(element) ?? element.dataset.fallbackText ?? ''
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

    if (leftNode?.type === 'pasted' && rightNode?.type === 'pasted') {
      if (
        leftNode.id !== rightNode.id ||
        leftNode.label !== rightNode.label ||
        leftNode.text !== rightNode.text
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

    if (element.matches('[data-pasted-ref="true"]')) {
      const nodeId = element.dataset.nodeId
      const label = element.dataset.label || ''
      const text = pastedTextOf(element)
      // Without the verbatim text the chip would deserialize into nothing and
      // silently vanish, so keep it only when the payload is actually known.
      if (nodeId && text != null) {
        nextDocument.push({ type: 'pasted', id: nodeId, label, text })
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
