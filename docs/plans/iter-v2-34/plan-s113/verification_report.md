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

> **本表以下 5 行的判据已过时**（记录本身不改，按当时口径打的 ✅ 是真打过的）：第 9 行区块顺序（痛点对照 / 成本对比 / 更新日志已撤出单页，见 S-122）、第 10 行「心相龙虾」（名已改定「心相」）、第 11 行「必须明示非正式版」（S-123 撤销该要求，对外只给版本号）、第 12 行成本对比区块（整块已删）；§3 第 3 条 `/download` 干净 URL 已由 S-121 落地。

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

## 5. 阶段 1 打磨第二轮（老大 2026-09-21 补口径，同属 S-113）

四项内容口径改动（命名 / 平台占位 / 上手四步 / 免费定位）+ 连带工程收口，全部落在 `website/**`，主仓源文件零改动。

### 改动

| 项 | 落地 |
|---|---|
| 命名 | `content/site.ts` 新增 `BRAND`（name/category/fullName/latin/vision）**单一出口**，原 17 处「心相龙虾」字面量清零；两个 HTML 的 title + description 同步为「心相智能助手」，并加注释标明是 BRAND 的静态投影面 |
| 平台占位 | `platforms[]` 数据驱动三平台按钮，`latest.json.downloads` 加 `macos` / `linux`（空即置灰，填 URL 自动生效）；FAQ「当前仅 Windows」这条假事实改为「能出，当前未产出」。**同日按老大第三条口径再收口**：按钮正文只留平台名（不带「下载」二字），状态改由右侧小标签承载（Windows「直链建设中」/ macOS·Linux「待发布 · 敬请期待」）；`platforms[].note` 系统要求备注整条删除（AOT self-contained 不挑环境）；`DownloadButtons` 的 `layout` 可选参数删除（仅一个调用方） |
| 免费措辞 | 不刻意标注「软件免费 / 免费下载」：Hero 徽章、主 CTA（→「立即下载」）、下载页副标题、两个 HTML 的 description 共 6 处清理；三层阶梯的「完全不花钱」等实质内容与「免费对话」功能名保留 |
| 上手四步 | 原三步 → 四步（合并「免费对话 + 挑 agent」为「轻度使用」），措辞按界面事实校准为「官方服务内嵌」（`DEFAULT_FREE_CHAT_SITES` + `FreeChatPage.tsx:20-26` 常驻 webview，登录在页内）；素材位从步骤卡里挪出单独成行并标注属于第几步。**第 1 步同日再修**：「装完就能打开，无需配置环境」漏了首启引导 —— 实际是 `PersonaSelectPage` 两步（称呼必填 + 语言 + 外观 → 选对话角色），已按真实流程改写 |
| 免费定位 | FAQ 新增「免费对话是给谁用的？」；导航项与 Hero 次按钮「不花钱怎么用」→「三种用法」；三层阶梯区不动 |

### 本轮发现并修掉的缺陷（6 个）

1. **顶栏折行**：品牌名 4 字改 2 字后 flex 挤压，「心 / 相」竖排、5 个导航项全部折成两行 —— 中文在 flex 里会在任意字后断行。修：文本项 `shrink-0 whitespace-nowrap`，nav `gap-7 → gap-6`。
2. **右卡「当前可用」徽章折行**（量测 `getClientRects().length` 从 2 → 1 确认修复）。
3. **Windows 按钮正文折行**：状态说明塞进按钮文字导致三键高低不齐（43px 等高已量测）。修：状态移到 note 行，按钮正文只留「{平台} 下载」。
4. **步骤卡 2x2 失衡**：第 1 步只有一句话被同行卡片撑出大片空白。修：步骤卡纯文字 `lg:grid-cols-4`，两个素材占位单独成行。
5. **`site.ts` TDZ 隐患**：`hero.primaryCta` 引用了声明在其后的 `platforms`，const 暂时性死区会运行期 ReferenceError —— tsc 不报，靠读码发现。修：`platforms` 提到 `hero` 之前。
6. **`LatestInfo` 三个未读字段**：`systemRequirements` / `officialRelease` / `releasesUrl` 全站零消费（grep 仅命中接口声明本身），其中系统要求已由 `platforms[].note` 单点承载 ⇒ 删除，`latest.json` 同步瘦身。

### 复验证据

