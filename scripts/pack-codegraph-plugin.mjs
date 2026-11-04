// CodeGraph 插件资产打包脚本
//
// 引擎和语言包合成**一个**包，用户点一次下载，两样都下来。
// （2026-11-03 老大定方案 B：码图谱整体走插件资产下载，不再随安装包发布；
//  语言包不再作为独立资产 —— 之前分成两条是因为引擎当时还在安装包里。）
//
// 包内结构固定为：
//   bin/codegraph.exe          AOT 单文件引擎（MCP stdio server）
//   bin/e_sqlite3.dll          SQLite 原生库
//   bin/grammars/*.dll         tree-sitter 运行时 + 18 个语言 grammar
//
// ⚠️ grammars 必须挂在 bin/ 下，不能跟 bin/ 平级：
//    CodeGraphNativeLibraryResolver.ProbeDirs() 的查找顺序是
//    WISHFULCLAW_CODEGRAPH_GRAMMARS_DIR → {AppContext.BaseDirectory}/grammars → BaseDirectory，
//    而 BaseDirectory 就是 bin/，所以 bin/grammars 是不传环境变量也能命中的位置。
//
// ⚠️ 产出的 size / sha256 必须回填到 src/main/plugins/plugin-asset-catalog.ts
//    —— 填表纪律（老大 2026-10-27 14:19）：size 与 sha256 必须实测，不许填估算值。
//
// 用法：
//   node scripts/pack-codegraph-plugin.mjs
//   node scripts/pack-codegraph-plugin.mjs --rid win-arm64
//   node scripts/pack-codegraph-plugin.mjs --skip-publish   # 复用上次 AOT 产物
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'
import AdmZip from 'adm-zip'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

const args = process.argv.slice(2)
const readFlag = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const RID = readFlag('--rid', process.env.CODEGRAPH_RID || 'win-x64')
const SKIP_PUBLISH = args.includes('--skip-publish')

const CODEGRAPH_REPO = process.env.CODEGRAPH_REPO || 'D:\\claw\\wishful-claw-codegraph'
const CODEGRAPH_PROJECT = join(
  CODEGRAPH_REPO,
  'src',
  'WishfulClaw.CodeGraph',
  'WishfulClaw.CodeGraph.csproj'
)

const STAGE_DIR = join(projectRoot, 'release', `codegraph-plugin-stage-${RID}`)
const PUBLISH_DIR = join(projectRoot, 'release', `codegraph-aot-${RID}`)
const OUT_DIR = join(projectRoot, 'release')
const OUT_FILE = join(OUT_DIR, `codegraph-${RID}.zip`)

