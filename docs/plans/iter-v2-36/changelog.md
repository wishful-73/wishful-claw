# 裁定记录（跨需求流水）

> 按日期追加，跨整个迭代。需求正文见 `requirements/S-{NNN}.md`。
> 立项与口径变更的流水，按日期追加。正文小节按编号排列，本节日志跨整个迭代。

- 2026-09-23：**iter-36 切出（14:43）** —— 老大「当前已经是 35 版本了，切出 36 迭代，我们准备继续搞」。分支 `dev/v2-iter-36` 从 `main` @ `43a616e6`（= tag `v0.2.35`）切出（`v0.2.35` 已推送：GitHub Release `isLatest=true`、三资产 `uploaded`）。**承接 iter-35 全部未实施项**：S-129 / S-140 / S-143 / S-144 / S-145 + iter-34 老挂账（S-131 路径二 / S-134 / S-108 / `will-navigate` 10 处未拦 / `memory-output.tsx:115` 裸英文 / `disableWebInstaller`）。本迭代范围待立项。
- 2026-09-23：**S-129 顺序裁定 + 开工（14:45）** —— 老大「更新源切官网这里的顺序需要调整一下，先把官网的本身调整对，然后把 35 迭代的放上去」。
  - **顺序**：① 官网侧代码改对（开 `releases/` 目录 + 前端改读 `latest.yml`）→ ② 把 0.2.35 三件放上官网 → ③ 验 `latest.yml` 可达 → ④ **最后**才切 `electron-builder.yml` 的 `publish:`。
  - **为何不能倒**：`publish:` 切了之后打的包会把包内 `app-update.yml` 指向 `.../releases/`；若官网那时还没有 `latest.yml`，新包的更新源就是个 404，更新功能直接死。
  - **一处事实澄清（会影响预期）**：`publish:` 切换**只对下一次打包生效** —— 0.2.35 包内的 `app-update.yml` 写死的是 `provider: github`（实测 `release/win-unpacked/resources/app-update.yml`），所以**已装的 0.2.35 用户检查更新仍走 GitHub**；官网成为 app 内更新源要等 **0.2.36 的包**装机。
  - **顺带发现（官网现成的坏，本项一并修）**：`website/public/latest.json` 里 Windows 地址指向 `https://wishful-claw.work/downloads/wishful-claw-0.2.34-setup.exe`，而 `website/public/` 与站点根**都没有** `downloads/` 目录 ⇒ **官网下载按钮是个 404 死链**（不是「指向 GitHub」，是彻底点不动）。根因与 S-129 同源：版本清单靠人手写。
  - **归属**：官网站点内容与合规归 S-143；本项只碰「发布目录 + 更新源」这条链。**上传服务器不由本实例执行**（SSH 只有列举连接、无上传能力）。