| 检查点 | 结果 | 取证方式 |
|---|---|---|
| website 类型检查 | ✅ 0 错 | `npx tsc -p tsconfig.json --noEmit` exit 0，且 `--listFiles` 实测覆盖 **20 个** `website/src` 文件（防 references-only 假绿） |
| website 构建 | ✅ | `npm run build` 233ms，`dist/` 双入口 + assets |
| 旧名清零 | ✅ | `grep -rn 心相龙虾 website/src website/*.html website/public` → 无命中（exit 1），同模式正对照 `心相` 命中 4 处证明 grep 本身在工作 |
| 单页四区实渲 | ✅ | browser-use `evaluate_script` 逐块取文本：title / 导航「三种用法」/ Hero 愿景行（opacity 1）/ 四步含「轻度使用」/ 三平台按钮灰态与 note / FAQ 7 问 |
| 下载页实渲 | ✅ | `/download.html`：h1「下载心相」、三平台 note、GitHub 入口、「装好之后，四步开始」 |
| 控制台 | ✅ | 两页 `error` / `warn` / `assert` 均 0 条 |
| 主仓无回归 | ✅ | `npm run typecheck` 0 错；`npm test` **45/45** |
| 第三轮收口后复验 | ✅ | website `tsc -p` 0 错 + build 173ms；`grep 软件免费\|免费下载 website/src website/*.html` 0 命中（exit 1）；两页量测三平台按钮等高 47px、正文与标签各 1 行不折行；`/download.html` 副标题与控制台（error/warn 0 条）复采通过 |

### 未做 / 遗留

- **窄屏（<640px）仍未逐项目视**：本轮量测在 ~1010px 视口，`browser-use` 无 viewport resize 能力，顶栏折行正是这个宽度暴露的 —— 更窄处的顶栏堆叠需老大目视。
- **建议新增素材 #11「免费对话页截图」**：它现在是上手第 2 步（最省事的入口），但《官网方案》素材清单 #1~#10 里没有这一页。未擅自编号进 `site.ts`（编号权威源是知识库），待老大定。
- **知识库待老大同步**：《官网方案》命名口径与文案纲要、《抖音发布指南》同源口径、素材 #7 名称。本仓不改知识库。
- **下载区观感**：三个官网直链按钮全灰（COS 未建成 + mac/linux 未出包），当前唯一可点的是右卡 GitHub —— 这是老大「双入口、阶段 1 直链置灰」拍板的直接结果，未擅自改成「Windows 主按钮接 GitHub 真链」。若觉得"全灰"太消极，改法是一行代码（`platforms[0]` 回退到 `downloads.github`），等他裁定。
- **提交归属**：本轮与阶段 1 同属 S-113，按「一需求一 commit」应折进 `16aa97f4`（`git reset --soft` 后重提），或留作迭代收尾那次修复调整 commit —— 待老大定。

## 6. 首屏叙事改版（老大 2026-09-21：「感觉强行去碰瓷了」）

**诊断（两层）**：① 首屏第一句「大厂的免费额度是鱼饵」+ 第二屏痛点表 + 优势区反问句「你的渠道，凭什么要别人批准？」是同族语气连成三处，陌生访客头一句看到的是吵架而不是能得到什么；② **「key 自己带」是行话** —— 目标人群口径正是"被 Codex 那类工具的高配置门槛挡住的人"，与自家红线「不写成程序员工具」「门槛低是主心骨」直接冲突。

**改法（老大选 A + C）**：

| 项 | 前 | 后 |
|---|---|---|
| h1 | 你的 AI 助手，**key 自己带** | 你说一句，**它去把活干完** |
| 副标题 | 大厂的免费额度是鱼饵。心相（WishfulClaw）让你接上任意服务商……重度使用也不肉疼。 | 跑在你自己电脑上的智能助手：读写文件、执行命令、操作浏览器和桌面软件。装完就能先问起来；要它真动手，填一个模型 Key——用哪家、花多少，你说了算。 |
| 区块顺序 | Hero → **痛点对照** → 四大优势 → 三层阶梯 → … | Hero → 四大优势 → 三层阶梯 → **痛点对照** → … |
| 优势区反问句 | 保留（老大裁定：它在第三屏，作论据有力） | 同左 |
| HTML title / description ×2、下载页副标题 | 含「key 自己带，渠道随便接」「自带 API key」 | 改为结果导向；`grep "key 自己带\|鱼饵"` 仅剩 `site.ts` 那条解释性注释 |

**验证**：website `tsc -p` 0 错 + build 252ms；浏览器实测 h1 = 「你说一句，它去把活干完」、`main > section` 顺序为 hero → advantages → value-ladder → pain → cost → features → download → quick-start → changelog → faq、**首屏文本不含「大厂」**、副标题收成 2 行（此前末行只剩「算。」孤字，已缩短一句）；控制台 error/warn 0 条。

**移交**：「key 自己带」是《官网方案》与《抖音发布指南》的**同源主叙事**，官网首屏已换旗，短视频侧是否跟改由老大定（本仓不改知识库）。
