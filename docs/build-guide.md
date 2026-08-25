# Wishful Claw 构建与打包指南

## 构建工具链

| 工具 | 用途 | 配置位置 |
|------|------|----------|
| `electron-vite` | 编译 Electron 主进程 + Preload + React 渲染进程 | `electron.vite.config.ts` |
| `electron-builder` | 打包为安装包/绿色版 | `electron-builder.yml` |
| `dotnet publish` | 编译 .NET Worker 子进程（Native AOT 自包含） | `scripts/publish-aot-worker.mjs` |

## 前置条件

- Node.js 20+
- .NET 10 SDK
- Visual Studio 2022 Build Tools（含 C++ 工具链，用于编译 node-pty 等原生模块和 Native AOT）

## 脚本命令

### 开发

```bash
npm run dev          # 仅前端开发（需先手动编译 .NET Worker）
npm run dev:full     # 编译 .NET Worker + 前端开发（推荐）
```

### 打包

```bash
npm run pack                     # 前端打包 + electron-builder --dir（解压目录）
npm run pack:full                # 完整流程：编译 AOT Worker → 前端打包 → 解压目录
npm run pack:zip                 # 打包并生成绿色版 zip 压缩包
npm run pack:installer           # 前端打包 + NSIS 安装器
npm run pack:installer:full      # 完整流程：编译 AOT Worker → 前端打包 → NSIS 安装器
```

### 输出产物

| 命令 | 产物路径 | 说明 |
|------|----------|------|
| `npm run pack` | `release/win-unpacked/` | 解压目录，可直接运行 `WishfulClaw.exe` |
| `npm run pack:full` | `release/win-unpacked/` | 同上，含最新 AOT Worker |
| `npm run pack:installer` | `release/WishfulClaw-*-setup.exe` | NSIS 安装器 |

## 打包流程

### 1. 编译 .NET Worker（Native AOT）

```bash
npm run build:worker:prod
```

使用 **Native AOT** 编译（`PublishAot=true`），输出到 `resources/worker/`：

```bash
dotnet publish src/runtime/WishfulClaw.Worker/WishfulClaw.Worker.csproj \
  -c Release \
  -r win-x64 \
  -p:PublishAot=true \
  -o resources/worker
```

AOT 编译后约 15MB（含 SQLite 运行时），目标机器不需要安装 .NET 运行时。

> **每次打包都必须重新编译 Worker**（使用 `pack:full` 或 `pack:installer:full`），信不过历史编译。
> 仅打包前端（`pack` / `pack:installer`）不会重新编译 Worker。

### 2. 编译前端

```bash
npm run build
# 或 npx electron-vite build
```

输出到 `out/` 目录（main / preload / renderer 三个子目录）。

### 3. electron-builder 打包

```bash
npx electron-builder --dir          # 绿色版（解压目录）
npx electron-builder --win           # NSIS 安装器
```

## electron-builder.yml 配置说明

### 核心原理：Vite 已打包绝大部分依赖

`electron-vite` 编译时会将 TS/React 源码及绝大多数 npm 依赖打包到 `out/` 目录中。运行时 `node_modules` 中只需要保留两类包：

1. **原生模块** — 含 `.node` 二进制文件，Vite 无法打包（如 `node-pty`、`@jitsi/robotjs`）
2. **动态 require 子路径的包** — 使用 `require("pkg/subpath")` 方式加载，Vite 无法静态分析（如 `ajv`、`protobufjs`）

### 白名单策略

`electron-builder.yml` 的 `files` 字段采用**白名单策略**：

```yaml
files:
  - out/**/*                         # Vite 编译产物（主进程 + 渲染进程 + preload）
  - package.json
  - '!node_modules/**/*'             # 先排除全部 node_modules
  # 再按白名单收入运行时必需包
  - node_modules/node-pty/**
  - node_modules/@jitsi/**
  - node_modules/ajv/**
  - node_modules/protobufjs/**
  # ...（完整列表见 electron-builder.yml）
```

**新增依赖后无需手动维护排除规则** — 只要 Vite 能打包，就不需要出现在白名单里。只有当新依赖满足以下条件之一时，才需要加入白名单：

- 包含 `.node` 原生二进制文件
- 使用 `require("pkg/subpath")` 动态子路径加载
- 在 `electron.vite.config.ts` 的 `main.build.rollupOptions.external` 中被显式排除

> **如何验证一个新依赖是否需要加入白名单？**
> 打包后运行应用，如果控制台报 `MODULE_NOT_FOUND`，说明 Vite 没能打包这个包，需要加入白名单。

### 白名单完整清单

| 包 | 原因 | 大小 |
|------|------|------|
| `node-pty` | 原生模块，Vite external | 9.0M |
| `@jitsi/robotjs` | 原生模块，createRequire 动态加载 | 1.1M |
| `node-gyp-build` | 原生模块加载器（node-pty / robotjs 共用） | 28K |
| `ajv` | require("ajv/dist/runtime/*") 动态子路径 | 686K |
| `ajv-formats` | require("ajv-formats/dist/formats") 动态子路径 | 28K |
| `protobufjs` | require("protobufjs/minimal") 动态子路径 | 1.3M |
| `@protobufjs/*` | protobufjs/minimal 的传递依赖（6 个子包） | 106K |
| `long` | protobufjs 传递依赖 | 113K |
| `fast-deep-equal` | ajv 传递依赖 | 28K |
| `fast-uri` | ajv 传递依赖 | 76K |
| `json-schema-traverse` | ajv 传递依赖 | 34K |
| `require-from-string` | ajv 传递依赖 | 9K |
| **合计** | | **~13.5M** |

