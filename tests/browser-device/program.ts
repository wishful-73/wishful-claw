// iter-40 / S-216：内置浏览器的设备模拟与导航目标状态机。
//
// 两件最容易回归的事锁在这里：
//   1. 站内跳转（pushState / hash / tab 切换）绝不能改变导航目标 —— 一改就整页重载；
//   2. 设备预置的宽高与 DPR、以及 UA 里绝不能漏出 Electron 标识。

import assert from 'node:assert/strict'
import { isSameBrowserUrl, nextCommittedUrl } from '../../src/renderer/src/lib/browser/committed-url'
import {
  BROWSER_DEVICE_MODES,
  CUSTOM_DEVICE_SCALE_FACTOR,
  CUSTOM_VIEWPORT_MAX,
  CUSTOM_VIEWPORT_MIN,
  DEFAULT_CUSTOM_VIEWPORT,
  browserDeviceKey,
  isBrowserDeviceMode,
  normalizeViewportSide,
  resolveBrowserDeviceViewport
} from '../../src/shared/browser-device-presets'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

// ── nextCommittedUrl ────────────────────────────────────────────────

const base = {
  prev: '',
  storedUrl: '',
  navigationSeq: 0,
  prevNavigationSeq: 0,
  scopeChanged: false,
  reuseModeChanged: false
}

eq(
  nextCommittedUrl({ ...base, prev: 'https://a.com/1', storedUrl: 'https://a.com/2', scopeChanged: true }),
  'https://a.com/2',
  '切会话/项目 ⇒ 跟到实际地址'
)

eq(
  nextCommittedUrl({
    ...base,
    prev: 'https://a.com/1',
    storedUrl: 'https://a.com/2',
    navigationSeq: 1,
    prevNavigationSeq: 0
  }),
  'https://a.com/2',
  '命令式导航序号变 ⇒ 跟到实际地址'
)

eq(
  nextCommittedUrl({ ...base, prev: '', storedUrl: 'https://a.com/1' }),
  'https://a.com/1',
  '导航目标为空 ⇒ 采纳实际地址（首次挂载）'
)

eq(
  nextCommittedUrl({
    ...base,
    prev: 'https://a.com/1',
    storedUrl: 'https://a.com/2',
    reuseModeChanged: true
  }),
  'https://a.com/2',
  '复用开关变化 ⇒ webview 重建，跟到实际地址'
)

eq(
  nextCommittedUrl({ ...base, prev: 'https://a.com/1', storedUrl: 'https://a.com/1#tab-2' }),
  'https://a.com/1',
  '站内切 tab / hash / pushState ⇒ 导航目标不变（否则整页重载）'
)

// 优先级：切会话优先于序号，序号优先于空目标
eq(
  nextCommittedUrl({
    ...base,
    prev: 'https://a.com/1',
    storedUrl: 'https://b.com/9',
    navigationSeq: 3,
    prevNavigationSeq: 2,
    scopeChanged: true,
    reuseModeChanged: true
  }),
  'https://b.com/9',
  '多条同时命中 ⇒ 结果仍是实际地址'
)

check(
  nextCommittedUrl({ ...base, prev: 'https://a.com/1', storedUrl: '' }) === 'https://a.com/1',
  '实际地址为空且无指令 ⇒ 保持原导航目标'
)

// ── isSameBrowserUrl ────────────────────────────────────────────────

check(isSameBrowserUrl('https://a.com/', 'https://a.com'), '尾斜杠不影响同址判定')
check(isSameBrowserUrl('https://A.COM/x', 'https://a.com/x'), '主机名大小写不影响同址判定')
check(isSameBrowserUrl('https://a.com:443/x', 'https://a.com/x'), '默认端口不影响同址判定')
check(!isSameBrowserUrl('https://a.com/x', 'https://a.com/y'), '不同路径不是同址')
check(!isSameBrowserUrl('http://a.com/x', 'https://a.com/x'), '不同协议不是同址')

// ── 设备预置 ────────────────────────────────────────────────────────

eq(resolveBrowserDeviceViewport('pc'), null, 'pc ⇒ 取消仿真，返回 null')

