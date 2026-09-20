/*
 * Wishful Claw 自研：启动分流判据对账测试。
 *
 * `shouldShowOnStartup` 是「开机自启是否静默」这条链上唯一的判据：登录项带
 * `--hidden` 就该只留托盘，不带就照旧弹窗。它必须保持**零 Electron 依赖** ——
 * 本套件用 esbuild 打成 CJS 后拿纯 node 跑，`src/main/index.ts`（模块作用域执行
 * app.setName / 单实例锁）或 `main-window-visibility.ts`（连带到
 * priority-shortcuts 的模块作用域 app.on('will-quit')）一旦被 import 就当场抛。
 */

import assert from 'node:assert/strict'
import { HIDDEN_FLAG, shouldShowOnStartup } from '../../src/main/startup-flags'

let checks = 0

function check(description: string, run: () => void): void {
  checks += 1
  try {
    run()
  } catch (error) {
    console.error(`FAIL: ${description}`)
    throw error
  }
}

check('bare argv shows the window', () => {
  assert.equal(shouldShowOnStartup([]), true)
})

check('argv carrying only unrelated switches still shows the window', () => {
  assert.equal(shouldShowOnStartup(['C:\\app\\wishful-claw.exe']), true)
  assert.equal(shouldShowOnStartup(['app.exe', '--no-sandbox', '--enable-logging']), true)
  assert.equal(shouldShowOnStartup(['app.exe', '--remote-debugging-port=9222']), true)
})

check('HIDDEN_FLAG anywhere in argv suppresses the window', () => {
  assert.equal(shouldShowOnStartup(['app.exe', HIDDEN_FLAG]), false)
  assert.equal(shouldShowOnStartup([HIDDEN_FLAG, 'app.exe']), false)
  assert.equal(
    shouldShowOnStartup(['app.exe', '--no-sandbox', HIDDEN_FLAG, '--enable-logging']),
    false
  )
})

check('only an exact match counts — similar-looking switches are ignored', () => {
  assert.equal(shouldShowOnStartup(['app.exe', '--hidden-window']), true)
  assert.equal(shouldShowOnStartup(['app.exe', '--hiddenness']), true)
  assert.equal(shouldShowOnStartup(['app.exe', '--HIDDEN']), true)
  assert.equal(shouldShowOnStartup(['app.exe', '--hidden=false']), true)
})

/*
 * The literal is an on-disk contract, not an implementation detail: it is written
 * into the OS login item (a registry command line on Windows). Changing it here
 * would leave every already-installed machine auto-starting with an unknown
 * argument — i.e. the window popping up again — while the settings switch still
 * reads "on". `main-window-config.ts` writes the flag through this same constant,
 * so pinning the value is what keeps writer and reader from drifting.
 */
check('HIDDEN_FLAG literal stays compatible with already-registered login items', () => {
  assert.equal(HIDDEN_FLAG, '--hidden')
})

console.log(`startup-flags: ${checks} checks passed`)
