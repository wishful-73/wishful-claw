# Plan: S-186 官网下载按钮改走 GitHub + 国内加速站（下拉多源）+ 中转页 `/go`

> 所属迭代：iter-v2-39 ｜ 需求明细：[`../requirements/S-186.md`](../requirements/S-186.md)
> 与 [S-182](../requirements/S-182.md) **一起收口**：S-186 负责**前端**（下载按钮 + 中转页），S-182 负责**服务器 nginx 与聚合**（`/go` 的 location 与 `clicks` 日志）。
> 类型：**官网侧** —— `website/` 独立轨道，**主仓业务代码零改动**，**软件内更新链路（`electron-updater` / `latest.yml` / blockmap / 差分）零改动**。
>
> ⚠️ **本文件是规划态快照，勿当现行口径读。** 实施分两刀：`2be923fb`（初版，落地本文件描述的中转页 `/go?src=<源>&u=<GitHub直链>`）+ **`bf4bd16f`**（2026-10-11 收紧：把 `u` 参数**整体删掉**，只留 `src=<源名>`）。**现行口径以 [`../requirements/S-186.md`](../requirements/S-186.md) 的 §九 实施记录 与 §9.1 为准。**

---

## 一、目标

把官网 `/download` 页的下载按钮，从「本站相对路径 `./downloads/{setupFile}`」改为「**GitHub 直链 + 国内加速站前缀**」，按钮变**下拉多源**；并新增官网第四个入口页 **`/go`（中转页）**，使每一次「官网点击」都先经过自己网站（供 S-182 用 nginx 日志计数），再跳往加速站。

---

## 二、口径（已定，不再问）

| # | 事项 | 定 |
|---|---|---|
| 1 | 加速站数量 | **4 个全上**（老大 10:21 裁定项 c）；实测可用的排前面 |
| 2 | 下拉必须保留 | **「本站直链」一项**（老大 10:21 裁定项 c）—— 既兜底，也是 nginx 能数到的来源 |
| 3 | 官网点击的 `href` | **不直指第三方**，改指自己官网的 **`/go?src=<源>&u=<GitHub直链>`**（老大 10:21 的 b；10:38 定为中转页方案） |
| 4 | 软件内自动更新 | **不调整**（老大明确） |

### 实施细节（助手拍定，非老大裁定）

| 事项 | 定案 | 理由 |
|---|---|---|
| 下拉形态 | **主按钮 = 默认源（一次点击直接下）**，右侧箭头展开菜单换源 | 少一次点击；换源是少数情况 |
| 默认源 | **`ghproxy.net`** | 仅有的 2 个实测可用站之一，且回 **206**（支持断点续传） |
| 选项集合 | `ghproxy.net` → `v6.gh-proxy.org` → `ghproxy.homeboyc.cn` → `gitproxy.click` → **GitHub 直链** → **本站直链** | 实测可用的排前，失效的保留但标注；境外用户可走 GitHub 直链 |
| 来源说明 | 按钮下方一行小字：**「下载由第三方公益加速站提供；若某个源不可用，请换一个」** | 老大在 S-186 §五 第 4 条留作开放问题，属实施细节 |
| 文件名兜底 | **接受**「文件名由对方决定」 | 加速站是否透传 `Content-Disposition` 不可控；不为此加逻辑（S-186 §五 第 6 条） |
| 中转页停留 | **不加人为延迟**，`location.replace()` 立即跳 | 无感最好；兜底链接常驻 |

---

## 三、步骤清单

- [ ] **步骤 1：常量与 URL 语义**
  - `website/src/content/site.ts` 新增：`GITHUB_RELEASES_BASE = 'https://github.com/wishful-73/wishful-claw/releases/download'`、`DOWNLOAD_ACCELERATORS: { id, label, prefix, note? }[]`（5 个加速/直连源，本站直链单列）。
  - `website/src/lib/latest-yml.ts`：保留「版本号 / `setupFile` 仍从官网 `latest.yml` 读」不变；新增 `githubDirectUrl(manifest)` = `${GITHUB_RELEASES_BASE}/v${version}/${setupFile}`、`acceleratedUrl(prefix, direct)`、`goUrl(src, u)`（`/go?src=…&u=encodeURIComponent(…)`）。
  - **验证检查点**：`npm run typecheck`（`website/`）零错误；三个函数各用一条 `node -e` 或临时断言核过拼接结果形态。
- [ ] **步骤 2：新建中转页 `/go`（页面本身）**
  - `website/go.html`（照 `download.html` 骨架，改 `<title>`，引 `./src/go-main.tsx`，根节点 id 与其它页一致）。
  - `website/src/go-main.tsx`（挂载，照 `download-main.tsx`）。
  - `website/src/go-page.tsx`：读 `?src=` 与 `?u=`，`decodeURIComponent` 还原；渲染 logo + 「正在前往下载…」+ 源名 + **兜底下载链接**；`useEffect` 里 `location.replace(target)`；缺参或协议非 `https:` 时**不跳**、只显示兜底与提示。
  - **验证检查点**：`website: npm run dev` 后访问 `/go.html?src=ghproxy.net&u=<encoded>` —— 页面显示正确、发生跳转；故意去掉 `u` ⇒ 不跳且给出提示。
