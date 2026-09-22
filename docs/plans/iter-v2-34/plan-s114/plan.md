# Plan: S-114 官网独立页 —— 使用指引 + 更新日志

## 目标

`website/` 新增两个独立页面：`/guide`（使用指引）与 `/changelog`（更新日志），并把顶栏导航收敛成「两份文档 + FAQ」。

## 口径来源与已拍板事项（2026-09-21 老大）

| # | 事项 | 裁定 |
|---|---|---|
| 1 | 指引内容来源 | **官网自维一份**（`website/content/user-guide.md`），不直读 `docs/user-guide.md` |
| 2 | 指引范围 | **16 章全量搬**（结构对齐 app 内指引），措辞按官网口径改写 |
| 3 | 顶栏腾位 | **锁三项**：使用指引 / 更新日志 / FAQ（+ 安装按钮）。页内锚点项从顶栏移除 |
| 4 | 首页日志区块 | **留最近 5 条 +「查看全部 →」** 跳独立页 |
| 5 | 日志数据源 | **B：官网自维一份**（`website/content/changelog.md`），**彻底不碰 GitHub API** —— 无限流、离线可看、正文可被 SEO 抓到 |

### 分工口径（防漂）

`docs/user-guide.md` 是 **app 内全量权威**（`lib/user-guide.ts` 打开它，钉 main 分支）；`website/content/user-guide.md` 是 **官网投影面**，结构对齐但**不要求逐字同步**。两份的对应关系与"改哪份要想到另一份"写进 `website.md`，不靠记忆。

## 关键工程决策

| 项 | 决策 | 依据 |
|---|---|---|
| Markdown 渲染 | `react-markdown@^10` + `remark-gfm@^4` + `@tailwindcss/typography`，**版本对齐主仓** | 主仓 `package.json:67,105,111` 已在用同一套 ⇒ 不算引新工具链（website.md 三节约束仍成立）；指引含 52 行 GFM 表格，必须有 gfm |
| 内容进页面 | 构建期 `import md from '../content/*.md?raw'` 内联 | 内容在 `website/` 目录内，**不需要** `server.fs.allow`（那是直读根 `docs/` 才要）；无运行时 fetch ⇒ 无 404、无闪烁、SEO 可抓 |
| 目录锚点 | 自写 `lib/markdown-toc.ts`：渲染前预扫 `^## ` 建「标题 → id」表，`components.h2` 查表挂 id | 中文标题 slug 规则要可控（GitHub 式规则对中文会产出 `#1-安装与启动` 这类要复刻的形态）；不为此再引 `rehype-slug` |
| 日志解析 | `lib/changelog.ts` 按 `^## ` 切节 → `{ version, date, body }[]`，首页取前 5 | 单一数据源，首页与独立页共用；`useRecentReleases`（GitHub API）**整条退役删除** |
| 页面形态 | 两个新 html 入口 + `guide-main.tsx` / `changelog-main.tsx`，`vite.config.ts` 的 `rollupOptions.input` 加两项 | 与既有 `download.html` 同构，MPA 无 router |
| 文档页外壳 | 共用 `components/doc-page.tsx`：顶栏 + 左 sticky 目录 + 右正文（typography prose） | 两页版式一致，避免第二份布局代码 |

## 步骤清单

