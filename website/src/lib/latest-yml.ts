/**
 * 发布清单（`latest.yml`）的解析 —— 官网下载按钮的数据源（S-129）。
 *
 * 这份清单由 electron-builder 打包时自动生成（本地产物 `release/latest.yml`），与 app 内
 * 自动更新读的**是同一份**：官网侧只用 `version` 与安装包文件名，其余字段（sha512 / size /
 * releaseDate）留给 updater。发版因此只覆盖一个文件，站点不再有需要手改的版本数据。
 *
 * 清单与安装包落在**站点目录之外**的下载目录（`/data/downloads/wishfulclaw`，nginx 用
 * `/downloads` 映射过来）—— 官网的静态发布是**整体替换站点目录**，资产放站点里会被清掉
 * （`scripts/deploy.mjs` 的 `downloadsDir` 注释即此意）。
 *
 * 换掉的是原来由 `deploy.mjs` 生成的 `public/latest.json`：它是生成物却要进版本库、改了还得
 * 重新构建站点才生效，且里面没有 blockmap / latest.yml 的落点（官网侧差分因此不成立）。
 *
 * YAML 只取两个顶层字段，格式由 electron-builder 固定生成，故用正则而不引入 YAML 库。
 * 取不到就返回 undefined，调用方据此退化为置灰按钮（页面照常渲染）。
 */

export interface ReleaseManifest {
  /** 版本号，如 `0.2.35` */
  version: string
  /** 安装包文件名（相对下载目录），如 `wishful-claw-0.2.35-setup.exe` */
  setupFile: string
}

/** 去掉 YAML 标量外层成对的单/双引号（builder 给 releaseDate 加引号，version / url 不加）。 */
function unquote(raw: string): string {
  const value = raw.trim()
  const quoted =
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))
  return quoted ? value.slice(1, -1) : value
}

/**
 * 解析发布清单。返回 undefined 表示这份内容不是我们要的形状（取不到就没得渲染）。
 *
 * `files:` 下的第一条即主安装包（builder 只列一个）；`setupFile` 只取文件名，杜绝清单里
 * 出现 `../` 之类把下载链接带出下载目录。
 */
export function parseReleaseManifest(text: string): ReleaseManifest | undefined {
  const versionMatch = /^version:[ \t]*(.+)$/m.exec(text)
  const urlMatch = /^[ \t]*-[ \t]*url:[ \t]*(.+)$/m.exec(text)
  if (!versionMatch || !urlMatch) return undefined

  const version = unquote(versionMatch[1])
  const setupFile = unquote(urlMatch[1]).split(/[\\/]/).pop() ?? ''
  if (!version || !setupFile) return undefined

  return { version, setupFile }
}

/**
 * 安装包在站点上的地址。相对路径（`./downloads/<文件名>`）：
 * 根部署 / 子目录部署都解析得到，与域名也解耦。
 */
export function releaseFileUrl(manifest: ReleaseManifest): string {
  return `./downloads/${manifest.setupFile}`
}
