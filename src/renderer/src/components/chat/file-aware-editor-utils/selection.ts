import {
  editorDocumentToPlainText,
  type SelectedFileItem
} from '@renderer/lib/select-file-editor'
import { collectTextContent, parseDomToDocument, pastedTextOf } from './dom'
import type { EditorSelectionOffsets } from './types'

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

export function setSelectionFromPoint(
  root: HTMLDivElement,
  clientX: number,
  clientY: number
): boolean {
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
        if (
          element.matches('[data-file-ref="true"], [data-plugin-ref="true"], [data-pasted-ref="true"]')
        ) {
          // A collapsed paste occupies its whole verbatim text in the plain-text
          // layer, but only a caption in the DOM — the length must come from the
          // payload map, not from the attribute.
          const chipText =
            element.dataset.pastedRef === 'true'
              ? pastedTextOf(element) ?? element.dataset.fallbackText ?? ''
              : element.dataset.fallbackText || ''
          const nextCursor = cursor + chipText.length
          const parent = element.parentNode || root
          const index = Array.from(parent.childNodes).indexOf(element)
          if (target <= nextCursor) {
            const offset = target - cursor <= chipText.length / 2 ? index : index + 1
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
