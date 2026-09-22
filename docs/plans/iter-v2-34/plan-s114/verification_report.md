# S-114 验证报告 —— 使用指引页 + 更新日志页

> 2026-09-21。验证对象：`website/` 新增 `guide.html` / `changelog.html` 两页、顶栏收敛、首页日志区块改自维数据源。
> 方法：命令行取证（tsc / build / grep 门）+ browser-use 实渲与几何量测（四页）。

## 结论：**PASS**

## 1. 检查点逐项

| # | 检查点 | 结果 | 证据 |
|---|---|---|---|
| 1 | website 依赖安装 | ✅ | `npm install` +104 包（react-markdown / remark-gfm / @tailwindcss/typography，版本对齐主仓 `package.json:67,105,111`） |
| 2 | website 类型检查 | ✅ | `npx tsc -p tsconfig.json --noEmit` exit 0（`--listFiles` 口径同 S-113，防 references-only 假绿） |
| 3 | 四入口构建 | ✅ | `npm run build` 265ms，`dist/` 出 `index.html` + `download.html` + `guide.html` + `changelog.html` |
| 4 | 渲染器不进首页 | ✅ | 分包实测：`guide` chunk 171.96KB（55.47KB gzip，含 react-markdown 与整份指引），`index` chunk 仍 12.07KB（3.39KB） |
| 5 | 指引 16 章齐全 | ✅ | 浏览器实测 `article h2` **16** 个、`h3` **8** 个、表格 **5** 张、代码块 **1** 个 |
| 6 | 目录锚点无断链 | ✅ | 侧栏 24 条目录项逐条 `getElementById` 反查，**0 断链**；slug 规则复刻 GitHub 中文式（`#2-不花钱先用起来免费对话`），与仓库既有 TOC 形态一致 |
| 7 | 内部痕迹清零 | ✅ | `grep -E "CaptureAppWindow\|iter-[0-9]\|docs/images\|development\.md\|README\.md\|配图待补" src/content/*.md` → **0 命中**（exit 1） |
| 8 | 日志数据自维 | ✅ | `changelog.md` 10 版 / 34 条；版本号与日期逐一对上 `git for-each-ref refs/tags`（v0.2.33=09-20 … v0.2.24=09-05） |
| 9 | GitHub API 退役 | ✅ | `grep -rn "api.github.com" website/src` → **0 命中**；`useRecentReleases` / `ReleaseEntry` 已删 |
| 10 | 首页日志区块 | ✅ | 实测最近 5 版（v0.2.33~v0.2.29）× 3 条 + 深链 `./changelog.html#v0-2-33` +「查看全部 10 个版本 →」 |
| 11 | 顶栏锁三项不折行 | ✅ | 顶栏 4 个链接（使用指引 / 更新日志 / FAQ / 安装）逐个 `getClientRects().length === 1`，中文未逐字折行 |
| 12 | 四页控制台 | ✅ | index / guide / changelog 实测 `error` / `warn` / `assert` **0 条**（download 页本轮未改，S-113 已验） |
| 13 | 主仓无回归 | ✅ | `npm run typecheck` exit 0；`npm test` **45/45** |

## 2. 验证中发现并修掉的缺陷

1. **`?raw` 路径错**：`src/sections/changelog.tsx` 里写 `../content/changelog.md` 指向 `src/content/`，而 md 当时落在 `website/content/` → rollup `UNRESOLVED_IMPORT`。tsc **不报**（`?raw` 走 vite/client 类型，路径字符串不参与检查），只有 build 暴露。
   修法不是改路径，而是**把 md 收进 `src/content/`**：那里已有 `site.ts` 全站文案，再开一个 `website/content/` 就是两个"内容目录"。改完 3 处 import 同步。
2. **`vite-env.d.ts` 缺失**：`?raw` 导入没有类型来源，加 `/// <reference types="vite/client" />`。
3. **description 与正文重复**：文档页外壳的 description 与指引 md 第三段是同一句话，页面上出现两遍。修：删正文那句。
4. **锚点被顶栏压住**：顶栏是 sticky，`scroll-margin-top` 未设时点目录跳过去标题藏在顶栏下。修：`.prose :where(h2,h3){ scroll-margin-top: 5rem }`。
5. **窄屏无目录**：16 章文档在手机上没有目录就是无限长滚。修：外壳加 `<details>` 折叠目录（`lg:hidden`），桌面仍用 sticky 侧栏。

