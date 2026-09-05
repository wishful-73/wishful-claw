import * as React from 'react'
import { cn } from '@renderer/lib/utils'
import { type FileAwareEditorHandle, type FileAwareEditorProps, renderDocument, isSameDocument, parseDomToDocument, getSelectionOffsets, setSelectionFromPoint, setSelectionOffsets, editorDocumentToPlainText } from './file-aware-editor-utils'
import { EditorSelectionOffsets } from './file-aware-editor-utils'
import { isImeTailAheadOfState } from './file-aware-editor-ime'

export const FileAwareEditor = React.forwardRef<FileAwareEditorHandle, FileAwareEditorProps>(
  function FileAwareEditor(
    {
      document,
      files,
      disabled = false,
      placeholder,
      suggestionText,
      showSuggestion = false,
      highlightedFileId,
      onDocumentChange,
      onSelectionChange,
      onFocus,
      onBlur,
      onKeyDown,
      onPaste,
      onUserEdit,
      onCompositionStart,
      onCompositionEnd,
      onReferencePreview,
      onReferenceLocate,
      onReferenceDelete,
      className
    },
    ref
  ) {
    const editorRef = React.useRef<HTMLDivElement>(null)
    const suggestionOverlayRef = React.useRef<HTMLDivElement>(null)
    const selectionRef = React.useRef<EditorSelectionOffsets>({ start: 0, end: 0 })
    const focusedRef = React.useRef(false)
    const selectionSyncFrameRef = React.useRef<number | null>(null)
    const documentSyncFrameRef = React.useRef<number | null>(null)
    const compositionEndRafRef = React.useRef<number | null>(null)
    const isComposingRef = React.useRef(false)
    const pendingUserInputRef = React.useRef(false)
    const pendingRenderAfterCompositionRef = React.useRef(false)
    // 仅在 compositionend 之后为 true，用来把 IME 末字符保护限定在结算窗口内。
    // 不设窗口会误伤「发送后清空输入框」这类 state 变短的程序化重置。
    const imeSettleWindowRef = React.useRef(false)
    const flushDocumentSyncRef = React.useRef<(() => void) | null>(null)
    const [compositionRenderVersion, bumpCompositionRenderVersion] = React.useReducer(
      (version: number) => version + 1,
      0
    )
    const [hasLiveContent, setHasLiveContent] = React.useState(false)
    const handlersRef = React.useRef<
      Pick<FileAwareEditorProps, 'onReferencePreview' | 'onReferenceLocate' | 'onReferenceDelete'>
    >({})
    const lastRenderedHighlightRef = React.useRef<string | null | undefined>(undefined)

    React.useEffect(() => {
      handlersRef.current = {
        onReferencePreview,
        onReferenceLocate,
        onReferenceDelete
      }
    }, [onReferenceDelete, onReferenceLocate, onReferencePreview])

    const syncLiveContent = React.useCallback(() => {
      const root = editorRef.current
      if (!root) return
      const liveDocument = parseDomToDocument(root)
      const livePlainText = editorDocumentToPlainText(liveDocument, files)
      setHasLiveContent(livePlainText.length > 0)
    }, [files])

    const syncSelection = React.useCallback(() => {
      const root = editorRef.current
      if (!root) return selectionRef.current
      const selection = getSelectionOffsets(root, files, selectionRef.current)
      selectionRef.current = selection
      onSelectionChange?.(selection)
      return selection
    }, [files, onSelectionChange])

    const scheduleSelectionSync = React.useCallback(() => {
      if (selectionSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionSyncFrameRef.current)
      }
      selectionSyncFrameRef.current = window.requestAnimationFrame(() => {
        selectionSyncFrameRef.current = null
        syncSelection()
      })
    }, [syncSelection])


    React.useEffect(() => {
      const handleSelectionChange = (): void => {
        const root = editorRef.current
        const selection = window.getSelection()
        if (!root || !selection || selection.rangeCount === 0) return
        const range = selection.getRangeAt(0)
        if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return
        scheduleSelectionSync()
      }

      window.document.addEventListener('selectionchange', handleSelectionChange)
      return () => {
        window.document.removeEventListener('selectionchange', handleSelectionChange)
        if (selectionSyncFrameRef.current !== null) {
          window.cancelAnimationFrame(selectionSyncFrameRef.current)
        }
        if (documentSyncFrameRef.current !== null) {
          window.cancelAnimationFrame(documentSyncFrameRef.current)
        }
        if (compositionEndRafRef.current !== null) {
          window.cancelAnimationFrame(compositionEndRafRef.current)
        }
      }
    }, [scheduleSelectionSync])

    const flushDocumentSync = React.useCallback(() => {
      const root = editorRef.current
      if (!root) return
      const nextDocument = parseDomToDocument(root)
      if (!isSameDocument(nextDocument, document)) {
        onDocumentChange(nextDocument)
      }
    }, [document, onDocumentChange])

    flushDocumentSyncRef.current = flushDocumentSync

    React.useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          const root = editorRef.current
          if (!root) return
          root.focus()
          focusedRef.current = true
          const selection = window.getSelection()
          const hasEditorSelection =
            selection &&
            selection.rangeCount > 0 &&
            root.contains(selection.getRangeAt(0).startContainer) &&
            root.contains(selection.getRangeAt(0).endContainer)
          if (!hasEditorSelection) {
            setSelectionOffsets(root, selectionRef.current.start, selectionRef.current.end)
          }
        },
        focusAtEnd: () => {
          const root = editorRef.current
          if (!root) return
          root.focus()
          focusedRef.current = true
          const plainText = editorDocumentToPlainText(document, files)
          selectionRef.current = { start: plainText.length, end: plainText.length }
          setSelectionOffsets(root, plainText.length, plainText.length)
          onSelectionChange?.(selectionRef.current)
        },
        setSelectionOffsets: (start, end = start) => {
          const root = editorRef.current
          if (!root) return
          selectionRef.current = { start, end }
          setSelectionOffsets(root, start, end)
          onSelectionChange?.(selectionRef.current)
        },
        getSelectionOffsets: () => {
          const root = editorRef.current
          if (!root) return selectionRef.current
          return getSelectionOffsets(root, files, selectionRef.current)
        },
        getDocumentSnapshot: () => {
          const root = editorRef.current
          if (!root) return document
          return parseDomToDocument(root)
        },
        flushPendingInput: () => {
          if (documentSyncFrameRef.current !== null) {
            window.cancelAnimationFrame(documentSyncFrameRef.current)
            documentSyncFrameRef.current = null
          }
          if (compositionEndRafRef.current !== null) {
            window.cancelAnimationFrame(compositionEndRafRef.current)
            compositionEndRafRef.current = null
          }
          isComposingRef.current = false
          pendingRenderAfterCompositionRef.current = false
          pendingUserInputRef.current = false
          imeSettleWindowRef.current = false
          flushDocumentSyncRef.current?.()
        },
        getScrollMetrics: () => {
          const root = editorRef.current
          return {
            scrollHeight: root?.scrollHeight ?? 0,
            clientHeight: root?.clientHeight ?? 0
          }
        },
        scrollToReference: (fileId: string) => {
          const root = editorRef.current
          if (!root) return false
          const target = root.querySelector(
            `[data-file-id="${CSS.escape(fileId)}"]`
          ) as HTMLElement | null
          if (!target) return false
          target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          return true
        }
      }),
      [document, files, onSelectionChange]
    )

    React.useLayoutEffect(() => {
      const root = editorRef.current
      if (!root) return

      if (isComposingRef.current) {
        pendingRenderAfterCompositionRef.current = true
        return
      }

      if (pendingUserInputRef.current) {
        return
      }

      const currentDocument = parseDomToDocument(root)
      const highlightChanged = lastRenderedHighlightRef.current !== highlightedFileId
      const shouldRender = highlightChanged || !isSameDocument(currentDocument, document)

      if (!shouldRender) {
        imeSettleWindowRef.current = false
        return
      }

      if (
        imeSettleWindowRef.current &&
        isImeTailAheadOfState(root, currentDocument, document, files)
      ) {
        // 采纳 DOM：把末字符回写进 state。若本次还有 highlight 变化，回写引发的
        // 重渲染会再进一趟本 effect，那时 state 已与 DOM 一致，正常走 renderDocument。
        imeSettleWindowRef.current = false
        flushDocumentSyncRef.current?.()
        return
      }

      imeSettleWindowRef.current = false
      renderDocument(root, document, files, {
        ...handlersRef.current,
        highlightedFileId
      })
      lastRenderedHighlightRef.current = highlightedFileId
      syncLiveContent()

      if (!focusedRef.current) return
      const selection = selectionRef.current
      setSelectionOffsets(root, selection.start, selection.end)
    }, [compositionRenderVersion, document, files, highlightedFileId, syncLiveContent])

    const scheduleDocumentSync = React.useCallback(() => {
      if (documentSyncFrameRef.current !== null) return
      documentSyncFrameRef.current = window.requestAnimationFrame(() => {
        documentSyncFrameRef.current = null
        if (isComposingRef.current) {
          pendingRenderAfterCompositionRef.current = true
          return
        }
        syncSelection()
        flushDocumentSync()
        pendingUserInputRef.current = false
      })
    }, [flushDocumentSync, syncSelection])

    const handleInput = React.useCallback(
      (event: React.FormEvent<HTMLDivElement>) => {
        onUserEdit?.()
        const nativeEvent = event.nativeEvent as Event & {
          inputType?: string
          isComposing?: boolean
        }
        const isCompositionInput =
          nativeEvent.isComposing === true ||
          nativeEvent.inputType === 'insertCompositionText' ||
          nativeEvent.inputType === 'deleteCompositionText'
        pendingUserInputRef.current = true
        if (isCompositionInput) isComposingRef.current = true
        syncLiveContent()
        if (isComposingRef.current) return
        scheduleDocumentSync()
      },
      [onUserEdit, scheduleDocumentSync, syncLiveContent]
    )

    const handleBeforeInput = React.useCallback((event: React.FormEvent<HTMLDivElement>) => {
      onUserEdit?.()
      const nativeEvent = event.nativeEvent as Event & {
        inputType?: string
        isComposing?: boolean
      }
      const isCompositionInput =
        nativeEvent.isComposing === true ||
        nativeEvent.inputType === 'insertCompositionText' ||
        nativeEvent.inputType === 'deleteCompositionText'
      pendingUserInputRef.current = true
      if (isCompositionInput) isComposingRef.current = true
      syncLiveContent()
      if (!isComposingRef.current) scheduleDocumentSync()
    }, [onUserEdit, scheduleDocumentSync, syncLiveContent])

    const handleCompositionStartInternal = React.useCallback(
      (event: React.CompositionEvent<HTMLDivElement>) => {
        onUserEdit?.()
        isComposingRef.current = true
        imeSettleWindowRef.current = false
        if (documentSyncFrameRef.current !== null) {
          window.cancelAnimationFrame(documentSyncFrameRef.current)
          documentSyncFrameRef.current = null
        }
        pendingUserInputRef.current = true
        syncLiveContent()
        onCompositionStart?.(event)
      },
      [onCompositionStart, onUserEdit, syncLiveContent]
    )

    const handleCompositionUpdateInternal = React.useCallback(() => {
      onUserEdit?.()
      pendingRenderAfterCompositionRef.current = true
      syncLiveContent()
    }, [onUserEdit, syncLiveContent])

    const scheduleCompositionSettle = React.useCallback(() => {
      if (documentSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(documentSyncFrameRef.current)
        documentSyncFrameRef.current = null
      }
      if (compositionEndRafRef.current !== null) {
        window.cancelAnimationFrame(compositionEndRafRef.current)
      }
      imeSettleWindowRef.current = true
      compositionEndRafRef.current = window.requestAnimationFrame(() => {
        syncLiveContent()
        flushDocumentSync()
        scheduleSelectionSync()
        // 挡板再留一帧。Windows 部分输入法在 compositionend 之后才把末字符写进
        // DOM，同帧解除挡板会让紧随其后的布局 effect 按落后的 state 重建 DOM。
        compositionEndRafRef.current = window.requestAnimationFrame(() => {
          compositionEndRafRef.current = null
          isComposingRef.current = false
          pendingUserInputRef.current = false
          if (pendingRenderAfterCompositionRef.current) {
            pendingRenderAfterCompositionRef.current = false
            bumpCompositionRenderVersion()
          }
        })
      })
    }, [flushDocumentSync, scheduleSelectionSync, syncLiveContent])

    const scheduleCompositionCommit = React.useCallback(
      (event: React.CompositionEvent<HTMLDivElement>) => {
        onUserEdit?.()
        pendingUserInputRef.current = true
        onCompositionEnd?.(event)
        scheduleCompositionSettle()
      },
      [onCompositionEnd, onUserEdit, scheduleCompositionSettle]
    )

    const handleCompositionEndInternal = React.useCallback(
      (event: React.CompositionEvent<HTMLDivElement>) => {
        scheduleCompositionCommit(event)
      },
      [scheduleCompositionCommit]
    )

    React.useEffect(() => {
      const root = editorRef.current
      if (!root) return
      const handleCompositionCancel = (): void => {
        onUserEdit?.()
        scheduleCompositionSettle()
      }
      root.addEventListener('compositioncancel', handleCompositionCancel)
      return () => {
        root.removeEventListener('compositioncancel', handleCompositionCancel)
      }
    }, [onUserEdit, scheduleCompositionSettle])

    const plainText = React.useMemo(
      () => editorDocumentToPlainText(document, files),
      [document, files]
    )
    const hasContent = document.length > 0 && plainText.length > 0
    const showPlaceholder = !hasContent && !hasLiveContent && Boolean(placeholder)

    return (
      <div className={cn('relative flex min-h-0 min-w-0 flex-col overflow-hidden', className)}>
        {showPlaceholder && (
          <div className="composer-editor-placeholder pointer-events-none absolute inset-0 p-2 pb-12 pr-3 text-base md:text-sm">
            {placeholder}
          </div>
        )}
        {showSuggestion && suggestionText && plainText.length > 0 && (
          <div
            ref={suggestionOverlayRef}
            className="composer-editor-suggestion pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-2 pb-12 pr-3 text-base md:text-sm"
          >
            <span className="invisible">{plainText}</span>
            <span>{suggestionText}</span>
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          spellCheck={false}
          data-gramm="false"
          className="composer-editor-content block min-h-[60px] min-w-0 max-h-full flex-1 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words p-2 pb-12 pr-3 text-base outline-none md:text-sm"
          style={{ scrollbarGutter: 'stable' }}
          onBeforeInput={handleBeforeInput}
          onInput={handleInput}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => {
            focusedRef.current = true
            onFocus?.()
            scheduleSelectionSync()
          }}
          onBlur={() => {
            focusedRef.current = false
            // 失焦时 compositionend 可能不触发（Windows 上点走会吞掉），挡板卡在
            // true 会让布局 effect 永久早退、编辑器不再反映任何 prop 变化。复位前
            // 若仍在结算窗口，先把 DOM 里已上屏的末字符收进 state，避免失焦丢字。
            if (imeSettleWindowRef.current) {
              imeSettleWindowRef.current = false
              flushDocumentSyncRef.current?.()
            }
            isComposingRef.current = false
            pendingUserInputRef.current = false
            onBlur?.()
          }}
          onClick={() => {
            scheduleSelectionSync()
          }}
          onKeyUp={() => {
            scheduleSelectionSync()
          }}
          onMouseDown={(event) => {
            if (event.button !== 2) return
            setSelectionFromPoint(event.currentTarget, event.clientX, event.clientY)
            scheduleSelectionSync()
          }}
          onDragOver={(event) => {
            if (disabled) return
            if (setSelectionFromPoint(event.currentTarget, event.clientX, event.clientY)) {
              syncSelection()
            }
          }}
          onDrop={(event) => {
            if (disabled) return
            if (setSelectionFromPoint(event.currentTarget, event.clientX, event.clientY)) {
              syncSelection()
            }
          }}
          onMouseUp={() => {
            scheduleSelectionSync()
          }}
          onContextMenu={(event) => {
            setSelectionFromPoint(event.currentTarget, event.clientX, event.clientY)
            scheduleSelectionSync()
          }}
          onScroll={(event) => {
            if (!suggestionOverlayRef.current) return
            suggestionOverlayRef.current.scrollTop = event.currentTarget.scrollTop
            suggestionOverlayRef.current.scrollLeft = event.currentTarget.scrollLeft
          }}
          onCompositionStart={handleCompositionStartInternal}
          onCompositionUpdate={handleCompositionUpdateInternal}
          onCompositionEnd={handleCompositionEndInternal}
          role="textbox"
          aria-multiline="true"
        />
      </div>
    )
  }
)
