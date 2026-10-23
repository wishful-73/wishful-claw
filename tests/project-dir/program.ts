/*
 * 项目级数据目录名的判定（v3-iter-1 S-223）。
 *
 * 存在理由：dev 实例写项目级数据必须落 `{工作区}/.wishful-claw-dev/`，打包版
 * 必须仍是 `{工作区}/.wishful-claw/` —— 「打包版零变化」此前只能靠真机看目录。
 * 判定抽到 `src/shared/project-dir.ts` 后，这里把它钉死。
 *
 * 只打纯函数：`resolveProjectDirName()` 住主进程模块、import 了 electron，
 * node 下 `app` 是 undefined，直接调会 TypeError。
 */

import assert from 'node:assert/strict'
import { pickProjectDirName, projectDataDirName } from '../../src/shared/project-dir'

let checks = 0

function check(condition: boolean, description: string): void {
  checks += 1
  assert.ok(condition, description)
}

// 1. 打包版：目录名与既有约定一字不差（老用户项目不受影响）
check(projectDataDirName(false) === '.wishful-claw', '打包版必须用 .wishful-claw')

// 2. dev 实例：另起一份，不写进正式项目
check(projectDataDirName(true) === '.wishful-claw-dev', 'dev 实例必须用 .wishful-claw-dev')

// 3. 环境变量覆盖优先于运行态判定
check(pickProjectDirName('x-custom', false) === 'x-custom', 'env 有值时必须优先采用')

// 4. 空白 env 等同没设：isPackaged=false 走 dev
check(pickProjectDirName('  ', false) === '.wishful-claw-dev', '空白 env 必须回退到 dev 目录名')

// 5. 没 env 且已打包：走生产
check(pickProjectDirName(undefined, true) === '.wishful-claw', '无 env 且打包时必须回退到生产目录名')

console.log(`project-dir: ${checks} checks passed`)
