# iter-v2-38 裁定流水

> 跨需求的决策、口径变更与偏差记录。按时序追加，一节一事。
> 需求正文见 `requirements/`，清单见 `raw-requirements.md`。

---

## 2026-10-08

- **12:37　老大追问 37 的图片生成成果 —— 入口找不到** —— 老大「我记得 37 迭代是处理了图片生成相关模型设置的，我没找到地方」。**实读复核**：37 第 9 刀 S-166（`cc26da7e`）是**纯后端**（`src/main/lib/image-endpoint.ts` + handler + 测试），**零 UI 改动**；唯一的声明入口藏在「设置 → AI 服务商 → 选中服务商 → 模型列表 → 编辑模型 → 模型的使用方式 → 图像」（`ModelFormDialog.tsx:266-275`）。⇒ 老大的「没找到地方」**不是记错，是本来就没有显式设置位**。

- **12:39　两条诉求一次口述 ⇒ 登记 S-173 / S-174** —— 老大：

  > 「S-166 本意确实是如果正常模型能生成图片就可以，但是当前来说这个是走不通的。所以需要**在模型管理页面，不是 AI 服务商管理页，设置图片生成模型**；以及**主页面左侧面板扩展中有绘图，需要接入了**，具体可以参考 OpenCowork」

  **拆两条的理由**：一条是**模型侧配置位**（S-173，动设置页 + 生图端点解析的取值源），一条是**界面侧工作台**（S-174，动左侧扩展入口 + 主布局路由 + 参考项目搬入），改动面与验证方式完全不同，合并即一需求两刀。两条有**前置关系**（先能指定模型，画布才有产出），故 S-173 排在前。

  - **S-173 勘测要点**：「模型管理」是设置页独立 tab（`zh/settings.json` `tabs.modelManagement`，desc「管理辅助请求使用的服务商和模型」），组件 `model-management/ModelManagementPanel.tsx`（233 行），数据源 `stores/managed-models.ts` 的 `managedModels`（`ManagedModelConfig extends AIModelConfig` + `normalizedKey`，**当前无「用途位」概念**）。S-166 的解析链在 `src/main/lib/image-endpoint.ts`，三级回落，**不读任何显式选择**。
  - **S-174 勘测要点**：入口**已在位**（`WorkspaceSidebar.tsx:216` 扩展区 `{ id: 'draw', ... onClick: openDrawPage }`），`ui-store.ts:273` 的 `openDrawPage` 只置 `drawPageOpen = true`，`MainLayout.tsx:45` 直接 `return <PlaceholderPage title="Draw" iterLabel="后续" icon={PenTool} />` ⇒ **是占位页，不是缺入口**。参考项目 `D:\claw\open-cowork-1.4.0` 的 `src/renderer/src/components/draw/` 为节点式画布工作台（40+ 文件），另有 `src/main/db/draw-runs-dao.ts` / `src/main/ipc/draw-agent-workspace-handlers.ts`。

- **12:44　归属裁定：进 38 迭代** —— 老大「归入 38 迭代，感觉有点复杂了」。

- **12:46　口径澄清** —— 老大「我说的**复杂**是对于 **37 准备收尾**来说太复杂了，列入新迭代去处理」。⇒ **需求档位未收窄**，不是「需求本身要砍」，是「不该塞进正在收尾的 37」。S-174 的范围问题（全量搬 vs 最小可用）**仍是待裁定项**，不因这句而默认缩小。

- **12:56　授权先开目录** —— 老大「目录可以先开，登记上需求」。⇒ 本迭代 `docs/plans/iter-v2-38/` 目录与两份需求正文建立；**不动任何代码、不切分支、不提交**（37 未收尾，`dev/v2-iter-38` 待 37 合并 main 后从 main 切出）。

- **挂账（登记时提出，13:36 已结）**：`requirements/S-172.md`（主链流式头链 5 份收敛）原挂在 iter-v2-37 目录、状态「已登记，本次不做」，其归属登记时未定。**13:36 老大裁定「172 也归属到 38 去」⇒ 已移入本迭代**，见下条。

- **13:36　S-172 归属变更：由 37 移入本迭代** —— 老大「172 也归属到 38 去」。

  操作：`docs/plans/iter-v2-37/requirements/S-172.md` **移动**到 `docs/plans/iter-v2-38/requirements/S-172.md`（该文件是**未跟踪**状态，直接 `Move-Item`，非 `git mv`）；状态行由「已登记，本次不做」改为「**已登记，待开工**」，并注明**原状态是相对 37 收尾而言、非需求本身搁置**。37 侧 `plan.md` / `raw-requirements.md` **本就没有 S-172 条目**（它只在 `requirements/` 目录里挂着），故 37 侧无需改动。

  ⇒ 本迭代范围定为 **S-172 ~ S-174 三条**，刀序：S-172（无前置依赖）→ S-173（S-174 的前置）→ S-174 → 迭代收尾。