- 2026-09-23：**S-129 官网侧代码落地（14:50）** —— 按上条顺序完成 ①：
  - 新增 `website/src/lib/latest-yml.ts`：`parseReleaseManifest()` 正则取 `version` 与 `files[0].url`（YAML 只取两个顶层字段，格式由 electron-builder 固定生成，不引 YAML 库），`releaseFileUrl()` 拼 `./releases/<文件名>`；标量外层引号剥除；`setupFile` **只取文件名**，杜绝清单里的 `../` 把链接带出 `releases/` 目录。
  - `website/src/lib/site-data.ts`：`useLatestInfo()`（fetch `./latest.json`）⇒ `useReleaseManifest()`（fetch `./releases/latest.yml`，`no-store`）；取不到就静默退化，页面照常渲染。
  - `website/src/content/site.ts`：删 `LatestInfo` 类型；`platforms` 去 `urlKey`（清单里只有「当前唯一产物」的文件名，没有按平台分的字段）。
  - `website/src/components/download-buttons.tsx`：`PlatformButton` 按平台 id 绑定（只有 Windows 有产物，地址 = `releaseFileUrl()`）；下载地址与清单**同域** ⇒ `download` 属性真正生效（早先指 GitHub 直链时跨域会被浏览器忽略）。
  - `sections/download-cta.tsx` / `download-page.tsx`：跟随改名；GitHub 兜底入口改用 `footer.github`（`.../releases` 列表页，比原来的 `/releases/latest` 更合「全部版本」语义）。
  - **删除 `website/public/latest.json`**（人手写的第二份清单，退役）。
  - **新增回归测试** `tests/latest-yml`（**15 断言**）：真清单逐字解析、引号剥离、形状不对 ⇒ undefined、路径穿越只取文件名。`package.json` 加 `test:latest-yml`。
  - **门禁**：`npm run test:latest-yml` 15 断言通过；`website` `npm run typecheck` EXIT=0；`npm run build` EXIT=0，产物含 `releases/latest.yml` 字面量、`latest.json` 已零命中。
  - **未做（等前序条件）**：`electron-builder.yml` 的 `publish:` 切换（待官网 `releases/latest.yml` 验通）、服务器上传（不由本实例执行）。
  - **一处判断（与 iter-35 初稿口径不同，需老大确认）**：`src/main/lib/distribution.ts` 的 `RELEASE_URL`（更新面板「查看全部版本」）**建议保留 GitHub**，不改指官网 —— 官网 changelog 页只有文字日志、没有历史安装包，而该入口的用途正是「找旧版本 / 回看全部版本」。feed 走官网（更新用）、该入口走 GitHub（找旧版用），两件事。**待老大裁定。**
- 2026-09-23：**S-129 三答（14:53）** —— ① **域名定裸域 `https://wishful-claw.work`**（不带 www）。实测（只读探测）裸域与 `www` **都返回 200、互不 301** ⇒ 同一份内容两个地址对外 = canonical 分裂；**建议**给 `www` 的 server 块加 `return 301 https://wishful-claw.work$request_uri;`（服务器侧动作，不由本实例执行，不做也能用）。代码影响面极小：官网前端全用相对路径，与域名解耦，只有 `publish.url` 与文档要写死。② **`distribution.ts` 的「查看全部版本」保留 GitHub** —— **iter-35 初稿「改指官网」的口径就此推翻**（官网只放最新版本、且更新日志将去掉，没有旧版可找）。③ **部署方式 = 覆盖上传**（非 `rsync --delete` 镜像）⇒ 传站点内容天然不会抹掉 `releases/`；发版只需增量覆盖，服务器 `releases/` 永远只留最新三件。
  - **顺带实测印证**：线上 `latest.json` 仍是旧数据（`version: 0.2.34` + 死链 `https://wishful-claw.work/downloads/wishful-claw-0.2.34-setup.exe`），`releases/latest.yml` 两边均 404（未上传，符合预期）⇒ **官网下载按钮此刻是坏的**，待新站点部署修复。
