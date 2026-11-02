/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

// Imported piecemeal on purpose: `monaco-editor`'s own entry (editor.main.js) pulls in the
// json / css / html / typescript language services, whose workerManager.js spawns
// `new Worker(new URL('ts.worker.js', import.meta.url))` — Vite bundles those four workers
// unconditionally, 16.4 MB of code no screen in this app ever asks for (S-302).
// editor.api + editor.all is the official "editor only, no language services" pair; the
// basic-languages entry registers every syntax definition lazily (monarch, main thread, no worker).
import { loader } from '@monaco-editor/react'
import * as localMonaco from 'monaco-editor/esm/vs/editor/editor.api'
import 'monaco-editor/esm/vs/editor/editor.all'
import 'monaco-editor/esm/vs/basic-languages/_.contribution'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

let initialized = false

loader.config({ monaco: localMonaco })

export function initializeMonaco(): void {
  if (initialized) return
  initialized = true

  const monacoGlobal = globalThis as typeof globalThis & {
    MonacoEnvironment?: {
      getWorker: (_workerId: string | undefined, label: string) => Worker
    }
  }

  monacoGlobal.MonacoEnvironment = {
    getWorker() {
      return new editorWorker()
    }
  }
}
