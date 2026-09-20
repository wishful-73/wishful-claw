// 一键跑完本地全部回归测试（TypeScript + C#）。
//
// 约定见 docs/dev-workflow.md 的「测试怎么跑」一节。
//
// 用法：
//   npm test                    全部（先编译 tests.sln，再跑两个面）
//   npm test -- --ts-only       只跑 TS 侧
//   npm test -- --csharp-only   只跑 C# 侧
//   npm test -- --no-build      跳过 C# 编译，复用现有 exe
//   npm test -- --filter <子串> 只跑名字含该子串的
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const filterIdx = argv.indexOf('--filter')
const filter = filterIdx >= 0 ? argv[filterIdx + 1] : null

const tsOnly = has('--ts-only')
const csOnly = has('--csharp-only')
const skipBuild = has('--no-build')

const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const tsTests = Object.keys(pkg.scripts)
  .filter((k) => k.startsWith('test:') && k !== 'test:clean')
  .filter((k) => !filter || k.includes(filter))

const csTests = readdirSync(join(projectRoot, 'tests'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^WishfulClaw\..+RegressionTests$/.test(d.name))
  .map((d) => d.name)
  .filter((n) => !filter || n.includes(filter))
  .sort()

const failures = []
let passed = 0

// 一律传「整条命令字符串」而不是 argv 数组：数组 + shell:true 会触发 DEP0190
// （参数不转义），而 Windows 下跑 .cmd / npm 又必须经 shell。
function runOne(label, command) {
  const t0 = Date.now()
  const r = spawnSync(command, { cwd: projectRoot, encoding: 'utf8', shell: true })
  const sec = ((Date.now() - t0) / 1000).toFixed(1)
  const out = `${r.stdout || ''}${r.stderr || ''}`
  // 套件自己打的计数行，有就带上
  const count = (out.match(/passed[:\s]+(\d+)/i) || [])[1]
  if (r.status === 0) {
    passed++
    console.log(`  ok   ${label.padEnd(44)} ${sec.padStart(6)}s${count ? `  ${count} assertions` : ''}`)
  } else {
    failures.push(label)
    console.log(`  FAIL ${label.padEnd(44)} ${sec.padStart(6)}s`)
    console.log(out.split('\n').slice(-20).join('\n'))
  }
}

// 先编译：跑旧 exe 等于验的不是当前代码
if (!tsOnly && !skipBuild) {
  console.log('== 编译 tests/WishfulClaw.Tests.sln ==')
  const t0 = Date.now()
  const r = spawnSync('dotnet build tests/WishfulClaw.Tests.sln --nologo -v q', {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: true
  })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  if (r.status !== 0) {
    console.log(out.split('\n').slice(-25).join('\n'))
    if (/MSB3021|MSB3027/.test(out)) {
      console.log('\n编译被开发实例锁住了 —— 见 docs/dev-workflow.md 的「编译环境」节（关掉 dev 实例再编）。')
    }
    process.exit(1)
  }
  console.log(`  ok   编译通过                                    ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
}

if (!csOnly) {
  console.log(`== TypeScript（${tsTests.length}）==`)
  for (const name of tsTests) runOne(name, pkg.scripts[name])
  console.log('')
}

if (!tsOnly) {
  console.log(`== C# 回归套件（${csTests.length}）==`)
  for (const name of csTests) {
    const label = name.replace(/^WishfulClaw\./, '').replace(/RegressionTests$/, '')
    const exe = join(projectRoot, 'tests', name, 'bin', 'Debug', 'net11.0', `${name}.exe`)
    if (!existsSync(exe)) {
      failures.push(label)
      console.log(`  FAIL ${label.padEnd(44)}  （exe 不存在，先编译）`)
      continue
    }
    runOne(label, `"${exe}"`)
  }
  console.log('')
}

const total = passed + failures.length
console.log('== 汇总 ==')
console.log(`  ${passed}/${total} 通过${failures.length ? `，${failures.length} 个失败` : ''}`)
if (failures.length) {
  console.log(`  失败：${failures.join(', ')}`)
  process.exit(1)
}
