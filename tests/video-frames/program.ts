/*
 * Read 读视频：抽帧取样点与分片规划（iter-36 S-145 §六）。
 *
 * 为什么单独测这两个：读视频整条链路的其余部分都要真的解码器与真文件（C# 侧的契约由
 * `WishfulClaw.ReadVideoRegressionTests` 覆盖），只有这两段是纯算术，也恰恰是边界最容易
 * 出错的地方 ——
 *
 *   1. 末帧取样点：直接取 duration 会 seek 到「下一帧还不存在」的位置，回调不触发，只能等超时。
 *   2. 分片规划：文件长度不是分片大小整数倍时，最后一片必须缩短到剩余字节，多读一字节就是
 *      给主进程一个越界的 offset/length。
 */

import assert from 'node:assert/strict'
import { computeFrameTimes, planChunks } from '../../src/renderer/src/lib/tools/video-read-plan'
import {
  fileExtension,
  isVideoPath,
  videoMediaTypeFor
} from '../../src/renderer/src/lib/media-file-types'

let checks = 0

function check(condition: boolean, description: string): void {
  checks += 1
  assert.ok(condition, description)
}

function eq(actual: unknown, expected: unknown, description: string): void {
  checks += 1
  assert.deepStrictEqual(actual, expected, description)
}

// ─── 1. 取样时间点 ───

eq(computeFrameTimes(10, 4), [0, 3.317, 6.633, 9.95], '四帧均匀铺开，末帧留 50ms 余量')
eq(computeFrameTimes(10, 1), [0], '单帧只取第 0 秒')
eq(computeFrameTimes(10, 0), [0], '帧数为 0 时退化成单帧，不返回空数组')
eq(computeFrameTimes(10, -3), [0], '负数帧数同样退化成单帧')

// duration 未知或极短时不能产出负数时间点（seek 到负值会直接抛错）。
eq(computeFrameTimes(0, 3), [0, 0, 0], 'duration 为 0 时全部落在 0')
eq(computeFrameTimes(0.01, 3), [0, 0, 0], 'duration 小于余量时全部落在 0')

// 单调不减是 seek 的前提：倒退的时间点会让某些容器重新解码。
{
  const times = computeFrameTimes(123.456, 8)
  check(times.length === 8, '八帧就是八个取样点')
  check(
    times.every((time, index) => index === 0 || time >= times[index - 1]),
    '取样点单调不减'
  )
  check(times[times.length - 1] < 123.456, '末帧严格小于 duration')
}

// 小数帧数按向下取整处理，避免产出半个帧的位置。
eq(computeFrameTimes(10, 2.7).length, 2, '小数帧数向下取整')

// ─── 2. 分片规划 ───

eq(planChunks(10, 4), [
  { offset: 0, length: 4 },
  { offset: 4, length: 4 },
  { offset: 8, length: 2 }
], '最后一片缩短到剩余字节')

eq(planChunks(8, 4), [
  { offset: 0, length: 4 },
  { offset: 4, length: 4 }
], '整除时不多出空片')

eq(planChunks(1, 4), [{ offset: 1 * 0, length: 1 }], '小于一片的文件读一片')

eq(planChunks(0, 4), [], '空文件不规划分片')
eq(planChunks(-5, 4), [], '负数长度不规划分片')
eq(planChunks(Number.NaN, 4), [], 'NaN 长度不规划分片')
eq(planChunks(10, 0), [
  { offset: 0, length: 1 },
  { offset: 1, length: 1 },
  { offset: 2, length: 1 },
  { offset: 3, length: 1 },
  { offset: 4, length: 1 },
  { offset: 5, length: 1 },
  { offset: 6, length: 1 },
  { offset: 7, length: 1 },
  { offset: 8, length: 1 },
  { offset: 9, length: 1 }
], '分片大小非法时退化成 1 字节，不会死循环')

// 切片必须无重叠、无空洞、正好覆盖整个文件 —— 任何一条不成立，拼出来的 Blob 就是坏的，
// 而坏掉的 Blob 只会表现成「视频解码失败」，极难反查到分片算术上。
{
  const size = 4097
  const chunks = planChunks(size, 1024)
  check(chunks.length === 5, '4097 字节按 1024 切成 5 片')
  check(chunks[0].offset === 0, '首片从 0 开始')
  check(
    chunks.every((chunk, index) =>
      index === 0 ? chunk.offset === 0 : chunk.offset === chunks[index - 1].offset + chunks[index - 1].length
    ),
    '分片首尾相接，无空洞无重叠'
  )
  check(
    chunks.reduce((total, chunk) => total + chunk.length, 0) === size,
    '分片长度之和等于文件长度'
  )
}

// ─── 3. 扩展名与 MIME ───

check(isVideoPath('clip.mp4'), '.mp4 认作视频')
check(isVideoPath('CLIP.MP4'), '扩展名判断不区分大小写')
check(isVideoPath('/tmp/深色 视频.webm'), '路径里有空格与中文也能认出来')
check(!isVideoPath('shot.png'), '图片不算视频')
check(!isVideoPath('notes.txt'), '文本不算视频')
check(!isVideoPath('noextension'), '没有扩展名不算视频')

eq(fileExtension('a/b/c.MOV'), '.mov', '取最后一段扩展名并转小写')
eq(fileExtension('noextension'), '', '无扩展名返回空串')
eq(fileExtension('archive.tar.gz'), '.gz', '多点文件名只取最后一段')

eq(videoMediaTypeFor('clip.mp4'), 'video/mp4', 'mp4 映射')
eq(videoMediaTypeFor('clip.mkv'), 'video/x-matroska', 'mkv 映射')
eq(videoMediaTypeFor('clip.M2TS'), 'video/mp2t', 'm2ts 映射且大小写无关')
eq(videoMediaTypeFor('unknown.xyz'), 'video/mp4', '认不出的扩展名回落 mp4')

console.log(`video frame checks passed: ${checks}`)