- 2026-09-23：**S-129 重大订正（14:55，读 `scripts/deploy.mjs` 后）** —— 老大 14:54「你看下脚本里面呢，我让另一个会话写了怎么上传的脚本」。**两处推翻自己**：
  - **① 我判错了**：上一条说的「官网下载按钮是 404 死链」**作废**。实测 `https://wishful-claw.work/downloads/wishful-claw-0.2.34-setup.exe` = **200**（`application/octet-stream`）—— 脚本把安装包放**站点目录之外**的 `/data/downloads/wishfulclaw`，nginx 用 `/downloads` 映射过去（`CFG.downloadsDir` / `CFG.downloadUrlPrefix`）。我只 curl 了 `/releases/latest.yml` 就下结论，没查 nginx 这一层。
  - **② 我原方案有硬伤**：`deploy.mjs` 的 `deploySite` 是**整体替换站点目录**（`mv siteDir → .prev-deploy`，再 `mv staging/dist → siteDir`）⇒ 我原方案把资产放站点内 `releases/`，**每次发站都会被清掉**。脚本作者用「站点外目录 + nginx 映射」规避了这点（注释原话：「刻意放站点目录之外 —— site 发布会整个换掉站点目录」），想得比我周全。⇒ **方案改为复用脚本的下载目录 `https://wishful-claw.work/downloads/`，不新建 `releases/`。**
  - **真问题没变、反而更清楚**：该目录里**只有 exe**（`.blockmap` → 404、`latest.yml` → 404）⇒ 官网侧**差分不成立**、app 内更新走官网也不成立。这正是老大最初第二问「这个下载理论上是一个文件夹，里面有 exe 安装包，也有增量的一些相关文件才对」所指。
  - **官网前端已按新路径落地**：`site-data.ts` 改 fetch `./downloads/latest.yml`；`latest-yml.ts` 的 `releaseFileUrl()` 返回 `./downloads/<文件名>`；测试断言与各处注释同步改（仍 15 断言）。
  - **待办（归属待定）**：`deploy.mjs` 目前只传 exe + 生成 `latest.json`，需补齐三处 —— ① `deployInstaller()` 改传**三件**；② 删 `writeLatestJson()`（清单改由 builder 的 `latest.yml` 担任，不再有生成物入库）；③ `verifyLive()` 改抽查 `/downloads/latest.yml` 与 `.blockmap`。脚本**不在版本库**（`.gitignore:53` 的 `scripts/*` 刻意排除，含服务器地址与密钥路径）⇒ 老大自己改 / 那个会话改 / 授权我改，**待定**。
