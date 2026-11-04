// AOT Worker 编译脚本
// 自动检测 VS Build Tools 路径，初始化 C++ 环境，然后执行 dotnet publish AOT
import { execSync } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { join, dirname } from 'path'
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

// S-303：CodeGraph 的语言包（tree-sitter 原生 grammar，18 个 dll 共 42.5 MB）不再随安装包发布。
// 用户在「设置 → 应用与插件 → 代码图谱」点「下载语言包」时，主进程会把同一批 dll 下到
// {dataDir}/plugins/codegraph/grammars；codegraph-assets.ts 的目录候选顺序里它排在 bundled 之前。
// 这里改做反向动作：清掉历史上捆进 resources/worker 的残留，否则 electron-builder 会把旧 dll 又扫进包。
function pruneBundledCodeGraphGrammars() {
  const grammarsDir = join(projectRoot, 'resources/worker/codegraph-worker/grammars')
  if (!existsSync(grammarsDir)) {
    console.log('[AOT Worker] 无随包 CodeGraph grammars，跳过清理')
    return
  }
  rmSync(grammarsDir, { recursive: true, force: true })
  console.log(`[AOT Worker] 已移除随包 CodeGraph grammars：${grammarsDir}（改为按需下载）`)
}

pruneBundledCodeGraphGrammars()

// 显示产物
const result = execSync(`dir "${workerDir}\\WishfulClaw.Worker.exe"`, { shell: 'C:\\Windows\\System32\\cmd.exe' }).toString()
console.log('[AOT Worker] 产物:')
console.log(result)
console.log('[AOT Worker] 完成！')