- **13:40　S-173 方案裁定：走 A** —— 老大「S-173 走哪条：**A 加第四档用途位**」。

  ⇒ 落点定在「模型管理」tab 的 `ProviderCompletionSettingsPanel`：加**第四档用途位「图片生成」**（服务商 + 模型），与现役三档（提示词优化 / 新建角色辅助 / 补位模型）**同形**；`ProviderCompletionSettings` 结构增 `imageProviderId` / `imageModelId`；生图解析优先读该指定位，读不到回落 S-166 三级链；该位的模型下拉须放宽到 `category === 'image'`（现役过滤只列 chat）。

  **两个细节老大未答，留实施时定**：① 第四档是否就用 `ProviderCompletionSettingsPanel` 还是另起一块 UI；② 显式指定位失败时报错还是回落。

- **13:40　S-174 范围暂不定** —— 老大「**S-174 暂时不定**」。⇒ A 全量搬 / B 最小可用 / C 折中三条路径均保持开放，**仍挂账**（见 `plan.md §五`）。

- **13:41　S-173 落点确认** —— 老大「**现役三档那个组件　加第四档用途位**」。⇒ 第四档「图片生成」加在 `ProviderCompletionSettingsPanel` 内，**不另起 UI**。A 方案至此只剩一条待定：指定位失败时报错还是回落。

- **37 收尾后　老大打包版实测反馈两处 ⇒ 登记 S-175 / S-176**（具体时刻未记；37 收尾合并 main 之后发生）。

  **S-175（应用内更新）**：0.2.36 升 0.2.37 时 **①走全量下载**（差分没生效）+ **②没有更新内容说明**。本会话勘测**两条根因均已锁定**：

  - **①全量** = 官网已无旧版 blockmap。日志铁证 `~/.wishful-claw/logs/2026-10-08.log:643`（`06:22:47Z` = 北京 `14:22:47`，与 `updater\pending\temp-…0.2.37…exe` 的 `14:22:48` 对齐）：
    `Cannot download differentially, fallback to full download: … "…/wishful-claw-0.2.36-setup.exe.blockmap", status 404`。
    服务器实测：旧 blockmap `000` / 旧 exe `404` / 新 blockmap `200`。**本地差分基包其实在**（`%LOCALAPPDATA%\wishful-claw-updater\installer.exe` = 113,530,036 B，与 Release `v0.2.36` 的 exe `size` **逐字节相同**）⇒ 缺的**只有**服务器那份旧 blockmap。
    **落点**：`scripts/deploy.mjs:469-472`「只留当前版本」的清理，注释写「差分不需要旧包」—— 该判断**对 `.exe` 成立、对 `.blockmap` 不成立**。差分链 `AppUpdater.js:609`（两份 blockmap URL，旧 URL = 新包 URL 换版本号）→ `:638` `Promise.all`（**两份都得下到**）→ `:642-648` catch ⇒ 回落全量；旧 **exe** 走 `:628` 的本地 `cacheDir/installer.exe`（NSIS `installer.nsh:93` 装机时自拷），**不从服务器取**。
    ⚠️ **`scripts/deploy.mjs` 不入版本控制**（`.gitignore:57` `scripts/*`，`git log -- scripts/deploy.mjs` 为空，从未提交）⇒ 改动仅本机生效，**口径必须同步写进 `docs/release-workflow.md`**，否则换机器即丢。

  - **②没说明** = 官网 `latest.yml`（356 B，全文实读）**根本没有 `releaseNotes` 字段**。generic provider 只认 `latest.yml`，**GitHub Release 的 notes 不参与应用内更新**。**UI 链路完好**（`updater.ts:377` → `updater-state.ts` → `UpdateDialog.tsx:142-144` `state.releaseNotes ? … : null`）—— 是**输入为空**导致整块不渲染，非渲染侧漏读。
    electron-builder **原生支持**（`updateInfoBuilder.js:16-24` 自动读 `release-notes.md`，经 `packager.js:582-602` `getResource` 查找），但本仓库**无 `build/` 目录、未配 `releaseInfo`** ⇒ **自有打包起就没带过**，非 37 回归（0.2.36 的 latest.yml 同为 356 B、同构）。

  **S-176（聊天窗渲染高度）**：老大转述「以前定的只增加不回收，后来说的是需要回收，目前高度超出聊天窗范围了」。**这是同一处第三次翻转**（28 R-10.2 定只增不减 → 29 T-8/T-15 否掉留白 → 30 S-31/S-32 试回收后**推翻**、定水位线恢复只增不减、留白交给跟随姿态 → 36 S-150 加 240 ms 冷却锁）。iter-30 推翻的理由**仍在代码注释里**：收 `min-height` 即制造 `scrollHeight` 骤减 → 浏览器 clamp `scrollTop` → 必然跳（`useMessageListScroll.ts:650-655`）。
  ⇒ **本需求分量不在「加回收」，在于必须给出与 iter-30 不同的做法**，否则复现同一抖动。
  **37 未动这三个文件**（末次改动是 iter-36 的 `31daecca` / `86e2d71c`）⇒ 属 **36 之后的存量问题，非 37 引入**。
  **现象细节与口径未定，方案未定** ⇒ 见 `requirements/S-176.md §五`（复现场景 / 空白还是截断 / 回收目标 / 是否接受跳动换留白 / 有无录屏）。**卡在这，待老大答。**

  **本迭代范围由三条扩为五条**：S-172 ~ S-176。刀序建议 **S-172 → S-173 → S-174 → S-175 → S-176 → 迭代收尾**：
  - S-175 排前段但**必须在 38 打包前落地**（否则 38 → 39 仍是全量 + 无说明，且 38 一发就把 0.2.37 的 blockmap 也删了，坏账加一版）；其补漏动作（把 0.2.36 blockmap 传回服务器 / 或先升到 0.2.37）见 S-175 §3.3，**两条互斥，待老大选一条**。
  - S-176 放最后：它**有外部依赖**（等老大确认现象），放后面不阻塞其余刀。

  **待裁点汇总（尚未答复）**：① S-174 走 A / B / C；② S-175 的 blockmap 保留版数 N（助手建议 3）+ 3.3 补法选哪条 + 更新说明用收尾文档还是另写用户向简版（助手倾向另写）；③ S-176 的 §五 五项；④ 知识库的沙箱 Write bug / 微信消息分析是否纳入 38。

