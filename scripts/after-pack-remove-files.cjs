// afterPack hook: 删除 Electron 壳中不必要的文件以减小包体积，
// 并在产物上做一次「公开面合规」硬拦截（S-318）。
// 参考：https://www.electron.build/configuration/configuration#afterpack

// ── S-318 硬拦截 ──────────────────────────────────────────────────
// 公开仓以后只做 bugfix，靠记性防不住「修 provider bug 时顺手把订阅额度 OAuth
// 冒充带回来」，所以扫的是**产物**而不是源码。
//
// 关键字取「冒充证据」本身（客户端标识头与厂商内部端点），不取厂商名裸词 ——
// `provider-materialization.ts` 的 REMOVED_BUILTIN_IDS 必须留着那几个 builtinId
// 才能把老数据里的僵尸记录剔掉，那是清理痕迹，不是病灶。
//
// 分刀已完成：刀 1 收 WorkBuddy 一系（X-IDE-* / X-Agent-* / X-Product /
// copilot.tencent.com / workbuddy.ai），刀 2 收订阅额度 OAuth 三家
// （codex / copilot / moonshot 套餐）。
const FORBIDDEN_MARKERS = [
  'X-IDE-Name',
  'X-IDE-Type',
  'X-IDE-Version',
  'X-Product',
  'X-Agent-Intent',
  'X-Agent-Purpose',
  'copilot.tencent.com',
  'workbuddy.ai',
  'codex_cli_rs',
  'GitHubCopilotChat',
  'KimiCLI',
  'chatgpt.com/backend-api/codex',
  'api.githubcopilot.com',
  'api.kimi.com/coding'
]

function findMarkers(buffer, markers) {
  // latin1 把字节一一映射成字符，UTF-8 关键字按同编码转一次即可做子串查找；
  // 这样不必解包 asar，也不依赖 @electron/asar。
  const hay = buffer.toString('latin1')
  return markers.filter((marker) => hay.includes(Buffer.from(marker, 'utf8').toString('latin1')))
}

function scanFile(filePath, markers, hits) {
  let buffer
  try {
    buffer = require('fs').readFileSync(filePath)
  } catch {
    return
  }
  for (const marker of findMarkers(buffer, markers)) {
    hits.push(`${marker} → ${filePath}`)
  }
}

function scanTree(dir, markers, hits) {
  const fs = require('fs')
  const path = require('path')
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      scanTree(full, markers, hits)
    } else if (entry.isFile()) {
      scanFile(full, markers, hits)
    }
  }
}

function verifyNoImpersonation(appOutDir) {
  const fs = require('fs')
  const path = require('path')
  const resourcesDir = path.join(appOutDir, 'resources')
  if (!fs.existsSync(resourcesDir)) {
    console.log('[afterPack] 跳过冒充扫描：未找到 resources/')
    return
  }

  const hits = []
  scanTree(resourcesDir, FORBIDDEN_MARKERS, hits)

  const asarPath = path.join(resourcesDir, 'app.asar')
  const scanned = fs.existsSync(asarPath)
    ? `含 app.asar ${(fs.statSync(asarPath).size / 1024 / 1024).toFixed(1)}MB`
    : '未找到 app.asar'

  if (hits.length > 0) {
    throw new Error(
      `[afterPack] 产物命中已从公开面剔除的冒充特征，构建中止（S-318）：\n  ` +
        hits.join('\n  ') +
        `\n\n这些是「订阅额度 OAuth 冒充」的证据串，私有仓另有分支保留该能力。` +
        `若本次是有意恢复，请先改 S-318 的裁定再动这里的关键字表。`
    )
  }

  console.log(`[afterPack] 冒充特征扫描通过（${FORBIDDEN_MARKERS.length} 个关键字，${scanned}）`)
}

exports.default = async function (context) {
  const { appOutDir } = context
  const fs = require('fs')
  const path = require('path')

  // 可安全删除的文件列表（保留时不影响功能，删除可节省约 20MB）
  const removeFiles = [
    'LICENSES.chromium.html',  // 许可证文本，20MB
  ]

  for (const file of removeFiles) {
    const filePath = path.join(appOutDir, file)
    if (fs.existsSync(filePath)) {
      const size = fs.statSync(filePath).size
      fs.unlinkSync(filePath)
      console.log(`[afterPack] 已删除 ${file} (${(size / 1024 / 1024).toFixed(1)}MB)`)
    }
  }

  verifyNoImpersonation(appOutDir)
}