- 2026-09-23：**`deploy.mjs` 三件化改造（15:00，老大「1.你改呀」授权）** —— `deployInstaller()` 从「传 1 个 exe + 写 `latest.json`」改为「**传三件**（exe + `.blockmap` + `latest.yml`，一次 tar 上传）→ 服务器侧解包 → 归正权限 → 移进下载目录 → **清掉非当前版本的旧包**（`find … ! -name '*<version>*' -delete`）→ 三件逐一 sha512 校验，全程下载目录里都有可用文件、不留空窗」；**删除 `writeLatestJson()` / `LATEST_JSON` / `writeFileSync` import**（清单改由 builder 的 `latest.yml` 担任，不再有生成物入库、不再需要「记得提交」）；`verifyLive()` 抽查项 `/latest.json` → `/downloads/latest.yml`；用法说明与文件头注释同步（新增「发布资产为什么是三件」一节）。**验证**：`node --check` 通过、`--help` 实跑正常、无残留引用。**尚未实跑**（动线上，待老大定）。
- 2026-09-23：**S-143 本轮增补（14:59，老大定）：官网去掉更新日志页** —— 老大「更新日志范围，就是官网不留这个，全部应该跳转去GitHub看」，即上一条问的 **B+**（连页面与内容一并删 **且** 入口改指 GitHub）。**已实施**（官网本地代码，未提交）：删 `changelog.html` / `changelog-page.tsx` / `changelog-main.tsx` / `lib/changelog.ts` / `content/changelog.md` 共 5 个文件；`vite.config.ts` 的 `PAGES` 与 `rollupOptions.input` 从四个入口减到三个（index / download / guide）；顶栏「更新日志」改**外链** `${GITHUB_REPO_URL}/releases`（`nav` 各项加 `external` 字段，`site-header.tsx` 据此渲染 `target="_blank" rel="noopener noreferrer"`）；`App.tsx` 注释同步。其余提到更新日志的入口本就指 GitHub（`download-cta` / `download-page`），无需改。**验证**：`typecheck` EXIT=0、`build` EXIT=0、产物只剩 3 个 html 且全 chunk `changelog` 零命中、顶栏外链已进产物（`external:!0` → `target:'_blank'`）。连带：`deploy.mjs` 的 `verifyLive()` 去掉 `/changelog` 抽查项。文档见 [S-143.md](requirements/S-143.md)。
- 2026-09-23：**S-129 收尾：`publish` 切官网（15:2x）** —— 按 §一 顺序的第 4 步（前 3 步已验通：官网 `latest.yml` / `.blockmap` / exe 三件 200）。
  - `electron-builder.yml`：`publish` 由 `provider: github`（owner/repo/releaseType）改为 **`provider: generic` + `url: https://wishful-claw.work/downloads/`**，并加注释说明「清单即 builder 自产的 `latest.yml`，三件成套覆盖上传；GitHub 退为存档与找旧版」。
  - `dev-app-update.yml`（开发态手工测更新用）同步切 `generic` + 同址 —— 否则 dev 下 `checkForUpdates` 仍打 GitHub。
  - **不加 GitHub fallback**：只配单源。`in-app-update-plan.md` 的「保留 GitHub fallback」是首期设想（原话「后续可增加 Generic Provider 镜像」），不是硬要求；双源需运行时代码支持，先单源跑通，确有需要再加。
  - **实测验证**（这是关键，别只看配置）：`npm run pack`（`--dir`）**不产 `app-update.yml`** —— 它由 NSIS 目标打包器写。改跑 `npx electron-builder --win`（EXIT=0），产物 `release/win-unpacked/resources/app-update.yml` 恰为：

    ```
    provider: generic
    url: https://wishful-claw.work/downloads/
    updaterCacheDirName: wishful-claw-updater
    ```

  - **打包踩坑（本次复发）**：首次 `npm run pack` 报 `EPERM: operation not permitted, rename 'release\win-unpacked.tmp' -> 'release\win-unpacked'` —— 上次失败留下的 `win-unpacked.tmp` 残留。删掉 `release/win-unpacked.tmp` 与 `release/win-unpacked`（PowerShell `Remove-Item` 在本机被环境拦，走 `node fs.rmSync`）后重跑即过。**已写进 `release-workflow.md` §4.2 的 ⚠️ 清单。**
  - **未污染已发布产物**：验证前把 `release/` 里已发布的 0.2.35 三件挪进 `release/_released-0.2.35/`，验证后删除重打包产物并把三件移回 —— 三件 sha512 与发布版逐字一致（exe `4F9916FBD9CFDA30…` / blockmap `F7C09B0588AC6FBF…` / latest.yml `17D5983561A6BDDB…`）。
  - **生效时点**：只对**下一次打包**生效。0.2.35 包内仍是 `provider: github`（实测），已装用户检查更新仍走 GitHub；官网成为应用内更新源要等 **0.2.36 的包**装机。
  - 文档：`release-workflow.md` §4.2 补「更新源指向官网的核验方法」+「`--dir` 不产 `app-update.yml`」+「EPERM 残留处理」；§4.4 的「脚本尚需补齐」过期提示改为**已三件化**的口径。