- **14:41　S-175 两项当场裁定 ⇒ 已实施并验证** —— 老大「36 的我已经下载回 `D:\claw\wishful-claw\release`，你把官网的补充上传一下；**blockmap 保留 5 个版本**」。

  **① 保留 N = 5** —— 改 `scripts/deploy.mjs`（⚠️ 该文件**不在版本库**，`.gitignore:57`）：

  - `CFG` 增 `blockmapKeepCount: 5`
  - 清理段由一条合并 find **拆成两条**：`.exe` 仍只留当前版（2026-09-23 口径不变）；`.blockmap` 用
    `find … -name 'wishful-claw-*-setup.exe.blockmap' | sort -V | head -n -5 | sudo xargs -r rm -f`
    保留最新 5 个（不足 5 个时 `head` 输出为空 ⇒ 不误删），落位后打印 blockmap 清单便于核对
  - **实测**（服务器 `/tmp` 造假数据，7 个：`0.2.9` / `0.2.10` / `0.2.33`~`0.2.37`）⇒ 保留
    `0.2.33`~`0.2.37`，删 `0.2.9` / `0.2.10` —— **按版本序而非字典序**（`sort -V`）；
    同目录 `.exe` 未被触碰；对真目录（当时 2 个）干跑输出为空 ⇒ 不误删
  - **尚未验证**：整套 `installer` 动作真发版跑一遍（等 38 发版顺带验）

  **② 补传 0.2.36 的 blockmap** —— 老大下回的 `release/wishful-claw-0.2.36-setup.exe.blockmap`（118,949 B）
  经 `scp` 落 `/tmp` → `sudo mv` 进下载目录 → `chown root:root` + `chmod 644`。核验：sha512
  `aecd71b9…54fbc` 本地/远端**一致**；线上 `…0.2.36-setup.exe.blockmap` **200**（`…0.2.36-setup.exe` 仍 404，
  **正常** —— 官网不放历史安装包、差分也不读它）；`0.2.37` 三件 200 / 200 / 200。
  ⇒ 老大机器（本地差分 base = 0.2.36 的包）**具备走差分的全部条件**。

  **③ 口径同步**（`docs/release-workflow.md`，进 git）—— §4.2 把「只放最新版本 / 差分不需要旧包」这句
  **错误口径**改成保留策略表（`.exe` 只留当前版 / `.blockmap` 保留 5 版）+ 机理说明（旧 exe 取本地
  `installer.exe`，旧 blockmap 必须从服务器下）；新增 **§4.2.1「补传历史 blockmap」**操作步骤；§六核验项
  加一条「最近 5 版 blockmap 均非 404」；顺手订正 `.gitignore:53` → **`:57`**（实测行号）。

  **工具坑（新，会再犯）** —— **Windows 的 `ssh.exe` 会把参数里的引号吃掉**：`ssh host "echo \"x\" | head -n -1"`
  到远端变成 `echo x | head -n -1`，带括号/管道的多行脚本直接语法报错。**多行脚本走 base64 最稳**：
  `$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))`，再
  `ssh … "echo $b64 | base64 -d | bash"` —— base64 只含 `A-Za-z0-9+/=`，不被任何一层改写。

  **未做 / 仍挂账** —— S-175 ②（让 `latest.yml` 带 `releaseNotes`）**仍未开工**，等老大定「更新说明的内容来源」；
  0.2.35 及更早的 blockmap 官网仍缺，助手建议**不补**（0.x 用户量小，今后由保留策略兜住）。

