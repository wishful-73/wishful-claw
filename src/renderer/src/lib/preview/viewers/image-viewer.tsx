/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import * as React from 'react'
import { ZoomIn, ZoomOut, RotateCw, Maximize2, ImageOff, Copy, Check, Loader2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { writeImageBlobToClipboard } from '@renderer/lib/utils/image-clipboard'
import type { ViewerProps } from '../viewer-registry'

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.pjpeg': 'image/jpeg',
  '.pjp': 'image/jpeg',
  '.gif': 'image/gif',
  '.apng': 'image/apng',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.cur': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.jxl': 'image/jxl'
}

function getMimeType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

function clampScale(scale: number): number {
  return Math.min(Math.max(scale, 0.25), 5)
}

export function ImageViewer({
  filePath,
  sshConnectionId,
  fileVersion
}: ViewerProps): React.JSX.Element {
  const [scale, setScale] = React.useState(1)
  const [rotation, setRotation] = React.useState(0)
  const [offset, setOffset] = React.useState({ x: 0, y: 0 })
  const [src, setSrc] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [isPanning, setIsPanning] = React.useState(false)
  const [isCopying, setIsCopying] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const imageRef = React.useRef<HTMLImageElement | null>(null)
  const panStartRef = React.useRef<{
    x: number
    y: number
    offsetX: number
    offsetY: number
  } | null>(null)
  const copiedTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    setSrc(null)
    setError(null)
    setScale(1)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
    setIsPanning(false)
    setCopied(false)

    const channel = sshConnectionId ? IPC.SSH_FS_READ_FILE_BINARY : IPC.FS_READ_FILE_BINARY
    const args = sshConnectionId
      ? { connectionId: sshConnectionId, path: filePath }
      : { path: filePath }
    ipcClient.invoke(channel, args).then((raw: unknown) => {
      if (cancelled) return
      const result = raw as { data?: string; error?: string }
      if (result.error || !result.data) {
        setError(result.error || 'Failed to read image file')
        return
      }
      try {
        const byteString = atob(result.data)
        const bytes = new Uint8Array(byteString.length)
        for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i)
        const blob = new Blob([bytes], { type: getMimeType(filePath) })
        objectUrl = URL.createObjectURL(blob)
        if (!cancelled) setSrc(objectUrl)
      } catch (err) {
        if (!cancelled) setError(String(err))
      }
    })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [filePath, fileVersion, sshConnectionId])

  React.useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current)
      }
    }
  }, [])

  React.useEffect(() => {
    if (!isPanning) return

    const handleMouseMove = (event: MouseEvent): void => {
      const panStart = panStartRef.current
      if (!panStart) return
      setOffset({
        x: panStart.offsetX + event.clientX - panStart.x,
        y: panStart.offsetY + event.clientY - panStart.y
      })
    }

    const handleMouseUp = (): void => {
      panStartRef.current = null
      setIsPanning(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isPanning])

  const zoomIn = (): void => setScale((current) => clampScale(current + 0.25))
  const zoomOut = (): void => setScale((current) => clampScale(current - 0.25))
  const rotate = (): void => setRotation((current) => (current + 90) % 360)
  const resetView = (): void => {
    setScale(1)
    setRotation(0)
    setOffset({ x: 0, y: 0 })
  }

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const delta = event.deltaY < 0 ? 0.1 : -0.1
    setScale((current) => clampScale(Number((current + delta).toFixed(2))))
  }

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y
    }
    setIsPanning(true)
  }

  const handleCopyImage = async (): Promise<void> => {
    if (!imageRef.current || isCopying) return

    try {
      setIsCopying(true)
      const width = imageRef.current.naturalWidth || imageRef.current.width
      const height = imageRef.current.naturalHeight || imageRef.current.height
      if (!width || !height) throw new Error('Image is not ready')

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height

      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas context unavailable')

      context.drawImage(imageRef.current, 0, 0, width, height)

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => {
          if (value) {
            resolve(value)
            return
          }
          reject(new Error('Failed to export image'))
        }, 'image/png')
      })

      await writeImageBlobToClipboard(blob)

      setCopied(true)
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current)
      }
      copiedTimerRef.current = window.setTimeout(() => {
        setCopied(false)
      }, 1500)
    } catch (err) {
      console.error('[ImageViewer] Copy image failed:', err)
    } finally {
      setIsCopying(false)
    }
  }

  if (error) {
    return (
      <div className="flex size-full items-center justify-center gap-2 text-sm text-destructive">
        <ImageOff className="size-5" />
        {error}
      </div>
    )
  }

  if (!src) {
    return (
      <div className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
        Loading image...
      </div>
    )
  }

  return (
    <div className="flex size-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b px-3 py-1">
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px]" onClick={zoomOut}>
          <ZoomOut className="size-3" />
        </Button>
        <span className="min-w-[3rem] text-center text-[10px] text-muted-foreground">
          {Math.round(scale * 100)}%
        </span>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px]" onClick={zoomIn}>
          <ZoomIn className="size-3" />
        </Button>
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px]" onClick={rotate}>
          <RotateCw className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-[10px]"
          onClick={resetView}
        >
          <Maximize2 className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-[10px]"
          onClick={handleCopyImage}
          disabled={isCopying}
          title={copied ? 'Copied' : 'Copy image to clipboard'}
          aria-label={copied ? 'Copied' : 'Copy image to clipboard'}
        >
          {isCopying ? (
            <Loader2 className="size-3 animate-spin" />
          ) : copied ? (
            <Check className="size-3 text-green-500" />
          ) : (
            <Copy className="size-3" />
          )}
        </Button>
        <div className="flex-1" />
        <span className="truncate text-[10px] text-muted-foreground/50">
          {filePath.split(/[\\/]/).pop()}
        </span>
      </div>

      {/* Image display */}
      <div
        className="flex flex-1 items-center justify-center overflow-hidden bg-[repeating-conic-gradient(hsl(var(--muted))_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] select-none"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      >
        <div
          className="flex items-center justify-center"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        >
          <img
            ref={imageRef}
            src={src}
            alt={filePath.split(/[\\/]/).pop() || ''}
            className="max-w-none transition-transform duration-200 will-change-transform"
            onError={() => setError('This image format is not supported by the embedded preview.')}
            style={{
              transform: `scale(${scale}) rotate(${rotation}deg)`
            }}
            draggable={false}
          />
        </div>
      </div>
    </div>
  )
}
