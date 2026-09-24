/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { useState, useEffect } from 'react'
import { FileText, ChevronLeft, ChevronRight } from 'lucide-react'
// @ts-ignore - react-pdf is an optional dependency
import { Document, Page, pdfjs } from 'react-pdf'
import { Button } from '@renderer/components/ui/button'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import type { ViewerProps } from '../viewer-registry'
import { viewerText } from '../viewer-text'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// Configure pdf.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+/i.test(value)
}

export function PdfViewer({
  filePath,
  sshConnectionId,
  fileVersion
}: ViewerProps): React.JSX.Element {
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadedFilePath, setLoadedFilePath] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    if (isHttpUrl(filePath)) return

    let cancelled = false

    const channel = sshConnectionId ? IPC.SSH_FS_READ_FILE_BINARY : IPC.FS_READ_FILE_BINARY
    const args = sshConnectionId
      ? { connectionId: sshConnectionId, path: filePath }
      : { path: filePath }
    ipcClient.invoke(channel, args).then((raw: unknown) => {
      if (cancelled) return
      const result = raw as { data?: string; error?: string }
      if (result.error || !result.data) {
        const readFailed = viewerText('failReadFile')
        setError(result.error ? `${readFailed}: ${result.error}` : readFailed)
        setLoading(false)
        setLoadedFilePath(filePath)
        return
      }
      try {
        const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0))
        if (!cancelled) {
          setPdfData(bytes)
          setError(null)
          setLoading(false)
          setLoadedFilePath(filePath)
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err))
          setLoading(false)
          setLoadedFilePath(filePath)
        }
      }
    })

    return () => {
      cancelled = true
    }
  }, [filePath, fileVersion, sshConnectionId])

  if (isHttpUrl(filePath)) {
    return (
      <iframe
        className="size-full border-0 bg-white"
        src={filePath}
        title={viewerText('titlePdf')}
      />
    )
  }

  const onDocumentLoadSuccess = ({ numPages: n }: { numPages: number }): void => {
    setNumPages(n)
    setCurrentPage(1)
  }

  const prevPage = (): void => setCurrentPage((p) => Math.max(1, p - 1))
  const nextPage = (): void => setCurrentPage((p) => Math.min(numPages, p + 1))

  if (loading || loadedFilePath !== filePath) {
    return (
      <div className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <FileText className="size-5 animate-pulse" />
        {viewerText('loadingPdf')}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex size-full items-center justify-center text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="flex size-full flex-col">
      {/* Page navigation */}
      <div className="flex h-8 items-center justify-center gap-2 border-b px-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1"
          onClick={prevPage}
          disabled={currentPage <= 1}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground">
          {currentPage} / {numPages}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1"
          onClick={nextPage}
          disabled={currentPage >= numPages}
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>

      {/* PDF content */}
      <div className="flex-1 overflow-auto flex justify-center bg-muted/30 p-4">
        {pdfData && (
          <Document
            file={{ data: pdfData }}
            onLoadSuccess={onDocumentLoadSuccess}
            error={
              <div className="flex items-center gap-2 text-sm text-destructive">
                <FileText className="size-4" /> {viewerText('failParsePdf')}
              </div>
            }
            loading={
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="size-4 animate-pulse" /> {viewerText('loadingGeneric')}
              </div>
            }
          >
            <Page
              pageNumber={currentPage}
              renderTextLayer={true}
              renderAnnotationLayer={true}
              className="shadow-lg"
            />
          </Document>
        )}
      </div>
    </div>
  )
}
