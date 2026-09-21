# S-113 阶段 1 验证报告

> 2026-09-21。验证对象：`website/` 骨架 + 单页 + 下载页（plan：`plan.md`）。
> 方法：命令行取证（build/typecheck/test）+ 浏览器实际渲染（browser-use，dev 与 preview 产物均过）。

## 结论：**PASS**（目视精修项除外，见 §3）

## 1. 检查点逐项

| # | 检查点 | 结果 | 证据 |
|---|---|---|---|
| 1 | website `npm install` | ✅ | 40 packages, 11s |
| 2 | website `npx tsc --noEmit` | ✅ | exit 0，无输出 |
| 3 | website `npm run build` | ✅ | `dist/` 双入口：`index.html` + `download.html` + `latest.json` + `logo.png` + 4 个 assets，35 modules，161ms |
| 4 | dev 两页可开 | ✅ | vite 5199：`/` 200、`/download.html` 200、`/latest.json` 200、`/logo.png` 200 |
| 5 | preview 产物可服务 | ✅ | vite 5298：同四项全 200，`latest.json` 内容回读正确 |
| 6 | 主仓 typecheck 无回归 | ✅ | `npm run typecheck`（node+web）0 错误 |
| 7 | 主仓全量测试无回归 | ✅ | `npm test` **45/45 通过**（含门禁收编逻辑未被 website 污染） |
| 8 | `website/dist`、`website/node_modules` 被忽略 | ✅ | `git check-ignore -v`：`.gitignore:20 node_modules/`、`:21 dist/` 命中 |
| 9 | 10+1 区块顺序与官网方案一致 | ✅ | 浏览器快照逐块核对：Hero→痛点→四大优势(门槛低/自由/好看)→三层阶梯→成本对比→功能展示→下载→三步→更新日志→FAQ→页脚 |
| 10 | 命名口径 | ✅ | 主标题「心相龙虾 WishfulClaw」，全站无「心相平台」混用 |
| 11 | 红线：非正式版明示 | ✅ | 下载区块 + 页脚均有「0.2.x 非正式版，正式版 1.0.0 仍在打磨」 |
| 12 | 红线：不编成本数据 | ✅ | 成本对比区块只放占位框 +「数据制作中，此处暂不展示数字」 |
| 13 | 双下载入口（老大口径） | ✅ | 主入口「直接下载 · 通道建设中」（置灰，`latest.json.downloads.direct` 为空即此态；阶段 4 填 URL 自动变真按钮）+ 次入口 GitHub Releases 真链接 |
| 14 | 版本运行时读取 | ✅ | 页面显示 `0.2.33`，来自 `public/latest.json` fetch（非构建注入） |
| 15 | changelog 真实数据 | ✅ | GitHub API 实拉到 v0.2.33~v0.2.29 五条摘要；取不到时整块隐藏的兜底已写 |
| 16 | 控制台无错误 | ✅ | 两页 `list_console_messages` 均空 |

## 2. 验证中发现并修复的缺陷

- **下载页顶部导航死链**：nav 锚点 `#features` 在 `download.html` 上解析成本页锚点 → 点击无内容。修复：nav href 改为 `./index.html#<anchor>`（`content/site.ts`），重建后快照复核指向正确。

## 3. 未做 / 遗留

- **视觉精修（阶段 1 首版）**：首版为深色底朴素版，老大验收「有点那啥」→ 见 §4 改版。配色/间距已按 Reasonix 拉齐，但**真机素材入场后的最终视觉校准仍留阶段 2**（占位框尺寸按素材清单比例预留）。
- **窄屏（<640px）未逐项目视**：布局用了 `sm:` 断点栅格，逻辑上会堆叠，但本次只在桌面宽度截图取证。
- **`/download` 干净 URL**：现链接用 `download.html`；Nginx 部署（阶段 3）加 `try_files $uri $uri.html` 即可不改代码上线 `/download`。
- 截图证据：本次浏览器截图未落盘到仓库（截图为会话内取证）；正式素材见 §1 表格的命令输出与快照记录。

## 4. 视觉改版（老大验收后，参考 reasonix.io）

老大 2026-09-21 看首版后：「参考 reasonix 的官网，你这个有点那啥」。抓 Reasonix 首页取设计 token（`evaluate_script` 读 computed style），按其语言重构：

| 维度 | 首版（深色朴素） | 改版（对齐 Reasonix） |
|---|---|---|
| 主题 | 深色底 `#0b0b0f` | **浅色纸面** 白底 + `#f7f8fa` 软面板 |
| 强调色 | 琥珀 `#f59e0b` | 品牌橙 `#ea580c`（不抄 Reasonix 的蓝，保留龙虾调性） |
| 标题 | 单行左对齐 | **居中大标题 + 关键词橙色高亮**（「key 自己带」）+ eyebrow 小标签 |
| Hero | 直接进正文 | 顶部加**状态徽章**「非正式版 0.2.x · Windows · 软件免费」（Reasonix 的 v1.x·MIT·免费同款位） |
| 卡片 | 深色描边 | 白底 `13px` 圆角 + 细边框 + hover 投影（Reasonix 卡片阴影值） |
| 下载区 | 单块 | **双卡并排**（左官网直链橙调高亮 / 右 GitHub 中性），对应 Reasonix 首屏「桌面端 / CLI」双卡 |
| 动效 | 无 | **滚动 reveal 渐显**（IntersectionObserver + 1.5s failsafe 兜底，防隐藏窗口/不支持时内容永久不可见）+ `prefers-reduced-motion` 关闭 |

改版后复验：website `tsc` 0 错、build 通过；两页浏览器实渲截图确认浅色主题生效、下载双卡无重复入口、failsafe 后 0 个隐藏区块；主仓 `npm run typecheck` 0 错 + `npm test` **45/45**（视觉改版不触主仓代码，回归仅确认门禁仍零污染）。
