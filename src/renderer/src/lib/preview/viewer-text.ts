/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License");
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

/**
 * 预览器文案（S-148）。
 *
 * 13 个 viewer 的「加载中 / 读失败 / iframe title」原本全是硬编码英文，这里统一走
 * `layout` 命名空间的 `preview.*`。
 *
 * 取词走 `translateOr` 而不是 `i18n.t`：`initializeI18n()` 是异步的，解析前 `t` 会返回
 * `undefined`，命名空间未加载完又会返回裸 key，两种都会漏到界面上。带英文兜底就等于
 * 改动前的行为。
 *
 * 用 i18n 实例而不是 `useTranslation` 的 `t`：多数文案发生在读文件的 effect 回调里，
 * 用 `t` 就得把它塞进依赖数组，换一次语言会白重读一遍文件（PDF 动辄几 MB）。
 * 渲染处的文案也跟着父组件重渲染重新求值，语言切换照常生效。
 */

import { translateOr } from '@renderer/lib/i18n-text'

/** i18n 未就绪时的英文兜底，与改动前的硬编码文案逐字一致。 */
const FALLBACKS: Record<string, string> = {
  docxCompatibilityHint:
    'This DOCX document is rendered in compatibility mode; complex formatting may be incomplete.',
  loadingPdf: 'Loading PDF...',
  loadingDocument: 'Loading document...',
  loadingSpreadsheet: 'Loading spreadsheet...',
  loadingImage: 'Loading image...',
  loadingAudio: 'Loading audio...',
  loadingVideo: 'Loading video...',
  loadingFont: 'Loading font...',
  loadingGeneric: 'Loading...',
  failReadFile: 'Failed to read file',
  failReadImage: 'Failed to read image file',
  failReadAudio: 'Failed to read audio file',
  failReadVideo: 'Failed to read video file',
  failReadFont: 'Failed to read font file',
  failParsePdf: 'Could not parse the PDF; the file may be corrupted or encrypted.',
  titlePdf: 'PDF preview',
  titleHtml: 'HTML preview',
  titleSvg: 'SVG preview',
  titleDevServer: 'Dev server preview',
  titleOffice: 'Microsoft Office preview',
  mermaidRenderFailed: 'Mermaid render failed',
  loadingDiagram: 'Rendering diagram...',
  binaryFileHint: 'Use the system app when you need to inspect or extract this file.',
  officeNeedsPublicUrl: 'Document preview needs a public URL',
  officeOnlineHint:
    'Microsoft Office online preview can only load Office-like documents from a reachable HTTPS URL. Local and SSH files are not sent online automatically.',
  officePrivateHint: 'Use local preview or open the file in the system app for private documents.',
  openInSystemApp: 'Open in system app'
}

export function viewerText(key: string): string {
  return translateOr(`preview.${key}`, { ns: 'layout' }, FALLBACKS[key] ?? key)
}