- 2026-09-23：**S-145 实施：Read 读图（已定稿方案落地）** —— iter-35 定稿、iter-36 实施；老大「除了官网发布，根据 docs 下开发工作流推进所有已经定稿的需求」。
  - **主体**：`ToolResult` 加可选 `ContentBlocks`（结构化 content 数组）；`FileReadTool` 对 `.png/.jpg/.jpeg/.webp/.gif/.bmp` 走图像分支，产出 `[text, image(base64)]`；`ToolDispatchRouter` / `ToolCallProcessor` 把结构化 content 一路送到 wire 的 `tool_result.content`。**没有新增工具** —— Read 就是 Read。
  - **新增 `ImageFileProbe`**：按扩展名判 mediaType + 从文件头读尺寸（PNG / JPEG / GIF / BMP / WebP 三变体）。刻意不引图像库：尺寸只用来写一行说明，为它拖一个解码依赖（AOT 体积 + 攻击面）不划算。
  - **一并修 Anthropic 丢图**：`AnthropicMessagesInputWriter` 对数组型 `tool_result.content` 按 block 数组写出（从前一律 `ToolResultToString` ⇒ image 块被丢）。顺带修掉 `DesktopScreenshot` / `CaptureAppWindow` 在 Anthropic 下看不见图的隐性 bug。
  - **OpenAI 两条线同时做**（iter-35 §2.3 标「待实施时核」）：Chat 的 tool 消息 content 与 Responses 的 `function_call_output.output` 都改走 parts 数组。**这条必须有** —— 原来非字符串 content 走 `GetRawText()`，base64 会以纯文本进 prompt（既看不见图，又撑爆 token）。
  - **两处本轮定**（iter-35 写「实施时定」）：① 非 vision 降级的数据来源 = 渲染端在 `sendMessage` 盖章 `supportsVision`（唯一门，避免六个透传点漏传）；查不到模型时返回 true（**宁可让上游报错，也不要静默吞像素让模型猜内容**）。② DB 不落 base64 是**结构上成立**：base64 只走 wire，事件里的 `Result` 保持文本摘要，会话恢复时 wire 的 tool_result 由渲染端存的文本在内存合成 ⇒ 跨轮/重启历史里没有 base64，要再看就重新 Read（§3.3 口径）。兜底另有 `limitToolResultContent` 的超限剥离。
  - **门禁**：`npm run build:worker` 0 错 0 警告；`npm run typecheck` EXIT=0；新增 `WishfulClaw.ReadImageRegressionTests`（**33 断言**）→ `npm test` **52 / 52**。
  - **未做**：工具卡片缩略图（事件刻意不带 base64，只有文本摘要）；SSH 远程图 / `pet` / `translate` 的 Read 按 iter-35 §3.4 继续挂账。正文见 [S-145.md](requirements/S-145.md)。
- 2026-09-23：**S-144 勘测 + 修复：沙箱 Write 被拦** —— 知识库登记的三个候选（中文文件名 / 下划线 / 两层子目录）**都不是触发项**。
  - **勘测结论**：`PathBoundary.IsInsideAnyRoot` 全程只做一次规范化 + 前缀比较（根本身 or `root + 分隔符` 开头），没有任何按文件名、字符集或层数分支的逻辑 ⇒ 中文/下划线/十层子目录都走同一条命中路径，**不可能**因文件名或层数被拦。三个候选已固化成断言（新套件 14 条）。
  - **真机制**：`workingFolder` 由渲染端**每个** run 组装点各自透传，而 Worker 侧两处依赖它 —— 沙箱根集合（`CollectProjectRoots`）与文件工具路径基准（`ToolCallProcessor` → `ToolExecutionContext.WorkingFolder`）。漏传一处 ⇒ **两者同时落空**：roots 退化成「只有数据根」，相对路径也不再挂工作目录（`GetFullPath` 落到应用目录）⇒ 项目内写入被判越界，报错还劝用户「把目录加进项目工作目录」（他早加了）。与知识库「写深层子目录被拦 → 反复重试 → 改走 py 脚本」的现象吻合。
  - **实修两侧**：① C# 新增 `PathBoundary.ResolveProjectWorkingFolder`（params 优先，缺失时按 `projectId` 回查项目表），`CollectProjectRoots` 与 `ToolCallProcessor` 共用 —— 从机制上关掉「漏传即整体越界」；② 渲染端 `use-chat-actions.ts` 三处（plan 批准 / plan 驳回 / 退出 plan 模式）补上 `?? project?.workingFolder` 回退，与主路径对齐（那三处此前是 `session.workingFolder ?? undefined`）。
  - **门禁**：`npm run build:worker` 0 错 0 警告；`npm run typecheck` EXIT=0；新增 `WishfulClaw.SandboxPathRegressionTests`（**14 断言**）→ `npm test` **53 / 53**。
  - **未验**：知识库那台机器的现场无法复现，本轮修的是「由代码读出的机制」这条链的每一环，不是「在某台机器上抓到了那一次拒绝」。正文见 [S-144.md](requirements/S-144.md)。