### 其他配置项

| 配置 | 值 | 说明 |
|------|------|------|
| `electronLanguages` | `en-US`, `zh-CN` | 只保留中英文，删除其余 50+ 语言包，节省约 40MB |
| `afterPack` | `scripts/after-pack-remove-files.cjs` | 打包后删除 `LICENSES.chromium.html`（~20MB） |
| `asarUnpack` | `resources/**`, `node-pty`, `@jitsi/robotjs`, `node-gyp-build` | 原生模块从 asar 解包（.node 文件不能在 asar 内运行） |
| `npmRebuild` | `false` | 跳过原生模块重建，依赖 prebuilt 二进制文件 |

### 已知问题

**`dingtalk-stream` 未安装但被 Vite external 引用：**

`electron.vite.config.ts` 中 `external: ['dingtalk-stream', 'node-pty']`，但 `dingtalk-stream` 不在 `package.json` dependencies 中，也没有安装。如果 DingTalk Stream 功能被触发，会 `MODULE_NOT_FOUND` 崩溃。需要安装该包或从 external 列表移除。

## 包体积构成

### 打包后总体积（~357MB 实测）

| 组件 | 大小 | 占比 | 可优化 |
|------|------|------|--------|
| `WishfulClaw.exe`（Electron 壳 + Chromium） | 216MB | 60% | 否 |
| Electron 运行时文件（.pak / .dll 等） | ~65MB | 18% | 少量 |
| `resources/app.asar`（应用代码） | 48MB | 13% | 是 |
| `resources/app.asar.unpacked/`（原生模块） | 10MB | 3% | 否 |
| `resources/worker/`（AOT Worker + SQLite） | 17MB | 5% | 否 |
| `locales/` | 1.1MB | <1% | 已裁剪 |

### app.asar 内部构成（48MB 实测）

| 组件 | 大小 | 说明 |
|------|------|------|
| `out/renderer/` | 45MB | Vite 编译的渲染进程（Monaco / Mermaid / PDF 等重包） |
| `out/main/` | 2.5MB | Vite 编译的主进程 |
| `node_modules/` | 13MB | 白名单保留的运行时依赖（12 个包） |

### renderer 产物 TOP 5（45MB 中的大头）

| 文件 | 大小 | 是什么 |
|------|------|--------|
| `ts.worker` | 13MB | Monaco TypeScript 语言服务 |
| `index`（主 bundle） | 7.9MB | React + 全部业务代码 |
| `setup` | 7MB | Monaco editor 初始化 |
| `css.worker` | 1.8MB | Monaco CSS 语言服务 |
| `mermaid.core` | 1.1MB | 流程图引擎 |

> 这部分是 Vite 编译产物，electron-builder 无法干预。后续优化方向是 renderer 层面的 dynamic import 懒加载。

## 体积优化方向

| 优先级 | 方向 | 预期收益 | 状态 |
|--------|------|---------|------|
| — | electron-builder 排除规则 | 已到天花板 | 完成 |
| — | electronLanguages 裁剪 | 节省 ~40MB | 完成 |
| — | afterPack 删除 chromium license | 节省 ~20MB | 完成 |
| — | 白名单策略替代黑名单 | 节省 ~20MB | 完成 |
| P1 | Monaco workers 按需加载 | 节省 ~15MB | 待讨论 |
| P2 | Mermaid / Cytoscape dynamic import | 节省 ~3MB | 待讨论 |
| P3 | PDF.js / xlsx 懒加载 | 节省 ~2MB | 待讨论 |

### 为什么 electron-builder 排除规则已到天花板

app.asar 中的 `out/` 目录是 Vite 编译产物，electron-builder 只负责打包，无法改变其内容。`node_modules` 中通过白名单策略已从 33MB（180+ 包）精简到 13MB（12 个包），进一步压缩需要从 renderer 源码层面入手（dynamic import 拆分 chunk）。

## 参考来源

打包方案参考了 `D:\claw\OpenCowork` 项目：

| 参考文件 | 关键内容 | 对应 Wishful Claw 文件 |
|----------|---------|----------------------|
| `electron-builder.yml` | 构建配置、files 排除规则 | `electron-builder.yml`（改为白名单策略） |
| `scripts/publish-native-worker.mjs` | .NET Worker AOT 编译脚本 | `scripts/publish-aot-worker.mjs` |
| `package.json` scripts | 打包命令 | `package.json` scripts |

与 OpenCowork 的主要差异：Wishful Claw 使用白名单策略（只列出运行时必需包），OpenCowork 使用黑名单策略（逐个排除前端包）。白名单策略更简洁、更安全，新增依赖不需要手动维护排除规则。

## 常见问题

### Q: 打包后运行报 `MODULE_NOT_FOUND`

A: 新增依赖可能使用了动态 require 子路径或包含原生二进制。检查 `out/main/` 中是否有该包的 require 调用，如果有，将该包加入 `electron-builder.yml` 的白名单。

### Q: electron-builder 报错 "EPERM: operation not permitted"

A: 删除 `release/` 目录后重试：
```bash
rm -rf release/
npm run pack
```

### Q: 打包后运行找不到 Worker

A: 检查 `release/win-unpacked/resources/worker/` 是否存在 `WishfulClaw.Worker.exe`。
如果缺失，先运行 `npm run build:worker:prod` 再重新打包。

### Q: AOT 编译报错缺少 cl.exe / link.exe

A: Native AOT 需要 Visual Studio 的 "Desktop development for C++" 工作负载。在 Visual Studio Installer 中勾选安装后重试。