- **15:0x　S-175 ② 当场救火：把 0.2.37 的说明补进线上 `latest.yml`** —— 老大「那现在补一下官网上的 latest.yml」。

  **先订正早期说法**：本条**不是**「自有打包起就没带过 releaseNotes」能解释的 —— 那句话**只对 `latest.yml` 成立**。实因是**两个 provider 取说明的管道不同**：

  - 旧（GitHub 源）：清单里没有 ⇒ `GitHubProvider.js:135-139` 回头去 GitHub Releases 的 atom feed 抓 Release 正文（`computeReleaseNotes()`）补上
  - 现（官网 generic 源）：`GenericProvider.js` 全文**不含** `releaseNotes`，**没有第二来源**，清单里没有就是空

  切源提交 `d8315a3c`（2026-09-23 15:25，S-129 收尾），`git tag --contains d8315a3c` = **v0.2.36 / v0.2.37**
  ⇒ **v0.2.35 及以前有说明，0.2.36 起没有**。0.2.36 正是第一个官网源版本，老大恰好在它上面点检查更新 ——
  撞的是切换点，**不是记错**。说明文字**本身没少写**（`v0.2.36` Release 正文 1333 字符、`v0.2.37` 1159 字符），只是新管道不去取。

  **实施**：内容取 `.wishful-claw/notes/release-notes-v0.2.37.md`（与 GitHub Release `v0.2.37` 正文同源，1159 字符），
  以**块标量**（`releaseNotes: |` + 2 空格缩进）追加到 `release/latest.yml` 末尾，scp 上传（先备份旧份，再 `sudo mv`）。
  **核验**（三条消费链全实跑）：`js-yaml` 可解析；`version` / `files[0].url` / `size` / `sha512` / `releaseDate` **一字未动**；
  `releaseNotes` 与源文件**逐字相等**；官网前端正则（`website/src/lib/latest-yml.ts`）与 `deploy.mjs` 的 `readLatestYml()` 仍取到正确值；
  线上 **3383 B**、sha256 与本地一致、`root:root 644`、200，三件套 200 / 200 / 200。
  ⚠️ **下次发版即被覆盖 —— 这是救火，根治仍须走 `build/release-notes.md`（S-175 §3.2），未开工**。

- **15:0x　nginx 缓存之疑 ⇒ 结案：不用动 nginx** —— 发现 nginx 给 `/downloads/` 下发 `Cache-Control: max-age=604800`（7 天），
  一度怀疑刚补上的说明会被缓存挡住。**实读结论：两个消费方都主动绕过缓存** ——

  - electron-updater 的 HTTP 执行器对 GET **自动加 `Cache-Control: no-cache`**：`node_modules/builder-util-runtime/out/httpExecutor.js:505-506`（原文实读）
  - 官网前端是 `fetch(..., { cache: 'no-store' })`

  ⇒ 7 天缓存对更新链路**无影响**，nginx 配置**不动**。（有 CDN 之类的中间层才需再议，本项目没有。）

  **工具坑（另一会话在此打转，记下来别再犯）**：`Grep` 工具对 `node_modules/**` 报 `Directory not found` ——
  查依赖源码改用 `git grep --no-index` 或 `Get-Content` 定位，**不要在 `Grep` 上反复重试**。

