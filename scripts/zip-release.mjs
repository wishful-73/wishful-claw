// Compress win-unpacked/ to a zip archive.
// Uses adm-zip (already a project dependency) to avoid Defender locking
// with PowerShell's Compress-Archive.
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const pkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'))
const version = pkg.version

const srcDir = resolve(projectRoot, 'release', 'win-unpacked')
const zipPath = resolve(projectRoot, `release/WishfulClaw-v${version}-win-x64.zip`)

console.log(`[zip-release] 正在压缩: release/win-unpacked/ -> ${zipPath}`)

const zip = new AdmZip()

function addDir(dirPath, zipPathPrefix) {
  const entries = readdirSync(dirPath)
  for (const entry of entries) {
    const fullPath = join(dirPath, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      addDir(fullPath, join(zipPathPrefix, entry))
    } else {
      zip.addLocalFile(fullPath, zipPathPrefix)
    }
  }
}

addDir(srcDir, 'win-unpacked')
zip.writeZip(zipPath)

console.log(`[zip-release] 完成! ${zipPath}`)