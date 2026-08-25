// afterPack hook: 删除 Electron 壳中不必要的文件以减小包体积
// 参考：https://www.electron.build/configuration/configuration#afterpack
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
}