## 3. 与 plan 的偏差（如实记）

- md 落点从 `website/content/` 改为 `src/content/`（理由见 §2.1），已回写进 plan 的「涉及文件」。
- 指引章节编号与 `docs/user-guide.md` **不是一一对应**：官网版新增第 2 章「不花钱先用起来：免费对话」（对应首页上手第 2 步），并把 app 版的「15 更新与日志」+「16 常见问题排查」并成一章，总数仍是 16。老大要求的是"16 章全量搬"（不删内容），未要求编号一致；两版的对应关系记在 `website.md`。

## 4. 遗留

- **S-112 未开工的连带**：指引第 4 章「界面导览」写的是顶栏问号 = 打开使用指引（当前真实行为）。S-112 实施后要改成「设置页·关于」，**这份官网指引必须同步改**，否则变假事实。
- **发版要记得加日志条目**：日志改成官网自维后，`changelog.md` 不再自动更新。收尾流程（`docs/release-workflow.md`）里需要插一步「给 `website/src/content/changelog.md` 补本版条目」，否则独立页会停在旧版本 —— 本轮未改 release-workflow，待老大排。
- **窄屏（<640px）仍未逐项目视**：本轮量测在 ~1010px；`browser-use` 无 viewport resize 能力。
- **prose 只做过 token 级对齐**：表格、行内 code、引用块的颜色已接本站 token，但字距与行高未逐档微调，真机素材入场后（阶段 2）一并校。


## 5. 同日追加：首页更新日志区块已撤回

§1 第 10 项（首页区块取最近 5 版 +「查看全部」）记录的是当时的验收事实，**同日已被老大推翻**：「现在不是已经有独立页面了么」⇒ 首页不再放日志列表，`src/sections/changelog.tsx` 删除（`grep` 确认无其他引用方），入口由顶栏「更新日志」承担。

独立页与数据层不受影响：`src/lib/changelog.ts`（`parseChangelog` / `changelogAnchor`）仍被 `changelog-page.tsx` 使用，`content/changelog.md` 仍是唯一数据源。撤回后复验：website `tsc -p` 0 错、build 257ms 四入口齐（`index` chunk 由 12.07KB 降到 11.05KB）、首页 `main > section` 顺序 hero → advantages → value-ladder → pain → cost → features → download → quick-start → faq、`#changelog` 不存在、`/changelog.html` 200、控制台 0 error/warn（删文件瞬间 dev 报的两条 404 是 HMR 残留，重载即清）。


## 6. 同日追加：指引第 5 章按产品事实重写（含一次我写错的纠正）

§1 第 5 项的「16 章齐全」仍是事实，但第 5 章内容口径按老大讲清的产品模型重写了。**先记一次跑偏**：我第一版把它写成「日常用法其实只有一个入口：全局会话」——老大纠正：正常使用是**先添加项目 → 项目下会话 → 说出任务 → 你拍板 → agent 执行**；他补充的是**全局会话能做的事**，不是"该只用它"，会话有两种。

| 位置 | 改后（第二版，已纠正） |
|---|---|
| 第 5 章标题 | 发起第一个任务 → **两种会话：项目下会话与全局会话** |
| 项目下会话 | 正常用法四步：新建项目（本地或 SSH 目录）→ 项目下新建会话 → 说任务 → **你拍板，agent 执行**；要盯细节就在同一会话继续说 |
| 全局会话 | 跨项目的调度与汇总四项能力：看清家底 `list_projects` / 父目录自建项目 `create_project` / 派活 `send_work_request`、`send_session_message` / 记账与回报 `create_global_task`、`list_global_tasks`、`list_global_dispatches` + 交活后被触动。并写明「需要跨项目安排活才用这一层，单件具体的事直接开项目下会话更快」 |
| 主动性 | 新增一节：触动两个来源 = 交活回传 + 定时任务 |
| 第 6 章 | 先讲交易「你希望它多主动，就得给它多大权限」；确认卡不会丢、会正常渲染在对应会话里，**区别只是有没有人去看** |
| 第 11 章 | **渠道会话是一种特殊的全局会话入口**；全局会话整理后的输出**直接发回渠道**，无需回电脑 |
| 第 12 章 | 定时任务的第二个用法：给全局会话安排触发点，自己醒来翻账本催办 |
| 第 7 章 | 全局记忆跨项目共享 ⇒ 派活派得准 |

