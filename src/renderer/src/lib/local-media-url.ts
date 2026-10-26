/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

/**
 * Build an `oc-media://` URL that streams a local file straight from disk via
 * the custom protocol registered in src/main/lib/local-media-protocol.ts. Unlike
 * fs:read-file-binary, this has no file-size limit — use it for displaying
 * local images/videos in <img>/<video> tags.
 */
export function filePathToMediaUrl(filePath: string): string {
  return `oc-media://local/${encodeURIComponent(filePath)}`
}