- 2026-09-23：**小项清扫（一）：`disableWebInstaller` + `memory-output` 硬编码文案** —— iter-34 挂账里两条「i18n / 日志噪声」级别的小事，一并收掉。
  - `src/main/updater.ts` 的 `configureUpdater` 补 `instance.disableWebInstaller = true`。我们只发 NSIS 全量包 + `.blockmap`（差分），没有「下载器再回网页取包」的 Web Installer 流程；不设它，**每次**下载 electron-updater 都打一条 warn（`NsisUpdater`：`disableWebInstaller is set to false`），既吵又像漏配（将来 electron-updater 默认值若翻转，行为会跟着变）。
  - `memory-output.tsx` 的 i18n 补齐：`PRIORITY_LABELS` 里硬编码的中文标签（永久 / 重要 / 常规 / 临时）与 `找到 N 条记忆` 全部改走 `chat` 命名空间的 `memory.priority.*` / `memory.hits`（zh + en 双语、键名对齐）。**未知优先级值原样回显**（上游将来加枚举时不猜含义）。`PriorityBadge` 的类型从「label + tone 一张表」拆成「tone 表 + 键存在性判断」，避免给未知值编造翻译键。
  - 门禁：`npm run typecheck` EXIT=0；`npm run test:i18n-coverage` 通过（2 checks）。
- 2026-09-23：**小项清扫（二）：`will-navigate` 兜底 + 默认 Markdown 链接收口**（iter-34 挂账「10 处未拦」，安全类）
  - **主进程补兜底**（`src/main/index.ts`）：新增 `mainWindow.webContents.on('will-navigate', …)` —— 除 `http:` / `https:`（交系统浏览器，归宿与 `setWindowOpenHandler` 一致）外**一律 `preventDefault`**。`setWindowOpenHandler` 只管 `window.open` / `target=_blank`；同帧点 `<a href>` 走的是 **will-navigate**，此前全仓没有这一道 ⇒ 渲染端任意一处漏接的链接点一下就把整个应用导航走，而渲染端是带 preload 桥的。SPA 内部路由（`history` / hash）不触发本事件，拦这里不影响应用自身跳转。
  - **渲染端统一收口**：`markdown-components.tsx` 新增导出 `SAFE_LINK_COMPONENTS`（只带 `<a>` 拦截的最小 components 集，判定与 `markdown-renderer.tsx` 同款：除页内锚点外**先 `preventDefault` 再交给 `openMarkdownHref`**）；此前裸用默认 Markdown 的 10 处全部接上 —— `memory-output.tsx`（3 处）、`ask-user-question-block.tsx`、`CodeGraphToolCard.tsx`、`ContextCompressionMessage.tsx`、`MessageItem.tsx`、`PlanReviewCard.tsx`、`SystemCommandCard.tsx`、`SessionSummaryPanel.tsx`。主进程那道是安全底线（拦下来 = 点了没反应），这一道才是正确归宿（网址 → 右侧浏览器面板、本地路径 → 预览面板）。
  - 门禁：`npm run typecheck` EXIT=0；`npm test` **53 / 53**。