- [✓] 1. 依赖与骨架：`website/package.json` 加 3 个依赖（版本对齐主仓）；`vite.config.ts` input 加 `guide` / `changelog`；新建 `guide.html`、`changelog.html`、`src/guide-main.tsx`、`src/changelog-main.tsx`。验证：`npm install` 成功 + dev 下两页能开（先空壳）
- [✓] 2. 文档页外壳与 TOC：`src/lib/markdown-toc.ts`（预扫标题建 id 表 + slug）+ `src/components/doc-page.tsx`（左目录 sticky、右正文 prose、`index.css` 挂 `@plugin "@tailwindcss/typography"`）。验证：`npx tsc -p tsconfig.json --noEmit` 0 错 + dev 下点目录项能跳到对应章节
- [✓] 3. 使用指引内容：`website/content/user-guide.md` —— 16 章全量，按官网口径改写：称呼改「心相」；**删**「配图待补清单」整节（含 `CaptureAppWindow`、迭代号、`docs/images/` 等内部信息）；**删**指向仓库内部文档的链接（`../README.md`、`development.md`）；**删**「尚未接入执行链路 / 未接入强制执行」这类内部状态注记（不提 ≠ 承诺，留着反而像自曝半成品）。验证：章数与 `docs/user-guide.md` 逐章对照不缺；`grep -E "CaptureAppWindow|iter-[0-9]|docs/images|development\.md|README\.md"` 在 `website/content/` 下 0 命中
- [✓] 4. 更新日志内容：`website/content/changelog.md` —— 格式 `## v0.2.33 · 2026-09-20` + bullet 条目，回填 v0.2.28~v0.2.33（数据源：`docs/progress/v2-iter-*.md` 与 `git tag` 日期），更早版本一句指向 GitHub Releases。验证：条目里的版本号与 `git tag --list 'v0.2.*'` 对得上、日期与 tag 日期一致
- [✓] 5. 日志接入与首页改造：`src/lib/changelog.ts` 解析；`sections/changelog.tsx` 改吃自维数据取前 5 +「查看全部 →」；`changelog-page.tsx` 渲染全量；**删除 `lib/site-data.ts` 的 `useRecentReleases` 与 `ReleaseEntry`**。验证：`grep -rn "api.github.com" website/src` 0 命中；首页与独立页在无网络请求下都有内容
- [✓] 6. 顶栏收敛：`content/site.ts` 的 `nav` 改 3 项（使用指引 → `./guide.html`、更新日志 → `./changelog.html`、FAQ → `./index.html#faq`）；Hero 次按钮「三种用法 →」保留页内锚点不动。验证：浏览器量测顶栏每个文本项 `getClientRects().length === 1`（中文折行是本轮已踩过的坑）
- [✓] 7. 复验与回写：website `tsc -p` + `npm run build`；**四页**（index / download / guide / changelog）浏览器实渲 + 控制台 0 error/warn；主仓 `npm run typecheck` + `npm test` 无回归；`website.md` 补 S-114 范围与两份指引的分工口径；本 plan 勾选 + `raw-requirements.md` S-114 节补实施记录。验证：逐项记录进 `plan-s114/verification_report.md`

## 涉及文件

- 新建：`website/{guide.html,changelog.html}`、`src/{guide-main.tsx,changelog-main.tsx,guide-page.tsx,changelog-page.tsx}`、`src/components/doc-page.tsx`、`src/lib/{markdown-toc.ts,changelog.ts}`、`src/vite-env.d.ts`、`src/content/{user-guide.md,changelog.md}`
- 修改：`website/package.json`、`vite.config.ts`、`src/index.css`、`src/content/site.ts`（nav）、`src/sections/changelog.tsx`、`src/lib/site-data.ts`（删 GitHub API）、`docs/plans/iter-v2-34/website.md`、`raw-requirements.md`
- **主仓源文件零改动**（与 S-113 阶段 1 同）
- ⚠️ 实施时改了一处 plan 口径：md 内容原写 `website/content/`，实际落到 **`src/content/`** —— 那里已有 `site.ts` 全站文案，再开一个 `website/content/` 会变成两个"内容目录"，找东西要猜；顺带 `tsconfig.json` 的 `include: ["src"]` 天然覆盖。

## 已知连带与风险

1. **产物体积**：指引 md 内联进 guide 入口 chunk（~20KB 原文，gzip 后约 7-8KB），不影响首页与下载页（分包按入口走）。
2. **S-112 未开工**：指引 §3「界面导览」写的是顶栏问号 = 打开使用指引 —— 这是**当前真实行为**。S-112 定案后要改成打开设置页「关于」，届时这份官网指引要同步改，否则变成假事实。已记在风险面，不现在改。
3. **两份指引会漂**：老大选择官网自维 ⇒ 每次改 `docs/user-guide.md` 的重大功能描述，官网那份要人工跟。`website.md` 里写明这条纪律。

## 提交计划

本需求单刀：`feat(website): S-114 使用指引页与更新日志页`，含 `website/**` + 本 plan 勾选 + 文档回写。迭代内不 push。S-113 阶段 1 那轮的打磨改动是否折进 `16aa97f4`，按老大另行裁定，不与本刀混。