"管家"一词全部撤下、统一叫「全局会话」，避免再被读成排他角色。

**复验**：16 个 h2 / 10 个 h3 / 26 条目录 **0 断链**；六处新口径逐条在浏览器内文命中，另加两条**反向断言**——页面文本不含「只有一个入口」、不含「管家」，均为真；website `tsc -p` 0 错、build 248ms。

## 7. 同日再追加：两处事实错误纠正（撤回 §6 里的两句）

老大补口径，两条都指向我写进去的**不存在的东西**：

| 我写过 | 真实 | 代码证据 |
|--------|------|---------|
| 确认卡提供「本次允许 / 允许并加入白名单（通配符与正则）/ 自动批准所有」，并标明风险等级（危险 / 注意 / 安全） | **只有两档权限、只有两个动作**：默认档每次由用户点同意 / YOLO 全部自动放行；卡上是 同意 与 拒绝 | `use-permission-mode.ts:11` `PermissionMode = 'default' \| 'fullAccess'`；`permission-control.tsx:17,22`「白名单设置入口已移除」「Two tiers」；`SubAgentCard.tsx:117,128` + `sub-agent-approval.ts` 返回单一 `approved: boolean` |
| 「没人看它就一直等在那儿」（对桌面与渠道一概而论） | 桌面弹窗确实一直等；**渠道 10 分钟未回复按拒绝处理**，并回发「审批已超时」 | `channel-shell-approval.ts:15` `SHELL_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000`、`:111` 超时文案 |
| 对话 / 协作 / 计划 / Goal 四档并列（三个平级 h3） | 对话 vs 协作切的是**能拿到哪一批工具**；计划与 Goal 是**协作这一侧的执行方式** | `ToolVisibilityScopes.cs:32` `WorkRunsOnly = ["*:cowork@*"]`，注释把「files, shell, …, a goal, a plan」归入这一栏；读查类为 `Everywhere` |

**错因（记下来防复发）**：那串文案我在 `locales/zh/chat.json:589-596` 里查到了**带完整中文值的键**，就当成了界面事实。它们其实**没有任何 `t()` 消费方** —— "键存在"不是证据，"有读取点"才是。已把这条补进记忆 `feedback-verify-absence-claims`（第三种伪装面）。

**同源错误应用侧也有一份**（官网抄的它）：`docs/user-guide.md` 第 4/5 章 + 配图清单 §4/§5 一并按上述事实修正，第 4 章顺带修掉更早的「全局会话只读不写工作区，适合当日常助手」。

**验证**：website `tsc -p` 0 错、build 254ms；指引页实渲 16 h2 / 9 h3 / 25 条目录 **0 断链**；4 条新口径浏览器内文命中；6 条否定断言（不含「允许并加入白名单」「自动批准所有」「本次允许」「危险 / 注意 / 安全」「只有一个入口」「管家」）全真。全仓复搜三条旧错串，现仅剩那串死 locale 键本身 —— **待清理项**：`locales/{zh,en}/chat.json` 的 `autoApproveAll` / `allowWhitelist` / `whitelistEditorTitle` / `whitelistModeWildcard` / `whitelistModeRegex` / `whitelistSave` / `whitelistInvalidPattern` / `whitelistAddedTool` / `whitelistAddedRule` / `manageWhitelist` / `whitelist` / `whitelistDesc` / `rememberTool` / `dangerous` / `caution` / `safe` / `showFullInput` —— 未删（属另一刀，且需与 en 同步），但它会继续误导下一个读代码的人。

