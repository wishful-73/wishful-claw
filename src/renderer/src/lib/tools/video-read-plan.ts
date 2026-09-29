/**
 * 读视频的两段纯算术（S-145 §六）：取哪几个时间点、文件按多少字节切片。
 *
 * 单独一个文件是因为它们必须可测 —— 这两个函数是「读视频」里最容易出界的地方
 * （末帧正好落在 duration 上、文件长度不是分片大小整数倍），而它们所在的
 * `video-frames.ts` 一 import 就会拖进 ipc-client 与 DOM，在 Node 里跑不起来。
 * 这里零依赖，`tests/video-frames` 可以直接断言。
 */

/**
 * 均匀取样的时间点（秒）。首帧取 0，末帧留 50 ms 余量 —— 正好落在 duration 上时，
 * 有些容器会 seek 到「下一帧还不存在」的位置，`seeked` 不触发，只能等超时。
 */
export function computeFrameTimes(durationSec: number, frameCount: number): number[] {
  const count = Math.max(1, Math.floor(frameCount))
  if (count === 1) return [0]

  const last = Math.max(0, durationSec - 0.05)
  const times: number[] = []
  for (let index = 0; index < count; index += 1) {
    times.push(Number(((last * index) / (count - 1)).toFixed(3)))
  }
  return times
}

/**
 * 按 `chunkBytes` 把 `size` 字节切成若干片。
 *
 * 为什么用「偏移 + 长度」而不是「第几片」：主进程按 offset/length 读，切片规划放在这里
 * 就能单测，不必起一个真的文件。size 非正或不可用时返回空数组 —— 调用方据此报「空文件」。
 */
export function planChunks(size: number, chunkBytes: number): Array<{ offset: number; length: number }> {
  if (!Number.isFinite(size) || size <= 0) return []

  const chunk = Math.max(1, Math.floor(chunkBytes))
  const total = Math.floor(size)
  const chunks: Array<{ offset: number; length: number }> = []

  for (let offset = 0; offset < total; offset += chunk) {
    chunks.push({ offset, length: Math.min(chunk, total - offset) })
  }

  return chunks
}
