/*
 * 全局数据根的决定（v3-iter-5 S-282）。
 *
 * 存在理由：`WISHFULCLAW_DATA_DIR` 指向全新目录时首次启动**静默退出**（连日志都没建出来），
 * 根因是 userData 子目录没人建。修法在 `src/main/index.ts`（`mkdirSync` 早于单例锁），
 * 但那条路要真起 electron 才验得了 —— 能在 node 下钉死的是「用哪个目录」这半步。
 *
 * 只打纯函数：`resolveDataDir()` 住主进程模块、import 了 electron，node 下 `app` 是 undefined。
 * 同理 `pickDataDir` 也不碰 `node:path`（shared 层同时进 tsconfig.web，引 node 内置会挂）。
 *
 * ⚠️ 第 6 / 7 条是「防实现退化」的闸：把 `pickDataDir` 改回「压成一个朴素字符串」，
 * 主进程就只能靠 `isAbsolute()` 猜来源 —— 用户配的相对路径（`.\data`）会被错误地拼到
 * home 下面，而 `WISHFULCLAW_DATA_DIR=.wishful-claw` 会被误判成默认目录名。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assessDataDirRisk, dataDirName, pickDataDir } from '../../src/shared/data-dir'

let checks = 0

function check(condition: boolean, description: string): void {
  checks += 1
  assert.ok(condition, description)
}

// 1. 打包版默认目录名与既有约定一字不差（老用户数据根不搬家）
//    注意参数语义：`dataDirName(isPackaged)`，与 project-dir 的 `projectDataDirName(isDev)` **相反**，
//    照抄那边会得到反的结论 —— 本套件第一次跑就因为这一点红过。
check(dataDirName(true) === '.wishful-claw', '打包版默认必须是 .wishful-claw')

// 2. dev 实例另起一份，不写进正式数据根
check(dataDirName(false) === '.wishful-claw-dev', 'dev 实例默认必须是 .wishful-claw-dev')

// 3. 环境变量给了完整路径：原样采信，且标记为「来自 env」
const absolute = pickDataDir('D:\\claw\\alt-data', true)
check(absolute.fromEnv === true, 'env 有值时必须标记 fromEnv=true')
check(absolute.value === 'D:\\claw\\alt-data', 'env 有值时必须原样采信，不做规范化')

// 4. 首尾空白不算配置内容
const padded = pickDataDir('  D:\\claw\\alt-data  ', false)
check(padded.value === 'D:\\claw\\alt-data', 'env 值必须去掉首尾空白')

// 5. 纯空白等同没设：回退默认目录名，且不是 fromEnv
const blank = pickDataDir('   ', true)
check(blank.fromEnv === false, '纯空白 env 必须回退成默认来源')
check(blank.value === '.wishful-claw', '纯空白 env 且打包时必须回退到生产目录名')

// 6. env 优先于打包态判定（两边都能给答案时，env 说话）
check(pickDataDir('E:\\custom', false).value === 'E:\\custom', 'env 与打包态冲突时必须由 env 决定')
check(pickDataDir(undefined, false).fromEnv === false, '没有 env 时绝不能标记 fromEnv')

// 7. env 值恰好等于默认目录名 —— 仍是 env，不许被当成默认值
//    （一旦实现靠「字符串相等」判来源，这条会被劫持到 home 下面）
const sameAsDefault = pickDataDir('.wishful-claw', true)
check(sameAsDefault.fromEnv === true, 'env 值等于默认目录名时仍必须标记 fromEnv=true')
check(
  sameAsDefault.value === '.wishful-claw',
  'env 值等于默认目录名时必须原样返回（不拼 home）'
)

// 8. 相对路径同样走 env 语义：原样返回，由主进程按 cwd 转绝对
//    （绝不能在这里 join home —— 那会把用户的相对配置变成 home 下一个怪目录）
const relative = pickDataDir('.\\data', false)
check(relative.fromEnv === true, '相对路径 env 也必须标记 fromEnv=true')
check(relative.value === '.\\data', '相对路径 env 必须原样返回')

// 9. 顺序闸：建目录必须早于 setPath，setPath 必须早于单实例锁。
//    这条之所以要钉，是因为整个修复的正确性**全押在顺序上** —— 有人把 mkdirSync 挪到
//    setPath 之后「看着更整齐」，缺陷就悄悄回来了，而那时真机只表现为「双击没反应」。
//    判据一律取带 `app.` 前缀的调用，避免命中注释里的同名字样。
const indexPath = join(process.cwd(), 'src', 'main', 'index.ts')
let indexSrc = ''
try {
  indexSrc = readFileSync(indexPath, 'utf8')
} catch {
  indexSrc = ''
}
check(indexSrc.length > 0, `必须读到 src/main/index.ts（cwd=${process.cwd()}）`)

const mkdirAt = indexSrc.indexOf('mkdirSync(userDataPath')
const setPathAt = indexSrc.indexOf('app.setPath(')
const lockAt = indexSrc.indexOf('app.requestSingleInstanceLock()')

check(mkdirAt > -1, 'index.ts 必须先建 userData 目录（S-282）')
check(setPathAt > -1 && mkdirAt < setPathAt, 'mkdirSync 必须排在 app.setPath 之前')
check(lockAt > -1 && setPathAt < lockAt, 'app.setPath 必须排在 app.requestSingleInstanceLock 之前')

// 10. S-293：非打包构建会不会改到一份已有的生产库。
//     判据是纯函数（fs 探测在主进程做），这里把四种组合钉死。
const liveDb = { exists: true, hasDatabase: true }
const emptyDir = { exists: true, hasDatabase: false }
const missingDir = { exists: false, hasDatabase: false }

// 10.1 打包版用自己的库天经地义
check(
  assessDataDirRisk({ fromEnv: true, value: 'D:\\data\\.wishful-claw' }, true, liveDb).level === 'ok',
  '打包版指向已有库必须是 ok（生产实例就是用自己的库）'
)

// 10.2 dev 默认目录里有 index.db 是它自己写的 —— 拦它等于拦掉正常开发
check(
  assessDataDirRisk({ fromEnv: false, value: '.wishful-claw-dev' }, false, liveDb).level === 'ok',
  '非打包 + 默认目录必须是 ok，不看探盘结果'
)

// 10.3 目录不存在 / 没有库 ⇒ 新建，没有污染可言
check(
  assessDataDirRisk({ fromEnv: true, value: 'D:\\claw\\alt-data' }, false, missingDir).level === 'ok',
  '显式指向不存在的目录必须是 ok'
)
check(
  assessDataDirRisk({ fromEnv: true, value: 'D:\\claw\\alt-data' }, false, emptyDir).level === 'ok',
  '显式指向空目录必须是 ok'
)

// 10.4 核心判据：非打包 + 显式 + 已有库 + 末段就是生产目录名 ⇒ 拦
const blocked = assessDataDirRisk(
  { fromEnv: true, value: 'C:\\Users\\me\\.wishful-claw' },
  false,
  liveDb
)
check(blocked.level === 'block', '非打包指向已有生产库必须 block')
check(
  (blocked.reason ?? '').includes('WISHFULCLAW_ALLOW_SHARED_DATA_DIR'),
  'block 的说明里必须给出逃生舱，否则只能去改代码'
)

// 10.5 尾部分隔符不能把末段判断打掉（`...\.wishful-claw\` 也算生产目录）
check(
  assessDataDirRisk({ fromEnv: true, value: 'C:\\Users\\me\\.wishful-claw\\' }, false, liveDb).level ===
    'block',
  '末尾带分隔符时仍必须认出生产目录名'
)

// 10.6 显式指向别的已有库 ⇒ 只告警，不拦（可能是用户自己的第二份库）
check(
  assessDataDirRisk({ fromEnv: true, value: 'D:\\claw\\alt-data' }, false, liveDb).level === 'warn',
  '非生产目录名的已有库必须 warn 而不是 block'
)

console.log(`data-dir: ${checks} checks passed`)