const log = (msg) => console.log(`[codegraph] ${msg}`)
const die = (msg) => {
  console.error(`[codegraph] ✖ ${msg}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 1. AOT 发布引擎
// ---------------------------------------------------------------------------
if (!SKIP_PUBLISH) {
  if (!existsSync(CODEGRAPH_PROJECT)) {
    die(`找不到引擎项目: ${CODEGRAPH_PROJECT}\n  设置 CODEGRAPH_REPO 环境变量指向独立仓。`)
  }
  rmSync(PUBLISH_DIR, { recursive: true, force: true })
  log(`AOT 发布 ${RID} …（首次约 20 秒）`)
  const r = spawnSync(
    'dotnet',
    [
      'publish',
      CODEGRAPH_PROJECT,
      '-c',
      'Release',
      '-r',
      RID,
      '-p:PublishAot=true',
      '-p:StripSymbols=true',
      '-o',
      PUBLISH_DIR,
      '--nologo'
    ],
    { stdio: 'inherit' }
  )
  if (r.status !== 0) die(`dotnet publish 失败（exit ${r.status}）`)
} else {
  log(`跳过发布，复用 ${PUBLISH_DIR}`)
}

const engineExe = join(PUBLISH_DIR, 'codegraph.exe')
if (!existsSync(engineExe)) die(`AOT 产物缺失: ${engineExe}（不要带 --skip-publish 重跑）`)

// ---------------------------------------------------------------------------
// 2. 组包
// ---------------------------------------------------------------------------
rmSync(STAGE_DIR, { recursive: true, force: true })
mkdirSync(join(STAGE_DIR, 'bin', 'grammars'), { recursive: true })

cpSync(engineExe, join(STAGE_DIR, 'bin', 'codegraph.exe'))
let engineBytes = statSync(engineExe).size

// e_sqlite3 由 SQLitePCLRaw.bundle_e_sqlite3 带出来，AOT 发布时一并产出。
const sqlite = ['e_sqlite3.dll', 'libe_sqlite3.dll']
  .map((n) => join(PUBLISH_DIR, n))
  .find(existsSync)
if (!sqlite) die(`AOT 产物里没有 e_sqlite3：${PUBLISH_DIR}`)
cpSync(sqlite, join(STAGE_DIR, 'bin', 'e_sqlite3.dll'))
engineBytes += statSync(sqlite).size

// ---------------------------------------------------------------------------
// 3. 取语言包（清单是主仓的 codegraph-grammars.json，不在独立仓）
// ---------------------------------------------------------------------------
const manifest = JSON.parse(
  readFileSync(join(projectRoot, 'src/shared/codegraph-grammars.json'), 'utf8')
)
const grammarsDir = join(homedir(), '.nuget', 'packages')
const nugetNativeDir = join(
  grammarsDir,
  manifest.source.package.toLowerCase(),
  manifest.source.version,
  'runtimes',
  RID,
  'native'
)
if (!existsSync(nugetNativeDir)) {
  die(
    `找不到语言包缓存: ${nugetNativeDir}\n` +
      `  先跑一次 dotnet restore ${join(CODEGRAPH_REPO, 'src', 'WishfulClaw.CodeGraph')}`
  )
}

const libraries = [manifest.runtime.library, ...manifest.grammars.map((g) => g.library)]
let grammarBytes = 0
for (const lib of libraries) {
  const src = join(nugetNativeDir, `${lib}.dll`)
  if (!existsSync(src)) die(`缺少 grammar: ${src}`)
  grammarBytes += statSync(src).size
  cpSync(src, join(STAGE_DIR, 'bin', 'grammars', `${lib}.dll`))
}
log(`语言包 ${libraries.length} 个 dll / ${(grammarBytes / 1024 / 1024).toFixed(2)} MB`)

// ---------------------------------------------------------------------------
// 4. 打 zip（条目名用 /，跨平台解压才不出乱结构）
// ---------------------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true })
rmSync(OUT_FILE, { force: true })
const zip = new AdmZip()
zip.addLocalFile(join(STAGE_DIR, 'bin', 'codegraph.exe'), 'bin')
zip.addLocalFile(join(STAGE_DIR, 'bin', 'e_sqlite3.dll'), 'bin')
for (const lib of libraries) {
  zip.addLocalFile(join(STAGE_DIR, 'bin', 'grammars', `${lib}.dll`), 'bin/grammars')
}
zip.writeZip(OUT_FILE)

const size = statSync(OUT_FILE).size
const sha256 = createHash('sha256').update(readFileSync(OUT_FILE)).digest('hex')
const entryCount = zip.getEntries().length

log('')
log(`引擎    ${(engineBytes / 1024 / 1024).toFixed(2)} MB（AOT + e_sqlite3）`)
log(`语言包  ${(grammarBytes / 1024 / 1024).toFixed(2)} MB（${libraries.length} 个 dll）`)
log(`合计    ${((engineBytes + grammarBytes) / 1024 / 1024).toFixed(2)} MB 未压缩`)
log(`产物    ${OUT_FILE}`)
log(`压缩后  ${(size / 1024 / 1024).toFixed(2)} MB（${size} 字节 / ${entryCount} 条目）`)
log(`sha256  ${sha256}`)
log('')
log('回填到 src/main/plugins/plugin-asset-catalog.ts：')
log(`  size: ${size},`)
log(`  sha256: '${sha256}',`)
log('')
log('发版：')
log(`  gh release create codegraph-v1 "${OUT_FILE}" --title "CodeGraph 插件资产 v1" --notes "…"`)
