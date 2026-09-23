/*
 * 更新失败的「面向用户」分类（iter-36 S-146）。
 *
 * 存在理由：更新对话框此前在「认不出的错误」上 `return message`，把**原始报文**直接摊给
 * 用户（`HttpError: 500 …`、`net::ERR_CONNECTION_RESET`、甚至整段 HTML 错误页）。分类逻辑
 * 抽成 `src/main/lib/updater-error-format.ts` 后，这里把「哪类报文归哪一类」钉死，重点是两条：
 *
 *   1. Chromium net 栈的 `net::ERR_*` 必须算网络类 —— 旧码表只认 Node 系的 ETIMEDOUT /
 *      ECONNRESET，而 Electron 的 net 模块与 electron-updater 的下载恰恰走 Chromium 网络栈，
 *      报文里出现的是 `net::ERR_*` ⇒ 一个都匹配不上，全部落到「裸吐原文」那条兜底分支。
 *   2. 认不出的错误**不再回吐原文**，只给短码（`ERR_UPDATER_*` / `HTTP nnn`）或通用兜底文案。
 */

import assert from 'node:assert/strict'
import {
  classifyUpdaterError,
  extractErrorCode,
  extractHttpStatus
} from '../../src/main/lib/updater-error-format'

let checks = 0

function check(condition: boolean, description: string): void {
  checks += 1
  assert.ok(condition, description)
}

// ─── 1. Chromium net 栈：旧码表的漏网主力 ───

check(
  classifyUpdaterError('net::ERR_CONNECTION_RESET').kind === 'network',
  'net::ERR_CONNECTION_RESET 归网络类'
)
check(
  classifyUpdaterError('net::ERR_NAME_NOT_RESOLVED').kind === 'network',
  'net::ERR_NAME_NOT_RESOLVED 归网络类'
)
check(
  classifyUpdaterError('net::ERR_INTERNET_DISCONNECTED').kind === 'network',
  'net::ERR_INTERNET_DISCONNECTED 归网络类'
)
check(
  classifyUpdaterError('net::ERR_HTTP2_PROTOCOL_ERROR').kind === 'network',
  'HTTP2 协议错误也算网络类'
)
check(
  classifyUpdaterError('Error: net::ERR_CONNECTION_TIMED_OUT at SimpleURLLoaderWrapper').kind ===
    'network',
  '报文带前缀与后缀时仍能认出'
)

// ─── 2. Node / undici 系（原有能力不能回退） ───

check(classifyUpdaterError('connect ETIMEDOUT 1.2.3.4:443').kind === 'network', 'ETIMEDOUT 归网络类')
check(classifyUpdaterError('read ECONNRESET').kind === 'network', 'ECONNRESET 归网络类')
check(classifyUpdaterError('getaddrinfo EAI_AGAIN github.com').kind === 'network', 'EAI_AGAIN 归网络类')
check(classifyUpdaterError('econnreset').kind === 'network', '小写码同样识别')

// ─── 3. HTTP 层：服务端抖动 ───

check(
  classifyUpdaterError('HttpError: 500 Internal Server Error').kind === 'network',
  'HTTP 500 归网络类（用户能做的只有稍后重试）'
)
check(classifyUpdaterError('HttpError: 502').kind === 'network', 'HTTP 502 归网络类')
check(classifyUpdaterError('502 Bad Gateway').kind === 'network', '无 HttpError 前缀的 502 也认')
check(classifyUpdaterError('HttpError: 429').kind === 'network', 'HTTP 429 限流归网络类')
check(classifyUpdaterError('HttpError: 408').kind === 'network', 'HTTP 408 超时归网络类')

// ─── 4. 清单缺失（发布侧问题，文案要指向「重新生成并上传」） ───

check(
  classifyUpdaterError('Cannot download "https://x/downloads/latest.yml", status 404').kind ===
    'missingMetadata',
  'latest.yml 404 归清单缺失'
)
check(
  classifyUpdaterError('HttpError: 404 for latest.yml').kind === 'missingMetadata',
  'latest.yml 404 的另一种写法'
)
check(
  classifyUpdaterError('HttpError: 500 for latest.yml').kind === 'network',
  'latest.yml 的 5xx 不是清单缺失，是服务端抖动'
)

// ─── 5. 认得出短码但非网络类：带码展示 ───

const checksum = classifyUpdaterError(
  'ERR_UPDATER_CHECKSUM_MISMATCH: sha512 checksum mismatch, expected ...'
)
check(checksum.kind === 'unknown', '校验失败归 unknown（不是网络类）')
check(checksum.code === 'ERR_UPDATER_CHECKSUM_MISMATCH', 'unknown 分支带出 updater 短码')

const forbidden = classifyUpdaterError('HttpError: 403 Forbidden')
check(forbidden.kind === 'unknown' && forbidden.code === 'HTTP 403', 'HTTP 403 带码展示')

check(
  classifyUpdaterError('net::ERR_CONNECTION_RESET')
    .code === undefined,
  '网络类不再额外带码（文案已覆盖）'
)

// ─── 6. 兜底：认不出来时绝不回吐原文 ───

// nginx 的 502 页是**服务端抖动**，归网络类（文案「检查网络、稍后重试」是对的）——
// 但用户看到的绝不能是这一整段 HTML。
const html502 = classifyUpdaterError(
  '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx/1.24.0</center></body></html>'
)
check(html502.kind === 'network', 'HTML 502 页归网络类（不是把整页摊给用户）')

// 非网络的 HTML 错误页（403）：只取短码，正文不出现在分类结果里
const html403 = classifyUpdaterError(
  '<html><head><title>403 Forbidden</title></head><body><center><h1>403 Forbidden</h1></center><hr><center>nginx/1.24.0</center></body></html>'
)
check(html403.kind === 'unknown' && html403.code === 'HTTP 403', 'HTML 403 页只取短码')
check(!('message' in html403), '分类结果里没有原文段（用户看不到原始报文）')

const mystery = classifyUpdaterError('Something exploded while unpacking the archive')
check(mystery.kind === 'fallback', '完全认不出的错误走通用兜底')
check(mystery.code === undefined, '兜底不带码')

check(classifyUpdaterError('').kind === 'fallback', '空串走兜底')
check(classifyUpdaterError(null).kind === 'fallback', 'null 走兜底')
check(classifyUpdaterError(undefined).kind === 'fallback', 'undefined 走兜底')
check(classifyUpdaterError({ message: 'HttpError: 500' }).kind === 'fallback', '非字符串走兜底不抛错')

// ─── 7. 两个提取器的边界 ───

check(extractHttpStatus('HttpError: 404') === 404, 'extractHttpStatus 认 HttpError: nnn')
check(extractHttpStatus('HTTP 503') === 503, 'extractHttpStatus 认 HTTP nnn')
check(extractHttpStatus('503 Service Unavailable') === 503, 'extractHttpStatus 认 nnn + 状态文本')
check(extractHttpStatus('no code here') === null, '无码时返回 null')
check(extractHttpStatus('version 0.2.36 released') === null, '版本号不会被误读成状态码')

check(
  extractErrorCode('net::ERR_SOCKET_NOT_CONNECTED') === 'ERR_SOCKET_NOT_CONNECTED',
  'net:: 前缀取到后面的码'
)
check(
  extractErrorCode('net::ERR_CONNECTION_RESET and ERR_UPDATER_SIGNATURE_MISMATCH') ===
    'ERR_CONNECTION_RESET',
  'net:: 优先于 ERR_UPDATER_'
)
check(extractErrorCode('unrecognizable failure') === null, '无码时返回 null')

console.log(`updater error format checks passed: ${checks}`)
