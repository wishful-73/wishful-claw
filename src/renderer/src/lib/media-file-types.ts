/**
 * 视频扩展名 → MIME 的单一清单（S-145 §六）。
 *
 * 为什么要集中一份：判「这是不是视频 / 该用什么 MIME」的地方有三处 ——
 * 抽帧（`lib/tools/video-frames.ts`）、预览播放（`lib/preview/viewers/video-viewer.tsx`）、
 * 历史重放的图像守卫（`lib/agent/visual-context.ts`）。清单各写一份必然漂移，
 * 漂移的表现是「能播但抽不了帧」这种一半可用，最难查。
 *
 * C# 侧（`WishfulClaw.Agent/Tools/FileTools/VideoFileProbe.cs`）有一份等价清单，
 * 跨语言没法共用代码 —— `tests/WishfulClaw.ReadVideoRegressionTests` 会逐项比对两边，
 * 任何一边改了而另一边没跟，测试直接失败。
 */

export const VIDEO_MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.3gp': 'video/3gpp',
  '.3g2': 'video/3gpp2',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t'
}

export function fileExtension(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
}

export function isVideoPath(filePath: string): boolean {
  return fileExtension(filePath) in VIDEO_MIME_TYPES
}

/** 认不出的扩展名按 mp4 处理：媒体元素按内容嗅探容器，MIME 只是提示。 */
export function videoMediaTypeFor(filePath: string): string {
  return VIDEO_MIME_TYPES[fileExtension(filePath)] ?? 'video/mp4'
}
