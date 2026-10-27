// 装本地 git 钩子（当前只有 pre-push）。`npm install` 后由 prepare 自动跑，
// 也可以 `npm run setup:hooks` 手动重装。
//
// 为什么不引 husky：为两个钩子加一个依赖不值当，而且 husky 会接管
// core.hooksPath，把 `.git/hooks` 里已有的东西（本机就有 Qoder 装的
// post-commit / post-checkout 追踪钩子）一起挤掉。
//
// 钩子本体是几行薄壳，逻辑全在 scripts/ci-checks.mjs —— 那个入库，这个不进。
//
// **必须按 LF 字节写**：core.autocrlf=true 只管版本控制里的文件，.git/hooks
// 不在其中；写成 CRLF 的 sh 脚本第一行会变成 `#!/bin/sh\r`，git 执行时报
// exec format error。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const MARK = 'wishful-claw pre-push'

const HOOK_BODY = [
  '#!/bin/sh',
  `# BEGIN ${MARK}（由 scripts/install-git-hooks.mjs 生成，勿手改）`,
  '# 逻辑在仓库里：scripts/ci-checks.mjs —— 类型检查 + TS 侧回归测试。',
  '# 只挂 push 不挂 commit：一次约 38 秒，push 一天一两次，commit 十几刀。',
  '# 从 GUI 客户端 push 时 PATH 里可能没有 node，跳过并提示，别让门禁变成推不上去。',
  'command -v node >/dev/null 2>&1 || { echo "pre-push 跳过：PATH 里找不到 node"; exit 0; }',
  'exec node "$(git rev-parse --show-toplevel)/scripts/ci-checks.mjs" --from-hook',
  `# END ${MARK}`,
  ''
].join('\n')

function ok(msg) {
  console.log(`  ok   ${msg}`)
}

function warn(msg) {
  console.log(`  warn ${msg}`)
}

try {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

  // 不是 git 工作区（例如只解压了源码）就直接退出，别破坏别人 npm install。
  // shell:true 不能省：整条命令字符串在 Windows 下不这么传就找不到 git。
  const r = spawnSync('git rev-parse --git-path hooks', {
    cwd: root,
    encoding: 'utf8',
    shell: true
  })
  if (r.status !== 0) {
    console.log('  跳过：当前目录不是 git 工作区')
    process.exit(0)
  }

  const hooksDir = resolve(root, (r.stdout || '').trim())
  mkdirSync(hooksDir, { recursive: true })
  const target = join(hooksDir, 'pre-push')

  if (existsSync(target)) {
    const current = readFileSync(target, 'utf8')
    if (current === HOOK_BODY) {
      ok('pre-push 已是最新')
      process.exit(0)
    }
    if (!current.includes(MARK)) {
      // 别人的钩子：留个备份，别静默抹掉。
      const stamp = new Date()
        .toISOString()
        .replace(/[-:T]/g, '')
        .slice(0, 14)
      const backup = `${target}.bak-${stamp}`
      renameSync(target, backup)
      warn(`已有他人的 pre-push，备份为 ${backup}`)
    }
  }

  writeFileSync(target, HOOK_BODY, { encoding: 'utf8' })
  ok(`pre-push 已装（${target}）`)
} catch (err) {
  // prepare 阶段炸掉会让整个 npm install 失败，这里一律吞掉只提示。
  console.log(`  warn 装钩子失败，门禁仅在 CI 生效：${err && err.message ? err.message : err}`)
}
