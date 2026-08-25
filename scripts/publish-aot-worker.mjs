// AOT Worker 编译脚本
// 自动检测 VS Build Tools 路径，初始化 C++ 环境，然后执行 dotnet publish AOT
import { execSync } from 'child_process'
import { existsSync, rmSync, mkdirSync, copyFileSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

console.log('[AOT Worker] 正在检测 Visual Studio Build Tools...')

// 常见的 vcvars64.bat 安装路径
const vsBase = 'C:\\Program Files (x86)\\Microsoft Visual Studio'
const versions = [19, 18, 17, 16, 15]
const editions = ['BuildTools', 'Community', 'Professional', 'Enterprise']
const vcvarsRelPath = 'VC\\Auxiliary\\Build\\vcvars64.bat'

let vcvarsPath = null
for (const ver of versions) {
  for (const ed of editions) {
    const candidate = join(vsBase, String(ver), ed, vcvarsRelPath)
    if (existsSync(candidate)) {
      vcvarsPath = candidate
      break
    }
  }
  if (vcvarsPath) break
}

if (!vcvarsPath) {
  console.error('[AOT Worker] [错误] 未找到 vcvars64.bat')
  console.error('[AOT Worker] 请安装 Visual Studio Build Tools:')
  console.error('[AOT Worker] https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio')
  process.exit(1)
}

console.log(`[AOT Worker] 找到 vcvars64.bat: ${vcvarsPath}`)

// 构建 cmd 命令：先调用 vcvars64.bat 初始化 C++ 环境，再跑 dotnet publish
const dotnetCmd = [
  `dotnet publish "${join(projectRoot, 'src/runtime/WishfulClaw.Worker/WishfulClaw.Worker.csproj')}"`,
  '-c Release',
  '-r win-x64',
  '--self-contained true',
  `-o "${join(projectRoot, 'resources/worker')}"`
].join(' ')

// src/runtime 的 global.json 钉住 .NET 11 preview；若本机默认 dotnet 不是 11，
// 通过 DOTNET_ROOT 环境变量指向便携版 SDK（如 D:\claw\dotnet-sdk）。
const dotnetSdkDir = process.env.DOTNET_ROOT ? `${process.env.DOTNET_ROOT};` : ''
const cmd = `call "${vcvarsPath}" >nul 2>&1 && set "PATH=${dotnetSdkDir}C:\\Windows\\System32;C:\\Windows;%PATH%;C:\\Program Files\\dotnet" && ${dotnetCmd}`

console.log('[AOT Worker] 开始 AOT 编译...')
console.log('[AOT Worker] 这可能需要几分钟，请耐心等待...')

try {
  execSync(cmd, {
    cwd: projectRoot,
    shell: 'C:\\Windows\\System32\\cmd.exe',
    stdio: 'inherit',
    timeout: 600000 // 10 分钟超时
  })
} catch (err) {
  console.error(`[AOT Worker] [错误] AOT 编译失败: ${err.message}`)
  process.exit(1)
}

console.log('[AOT Worker] AOT 编译成功！')

// 删除 pdb 调试符号
const workerDir = join(projectRoot, 'resources/worker')
if (existsSync(workerDir)) {
  const pdbFiles = ['*.pdb']
  for (const pattern of pdbFiles) {
    const files = execSync(`dir /b "${workerDir}\\${pattern}" 2>nul`, { shell: 'C:\\Windows\\System32\\cmd.exe' })
      .toString().trim().split('\n').filter(Boolean)
    for (const f of files) {
      rmSync(join(workerDir, f.trim()))
    }
  }
  console.log('[AOT Worker] 已删除 .pdb 调试符号文件')
}

// CodeGraph：把 tree-sitter grammar DLL 复制到 worker 旁的 grammars 目录
// （主进程 codegraph-assets.ts 打包模式按 <workerDir>/codegraph-worker/grammars 解析；
// 只复制 manifest 声明的 grammar + 核心运行时，未识别文件会触发资产诊断告警）
function bundleCodeGraphGrammars() {
  const manifest = JSON.parse(
    readFileSync(join(projectRoot, 'src/shared/codegraph-grammars.json'), 'utf8')
  )
  const rid = 'win-x64' // 与上方 publish 的 -r 参数保持一致
  const nugetNativeDir = join(
    homedir(),
    '.nuget',
    'packages',
    manifest.source.package.toLowerCase(),
    manifest.source.version,
    'runtimes',
    rid,
    'native'
  )
  if (!existsSync(nugetNativeDir)) {
    console.error(`[AOT Worker] [错误] 未找到 NuGet 缓存目录: ${nugetNativeDir}`)
    console.error('[AOT Worker] 请先执行 dotnet restore src/runtime/WishfulClaw.CodeGraph')
    process.exit(1)
  }

  const grammarsDir = join(projectRoot, 'resources/worker/codegraph-worker/grammars')
  mkdirSync(grammarsDir, { recursive: true })

  // 核心运行时 + manifest 中的语言 grammar（Windows 命名：<library>.dll）
  const libraryNames = [manifest.runtime.library, ...manifest.grammars.map((g) => g.library)]
  let copied = 0
  for (const library of libraryNames) {
    const sourceFile = join(nugetNativeDir, `${library}.dll`)
    if (!existsSync(sourceFile)) {
      console.error(`[AOT Worker] [错误] 缺少 grammar 文件: ${sourceFile}`)
      process.exit(1)
    }
    copyFileSync(sourceFile, join(grammarsDir, `${library}.dll`))
    copied += 1
  }
  console.log(`[AOT Worker] 已捆绑 ${copied} 个 CodeGraph grammar 到 ${grammarsDir}`)
}

bundleCodeGraphGrammars()

// 显示产物
const result = execSync(`dir "${workerDir}\\WishfulClaw.Worker.exe"`, { shell: 'C:\\Windows\\System32\\cmd.exe' }).toString()
console.log('[AOT Worker] 产物:')
console.log(result)
console.log('[AOT Worker] 完成！')