## 8. 同日再追加：第 5 章拆成两章，章节号整体后移

老大裁定「项目会话 和 全局会话 拆成两个独立的 5 和 6」，并补一条产品事实：**全局会话本身不能新增 / 修改 / 删除文件，只能读文件与调配资源。**

**结构变化**：

| 章 | 原 | 现 |
|----|----|----|
| 5 | 两种会话：项目下会话与全局会话 | **项目下会话：干活的地方**（正常用法四步、对话/协作、计划/Goal、长对话怎么管） |
| 6 | 权限模式与工具确认 | **全局会话：调配资源的那一层**（四项能力、它只调配资源不动手改文件、主动起来） |
| 7–17 | 原 6–16 | 整体后移一位 |

文内 4 处交叉引用随之改号（第 6→7 节、第 11→12 节、第 12→13 节 ×2）。

**新事实的代码依据**：`AgentRunContextPolicy.cs:54-57` 把 `scope == "global"` 的 `collaborationMode` **硬写为 `chat`**（唯一例外 `runtimeRole == "automation"` 的无头定时任务，不是用户面对的全局会话）；`FileWriteTool:24` / `FileEditTool:23` / `TaskTool:27` 均 `WorkRunsOnly = ["*:cowork@*"]` ⇒ 这三类工具对全局会话**永远不可见**。老大给的边界与代码一致，写成第 6 章的一节，并把"为什么"落到"改文件需要明确落点，而全局会话恰没有落点"。

**顺带改准一处旧表述**：§7 之前那版把「执行命令」列进协作专属，经查 `ShellExecuteTool.cs:44` 是 `Everywhere`，对话模式也能看到 shell ⇒ 从专属清单里删掉，只留写文件、编辑文件、开子任务。

**与 app 版的分叉（如实记）**：官网 17 章 / `docs/user-guide.md` 16 章，两种会话在 app 版仍并排在第 4 章。老大只要求改使用页面，故 app 版**不做拆分**，只在其全局会话条目补同一句事实保持两侧不打架。

**验证**：website `tsc -p` 0 错、build 260ms；实渲 **17 个 h2（1–17 连续）/ 9 个 h3 / 26 条目录 0 断链**；正向 7 条命中、反向 4 条（旧合并标题、`见第 6 节`、`见第 11 节`、旧章名做标题）均为真。

## 9. 同日追加：目录双向联动 + 滚动条静置上色

老大两条：① 右侧滚动时左侧目录要有选中效果；② 滚动条不要 hover 才有颜色，一开始就有，但颜色淡一点。

**改动面**：新增 `lib/use-active-heading.ts`；`components/doc-page.tsx` 接选中态 + 把选中项带进目录可视区；`index.css` 滑块静置色 `#e4e7ec → #fad4c0`（accent 26% 混白），hover `#f4a881`（52%），两个值收成 `:root` 变量供 webkit 与 Firefox 两条路径共用；`.doc-rail` 收掉目录栏自身的滚动条。两页共用外壳，同时生效。

**量测出来的取舍（不是拍脑袋加的规则）**：文末兜底那条先删后加 —— 指引页滚到底时第 17 章在 y=−233，兜底是死代码；删掉后更新日志页最后一版 v0.2.24 停在 y≈379（下面压着 209px 页脚），永远选不上，于是加回并把注释换成这个实测理由。

**证据**：9 个滚动位置选中项与几何预期 9/9 全中（含 h3）；点击第 7 项滚动落定后 `aria-current` 命中被点项、目标标题停在 top=80；日志页文末按兜底命中 v0.2.24；控制台 0 消息；website tsc 0 错 + build 252ms。
**像素证据**：改前截图目录右边缘采到 1702 个 ≈(250,212,192) 像素 ⇒ 静置已上色；改后该簇归 0 ⇒ `.doc-rail` 生效。
**未能证明**：视口级滚动条颜色 —— 这台内嵌浏览器不绘制视口滚动条（overlay），只能证到 CSSOM 层规则有效且 `color-mix` 被支持、产物带十六进制兜底。人眼验收请在 Chrome / Firefox 各开一次指引页。
