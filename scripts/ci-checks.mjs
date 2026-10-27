// 提交门禁：类型检查 + TS 侧回归测试。本地 pre-push 钩子与 GitHub Actions 共用。
//
// 为什么要有这个文件：以前每次都是人手动敲 `npm run typecheck` 和
// `npm test -- --ts-only`，靠自觉 —— 自觉就会漏。现在钉到 push 上，
// 钩子和 CI 调的是同一个脚本，两边判据不会跑偏。
//
// 用法：
//   npm run ci:checks                         手动跑（省掉以前那两条命令）
//   node scripts/ci-checks.mjs --from-hook    钩子调用，会读 stdin 判断能否跳过
//   CI_FORCE=1 git push                       强制跑，不跳过
//
// 成本（2026-10-27 本机实测）：typecheck 22.7 s + TS 侧 15.2 s（67 个套件）。
//
// C# 侧（tests/WishfulClaw.Tests.sln）不进这里：要 .NET 11 预览版 SDK，
// GitHub runner 上没有；C# 回归仍在本地 `npm test` 全量跑。
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const fromHook = argv.includes('--from-hook')
const force = process.env.CI_FORCE === '1'

const STEPS = [
  { name: 'typecheck', cmd: 'npm run typecheck' },
  { name: 'test（TS 侧）', cmd: 'npm test -- --ts-only' }
]

// 纯文档 / 杂项改动的豁免名单。
//
// 判定方向是白名单：**只有全部改动都命中这里才跳过**，认不出来就跑。
// 宁可多花 38 秒，也不能因为规则写漏把坏代码放过去。
const EXEMPT = [
  /^docs\//,
  /\.md$/,
  /^\.wishful-claw\//,
  /^\.gitignore$/,
  /^\.gitattributes$/,
  /^LICENSE/i
]

// pre-push 的 stdin 每行是「本地 ref / 本地 sha / 远程 ref / 远程 sha」，空格分隔。
function readRefLines() {
  if (process.stdin.isTTY) return [] // 手动跑钩子时别把终端卡住
  try {
    return readFileSync(0, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

// 返回本次 push 涉及的文件列表；返回 null 表示情况不明，调用方应当照常跑检查。
function changedFiles(refLines) {
  const files = new Set()
  for (const line of refLines) {
    const [, localSha, , remoteSha] = line.split(' ')
    if (!localSha || /^0+$/.test(localSha)) continue // 删分支，没有新内容要验
    if (!remoteSha || /^0+$/.test(remoteSha)) return null // 新分支，不猜
    const r = spawnSync(`git diff --name-only ${remoteSha}..${localSha}`, {
      cwd: projectRoot,
      encoding: 'utf8',
      shell: true
    })
    if (r.status !== 0) return null
    for (const f of (r.stdout || '').split('\n')) if (f.trim()) files.add(f.trim())
  }
  return [...files]
}

if (fromHook && !force) {
  const refLines = readRefLines()
  const files = refLines.length ? changedFiles(refLines) : null
  if (files && files.length && files.every((f) => EXEMPT.some((re) => re.test(f)))) {
    const head = files.slice(0, 5).join(', ')
    console.log(`== 跳过门禁：本次 push 只改了 ${files.length} 个文档/杂项文件 ==`)
    console.log(`   ${head}${files.length > 5 ? ' 等' : ''}`)
    console.log('   要强制跑：CI_FORCE=1 git push')
    process.exit(0)
  }
}

// 失败即停：类型不通时后面那批测试的结论没有参考价值，还会刷一屏红。
const failed = []
for (const { name, cmd } of STEPS) {
  console.log(`\n== ${name} ==`)
  const t0 = Date.now()
  const r = spawnSync(cmd, { cwd: projectRoot, stdio: 'inherit', shell: true })
  const sec = ((Date.now() - t0) / 1000).toFixed(1)
  if (r.status !== 0) {
    console.log(`\nFAIL ${name}（${sec}s）`)
    failed.push(name)
    break
  }
  console.log(`ok   ${name}（${sec}s）`)
}

if (failed.length) {
  console.log('\n== 门禁未通过 ==')
  console.log(`  失败：${failed.join(', ')}`)
  if (fromHook) {
    console.log('  修好再 push。确需绕过：git push --no-verify（绕过等于没守，别当常规手段）')
  }
  process.exit(1)
}

console.log('\n== 门禁通过 ==')
