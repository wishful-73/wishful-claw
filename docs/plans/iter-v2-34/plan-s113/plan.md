# Plan: S-113 阶段1 — website/ 官网骨架 + 单页内容 + 本地构建

## 目标

在仓库根新建独立静态前端项目 `website/`（Vite + React 19 + Tailwind 4，独立 `package.json`），落地官网单页（10 区块）+ 独立 `/download` 页，`npm run build` 产出纯静态文件。**只做阶段 1**：真机素材、Nginx 部署、COS 下载源改造均不在本 plan 内（见 `website.md` 排除项）。

## 口径来源（权威，不复制进代码）

- 内容与区块顺序：`D:\koda\Obsidian\05-WishfulClaw\官网方案.md`（只读）—— 文案纲要照抄其第三节，命名口径「心相龙虾 / WishfulClaw」，口径红线三条（不吹功能稀缺 / 不写成程序员工具 / 明示非正式版）
- 工程边界：`docs/plans/iter-v2-34/website.md`

## 关键工程决策

| 项 | 决策 | 依据 |
|---|---|---|
| 构建形态 | **MPA 双入口**（`index.html` + `download.html`），rollup input 两处 | 下载页是独立 URL，静态托管（Nginx）无需 SPA 路由兜底，零 router 依赖 |
| 版本占位 | `public/latest.json`（`{ "version": "0.2.33", "downloads": { "direct": "", "github": "https://github.com/wishful-73/wishful-claw/releases/latest" } }`），页面**运行时 fetch** | website.md 待确认 #1 的占位方案 + 附录「运行时读 latest.json、发版零官网构建」的设计方向 |
| 下载按钮 | **两个入口并列**（老大 2026-09-21 拍板）：① 主按钮「直接下载」= 官网源直链，阶段 1 URL 为空占位（按钮置灰 + 提示「下载通道建设中」），阶段 4 接 COS 后填充即生效；② 次按钮「GitHub Releases」= 跳转备用源。两 URL 均来自 `latest.json` 运行时读取 | 老大：「需要两个都有，一个是官网的，一个是跳去 GitHub」；COS 直链属阶段 4，本阶段只留结构不接线 |
| 占位素材 | 带尺寸标注的虚线占位框（标注素材清单 #1~#8 对应项），Logo 直接用 `resources/icon-512.png` 拷入 `public/` | 素材清单 #9 Logo 已有，其余阶段 2 替换 |
| 视觉方向 | 深色底 + 琥珀强调色（与顶栏更新图标同色系），文案区为主、无插画 | 阶段 1 目标是结构与口径正确，视觉精修留待素材就绪 |
| 依赖版本 | 对齐主仓：react/react-dom ^19、tailwindcss ^4、@vitejs/plugin-react ^4.3；vite/typescript 取当前稳定版 | website.md 三「复用本仓现有依赖，不引新工具链」 |
| 门禁 | website  scripts **不使用 `test:*` 前缀** | website.md 四节尾注：加了就会被 `run-tests.mjs` 收编 |

## 步骤清单

- [✓] 1. 项目骨架：`website/package.json`（dev/build/preview，无 test: 前缀脚本）、`vite.config.ts`（双入口）、`tsconfig.json`、`index.html`、`download.html`、`src/main.tsx`、`src/index.css`（Tailwind 4 `@import`）。验证：`npm install` 成功 + `npm run dev` 两页都能打开
- [✓] 2. 文案常量层：`src/content/site.ts` —— Hero/痛点表/四大优势/三层阶梯/功能展示/上手/FAQ 全部文案集中在此（提示词写作规范同款思路：文案进常量不散落 JSX）。验证：与官网方案第三节逐块对照无缺项、红线三条体现
- [✓] 3. 单页区块组件 ×10：`src/sections/` 下每区块一文件（hero / pain-table / advantages / value-ladder / cost-compare / features / download-cta / quick-start / changelog / faq）+ `footer`。changelog 区块运行时 fetch GitHub Releases 列表（失败则隐藏，不影响页面）。验证：`npx tsc --noEmit`（website 自己的 tsconfig）零错误 + dev 下逐区块目视
- [✓] 4. 下载页：`src/download-page.tsx` 组装（版本/系统要求/主按钮/次链接/更新日志入口），版本号与安装包列表运行时 fetch `latest.json`。验证：`/download` 本地可访问、fetch 到占位 json
- [✓] 5. 构建验证：`npm run build` 成功，`dist/` 含 index.html + download.html + latest.json + 资源；`npm run preview` 两页可开。验证：产物文件清单 + `git status` 确认 `website/dist`、`website/node_modules` 被根 `.gitignore` 覆盖
- [✓] 6. 主仓无回归：根目录 `npm run typecheck` + `npm test` 全量（确认门禁零污染的实际证据）。验证：均与此前基线一致（typecheck 0 错误、测试 N/N）

## 涉及文件

- `website/**` — 全部新建（约 20 个文件，均在 website/ 内，不改主仓任何源文件）
- `resources/icon-512.png` → 复制为 `website/public/logo.png` — 拷贝不改原件
- `docs/plans/iter-v2-34/raw-requirements.md` — S-113 节补实施记录
- `docs/PROGRESS.md` — 迭代行状态更新（随本需求提交入库）

## 参考源码

- 知识库 `官网方案.md`（D:\koda\Obsidian\05-WishfulClaw\，只读）— 文案与区块结构的唯一权威源
- 主仓 `package.json` — react/tailwind 版本对齐基准
- `docs/plans/iter-v2-34/website.md` — 工程边界与门禁核证结论

## 验证检查点汇总

1. website 内 `npm run build` 零错误，`dist/` 双页产物齐
2. website 内 `npx tsc --noEmit` 零错误
3. 根仓 `npm run typecheck` + `npm test` 无回归（证明门禁零污染）
4. 目视：10 区块顺序与官网方案一致、命名口径正确（主标题「心相龙虾」、非正式版明示）
5. UI 目视项在本环境无法截图取证（见记忆 env-no-screen-capture）——preview 后由老大目视验收，报告里记「未做+原因」

## 提交计划

本需求全部步骤测通后单刀：`feat(website): S-113 阶段1 官网骨架与单页内容`，含 `website/**` + 计划文档 + raw-requirements/PROGRESS 更新。迭代内不 push。