- **15:16　老大点出「发布流程里对正文有要求」⇒ 订正我自己的错误倾向：正文不另写** —— 老大「你查看发布流程，里面有对发布正文的要求」。

  **我错在哪**：我先前判断「收尾那份 notes 带内部编号 S-xxx，直接给用户看不合适 ⇒ 倾向另写一份用户向简版」。**回查 `docs/release-workflow.md` §4.3 硬规则，这条判断不成立** ——

  - 条目格式是**模板明文规定**的：`- **{名字}（{编号}）** — {说明}`，**编号在括号内跟在名字后面**（原文要求，`§4.3` 硬规则第 3 条）
  - 同一条还规定「条目一律写**用户视角**；**不写** commit hash、文件路径、实现细节」
  - 标题固定 `## 迭代 {N}`，小节固定 `### 新增能力` / `### 修复` / `### 校验`，可选 `### 已知限制`

  ⇒ **那份 release notes 本身就是「面向用户的正文」**，不是工程口径稿；它也正是 `gh release create --notes-file` 的输入。**不存在「另写一份」的必要**。

  **实测坐实「真源唯一」**（2026-10-08，三方逐字比对，均 **1158 字符**）：
  本地 `.wishful-claw/notes/release-notes-v0.2.37.md` ＝ GitHub Release `v0.2.37` 正文 ＝ 线上 `latest.yml` 的 `releaseNotes`。

  **顺带记一个读法坑**：`.wishful-claw/notes/*.md` 是 **UTF-8 无 BOM**，用 `Get-Content -Raw`（PS 5.1 默认 ANSI）会读出乱码、且长度虚高（实测虚报 1612 vs 真实 1158）。**比文本一律 `[IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)`。**

  ⇒ S-175 ② 结论：**正文直接用 `.wishful-claw/notes/release-notes-v0.2.{N}.md`，不另写**；只剩落地方式 A / B 待老大拍（见 `S-175.md §四` 第 4 条）。