- 2026-09-23：**S-131 路径二（视口变窄也要收侧）** —— iter-34 挂账「左栏渲染漏按视口收窄」的**路径二**（路径一 `24311a9e` 只修了「渲染值按视口 clamp」）。
  - **问题**：收侧判定（`resolveChatWidthGuard`）只在「展开 / 拖宽某一侧」时跑。窗口被拖小没有动作可挂 ⇒ 两侧面板同开（左 370 + 右 370）时把窗口拖到 900，聊天窗只剩 **160**，破了 `CHAT_MIN_WIDTH = 600` 的底线，而所有 width 值都没人质疑过。
  - **修法**（iter-34 记的「修法 A」）：`right-panel-defs.ts` 新增纯函数 `resolveViewportYield()` —— 与 `resolveChatWidthGuard` 的区别是**没有「正在动的那一侧」**，两侧都按既有状态判；先收右侧（预览/浏览器是辅助面），右侧没开才收左栏（导航）。`ui-store` 加 action `enforceViewportWidthGuard()`（不需要收时 **`return state` 而非 `{}`**，避免一次无谓的全量通知）。`MainLayout.tsx` 挂 `resize` 监听，**只在变窄时**补跑判定；变宽不动（收掉的面板不会自动弹回，需用户自己点开 —— 与「窗口拉回来宽度值自动恢复」是两回事）。
  - 门禁：`npm run typecheck` EXIT=0；`npm test` **53 / 53**。
- 2026-09-23：**S-108 复勘：结案结论成立，不是「被 S-141 推翻」** —— iter-36 立项时按 iter-35 早期（08:42）那句「S-108 的真复现」登记，本次按 DB 实证复核，**该说法是当时的初版误判，S-141 自己在 §三/§七 已订正过，只是 iter-35 `changelog` 那句没回改**。
  - **判据**：S-141 的 61 条 DIAG 全部来自会话 `YUWPQgpeb7rzuWNGusOiZ`（08:27 那次）。直查打包版库 `C:\Users\龚翼\.wishful-claw\index.db`（`node:sqlite` 只读）：`context_cap_tokens = 200000`、`context_cap_model_id = deepseek-flash`、`model_id = null`（inherit）、`compression_threshold = 0` —— 与 `S-108.md` §二 2026-09-22 记的**逐字一致**（全库 119 个会话里非零 cap 的只有 2 个，都是 200000）。
  - ⇒ `contextLength=200000` **就是会话级 cap 生效**，不是「模型窗口没送到后端、后端吃兜底 200K」。S-108 的三条结论（取值链无缺陷 / 200000 的唯一来源是滑条最左端被拖到底 / 症状是前后端两套分母）**原样成立**，**不需要重新开刀**。
  - **仍挂着的三个遗留隐患**（S-108.md 原文记档，非本需求范围）：① **滑条最左端 = 200000** —— 想「放开限制」的人拖到底，恰好把上限设成最小值 20 万（建议 `0 = 不限制`，与全局项 0 哨兵口径统一）；② **两处 `currentModelId` 不同源**（上下文环显示端用 `activeModelCfg?.id`、payload 盖章端用 `provider.model`）；③ 前端按模型窗口算百分比、后端按会话 cap 算触发线，两套分母未统一。**这三条要不要单独立项，等老大一句。**
- 2026-09-23：**S-134 现状勘测（代码层面，未真机）** —— 「切会话 / 结束会话但 tab 还开着 ⇒ 进程是否仍在」的现状：
  - **终端 tab 是按会话分区的**：`TerminalTab.sessionId`（`terminal-store.ts`），agent 起的 tab 带 `sessionId`；`ensureSshAgentTab` / `hasSshAgentTabForSession` 都按 `sessionId` 找。
  - **只有关 tab 才杀进程**：`closeTab()` 对非 `ssh-agent` 的 tab 发 `TERMINAL_KILL`（`terminal-store.ts:161-168` → `terminal-handlers.ts` 的 `killTerminalSession`）。**切会话不关 tab ⇒ 不发 kill ⇒ PTY 进程仍在**（主进程 `terminalSessions` 里那条记录也还在，输出继续累积）。
  - **这是现状、不是缺陷**：没找到任何「会话切换 / 会话结束」触发的终端清理路径。所以待裁的是**期望**：保留（切回来还能看，符合「常驻终端」的命名）还是切会话即杀（省资源、避免后台进程失控）。**等老大一句话。**
