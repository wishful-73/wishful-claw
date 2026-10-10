#!/usr/bin/env node
/**
 * 官网统计报表（S-182）—— 拉取服务器上的聚合结果并打印。
 *
 * 数据由服务器 cron（`/usr/local/bin/wishfulclaw-stats.sh`）每日聚合 nginx 日志写入
 * `/data/stats/`：`YYYY-MM-DD.json` 逐日 + `summary.json` 累计。**聚合在服务器上做**
 * （日志只在服务器），本地只负责取回来给人看。
 *
 * 配置与 `scripts/deploy.mjs` 同源（同主机、同密钥），但那份**不入版本库**
 * （见 `docs/release-workflow.md` 4.2），所以这里自包含一份，不 import 它。
 *
 * 用法：
 *   node scripts/site-stats.mjs               # 累计 + 最近 7 天
 *   node scripts/site-stats.mjs --days 30     # 累计 + 最近 30 天
 *   node scripts/site-stats.mjs --json        # 原样打印 summary.json（喂别的工具用）
 */
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CFG = {
  sshHost: '119.45.103.252',
  sshUser: 'ubuntu',
  // 部署专用密钥（与 deploy.mjs 同一把）
  sshKey: join(homedir(), '.ssh', 'wishfulclaw_deploy'),
  statsDir: '/data/stats'
}

const SSH_OPTS = ['-i', CFG.sshKey, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new']

/** 在服务器上跑一段 shell（脚本走 stdin，绕开 Windows 命令行转义） */
function ssh(script) {
  return new Promise((res, rej) => {
    const child = spawn('ssh', [...SSH_OPTS, `${CFG.sshUser}@${CFG.sshHost}`, 'bash -s'])
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => rej(new Error(`ssh 启动失败: ${e.message}`)))
    child.on('close', (code) =>
      code === 0 ? res(out) : rej(new Error(`远端脚本失败(退出码 ${code})${err ? `\n${err.trim()}` : ''}`))
    )
    child.stdin.write(script)
    child.stdin.end()
  })
}

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const daysAt = args.indexOf('--days')
const days = daysAt === -1 ? 7 : Math.max(1, Number(args[daysAt + 1]) || 7)

const num = (value) => (Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-CN') : '—')

const summaryScript = `
set -euo pipefail
if [ -f '${CFG.statsDir}/summary.json' ]; then
  cat '${CFG.statsDir}/summary.json'
else
  echo '{}'
fi
`

const dailyScript = `
set -euo pipefail
files=$(ls -1 ${CFG.statsDir}/????-??-??.json 2>/dev/null | tail -n ${days} || true)
if [ -z "$files" ]; then echo '[]'; else jq -s '.' $files; fi
`

const summaryRaw = await ssh(summaryScript)
if (asJson) {
  process.stdout.write(summaryRaw)
  process.exit(0)
}

let summary
try {
  summary = JSON.parse(summaryRaw)
} catch {
  console.error('✗ summary.json 不是合法 JSON —— 先确认服务器上脚本跑过：sudo /usr/local/bin/wishfulclaw-stats.sh')
  process.exit(1)
}

if (!summary || Object.keys(summary).length === 0) {
  console.log('服务器上还没有统计结果（/data/stats/summary.json 不存在）。')
  console.log('先部署服务器侧并手工跑一次：sudo /usr/local/bin/wishfulclaw-stats.sh')
  process.exit(0)
}

const sources = summary.sources ?? {}
console.log('▶ 官网统计（/data/stats/summary.json）')
console.log(`  累计下载   ${num(summary.downloads_total)} 次`)
console.log(`  累计访问   ${num(summary.visits_total)} 次`)
console.log(
  `  分源明细   web_click ${num(sources.web_click)} · web_download_local ${num(sources.web_download_local)} · app_update ${num(sources.app_update)}`
)
console.log(`  统计天数   ${num(summary.days)} 天（生成于 ${summary.generated_at ?? '—'}）`)

const dailyRaw = await ssh(dailyScript)
let daily = []
try {
  daily = JSON.parse(dailyRaw)
} catch {
  daily = []
}

if (Array.isArray(daily) && daily.length > 0) {
  console.log(`\n  最近 ${daily.length} 天`)
  for (const day of daily) {
    console.log(
      `  ${day.date}   下载 ${num(day.downloads)}   访问 ${num(day.visits)}` +
        (day.filtered_bots ? `   （已过滤 ${num(day.filtered_bots)} 条机器人）` : '')
    )
  }
} else {
  console.log('\n  暂无逐日文件。')
}