- **15:2x　「已下载却装不上」根因定位（实读代码 + 磁盘取证，非推断）** —— 老大报：机器 A 全量下载完成（显示 `108.3 MiB / 108.3 MiB · 已用 15:51`），点「立即重启安装」却报「没有已下载并准备安装的更新」；机器 B 在补传 36 blockmap 后下载、全程进度与大小未知、约 3 分钟装完。

  **结论：这是两个独立缺陷，机器 A 那条与 blockmap 无关。**

  **机器 A 根因链（逐环节有代码或磁盘证据）**：

  1. 下载**确实完成** —— `%LOCALAPPDATA%\wishful-claw-updater\pending\` 里躺着 `wishful-claw-0.2.37-setup.exe` **113,584,825 B**（＝ `latest.yml` 声明的 size），`update-info.json` 的 sha512 与 `latest.yml` 一致，LastWriteTime `2026/10/8 14:38:38`。⇒ 相位 `downloaded`、`downloadedVersion = '0.2.37'`。
  2. 用户点顶栏图标 ⇒ 渲染端 `recheckLatest()`（`use-app-updater.ts:147` 先置 `checking`）⇒ 主进程 `updater.checkForUpdates()` ⇒ electron-updater 抛 `checking-for-update` ⇒ `updater.ts:360` 调 `beginCheck()`；`downloaded → checking` 在表里是**合法**的（`updater-state.ts:20`）⇒ **相位离开 `downloaded`**。
  3. 接着抛 `update-available(0.2.37)` ⇒ 命中 `updater.ts:372-375` 的守卫（`downloadedVersion === version` 就 `return`）—— **它保住了磁盘上的包，却没把相位放回去**；`update-not-available` 也不会再来（本来就有新版）⇒ **主进程相位永久停在 `checking`**。
  4. 渲染端对同一件事有**补偿**逻辑（`use-app-updater.ts:162-165`：`downloadedVersion === result.latestVersion` ⇒ 相位回 `downloaded`）⇒ **UI 照旧显示「已下载完成 / 可重启安装」，进度还是那次的 `108.3 MiB / 108.3 MiB · 已用 15:51`**（完播时的 stale 快照，`finishedAt` 留下的值 —— 与老大看到的数字逐字吻合）。
  5. 点「立即重启安装」⇒ `requestUpdateInstall()`（`updater.ts:583`）见 `downloadedVersion` 非空，过掉第一道门（`:588`）⇒ `createUpdateInstallGate().request()` ⇒ `beginInstall()`：`hasMatchingPackage` 为真，但 `transition('installing')` 从 `checking` **不合法**（`LEGAL_TRANSITIONS.checking` 里没有 `installing`，`updater-state.ts:17`）⇒ 返回 false ⇒ `'refused'` ⇒ `updater.ts:593-594` 报 `noDownloadedUpdate`。

  **一句话**：**包还在盘上、`downloadedVersion` 还在，但相位飘到了 `checking`；而安装闸门判的是「相位能不能转到 `installing`」，不判 `downloadedVersion` —— 于是拒装。**

  **同族第二、三条路（同一根因，只堵一条会复现）**：
  - `applyNotAvailable()`：`downloaded → idle` 合法，且 `downloadedVersion` 非空时**故意不清**（`updater-state.ts:177-183`）
  - `failSilently()`：`→ idle`（`updater-state.ts:266-271`）

  两者都把相位留在 `idle`，而 `idle → installing` 同样不合法 ⇒ **同样拒装**。三条合起来才是根因：**「盘上有包」这个事实存在 `downloadedVersion` 里，闸门却用相位可达性代判，而相位会因手工重查 / 巡检 / 静默失败合法地飘走。**
  （注：`runPeriodicRecheck` 见 `downloadedVersion` 会自停（`updater.ts:619`），所以本次触发点必然是**手工重查**，与 `updater.ts:370-371` 那条注释自述的「用户点图标重查走的正是这条路」完全对上 —— 当时只想到了别把包作废，没想到相位已经先走了。）

  **附带一条独立缺陷（观测）**：`logLevel` 当前为 `warn`（`src/shared/logging.ts` 的 `DEFAULT_LOG_LEVEL`，实测本机 `settings/general.json` 也是 `warn`）⇒ `logInfo` 一律不落盘 ⇒ `updater.ts` 里 `Updater check started` / `kept the already-downloaded version` / `logDownload` 这些关键 INFO **一条都看不到**（今日日志 807 行，`INFO = 0`、`WARN = 773`、`ERROR = 17`，`[main]` 只有 1 条）。本次定位全靠磁盘文件 + electron-updater 自己那条 error 行倒推。**建议把 updater 的关键 INFO 提到 warn 级，或在发版流程钉一条「预置 info 级」。**

  **机器 B（差分无进度）—— ⚠️ 我第一版结论错了，下面是订正**：

  ❌ 我先前写「机器 B 不是 bug，是 `transferredOfTotal` 的既定渲染行为（两侧未知只输出一个「未知」）」—— **只看了渲染端就想当然，作废**。
  ✅ 老大追问「大小为什么未知？下载了多少？每秒多少？」后回查 electron-updater 源码，**这是真 bug，且是「切官网」引出的回归**。

  **机理（实读 `node_modules/electron-updater/out`，非推断）**：

  - `differentialDownloader/DifferentialDownloader.js:105`：
    ```js
    if (!this.options.isUseMultipleRangeRequest && this.options.onProgress) {
    ```
    ⇒ **只有「不用多区间请求」时才创建 `ProgressDifferentialDownloadCallbackTransform`**；配套注释原文：`// TODO: Does not support multiple ranges (someone feel free to PR this!)`。`:155` 再分叉：`if (this.options.isUseMultipleRangeRequest) { w = executeTasksUsingMultipleRangeRequests(...) }`。
  - 也就是说：**多区间差分路径上一个 `download-progress` 事件都不发** —— 不是「渲染成未知」，是**根本没有数据**。`transferred` / `total` / `bytesPerSecond` 全在那个不存在的 transform 里算（`ProgressDifferentialDownloadCallbackTransform.js` 逐字段可查），所以三样一起没有，正是老大看到的三样。
  - 该 transform 本身**是有数据的**：`total = grandTotal`（各 DOWNLOAD 区间字节和）、`percent`、`bytesPerSecond` 都算得出来；且每 1000ms 推一次。即**数据源存在，只是被 `isUseMultipleRangeRequest` 掐掉了**。
  - **为什么切官网之前没这问题**：`providers/GitHubProvider.js:16` 把 `isUseMultipleRangeRequest` **硬编码成 `false`** ⇒ **GitHub 时代差分是有进度的**。换成 generic（官网）后走 `providerFactory.js:50`：
    ```js
    isUseMultipleRangeRequest: options.useMultipleRangeRequest !== false && isUrlProbablySupportMultiRangeRequests(options.url)
    ```
    我们**没传** `useMultipleRangeRequest`（`electron-builder.yml` 的 `publish` 段只有 `provider` / `url`；生成的 `release/win-unpacked/resources/app-update.yml` 里也只有 `provider` / `url` / `updaterCacheDirName`），而 `isUrlProbablySupportMultiRangeRequests(url) = !url.includes('s3.amazonaws.com')`（`providerFactory.js:11-13`）⇒ **官网 URL 判定为支持多区间 ⇒ `true` ⇒ 进度被掐掉**。
  - **为什么现在才暴露**：切官网后差分先因 blockmap 404 失败 → 回落**全量**下载（`AppUpdater.js:641` catch 里 `fallback to full download`），全量走的是 `ProgressCallbackTransform`（**无条件创建**），所以机器 A 有进度（`108.3 MiB / 108.3 MiB`）。机器 B 补上 blockmap 后**差分真跑通了**，于是踩进无进度的多区间路径。
    ⇒ **推论：blockmap 补齐之后，所有走差分的用户都会看不到进度。** 这正是老大「切官网之后全线崩盘」体感的一大来源 —— 不只是装不上，还有「下载中什么都看不见」。

  **修法（一行，两条路，未实施）**：`useMultipleRangeRequest: false`（`builder-util-runtime/out/publishOptions.d.ts:175-177` 有此选项，注释自述「Defaults to `true` if `url` doesn't contain `s3.amazonaws.com`」）。
  - **打包期（推荐）**：`electron-builder.yml` 的 `publish:` 段加一行 `useMultipleRangeRequest: false`。**已核实它能落进 `app-update.yml`**：`app-builder-lib/out/publish/PublishManager.js:193-198` 是 `{ ...publishConfigs[0], updaterCacheDirName }`（spread 保留额外字段），`:416-433` 的 generic 分支直接 `return options`（只做 `{...options}` 与字符串宏展开）⇒ 额外键原样序列化进 `app-update.yml`（`:89` `serializeToYaml(publishConfig)`）。
  - **运行期（备选）**：`autoUpdater.setFeedURL({ provider: 'generic', url, useMultipleRangeRequest: false })` —— `AppUpdater.js:209-220` 走的正是同一条 generic 判定。缺点：要把 URL 在代码里再写一遍，多一个真源。
  - **代价（必须先量）**：多区间是**并行分片**，关掉改**顺序区间**（`DifferentialDownloader.js:155` 的另一分支），**可能变慢**。机器 B 那 3 分钟到底下了多少字节，最干净的取证是**服务器 nginx 的 access log**（range 请求条数与总字节），能直接算出差分比例；量完再定值不值得换。

  **顺带**：`declaredInstallerSize` 已一路透传到渲染端（`use-app-updater.ts:106/121`）但**没有任何 UI 消费它** —— 这条是**独立**的可选项，只在「拿到了 transferred 但不知道 total」时才有用；本次三样全无，它救不了。3 分钟装完 ⇒ 补 blockmap 这一步**本身是生效的**，别跟这条混为一谈。

  **修复方向（待老大拍，本次未动任何代码）**：
  - **甲（治本）**：把 `beginInstall` 的判据从「相位可达性」换成事实 —— 只要 `hasMatchingPackage` 且相位不是 `downloading`（在途不许退），就允许进 `installing`。实现上给 `idle` / `checking` 补 `installing` 可达，或让 `beginInstall` 走显式覆盖。**三条路一起堵。**
  - **乙（治标）**：只在 `updater.ts:372-375` 守卫处补一次「相位复位」（新增 `keepDownloaded()`：`checking | available → downloaded` + 重播 `update:downloaded`）。**只堵住机器 A 那条**，`applyNotAvailable` / `failSilently` 那两条仍在。

- **15:5x　S-175 ② 定案（老大裁定）** —— 老大口径：**「跟 GitHub 上能保持一致；`latest.yml` 只保留版本 / 时间 / 地址这些，更新说明由另一个文档提供」**。⇒ **登记为 S-175 ② 的落地方案**，详见 `requirements/S-175.md` §3.2「定案」/ §四。

  **三条事实（本轮实读）**：

  1. **`latest.yml` 不带 `releaseNotes` 本来就是 electron-builder 的默认行为** —— 仓库无 `build/` 目录、未配 `releaseInfo`，工具**从来没产出过**该字段。铁证现成：`tests/latest-yml/program.ts` 拿 **0.2.35 的真实产物**当 fixture、逐字照抄，**里面就没有** `releaseNotes`（0.2.37 那份是 15:0x 手工救火塞进去的）。⇒ 老大要的「只保留版本 / 时间 / 地址」= **什么都不用做**。
  2. **官网下载页不看 `releaseNotes`** —— `website/src/lib/latest-yml.ts` 的 `parseReleaseManifest` 只取 `version` 与安装包文件名（注释即写「其余字段留给 updater」）⇒ 零影响。
  3. **应用只从 `latest.yml` 读说明，没有第二来源** —— `latest.yml.releaseNotes` → `info.releaseNotes` → `formatReleaseNotes`（`updater.ts:180`）→ payload → `UpdateReleaseNotes.tsx`。抽走就是空态「本次发布未提供更新说明。」

  **方案（应用侧兜底）**：清单**有** `releaseNotes` ⇒ 用（旧行为一字不改）；**没有** ⇒ 去官网拉 `release-notes-{version}.md`；拉不到 / 版本对不上 ⇒ 空态。
  - **一个真源喂两个发布面**：收尾那份 `.wishful-claw/notes/release-notes-v0.2.{N}.md` —— 一份给 `gh release create --notes-file`（GitHub 正文）、一份传官网 —— **「跟 GitHub 保持一致」由此保证**，不靠人工对齐两份文本。
  - **文件名带版本号** ⇒ 应用拿 `info.version` 拼 URL，**文件不在就是没说明，绝不显示上一版的说明**（与 blockmap 那次同一类坑，宁缺勿错）。
  - **上传顺序**：notes md 先传、`latest.yml` 后传。
  - **`electron-builder.yml` 零改动**（不喂 `releaseInfo`、不建 `build/`）。
  - **过渡期**：已发出的 ≤ 0.2.37 客户端**只认清单内联**，若 0.2.38 清单已抽干净则 0.2.37 用户升 38 时**反而看不到说明** ⇒ **0.2.38 照旧带内联**，真正「干净」最早从 **0.2.39** 起。
  - **实现细节待定**：官网根地址倾向读包内 `resources/app-update.yml` 的 `url:`（唯一真源），**不**在代码里手写 URL。
  - **更省的备选 A′**（记下备用、助手不推荐）：弹窗只放一个「查看更新说明」按钮开浏览器 —— 零主进程改动，但会砍掉 `UpdateReleaseNotes.tsx` 那块内联说明区。

  **作废**：§3.2 原推荐的 `build/release-notes.md`（**内联进清单**）方向**整个不要了** —— 方向相反；落地方式 A / B 之争、`releaseInfo.releaseNotesFile` 备选一并作废。

  **本轮零代码改动、零提交**。`docs/plans/iter-v2-38/` 与 `docs/release-workflow.md` 的改动按要求**攒着**，不单独提交。

- **15:5x　登记落地（老大「根据你的推荐登记」）** —— 把本轮排查出的两处更新链路缺陷补登进 **S-175**，该需求由「两处缺陷」扩为**四处**：

  | # | 缺陷 | 状态 |
  |---|---|---|
  | ① | 差分失效（走全量） | ✅ 已修复并实测（§3.1 / §3.3） |
  | ② | 更新说明缺失 | ✅ 方案已定（§3.2），代码未开工 |
  | ③ | **差分下载无进度**（真差分路径不发 `download-progress`） | 🔍 根因已定位（新增 §3.4），修法一行，未开工 |
  | ④ | **已下载却装不上**（闸门判相位可达性，不判盘上事实） | 🔍 根因已定位（新增 §3.5），治本/治标待裁 |

  **改动清单（全部文档）**：
  - `requirements/S-175.md` —— 标题与状态头改「四处」；§一 现象表补 ③④ 两行；新增 **§3.4**（③ 机理 + 两条修法 + 生效边界：`app-update.yml` 烧进安装包 ⇒ 只随下个构建生效，**0.2.37 → 0.2.38 这跳仍零进度**）与 **§3.5**（④ 根因链五步 + 同族另两条路 + 甲/乙两条修法 + INFO 日志缺失这条观测）；§四 补第 5 ~ 7 条待裁；§五 补 6 / 7 两条验证要求；§六 补三条「刻意不做」。
  - `plan.md` —— 状态改「5 条需求」；§一 补 S-175 / S-176 两段；§二 索引补两行；§三 刀序补两步（S-175 剩余 ②③④、S-176 在最后）；§五 补两条挂账。
  - `raw-requirements.md` —— S-175 行改「四处」；补老大当轮**逐字原话**（「全线崩盘」/「大小为什么会未知？下载了多少 每秒下载大小 未知？」/ `app-update.yml` 追问）。
  - **本文（changelog）** —— 补本条流水。

  **明确挂账、未做**：③ 的代价取证（`useMultipleRangeRequest: false` 会不会变慢 —— 需 nginx access log）、④ 走甲还是乙、updater 关键 INFO 是否提级。**均未动任何代码。**

- **16:09　③ 拍板并落地（老大「改成 false 确定了」）** —— 老大理由原话：「改成 false 确定了，**服务器带宽太小了**，加上现在为 true 还**导致进度显示 bug**」。

  - **改动**：`electron-builder.yml` 的 `publish:` 段加 `useMultipleRangeRequest: false`（附注释说明原因与生效边界）。**这是 iter-38 的第一处非文档改动。**
  - **顺带否掉「先量再定」**：带宽是瓶颈 ⇒ 并行分片拿不到额外收益，顺序区间不吃亏。代价（顺序区间 = 一个 range 下完再下一个，且每 100 个区间歇 1 秒，`DifferentialDownloader.js:202-213` / `:207-210`）**据实记录、未实测**。
  - **核对**：`js-yaml` 解析 `publish` = `{provider, url, useMultipleRangeRequest: false}`，类型 boolean；选项名精确拼写见 `builder-util-runtime/out/publishOptions.d.ts:175-177`（**单数 `Request`**）；文件 no-BOM + 纯 CRLF。
  - **文档**：`S-175.md` —— 状态头 ③ 改「定案并已落地」；§3.4 标题改 ✅ 定案、修法表标「已采用 / 不用」、补定案理由与实施记录；§四 第 5 条划掉；§五 第 6 条补两条「不是 bug」的语义（`total` = 差分要下的字节、COPY 段不计数）+ 打包后核 `app-update.yml`；§六 补「不为多区间补进度上报、不改库不 fork」。
  - **未提交** —— ③ 只是 S-175 的一段，按刀序与 ② 合刀；**迭代内一律不 push**。