- [ ] **步骤 3：接入 MPA 构建**
  - `website/vite.config.ts`：`PAGES` 加 `'go'`；`rollupOptions.input` 加 `go: resolve(__dirname, 'go.html')`。
  - **验证检查点**：`npm run build` 通过；`dist/` 下产出 `go.html` 与对应 chunk。
- [ ] **步骤 4：下载按钮改下拉多源**
  - `website/src/components/download-buttons.tsx`：Windows 按钮由单个 `<a href="./downloads/…">` 改为「主按钮 + 源菜单」；每个选项的 `href` = `goUrl(源)`（**本站直链选项除外**，它直接指 `./downloads/{setupFile}`，不经 `/go`）；macOS / Linux 置灰逻辑**原样保留**；加一行来源说明小字。
  - ⚠️ **不再依赖 `download` 属性**：跨域时浏览器本就忽略它（`download-buttons.tsx` 原注释已写明），现改走 `/go` 中转，由加速站 / GitHub 的 `Content-Disposition` 决定。
  - **验证检查点**：`website: npm run typecheck` 零错误；`npm run dev` 实际点开下拉，菜单项 `href` 形态正确（加速站项指向 `/go?...`，本站直链项指向 `./downloads/...`）。
- [ ] **步骤 5：中转页与统计打通（与 S-182 联调）**
  - 依赖 S-182 的 nginx：`location = /go` + 独立日志 `wishfulclaw-clicks.log` + 尾斜杠 301 正则补 `go`。
  - 部署：`node scripts/deploy.mjs site`（站点）+ S-182 那条服务器配置改动。
  - **验证检查点**：线上点一次加速站选项 ⇒ `wishfulclaw-clicks.log` 多一条含 `/go?src=…` 的请求；点一次本站直链 ⇒ **不进** `clicks`，进 `downloads` 日志。
- [ ] **步骤 6：真实安装包复测（S-186 §三 的开工前置）**
  - 用**真实 exe（约 113 MB）**对 4 个加速站逐个复测：能否下载 / 能否断点续传 / 实际速率 / `Content-Disposition` 是否透传。
  - 结论回填 `requirements/S-186.md` §三（把小文件探测结论升级为真实资产结论），并在下拉里据实调整「可用 / 不可用」标注。
  - **验证检查点**：每个源一条实测结论（HTTP 状态 + 速率 + 是否 206）；不可用的源在下拉中标注或降位。

---

## 四、涉及文件

| 文件 | 动作 |
|---|---|
| `website/src/content/site.ts` | 改 —— 新增加速站常量 + GitHub releases base |
| `website/src/lib/latest-yml.ts` | 改 —— 新增 GitHub 直链 / 加速 / `/go` 三个 URL 构造函数（`releaseFileUrl` 保留给本站直链项） |
| `website/src/components/download-buttons.tsx` | 改 —— 单按钮 → 主按钮 + 源菜单 |
| `website/go.html` | **新建** |
| `website/src/go-main.tsx` | **新建** |
| `website/src/go-page.tsx` | **新建** |
| `website/vite.config.ts` | 改 —— `PAGES` 与 `rollupOptions.input` 各加 `go` |
| `website/src/index.css`（或就近） | 改 —— 下拉 / 中转页所需的最少样式 |

**不动**：`website/src/lib/site-data.ts` 的 `latest.yml` 读取链路、macOS / Linux 置灰逻辑、主仓 `src/**`、`.github` 工作流。

---

## 五、参考源码

- 本仓 `website/src/download-page.tsx` / `download-main.tsx` / `download.html` —— `/go` 页与入口的**照抄模板**（同一 MPA 形态）。
- 本仓 `website/src/components/site-header.tsx` / `ui.tsx` —— 可复用的容器与排版件。
- `docs/plans/iter-v2-36/`（官网成为完整更新源那一迭代）—— 官网下载链路的历史口径来源；`latest.yml` 读取链路不变的那部分以它为准。
- 无外部参考项目（官网为自建，无 OpenCowork / KodaClaw 对应物）。

---

## 六、风险与已知限制

1. **加速站是公益服务**，随时失效（本次实测 4 中 2 已不可用）⇒ 多源下拉是缓解手段，**不保证长期可用**。
2. **应用内自动更新仍走 128 KB/s 的服务器**，本需求不调整（老大明确）⇒ 差分失效回退全量时仍慢。
3. **走第三方意味着下载请求经过第三方**（URL 只含版本号与文件名，无敏感信息）。
4. **`/go` 页是多一个入口**：需同步 nginx 尾斜杠 301 正则（**归 S-182**），否则 `/go/` 会 404。