const iphone = resolveBrowserDeviceViewport('iphone')
check(iphone, 'iphone 有视口')
eq(iphone?.width, 390, 'iphone 宽 390')
eq(iphone?.height, 844, 'iphone 高 844')
eq(iphone?.deviceScaleFactor, 3, 'iphone DPR 3')

const pixel = resolveBrowserDeviceViewport('pixel')
eq(pixel?.width, 412, 'pixel 宽 412')
eq(pixel?.height, 915, 'pixel 高 915')
eq(pixel?.deviceScaleFactor, 2.625, 'pixel DPR 2.625')

const ipad = resolveBrowserDeviceViewport('ipad')
eq(ipad?.width, 820, 'ipad 宽 820')
eq(ipad?.height, 1180, 'ipad 高 1180')
eq(ipad?.deviceScaleFactor, 2, 'ipad DPR 2')

const customDefault = resolveBrowserDeviceViewport('custom')
eq(customDefault?.width, 390, 'custom 缺省宽 390')
eq(customDefault?.height, 844, 'custom 缺省高 844')
eq(customDefault?.deviceScaleFactor, CUSTOM_DEVICE_SCALE_FACTOR, 'custom DPR 固定 3')

const customGiven = resolveBrowserDeviceViewport('custom', { width: 500, height: 900 })
eq(customGiven?.width, 500, 'custom 采用传入宽')
eq(customGiven?.height, 900, 'custom 采用传入高')

for (const mode of BROWSER_DEVICE_MODES) {
  if (mode === 'pc') continue
  const ua = resolveBrowserDeviceViewport(mode)?.userAgent ?? ''
  check(ua.length > 0, `${mode} 的 UA 非空`)
  check(!ua.includes('Electron'), `${mode} 的 UA 不含 Electron 标识`)
}

// ── normalizeViewportSide ──────────────────────────────────────────

eq(normalizeViewportSide(0, 390), 390, '0 ⇒ 回落 fallback')
eq(normalizeViewportSide(-10, 390), 390, '负数 ⇒ 回落 fallback')
eq(normalizeViewportSide(Number.NaN, 390), 390, 'NaN ⇒ 回落 fallback')
eq(normalizeViewportSide('abc', 390), 390, '非数字 ⇒ 回落 fallback')
eq(normalizeViewportSide(99999, 390), CUSTOM_VIEWPORT_MAX, '超上限 ⇒ 夹到上限')
eq(normalizeViewportSide(1, 390), CUSTOM_VIEWPORT_MIN, '低于下限 ⇒ 夹到下限')
eq(normalizeViewportSide(412.6, 390), 413, '小数 ⇒ 四舍五入')

// ── isBrowserDeviceMode ────────────────────────────────────────────

check(isBrowserDeviceMode('iphone'), '合法枚举通过')
check(!isBrowserDeviceMode('desktop'), 'desktop 不是合法枚举')
check(!isBrowserDeviceMode(null), 'null 不是合法枚举')
check(!isBrowserDeviceMode(1), '数字不是合法枚举')

// ── browserDeviceKey ───────────────────────────────────────────────

eq(browserDeviceKey('pc'), 'pc', 'pc 的键就是 pc')
eq(
  browserDeviceKey('iphone'),
  browserDeviceKey('iphone'),
  '同输入同键'
)
check(browserDeviceKey('iphone') !== browserDeviceKey('ipad'), '不同设备不同键')
check(
  browserDeviceKey('custom', { width: 400, height: 800 }) !==
    browserDeviceKey('custom', { width: 401, height: 800 }),
  '自定义尺寸不同 ⇒ 键不同'
)
eq(
  browserDeviceKey('custom', { width: 99999, height: 800 }),
  browserDeviceKey('custom', { width: CUSTOM_VIEWPORT_MAX, height: 800 }),
  '夹取后等值 ⇒ 同键（否则永远判定为新配置、反复 reload）'
)
eq(
  browserDeviceKey('custom'),
  browserDeviceKey('custom', { width: DEFAULT_CUSTOM_VIEWPORT.width, height: DEFAULT_CUSTOM_VIEWPORT.height }),
  'custom 缺省与显式默认值同键'
)

console.log(`browser-device: ${checks} checks passed`)