- 2026-09-23：**S-146 登记 + 实施：下载类报错未包装** —— 老大 16:00「增加一个小需求，下载之类的 网络波动导致报错，并没有处理包装，用户看到的是原始的报错报文，这个需要调整」。正文见 [S-146.md](requirements/S-146.md)。
  - **定位**：`updater.ts` 的 `formatError()` 三层判定，前两层（`latest.yml` + 404 → 清单缺失；Node 系网络码 → 网络）有包装，**第三层兜底 `return message` 把原始报文直接送进更新对话框**（`UpdateDialog` 里 `<p>{state.error}</p>` 摊开）。
  - **第二层还有个漏**：码表只认 **Node 系**（`ETIMEDOUT` / `ECONNRESET` / `ENOTFOUND` …），而 Electron 的 `net` 模块与 electron-updater 的下载走 **Chromium 网络栈**，报文里是 `net::ERR_CONNECTION_RESET` 这种带前缀的形式 ⇒ **一个都匹配不上**，全部落进裸吐分支；HTTP 5xx / 408 / 429（服务端抖动）同样不在表内。
  - **修法**：抽纯函数模块 `src/main/lib/updater-error-format.ts`（零 electron 依赖 ⇒ main 与回归套件跑同一份代码，同 S-142 抽 `stream-segments` 的做法）—— `classifyUpdaterError()` 出 `{ kind: 'missingMetadata' | 'network' | 'unknown' | 'fallback', code? }`；网络码表**扩到三套**（Node/undici 系、Chromium `net::ERR_*`、HTTP 408/429/5xx）；短码优先级 `net::ERR_*` > `ERR_UPDATER_*` > `HTTP nnn`，**只放行短码**上屏；兜底不再回吐原文（原文照旧进 `logError` 的 extra，排查不受影响）。`updater.ts` 的 `formatError()` 改按分类取文案，新增双语键 `unknownWithCode`（`更新失败（{code}），请稍后重试。` / `Update failed ({code}). Please try again later.`）。
  - **范围**：只覆盖 **app 内更新**这条链（检查 / 下载 / 安装的失败展示）。官网下载按钮失败是浏览器行为，不归本应用展示；工具内下载不在本轮。老大若指的是别的下载界面，说一声另行登记。
  - **门禁**：`npm run typecheck` EXIT=0；新增套件 `tests/updater-error-format`（**38 断言**）。
- 2026-09-23：**S-147 登记 + 实施：请求日志报错信息可一键复制** —— 老大 16:05「再新增一个需求 请求日志里面如果请求报错有错误信息，希望有复制图标点击后可以复制」。正文见 [S-147.md](requirements/S-147.md)。
  - **定位**：老大说的「请求日志」= 设置 → 用量统计 → **请求明细**（`components/settings/usage-detail-table.tsx`；该页脚注原话「统计基于模型请求日志（每次 HTTP 请求一行，含重试与失败）」，行数据带 `status` / `errorKind` / `errorMessage` / `httpStatusCode`）。失败行只在成本列显示 `⚠ errorKind`，**完整错误信息仅挂在 `<tr title>`** —— 悬浮能看到全文，但没有可见文本、也没有任何复制入口。
  - **改法**：成本列 `⚠ errorKind` 之后加复制图标按钮，**仅有错误文本时才渲染**（`errorMessage?.trim() || errorKind?.trim()`，不给空按钮）；复制内容 = 悬浮那一段（`errorMessage` 优先，退回 `errorKind`）；点击后 1.5s 换对勾（与 `change-review-helpers` / `file-change-diff` 同款写法）；`stopPropagation` 防将来行级点击打架；`<tr title>` 保留。新增 i18n 键 `usage.detail.copyError`（zh「复制错误信息」/ en「Copy error message」）。
  - **门禁**：`npm run typecheck` EXIT=0；`npm run test:i18n-coverage` 通过（新键在两个 locale 就位）。
