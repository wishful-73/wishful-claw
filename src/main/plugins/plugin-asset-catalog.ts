/*
 * 内置资产目录（S-242）—— 主程序侧的表，插件看不见 URL。
 *
 * 为什么表在主程序而不是插件清单里：插件只报 id，去哪拿、多大、什么哈希由我们决定。
 * 换源、下架、国内分流都不用让插件跟着发版；反过来，插件也没法把一个来路不明的
 * 地址塞给用户。
 *
 * ⚠️ 填表纪律（老大 2026-10-27 14:19 定）：**size 与 sha256 必须实测**，不许先填估算值。
 * 假哈希比没有哈希更危险 —— 校验永远失败，用户看到的是「文件损坏」，实际是表的错。
 *
 * 第一个真实条目（`demo/logo.png`）是**验收演示用**：它指向官网自己的 logo.png，
 * 体积与哈希都实测过，任何一台机器点一下就能跑通「下载 → 校验 → 就绪」全程。
 * 第一批业务条目（QwenASR exe / 模型）等拿到真实文件再补，补的时候照它的样子写实测值。
 */

import type { PluginAssetPublicInfo } from '../../shared/plugin-asset-types'

export type PluginAssetKind = 'binary' | 'model' | 'data'

export interface PluginAssetCatalogEntry {
  /** 全程序唯一键，带命名空间前缀。 */
  id: string
  /** 用户看到的名称。 */
  name: string
  /** 一句话用途 —— 下载前必须让用户知道自己在下什么。 */
  desc: string
  kind: PluginAssetKind
  /** 字节。用户点下载之前必须看到这个数。 */
  size: number
  /** 小写十六进制 sha256。 */
  sha256: string
  /** 多源按序试，第一个通的就下。 */
  urls: string[]
}

/** 目录表 → 渲染端可见投影（去掉 url / sha256，见 shared/plugin-asset-types.ts）。 */
export function toPublicAssetInfo(entry: PluginAssetCatalogEntry): PluginAssetPublicInfo {
  return {
    id: entry.id,
    name: entry.name,
    desc: entry.desc,
    kind: entry.kind,
    size: entry.size
  }
}

/**
 * 内置目录。**内置，不做远端热更** —— 路径过期了改表发版（老大 14:19）。
 */
const CATALOG: PluginAssetCatalogEntry[] = [
  {
    id: 'demo/logo.png',
    name: '示例资产（基座验收）',
    desc: '插件基座验收用的示例文件：点一次就能跑通下载、校验、就绪全程，随时可删。',
    kind: 'data',
    // 实测 2026-10-29，来源 https://wishful-claw.work/logo.png
    size: 472158,
    sha256: 'e1c78216baed078fe5507bf3b350b93a0cb9546768c0da3405020752c05999cd',
    urls: ['https://wishful-claw.work/logo.png']
  },
  {
    id: 'codegraph/win-x64.zip',
    name: '代码图谱',
    desc: '代码图谱引擎与语言包（18 种语言），装完即可索引项目、做符号导航与影响分析。',
    kind: 'binary',
    // 实测 2026-11-03，GitHub Release `codegraph-v1` 挂在**代码图谱独立仓**
    // `wishful-73/wishful-claw-codegraph`（纯资产 release，独立 tag 不跟主版本走）。
    // **匿名**下载（不带任何 Authorization）：HTTP 302 → 200 / 10133006 字节 / sha256 对阵一致。
    //
    // 包内（引擎与语言包**合一**，2026-11-03 老大定方案 B：代码图谱整体走插件资产下载）：
    //   bin/codegraph.exe       AOT 单文件引擎（MCP stdio server）      9.56 MB
    //   bin/e_sqlite3.dll       SQLite 原生库                            1.89 MB
    //   bin/grammars/*.dll      tree-sitter 运行时 + 18 个语言 grammar   42.54 MB
    //   未压缩 53.99 MB → 压缩 9.66 MB（原生代码压缩率约 5.6:1）
    //
    // ⚠️ grammars 必须挂在 bin/ 下，不能与 bin/ 平级：引擎的
    //    CodeGraphNativeLibraryResolver.ProbeDirs() 查找顺序是
    //    WISHFULCLAW_CODEGRAPH_GRAMMARS_DIR → {AppContext.BaseDirectory}/grammars → BaseDirectory，
    //    而 BaseDirectory 就是 bin/，所以 bin/grammars 不传环境变量也能命中。
    //
    // 实测索引（解压产物真跑）：200 文件 / 4462 节点 / 10533 边 / 3027 ms ⇒ 18 个 grammar 全部加载成功。
    //
    // 注：GitHub 会把仓库里唯一的正式 release 强行当作 /releases/latest，
    // make_latest:false 拦不住。但更新弹窗的「查看发布页」指向**主仓**的 latest
    // （wishful-73/wishful-claw），与本仓无关，因此无影响。
    // 仓库必须保持 public —— 私有仓的 release 资产匿名请求一律 404，客户端拿不到。
    //
    // 旧的 `codegraph/grammars-win-x64.zip`（纯语言包 / grammars-v1）已废弃：引擎当时还在安装包里，
    // 只有语言包需要下载；现在两者合一，不再有消费者。
    size: 10133006,
    sha256: '90c4babfb020408fb5098f6a1b010c85c058ae19a034ea06542a8a791d510ff8',
    urls: [
      'https://github.com/wishful-73/wishful-claw-codegraph/releases/download/codegraph-v1/codegraph-win-x64.zip'
    ]
  }
]

/** 目录表的只读视图。渲染端要展示「需下载 XX MB」时读它。 */
export function listCatalog(): PluginAssetCatalogEntry[] {
  return CATALOG.map((entry) => ({ ...entry, urls: [...entry.urls] }))
}

export function findCatalogEntry(id: string): PluginAssetCatalogEntry | null {
  const key = (id ?? '').trim()
  if (!key) return null
  return CATALOG.find((entry) => entry.id === key) ?? null
}

/**
 * 资产 id → 落盘相对路径（相对共享资产根）。
 *
 * 按 id 的命名空间建目录：`asr/qwen3-asr-0.6b` → `asr/qwen3-asr-0.6b`。
 * 只有最后一段是文件名时才是文件，`kind === 'model'` 的目录型资产按最后一段建目录 —— 
 * 本号只交付单文件直下，目录型留给第一个真实插件时再定（需求 §7）。
 */
export function resolveAssetRelativePath(id: string): string {
  return id
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join('/')
}

/** 「489 MB」这种给人看的体积在 `shared/plugin-asset-types.ts` —— 渲染端也要用。 */
