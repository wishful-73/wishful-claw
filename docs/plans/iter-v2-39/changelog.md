# iter-v2-39 裁定流水

> 跨需求的决策、口径变更与偏差记录。按时序追加，一节一事。
> 需求正文见 `requirements/`，清单见 `raw-requirements.md`。

---

## 2026-10-09

- **17:30　开迭代** —— 老大：

  > 「开39迭代吧，我的目标是39或者40迭代转正成1.0.0版本 不过目前要看bug的修复情况，近期不会频繁更新了，沉淀一下」

  ⇒ 从 `main`（`2c925c88` = tag `v0.2.38`，38 收尾合并点）切出 `dev/v2-iter-39`，建 `docs/plans/iter-v2-39/`（`plan.md` / `raw-requirements.md` / `changelog.md`）。

  **迭代定位**：**沉淀迭代** —— 以缺陷修复与收敛为主，近期不频繁发版；**转正 `1.0.0` 的落点（39 或 40）待 bug 修复情况判定**。

  **需求范围未定**，待老大登记。承接 38 的候选遗留项（S-174 / S-177 观察 / 更新链路端到端验证 / 文档欠账 3 笔 / 沙箱 Write + 微信消息分析）已列在 `plan.md` §六，**均为候选，不等于已登记**。

- **17:41　范围口径：本迭代只收 bug，等 38 实跑** —— 老大：

  > 「版本规则现在不着急改，等确认的时候再说，bug 就是需要38先运行看到底有哪些bug 新功能都可以暂时不用列入」

  ⇒ 三条：

  1. **转正 1.0.0 的版本规则改动推迟** —— 等「转正确认」时再定（`docs/release-workflow.md` §二 `0.2.{N}` 的改写**不在本次**）。
  2. **本迭代只收 bug 修复，新功能暂不列入** —— 顺延的 **S-174 绘图工作台**（属新功能）**不纳入 39**；§六 其余条目按此口径逐条筛。
  3. **需求登记先不齐** —— 要**等 `v0.2.38` 实机运行一段时间、把 bug 收集齐**再登记；39 期间以「收 bug → 逐条修」为主。

- **17:43　转正落点修订：最早 40** —— 老大（纠正我的错误建议）：

  > 「0.2.37 的机器，升一次到 0.2.38，把现象（进度、说明、差分、装不上） 这个报个鸡毛哦，38才修复的 需要38升级39才能看 所以最快也要40版本才能考虑转正1.0.0」

  **我错在哪**：把「更新链路整体验证」笼统挂在 `0.2.37 → 0.2.38` 那一跳上。实际那一跳只能看**旧客户端视角的三样**（发现更新 / 差分生效 / 说明内联），**38 新修的进度显示、装不上、说明兜底拉取全都看不出** —— 那是「带修复的客户端」升下一版才有的表现。

  **修订后的口径（生效）**：

  1. **应用内更新链路的修复只能由后一版实升验证** —— 38 的修复看 **`0.2.38 → 0.2.39`**，39 的修复看 **`0.2.39 → 0.2.40`**。
  2. **最短链条 = 38（修）→ 39（验 38）→ 40（验 39）** ⇒ **`1.0.0` 最早落在 40 迭代**；原口径「39 或 40」**作废**。
  3. ⇒ **39 迭代必须发布 `0.2.39`** —— 不为新功能，也是**把 38 的修复推到实机、形成可验证升级链**的必经一环。

- **17:54　登记 S-182（第一条）—— 官网侧统计** —— 老大：

  > 「先登记一个跟软件本身没关系的，官网的需求，我希望能记录下载次数和访问次数。」

  ⇒ 登记 **S-182**，正文 `requirements/S-182.md`。**性质：官网侧需求，与软件本体无关**（不影响软件版本号、不阻塞发版、主仓业务代码零改动），不占用软件缺陷池。

  **只读勘测结论**（`ubuntu@119.45.103.252`，2026-10-09）：

  - 「**访问次数**」**现在就能算** —— 页面请求已记入 `/var/log/nginx/access.log`（combined 格式），但 logrotate **daily × 14**，只有 14 天窗口；当日 `/` 命中 302 次、独立 IP 238，**混着大量扫描器与爬虫**，不筛则数字失真。
  - 「**下载次数**」**现在拿不到** —— `location ^~ /downloads/` 里写着 **`access_log off;`**（`/etc/nginx/snippets/wishfulclaw-site.conf`），实测 `access.log` 中 `setup.exe` / `latest.yml` 命中均为 **0**。**要统计必须先改 nginx 配置。**
  - **一个 URL 两类下载者**：官网点击（浏览器 + referer）与应用内更新（`electron-updater`）拉的是同一个 exe ⇒ 「下载次数」**必须先定义口径**，建议拆 `web_download` / `app_update` / `update_check` 三个数。
  - 首选方案 **A（服务器侧日志聚合，零前端改动）**；六项待确认口径见正文 §五。

## 2026-10-10

- **08:33 / 08:35　S-182 口径细化（两条）** —— 老大：

  > 08:33「下载数量 我是想在官网下载页面能看到  下载次数你觉得那个合适 检查更新的次数感觉不能算上」
  > 08:35「我要的不是这个版本的下载， 应用内自动更新这个也算上」

  ⇒ **「下载次数」最终口径**：

  1. **要显示在官网下载页面**（`/download`）；
  2. **官网点击与应用内自动更新都算** —— 要的是**安装包分发总量**，不是官网页面的点击量（08:35 纠正了助手「只算官网点击」的建议）；
  3. **检查更新次数（`latest.yml` 请求）不算**。

  **由此改掉的计数规则（关键）**：原先拟「按无 `Range` 的首次请求计数」—— **作废**。`electron-updater` 的**差分下载**只发带 `Range` 的段请求，可能完全没有一次完整 GET，那样会把自动更新全漏掉。改用 **按 `客户端 IP + User-Agent + 文件名` 去重（1 小时窗口）** —— 同一「IP-客户端-文件」在窗口内的所有请求只算 1 次（浏览器多线程与 updater 分段都能并掉）。代价：NAT 出口同小时的多人会并成 1 次。

  **方案 B（前端埋点）按新口径作废** —— 它天生数不到自动更新。

- **08:41　访问次数也公开** —— 老大：

  > 「访问次数可以公开，感觉也不是怎么特别的东西」

  ⇒ **两个数都上官网页面**：**下载次数 → `/download` 页**（08:33 定）；**访问次数 → 全站 footer**（助手提案，低调、每页可见）。页面上的「访问次数」用 **PV（累计，已过滤机器人）**；后台报表仍保留 PV / UV 与分页明细。

- **09:33　S-182 纳入 39（性质澄清）** —— 老大：

  > 「纳入39啊，不过其实官网跟我们软件迭代没什么关系」

  ⇒ ① **纳入 iter-v2-39**；② 但它是**独立轨道** —— 与软件本体、软件版本号、发版节奏**无关**：代码只动 `website/`（**不动主仓业务代码**），部署走 `node scripts/deploy.mjs site`（与 `installer` 那条发版线互不干扰）。

  ⇒ **不占用软件缺陷池，也不等 39 的其他 bug 登记齐 —— 可先做。**

- **09:36　登记 S-183 / S-184 —— 项目档案页系列 bug** —— 老大：

  > 「登记系列bug 主要集中在项目档案页面 1.项目记忆，记忆库 等文档或列表缺少高度限制也不出滚动条，导致内容直接被遮挡无法查看 2.项目人格，当前wishfulclaw下默认把全局人格都拷贝进来了，但是用户无法点击切换查看，也删不了，这个需要探索情况」

  ⇒ 拆两条登记（正文 `requirements/S-183.md` / `S-184.md`），均为**软件侧 bug**，按 17:41 口径纳入 39：

  1. **S-183 · 内容区缺少高度约束** —— 现象：项目档案页里内容超一屏的文档 / 列表**不出滚动条**、超出部分被**静默裁掉**。
     **静态读码定位的根因**：`ProjectArchivePage.tsx:201` 的中间层 `<div className="mx-auto w-full max-w-[1480px]">` 是**普通块级 div**，不在 flex 高度链上 ⇒ 下游（`:300` tab 内容区 → `ProjectMemoryFileTab.tsx:106/:159`、`ProjectMemoryLibraryTab.tsx:283/:376`）的 `flex-1` 逐级失效 ⇒ `overflow-auto` 永不触发；而根容器 `:200` 是 `overflow-hidden` ⇒ 超出部分被裁。**未实测**（静态推断），修复方向 = 让中间层进 flex 高度链。
  2. **S-184 · 项目人格** —— 三个子问题：
     - **A（项目目录为什么有全部 6 份内置人格）**：现场 `.wishful-claw/personas/` 实有 `default / lao-zheng / jarvis / taozi / tingjie / aming`，**与 `PersonaPresetService.cs:20-23` 的 `BuiltinPresetIds` 完全一致**；全局目录 `~/.wishful-claw/personas/` 为空。落盘路径 = `PersonaStore.CopyToProject(personaId=null, …)`（`PersonaStore.cs:318-343`，一次拷全部 preset）→ IPC `persona/apply-to-project`（`PersonaModule.cs:147-163`）→ **渲染端唯一调用点** `PersonaPanel.tsx:121-129` 的**用户点击按钮**。⇒ **代码中无自动触发路径**，「默认拷进来」**待复现确认**。
     - **B（无法点击切换查看）**：`ProjectArchivePage.tsx:344-359` 的按钮 `onClick={() => setActiveTab('persona')}` 是**空操作**（本来就已在 `persona` tab），且预览区 `:360-366` **硬编码 `personas[0]`**、无选中态。
     - **C（无法删除）**：人格 tab 内**无删除入口**；删除能力在设置页（`PersonaPanel.tsx:114-119` → `persona/delete`，支持 `workingFolder`）。
     - **附带**：设置页列表走 `ListPersonas`（内置 + 全局 + 项目**三层合并**），项目档案页 `loadPersonas` 只 `listDir(项目 personas 目录)`，**两处语义不一致**。
     - **待拍板 Open 问题**（见 S-184 正文 §三）：C 的删除边界 / 是否改用合并语义。

- **09:43　S-184 范围收敛：A 出局** —— 老大：

  > 「A 不算bug 应该是测试的时候弄的，我手动删掉就是」

  ⇒ **A（项目目录里为什么有全部 6 份内置人格）判定为非 bug** —— 测试期间经设置页「从全局复制到项目」按钮人为落盘，属操作结果；老大手动清理即可。**S-184 收敛为 B（无法点击切换查看）+ C（无法删除）**，两条仍是待修缺陷。

  ⇒ 正文 `requirements/S-184.md` 已同步：标题、状态、§二 A 段（标注归档）、§三 开放问题（删去原第 1 条并重编号）、§四 影响范围（去掉 `PersonaPanel` 相关）。

- **09:49　登记 S-185（内置人格精简）** —— 老大：

  > 「185 把所有内置人格意思不变的情况下 精简字数，避免注意力超标，现在只登记，不开工，等下午6点后走低消费模型时段」

  ⇒ 登记 **S-185**（正文 `requirements/S-185.md`）。**四条约定**：对象 = 全部内置人格（6 preset）；约束 = **意思不变**；目标 = **精简字数、避免注意力超标**；时机 = **只登记、不开工，18:00 后**走低消费模型时段。

  **只读勘察结论（2026-10-10）**：

  - **范围与基线**：`src/runtime/WishfulClaw.Persona/Resources/Personas/` 下 **24 个文件**（6 preset × 4 文件），全仓**无第二份副本**（`git ls-files` 核实）。总计 **15,435 字符** —— `aming` 3,022 / `default` 1,464 / `jarvis` 2,468 / `lao-zheng` 3,939 / `taozi` 1,962 / `tingjie` 2,580。**`SOUL.md` 独占 7,218 字符（47%）**，`SOUL + ONTOLOGY` 占 69%。
  - **注入方式 = 原样**：`PromptBuilder.cs:15` 明确 Persona `.md` **as ContextDocuments（raw Markdown, not parsed fields）** ⇒ 每个字都进上下文；`BuildContextDocuments`（`:182-221`）按固定序 **IDENTITY → SOUL → ONTOLOGY → AGENTS**（`:411-414`）包进 `<persona>` 块，只在 `PromptProfile.Main` 注入。
  - **不是截断问题**：预算 `DefaultCharacterBudget = 20_000`（`:25`），**无任何调用方传自定义值** ⇒ 恒 20,000；最大人格 3,939 **远未触及** ⇒ 不触发截断。⇒ 老大的「注意力超标」是**提示词整体变长稀释指令遵从**，**只能靠写短解决**。
  - **精简空间来自跨文件重复**（以 `lao-zheng` 为例）：「直 / 不废话 / 不客套」散在 IDENTITY + SOUL + ONTOLOGY + AGENTS 四处；「不确定就说不确定」散在 SOUL + ONTOLOGY + AGENTS 三处；「我是谁」自述在 IDENTITY + SOUL + ONTOLOGY **三处**。⇒ 手段 = **去重 + 去修饰**，不是删信息。
  - **⚠️ 无自动化护栏**：`tests/` 下对 `Personas` / preset ID **零命中** ⇒ 内容改动逃过全部测试，**人工逐条复核是唯一护栏**。
  - **存量副本不同步**：用户经设置页「从全局复制到项目」落盘的人格是**静态拷贝**，精简后仍是旧文本（已登记备查，**不在本需求范围**）。

  **开工前置**：目标压缩比（助手建议 35%~45%，15,435 → 约 8,500~10,000）待老大拍板。

- **10:10　S-185 补充裁定：不设压缩指标** —— 老大：

  > 「目标压缩比不强制，目的只是为了精简」

  ⇒ **唯一硬约束 = 意思不变**；压多少由文本自身冗余度决定，**不做数字对齐**。原「建议 35%~45%」降级为**参考量级**（正文 §五.2/§五.3 已改）。`default`（1,464 字符，本就紧凑）**允许压缩比明显低于其他**。

  ⇒ §七 开放问题第 1 条（目标压缩比）**结案**。

- **10:14　登记 S-186（官网下载按钮改走 GitHub 加速站）** —— 老大：

  > 「186 也是关于官网的，目前官网下载页面点击下载是提供的我们服务器本身的路径，不过今天研究后发现我们服务器虽然是1M带宽 实际下载只有128kb, 所以下载按钮打算还是用GitHub的，只是走国内加速站点 ，差分下载这些软件内的自动更新不调整，只是下载按钮变成下拉选择这几个里面的一个
  > ghproxy.net：https://ghproxy.net/ + 你的链接。支持断点续传，比较稳定。
  > ghproxy.homeboyc.cn：https://ghproxy.homeboyc.cn/ + 你的链接。有实测提到这个适合下载 1GB 以上的大体积 Release 包，很稳。
  > v6.gh-proxy.org：https://v6.gh-proxy.org/ + 你的链接。这个站针对国内网络做了优化，还支持 IPv6。
  > gitproxy.click：https://gitproxy.click/ + 你的链接。专门做 GitHub 仓库和 Release 文件加速的服务。」

  ⇒ 登记 **S-186**（正文 `requirements/S-186.md`）。**四条口径**：对象 = 官网 `/download` 的下载按钮；改法 = **GitHub 直链 + 加速站前缀**；形态 = **下拉多源**；红线 = **软件内自动更新（差分 / `latest.yml` / blockmap）一律不调整**。

  **只读勘察结论（2026-10-10）**：

  - **现状落点**：`website/src/lib/latest-yml.ts:57-59` 的 `releaseFileUrl` 返回 **`./downloads/${setupFile}`（同域相对路径）**；`download-buttons.tsx:26-28` 注释里写着「跨域时浏览器会忽略 `download` 属性，早先指 GitHub 直链就是那种情况」⇒ **本需求正是要走回那条被放弃过的路**。
  - **目标 URL 形态**（`gh api` 实测）：`https://github.com/wishful-73/wishful-claw/releases/download/v{version}/{setupFile}`；v0.2.38 的实际资产名 `wishful-claw-0.2.38-setup.exe` 与 manifest 的 `setupFile` **一致**，tag = `v{version}`。
  - **加速站实测（`Range: 0-2047` + Chrome UA，对 v0.2.38 的 `latest.yml`）**：`ghproxy.net` **206 ✅**；`v6.gh-proxy.org` **206 ✅**；`ghproxy.homeboyc.cn` **403 ❌**；`gitproxy.click` **200 但 0 字节 ⚠️**。⇒ **4 站只有 2 站当下可用**，印证「下拉多源」的必要性；开工时须用**真实 exe（113 MB）**复测速率 / 断点续传 / `Content-Disposition`。
  - **⚠️ 与 S-182 冲突（需拍板）**：S-182 的「下载次数」= **官网点击 + 应用内更新**，靠 nginx `/downloads/` 日志。S-186 生效后**官网点击不再经过自己服务器** ⇒ nginx 数不到 ⇒ 该数字只剩**应用内更新**一个来源（口径收窄）。**GitHub 的 `download_count` 顶不上**（实测同一份数据：v0.2.38 exe=3 / v0.2.37 exe=2 / v0.2.36 exe=22 / v0.2.35 exe=12 —— 历史上没人从 GitHub 直接下）。⇒ 四条出路（只统计应用内更新 / 加前端点击上报 / 下拉保留本站源兜底 / 改文案改口径）**待老大定**。
  - **已知限制**：应用内自动更新仍走 128 KB/s 的服务器（差分远小于全量，可接受；**回退全量时仍慢**）；加速站是公益服务，随时可能失效。

---

## 2026-10-10 10:21 —— S-182 / S-186 统计口径裁定：**b + c 都做**

**老大原话**：

> 「b和c都要 你的推荐a违背了我做这个统计的目的」

**裁定**：

- ✅ **b** —— 官网点击**统计**（补「官网点击」那一半）；
- ✅ **c** —— 下拉里**保留本站直链**（第三方全挂时兜底，也是 nginx 能直接数到的来源）；
- ❌ **否定 a** —— 助手原建议把「下载次数」缩成只剩**应用内更新**，**违背 S-182「统计真实分发量」的初衷**（拿「数字变小」换省事，方向错了）。

**由此产生的统计设计（S-182 侧）**：

- 统计来源由**一个**变**两个**：`wishfulclaw-downloads.log`（应用内更新 + 走本站直链的下载）＋ **`wishfulclaw-clicks.log`**（官网点击）；
- 去重规则沿用 `IP + UA + 文件名`（1 小时窗口）；
- b 只承担「官网点击」这一半，**自动更新仍由服务器数** ⇒ **不是回到当初被否的「纯前端埋点」**。

**连带影响**：

- **S-182 口径修订** —— 改按**两个日志源**设计（`S-182.md` §三「口径修订」、§四 B′、§六.6）；状态由「口径已齐」改为「**口径已定，待开工**」。
- **S-186 口径齐** —— 去掉「待拍板」，§四变化点补 b / c 两条，§六 改为裁定记录。
- **刀序** —— **S-182 与 S-186 一起收口**：先落 S-186 的前端改动，再一次性把 S-182 的聚合脚本按两个日志源做完。
- **均仍属「待开工」** —— 本次仅为口径裁定，**不是开工指令**。

---

## 2026-10-10 10:30 —— b 不走前端接口：确认「先经过我们 nginx」即可计数

**老大原话**：

> 「b 看下可以走nginx 的方式不。加接口感觉有点复杂了」
> 「走加速站的也可以用nginx的方式么？如果是那就可以」

**结论：可行** —— 加速站点击只要「先经过我们 nginx」，就能被记到。助手先给的是**裸 `302`** 版本（`location = /dl { return 302 … }`，前端零 JS）。

---

## 2026-10-10 10:38 —— b 定为「**官网中转页**」

**老大原话**：

> 「我的想法是官网新建一个中转页面，点击下载先到我们中转页面，基于这个中转就可以记录下载次数了，然后中转再直接跳转到加速站去，这里是否成功就跟我们没关系了」

**结论：不是裸 `302`，而是一个真实页面。**

**做法**：官网新增**第四个 MPA 入口** `/go`（现为 `index` / `download` / `guide` 三入口），加速站各项的 `href` 指向它；**页面请求本身进 nginx 即计一次点击**，页面再 `location.replace()` 跳到加速站。

**落点（4 处）**：

| # | 文件 | 改动 | 归属 |
|---|---|---|---|
| 1 | `website/go.html`（新建） | 照 `download.html` 骨架，改 title，引 `./src/go-main.tsx` | S-186 |
| 2 | `website/src/go-main.tsx` + `go-page.tsx`（新建） | 读 query → 显示「正在前往下载…」+ 兜底链接 → `location.replace(target)` | S-186 |
| 3 | `website/vite.config.ts` | `PAGES` 加 `'go'`；`rollupOptions.input` 加 `go: 'go.html'` | S-186 |
| 4 | nginx `wishfulclaw-site.conf` | `location = /go` + `wishfulclaw-clicks.log`；尾斜杠 301 正则补 `go` | S-182 |

```nginx
location = /go {
    access_log /var/log/nginx/wishfulclaw-clicks.log combined;
    try_files $uri.html =404;          # /go -> /go.html（与现有 /download 同款）
}
location ~ ^/(download|guide|changelog|go)/$ { return 301 /$1; }
```

**计数原理 —— 中转页里不写任何上报代码**：

- 点加速站项 ⇒ `GET /go?src=ghproxy.net&u=...` ⇒ 进 `clicks` 日志 ⇒ **计 1 次**；
- `combined` 的 `$request` **含 query string** ⇒ 聚合脚本能按 `src` 拆出各站点击量；
- 跳转由页面 `location.replace()` 完成，**成败与我们无关**（老大原话）。

**相对裸 `302` 的差别**：多一层页面 ⇒ 能显示「正在前往下载…」、能放**兜底链接**（自动跳转被拦时可手点），也不怕 `302` 失败变白屏。**计数口径完全一样。**

**偏差**：数的是「**点击**」（进了中转页），不是「加速站真实传输完成」。

**连带影响**：`S-186.md` §四 / §六 / §七 / §八 与 `S-182.md` §三 / §四 / §五 / §六 已同步为**中转页方案**（`/dl` 全部改掉）；`plan.md` 刀序不变（仍与 S-182 一起收口）。**仍属口径记录，非开工指令。**

---

## 2026-10-10 10:46 —— 登记 S-187（右侧面板 Git 选项卡布局）

**原话**：

> 「再登记一个优化需求 右侧面板的文件板块下的 git选项卡 现在默认是文件夹的情况下，出来了文件历史 还有个 说明还是什么，导致右侧放不下了，这里需要讨论一下，比如文件历史走弹窗」

**登记**：**S-187**，纳入 39，**待讨论**（非开工）。老大已给方向倾向 —— **文件历史走弹窗**。

**只读勘察（本会话，零改动）**：

- 落点链：右侧面板 → `AgentFilesPanel`（文件板块，`TABS` = `files` / `branches` / **`git`**）→ **Git 子选项卡** → `chat/GitPage.tsx`（667 行）。
- 「文件历史」唯一使用点 = `GitPage.tsx:497`（i18n `chat.git.fileHistory`，`zh/chat.json:1452`）。
- `GitPage` 按**宿主宽度**切形态（`ResizeObserver`，`:87-96`）：**< 640** ⇒ **紧凑**（只 `ScmSidebar`，diff 走 `GitDiffDialog` 弹窗，**不渲染文件历史栏**）；**≥ 640** ⇒ **三栏并排**（`ScmSidebar` ｜ diff ｜ 文件历史）。
- 右侧面板常量：`RIGHT_PANEL_DEFAULT_WIDTH = 384` / `MIN = 280`（`right-panel-defs.ts:5-6`）。

**⚠️ 结论：现状与老大描述对不上** —— 默认 384 < 640 ⇒ 应落**紧凑**形态，**理论上看不到文件历史栏**。⇒ **复现条件待老大确认**（4 条：面板实际宽度 / 「文件夹」所指 / 「说明」是哪块 / 能否截图录屏）。

**候选方案**（均未实施）：A 提高紧凑阈值（治标）／ **B 文件历史改弹窗（老大提议，助手倾向）**／ C 紧凑形态补历史入口 ／ D 历史栏可折叠。**B 顺带补齐「紧凑形态下看不到文件历史」的缺口。**

**落档**：新建 `requirements/S-187.md`；`plan.md`（§一 计数 5→6、§二 索引、§三 刀序、裁定汇总）、`raw-requirements.md`（进度 / 表 / 原文 / 统计 5→6）同步。**行尾核验：`bareLF=0`、无 BOM。**

---

## 2026-10-10 11:02 —— S-187 口径已定：**去三栏** + **右键文件开历史弹窗**

**原话**：

> 「就是拉宽了，然后出来重叠在一起了，我之前不知道。三栏并排：SCM ｜ diff ｜ 文件历史 这个不要，然后文件历史可以右键文件历史进行弹窗是最好的」

**现象坐实（老大侧）**：不是默认宽度下看到的 —— 是**把右侧面板拉宽**后触发的。老大原话「我之前不知道」= 不知道宽形态还有第三栏。

**根因（本会话只读勘察）**：

- `GitPage` 形态阈值 `GIT_PAGE_COMPACT_MAX_WIDTH = 640`（`GitPage.tsx:31`）；
- 宽形态三栏 = `ScmSidebar`（固定 `scmWidth`，默认 **360**）｜ diff（`flex-1`）｜ 文件历史（固定 `historyWidth`，默认 **300**）；
- **阈值与实际所需宽度不匹配**：三栏要 360 + 300 + 可用 diff ≈ **800+** 才放得下，而 640 就切三栏 ⇒ 面板落在 **640 ~ 约 800** 区间时，两栏固定宽把中间 `flex-1` **挤爆 ⇒ 三栏重叠**。

**口径（2 条）**：

1. **三栏并排不要** ⇒ 宽形态改 **两栏**（`ScmSidebar` ｜ diff）；
2. **文件历史改弹窗**，**入口 = 右键文件**。

**方案 B′（5 处改动，**均未实施**）**：

| # | 文件 | 改动 |
|---|---|---|
| 1 | `GitPage.tsx` | 删 `:487-563`（历史栏 + resize 手柄）⇒ 宽形态两栏 |
| 2 | `hooks/use-git-panel-split.ts` | 删 `historyWidth` / `onHistoryResizePointerDown` |
| 3 | `GitPage/git-history-dialog.tsx`（新建） | 照 `git-diff-dialog.tsx`：左 = 提交列表，右 = 选中 commit 的该文件 diff |
| 4 | `GitPage/ScmSidebar.tsx` | `ScmFileRowView` 挂 `ContextMenu`（组件**已 import**）→ 菜单项「文件历史」 |
| 5 | `GitPage.tsx` | 接 `onShowFileHistory` → 打开弹窗 |

**复用**：`historyPick` / `handleHistoryCommitClick` / `loadFileHistory` / `loadMoreHistory` / `historyFileDiffByKey` 全部照用，宿主从「侧栏」换「弹窗」。**顺带补齐**：紧凑形态（< 640）现在**完全没有文件历史入口**，右键菜单一加窄面板也能看历史。

⚠️ **开工前待确认 3 条**：① 右键对象 = SCM 文件行（助手按此落档）；② 两栏后阈值 640 保不保留（暂按保留）；③ 弹窗内点 commit 看 diff 的能力保留（暂按保留）。

**落档**：`S-187.md` 全文重写（状态 → 口径已定 / 待开工）；`plan.md`（索引行、刀序第 6 条、裁定汇总）、`raw-requirements.md`（表 + 原文）同步。**仍属口径记录，非开工指令。** 行尾核验：`bareLF=0`、无 BOM。

---

## 2026-10-10 11:10 —— S-187 补充口径：**阈值不留** + **未跟踪目录展开**（「文件夹」谜底揭开）

**原话**：

> 「阀值不留  更改下当前只有一个文件夹 理论上文件夹下的文件也应该都列出来  弹窗里的东西保留 不动它」

**新口径 4 条**：

1. **阈值不留** ⇒ 去掉 `compact` / `wide` 形态切换，统一单一布局；
2. **未跟踪目录下的文件也要列出来**；
3. **文件历史走弹窗**（右键文件为入口）；
4. **弹窗里的内容保留，不动它**。

**「只有一个文件夹」根因坐实（本会话只读勘察）**：

- `GitStatusTools.StatusDetailedAsync`（`src/runtime/WishfulClaw.Agent/Modules/Git/GitStatusTools.cs:16`）执行的是 `new[] { "status", "--porcelain=v1", "-b" }`；
- **没带 `-uall`（`--untracked-files=all`）** ⇒ git 用默认 `--untracked-files=normal`，把未跟踪**目录折叠成一条**（如 `?? docs/plans/iter-v2-39/`）；
- ⇒ SCM「未跟踪」区里**只有一个目录条目**，目录下的文件一个都看不到 —— 正是老大说的「只有一个文件夹」；
- ⇒ 老大 10:46 说的「**说明**」= 选中该目录时，中间 diff 区显示的提示文字（目录无 diff 可算）。

**S-187 定性升级**：从「纯渲染端」变为 **渲染端 + C# 侧** —— `GitStatusTools.cs` 加 `--untracked-files=all`，**本迭代唯一 C# 改动**。

**完整改动 6 处**：

| # | 侧 | 文件 | 改动 |
|---|---|---|---|
| 1 | **C#** | `Modules/Git/GitStatusTools.cs:16` | 参数加 `--untracked-files=all` |
| 2 | 渲染 | `GitPage.tsx` | 删 `:487-563` 历史栏；去形态切换 |
| 3 | 渲染 | `hooks/use-git-panel-split.ts` | 删 `historyWidth` / `onHistoryResizePointerDown` |
| 4 | 渲染 | `GitPage/git-history-dialog.tsx`（新建） | 照 `git-diff-dialog.tsx` |
| 5 | 渲染 | `GitPage/ScmSidebar.tsx` | `ScmFileRowView` 挂 `ContextMenu` → 菜单项「文件历史」 |
| 6 | 渲染 | `GitPage.tsx` | 接 `onShowFileHistory` → 开弹窗 |

⚠️ **开工前待确认 3 条**：① **「阈值不留」后统一成哪种布局** —— ① 只有 SCM 一列（diff / 历史全走弹窗，**助手按此落档**）还是 ② 两栏（SCM ｜ diff）；② `-uall` 要不要设条目上限（暂按不设，与 git 默认行为一致）；③ 右键对象 = SCM 文件行（已按此落档）。

**落档**：`S-187.md` 全文重写（§三 三个现象根因 / §四 4 条口径 / §五 6 处改动 / §六 待确认 3 条）；`plan.md`（索引行、刀序、裁定汇总）、`raw-requirements.md`（表 + 原文）同步。**仍属口径记录，非开工指令。** 行尾核验：`bareLF=0`、无 BOM。

---

## 2026-10-10 11:17 —— S-187 口径齐：布局定为「只有 SCM 一列」

**原话**：

> 「① 只有 SCM 一列 —— diff 和历史全走弹窗，面板里就一列文件列表  不设置条目上限，如果高了就滚动条呗」

**裁定**：

- **布局 = ①**：`GitPage` 统一为**只有 `ScmSidebar` 一列**；**diff 与文件历史全走弹窗**；
- **`-uall` 不设条目上限** ⇒ 条目多了由**滚动条**承接。

**S-187 六条口径至此全部已定**：① 三栏并排不要 ② 阈值不留 ③ 文件历史改弹窗（右键文件为入口）④ 未跟踪目录展开 ⑤ 布局统一「只有 SCM 一列」⑥ 不设条目上限。**弹窗里的内容保留不动。**

**改动 7 处（全部未实施）**：

| # | 侧 | 文件 | 改动 |
|---|---|---|---|
| 1 | **C#** | `Modules/Git/GitStatusTools.cs:16` | 加 `--untracked-files=all`（**本迭代唯一 C# 改动**） |
| 2 | 渲染 | `GitPage.tsx` | 删阈值 `:31` / `compact` state + `ResizeObserver` `:82-96` / `useGitPanelSplit` `:98-104` / 宽形态头部 `:347-368` / **中间 diff 区 + 历史栏整块 `:433-567`**；容器 className 统一取紧凑套；`GitDiffDialog` 去掉 `compact ?` 包裹 |
| 3 | 渲染 | `hooks/use-git-panel-split.ts` | **整个文件删除**（唯一调用方即 `GitPage`） |
| 4 | 渲染 | `GitPage/ScmSidebar.tsx` | 删 `compact` prop（`:63` `:118`）与其唯一用途 resize 手柄（`:667-674`）；删 `scmWidth` prop |
| 5 | 渲染 | `GitPage/utils.tsx`（`ScmFileRowView` `:168`） | 挂 `ContextMenu` → 菜单项「文件历史」。**单点改动，conflict/staged/unstaged 三处（`:549` `:595` `:641`）同时生效** |
| 6 | 渲染 | `GitPage/git-history-dialog.tsx`（新建） | 照 `git-diff-dialog.tsx` |
| 7 | 渲染 | `GitPage.tsx` | 新增 `historyDialogPath` state + 渲染 `GitHistoryDialog`；历史逻辑与弹窗内 UI **原样复用** |

**实施细节**：`handleDiffSelect` / `compactRows` / `compactDiffOpen` 等命名残留 `compact` 字样，实施时改成中性名。

**落档**：`S-187.md` 全文重写（状态 → **口径齐，可开工**；§四 6 条口径表；§五 精确到行号 + 改前结构；§六 待确认 → 已确认留档）；`plan.md`（索引行、刀序、裁定汇总）、`raw-requirements.md`（表 + 原文）同步。**仍属口径记录，非开工指令。** 行尾核验：`bareLF=0`、无 BOM。

---

## 2026-10-10 15:02 —— 登记 S-188：全局 PM 对项目会话的掌控不全面

**原话**：

> 「再登记一个需求 当前全局PM对项目下会话的掌控不够全面，在队列中的消息 用户能撤销，全局PM做不到，也看不到，也没法停止项目会话的运行，导致很多时候只能干着急」

**三个缺口**：

| # | 缺口 | 用户能做 | PM 能做 |
|---|---|---|---|
| 1 | **看不到**项目会话排队的消息 | 队列面板可见 | ❌ |
| 2 | **撤销**排队中的消息 | 「取回」/「删除」/「清空」 | ❌ |
| 3 | **停止**项目会话的运行 | 停止按钮 | ❌ |

**只读勘察（结构性根因，本会话完成）**：

- **PM 现有工具面一个都没有** —— `ProjectToolsProvider`（`list_projects` / `get_project_details` / `create_project` / `create_session` / `send_session_message` / `update_session_follow_up`）＋ `GlobalTaskToolsProvider`（`list_global_tasks` / `create_global_task` / `update_global_task` / `list_global_dispatches` / `send_work_request` / `update_dispatch`）＋ `GlobalDispatchReplyToolProvider`（`reply_global_dispatch`）⇒ **只有投递能力，没有观测与干预能力**。
- **队列是渲染端内存态**（**根因**）—— `src/renderer/src/hooks/use-chat-actions.ts:726` 的模块级 `const _pendingMessages = new Map<string, PendingSessionMessageItem[]>()`，**不落库、无 IPC 出口**；PM 跑在 worker（C#）侧**物理上看不到**。⇒ **不是「忘了做工具」，是数据不在它那一边。** 相关 API（全在渲染端）：`getPendingSessionMessages:772` / `removePendingSessionMessage:847` / `clearPendingSessionMessages:297` / `hasPendingSessionMessagesForSession:950` / `pausePendingSessionDispatch:840` / `dispatchNextQueuedMessageForSession:867`。
- **运行态两个坑** —— ① `abortSession` / `stopSessionStreaming`（`use-chat-actions.ts:292/956`）**只清 UI 流式状态（`setStreamingMessageId`），不真停**；真停是 `useChatStore.getState().cancelStream(sessionId?)`（`stores/chat-store/index.ts:541`，**支持指定会话** ✅）。② worker 侧 `bridge.requestStopAgent(runId)`（`lib/ipc/agent-bridge.ts:93` → `agent/request-stop`）**全仓零调用点（死代码）**，且 worker 运行态（`AgentRuntimeRunState`）按 **`runId`** 索引，PM **拿不到目标会话的 `runId`** —— 反而**按会话**的 `cancelStream` 对得上 PM 视角。
- **现成的桥** —— `send_session_message` 就是走**反向请求**回渲染端投递（worker `AgentRuntimeProjectExecutor.SendSessionMessageAsync` → `AgentRuntimeReverseRequests`；渲染端处理器 `src/renderer/src/lib/tools/project-send-message.ts`）⇒ 三个缺口**复用同一条桥**，**不必把队列搬进 DB**。
- **先例** —— `use-channel-auto-reply.ts:448` 已在程序里直接调 `useChatStore.getState().cancelStream(payload.sessionId)` ⇒ **「由代码按会话停某一轮」这条路已经跑通**。
- **顺带一个不准的点** —— `get_project_details` 的 `activeSessionId` 是「`updated_at` 在 1 小时内」的**启发式** ⇒ **「活跃」≠「在跑」**。

**候选方案**：

| # | 方案 | 依赖 |
|---|---|---|
| **A** | 只加「看」（真实运行态 + 队列快照） | 反向请求 + 已有只读 API |
| **B** | 看 + 撤队列（删单条 / 清空） | ＋已有 `removePendingSessionMessage` / `clearPendingSessionMessages` |
| **C** | 看 + 撤 + 停（`cancelStream(sessionId)`） | ＋已有 `cancelStream`（**有先例**） |

⇒ 助手**倾向 C**（老大三条都点名），但**建议分两刀**（B 零新机制先落，C 的「停」先把语义定死）。

⚠️ **S-188 共 7 条待确认**（`S-188.md` §五）：① 一次做完还是分刀；② **「停止」的语义**（停本轮 / 停本轮＋丢队列 / 停本轮＋暂停派发 —— 三种落点不同）；③ 「撤销」= 删除还是清空（**PM 没有 composer，「取回」不可用**）；④ 停止要不要在渲染端**弹确认**；⑤ 新工具命名与作用域（沿用 `GlobalSideOnly`？）；⑥ 是否顺带修 `get_project_details` 的「活跃」启发式；⑦ ⚠️ **本需求是否纳入 39**（39 是**沉淀迭代、只收 bug**；本需求是**加能力**，与 S-182 / S-186 同类）。

**落档**：新建 `requirements/S-188.md`；`plan.md`（§一 计数 6→7、§二 索引、§三 刀序第 7 条、§五 裁定汇总）、`raw-requirements.md`（进度 / 表 / 原文 / 统计 6→7）同步。**仍属需求登记与勘察，非开工指令。** 行尾核验：`bareLF=0`、无 BOM。

---

## 2026-10-10 15:11 —— 裁定 S-188：纳入 39 + 定死「停止」语义

**原话**：

> 「停止就是会话本身在运行中，需要让会话停下来，然后重新发消息给会话呀 需要纳入39 这是能力的补充」

**两条口径落定**：

| # | 问题 | 裁定 |
|---|---|---|
| 1 | 是否纳入 39？ | **纳入 39**，定性 **「能力补充」**（非 bug）—— 记为 39「只收 bug」原口径的**例外**（同 S-182 / S-186 / S-185） |
| 2 | 「停止」的语义？ | **只停当前这一轮** —— `useChatStore.getState().cancelStream(sessionId)`；**队列保留、派发照旧、停完可再发消息** |

**第 2 条的边界（落档备查）**：

- **不碰** `clearPendingSessionMessages`（那是「停 + 丢队列」）与 `pausePendingSessionDispatch`（那是「停 + 暂停后续派发」）—— 两种更重的语义，**本需求不做**。
- **不用** `bridge.requestStopAgent(runId)` —— 死代码，且 worker 运行态按 `runId` 索引、PM 拿不到 `runId`。
- **借方**：`use-channel-auto-reply.ts:448` 已有 `cancelStream(payload.sessionId)` 先例。

**余 5 条待确认**（`S-188.md` §5.2，助手建议已给）：① 是否分刀；② 撤销 = 删单条 / 清空 / 两者都给；③ 停止是否弹确认；④ 工具命名与作用域；⑤ 是否顺带修 `get_project_details` 的 `activeSessionId` 启发式。

**落档**：`S-188.md`（状态块 → 「已纳入 39 + 停止语义已裁」；§二 增「停止」裁定语义段；§四 候选 → 定走 C；§五 拆成「5.1 已裁定 2 条 / 5.2 待确认 5 条」）；`plan.md`（§一 需求清单与范围口径「例外记录」、§二 索引行、§三 刀序第 7 条、§五 新增 15:11 条）；`raw-requirements.md`（进度行 15:11、索引行、S-188 原文段落、统计）。**仍属口径裁定，非开工指令。** 行尾核验：`bareLF=0`、无 BOM。

---

## 2026-10-10 15:38 —— S-188 收口：口径齐，5 项实施细节自行拍定

**起因**：助手把 5 条**实施细节**当「待确认」上呈，被老大否：

> 「你这5条有些根本没意义 你列出来问我干嘛」

**定性**：那 5 条里 4 条是**助手该自己拍的实施细节**（分刀节奏 / 弹不弹确认 / 工具作用域 / 撤销动作面），1 条是弱范围问题（`activeSessionId` 启发式）。**上呈 = 把工程判断推给老大 ⇒ 收回，自行拍定。**

**§5.2 实施细节定案（非老大裁定，老大可否）**：

| # | 事项 | 定案 | 依据 |
|---|---|---|---|
| 1 | 落地节奏 | **分两刀** —— 第一刀 **A + B（看 + 撤）**，第二刀 **C（停）** | 反向请求是**新机制首次接入**，先跑通桥路再叠干预；39 沉淀迭代**稳优先** |
| 2 | 「撤销」动作面 | **删单条 + 清空，都给** | 渲染端两个 API **均已存在**；PM **无输入框**，「取回」条件不存在 |
| 3 | 停止是否弹确认 | **不弹** | PM 是自动化角色，弹确认会**阻塞其自身推理链**；「停」**可逆** |
| 4 | 工具作用域 | **沿用 `GlobalSideOnly`** | 与既有 `send_session_message` 同作用域，**不新开口子** |
| 5 | `activeSessionId` 启发式 | **本需求不动** | 属**独立议题**，避免扩范围；如需修**由老大另立** |

**新工具集（定案）**：第一刀 `get_session_queue`（真实运行态 + 队列快照）/ `remove_session_queue_message` / `clear_session_queue`；第二刀 `stop_session_run`。

⚠️ **一处消歧**：`get_session_queue` 的「真实运行态」取自 `hasActiveSessionRunForSession(sessionId)`（`use-chat-actions.ts:943`，**准确**），**不走** `get_project_details` 的启发式 ⇒ 与第 5 项「不改 `get_project_details`」**不矛盾**（**新工具给准的，老工具不动**）。

**状态**：S-188 **口径齐、待开工**（同 S-187）。

**落档**：`S-188.md`（状态块 → 口径齐；§四 分刀定案；**§五 重整为 5.1 老大裁定 / 5.2 实施细节 / 5.3 归属说明**；§六 影响面按两刀拆分 + 新工具表）；`plan.md`（§二 索引行、**§三 刀序第 7 条拆为「7 第一刀 / 8 第二刀」**，后续顺延 9 / 10、§五 15:11 条尾句改为「由助手自行拍定，未上呈」）；`raw-requirements.md`（索引行、S-188 段落尾句）。**仍属口径与计划记录，非开工指令。** 行尾核验：`bareLF=0`、无 BOM。

---

## 2026-10-11 13:10 —— S-188 补裁：**加恢复工具**（第三刀）

**起因**：老大 13:00 前后复查「PM 停完还能不能继续」，助手倒查链路后确认第二刀留下一个与 §二 不符的副作用 —— `stop_session_run` 的落点就是 `cancelStream`，而 `cancelStream`（`chat-store/index.ts:541-561`）**第一件事**就是 `pausePendingSessionDispatch`，本轮以 `aborted` 结束又在 `:1741-1743` 暂停一次 ⇒ **停完队列被冻住**，且**没有自动出口**：所有自动派发路径传的 `resumePaused` 恒为 `false`（`:1750` loop_end、`use-chat-actions.ts:936` 自重试），连「停完再发一条新消息、那一轮跑完」也不解冻；全仓只有 UI 队列面板的「继续」按钮（`use-queued-messages.ts:113`，默认 `true`）能解。PC 侧 PM 没有输入框 ⇒ 停了永远卡住，唯一出路是 `clear_session_queue`（等于丢消息）。

**老大原话**：

> 「那加个方法去触发队列的继续」

**裁定**：**补一个 PM 侧恢复工具**（第三刀 `resume_session_queue`），等价于 UI 的「继续」按钮。

**与原口径的关系**：§二 上方原写「队列保留、**派发照旧**」—— 那句与实现不符，**按本裁定修订为**：**停 = 队列保留 + 派发冻结；恢复由 `resume_session_queue`（或用户点「继续」）触发。**

**实施（本会话完成，`689e031c`）**：

- 渲染端新增 `resumePendingSessionDispatch(sessionId)`（**只解冻、不派发**，与 `pausePendingSessionDispatch` 对称）—— **只调 `dispatchNextQueuedMessageForSession` 不够**：它在「有活跃 run」时直接 `return false` 且**不解冻**（`use-chat-actions.ts:872-874`），那样「会话在跑 + 队列被冻」的组合仍然解不开。
- 新工具 `resume_session_queue`：解冻 + 无活跃 run 时立即派发；有活跃 run 时本轮结束由 loop_end 自动续上。反向请求 `project/resume-session-queue` 四处登记齐（工具定义 / `ProjectToolNames` + 执行分支 / 主进程 `rendererMethods` / 渲染端桥）。
- `get_session_queue` 与 `stop_session_run` 的描述补上恢复入口指引（否则 PM 不知道有这条路）；`GoalRegressionTests` 全局工具清单 **10 → 11**。
- 门禁：`npm run typecheck` **0 错误** / `dotnet build src/runtime/WishfulClaw.sln` **0 警告 0 错误** / `npm test` **68/68**（Goal 335 断言）。

**状态**：S-188 **三刀全落**（`27791c7f` / `f111da66` / `689e031c`）；**实机端到端仍待验**（PM 会话里停一个带队列的项目会话 → `resume_session_queue` → 队列继续；UI 队列面板暂停态消失）。

**落档**：`requirements/S-188.md`（状态块 → 已实施；**§2.1「停止与队列派发的实际关系」新增**；§六 工具表 + 文件表补第三刀，并订正原表两处**实施时未改动**的文件）；`plan-s188/plan.md`（标题 → 三刀；§2.1 增第 3 条「恢复」；§2.3 工具表加第三刀行；**新增「§四·b 第三刀步骤清单」**；步骤 1-8 复选框回填）；本 `changelog.md`。**文档改动静默攒着，随迭代收尾那一刀入库。** 行尾核验：`bareLF=0`、无 BOM。

---

## 2026-10-12 08:45 —— S-189 登记：**PM 建会话后首次派发任务失败**（bug）

**老大原话**：

> 「登记一个bug 全局PM调用的项目下创建会话，创建后首次派发任务会失败，需要检查路线然后进行修复」
> 「Target session must be a project session 首次派发报这个」

**定性**：**bug**（不是能力补充）。**归属 iter-39** —— 老大 2026-10-12 09:01 确认：「**就是登记成39迭代的，39迭代的目的就是修复各类bug**」。

**根因（静态读码定位，未实测）**：`create_session` 工具（`Tools/Providers/ProjectToolsProvider.cs:69`）走的是 **worker 直插 SQL**（`AgentRuntimeProjectExecutor.cs:195-259`），INSERT 列清单里**漏了 `scope`**（连带 `collaboration_mode` / `permission_mode`）；而 `sessions.scope` 列**可空无默认**（`DbClient.cs:92` 建表 `scope TEXT,`、`:535` `EnsureColumn("sessions","scope","TEXT")`）⇒ 新行 `scope = NULL`。PM 紧接着 `send_work_request` → `DbGlobalTaskDispatchTools.Create`（`DbGlobalTaskDispatchTools.cs:108-112`）按 `scope = 'project'` 判定 ⇒ **NULL 不匹配** ⇒ 报 `"Target session must be a project session"`。

**为什么只是「首次」**：NULL 会被**懒修复** —— `rowToSession`（`db-helpers.ts:219-238`）自己调 `normalizeSessionContext`（`projectId` 有值 ⇒ `scope='project'`），紧接着 `persistNormalizedSessionContext`（`:203-217`）把这行写回 DB。⇒ **这行只要被渲染端读过一次（`dbGetSession` / 启动 `dbLoadAll` / 侧栏加载），NULL 就被补上**；而 PM 派活那一跳是 **C# 直查 DB、不经过渲染端**，补写还没发生 ⇒ 报错。重启或任何「先读过这行」的操作之后，同一会话再派发即成功。**启动补写（`DbClient.cs:545-547`）只是另一条同样效果的兜底。**

**⚠️ 自查订正**：本节初版曾把「`handleProjectSendSessionMessage` 也被 scope=NULL 带偏（丢 projectId / 工作目录）」列为**旁症状** —— **那是错的，已删**。该 handler 拿到的 `targetSession` 来自 `chatStore.sessions` 或 `dbGetSession`，**都过了 `rowToSession` 归一化**，`scope` 已是 `'project'` ⇒ 普通 `send_session_message` 路径无此症状。本 bug **只在 C# 直查 DB 那一跳成立**。

**为什么 UI 建的会话没事**：渲染端走 `DbSessionTools.Create`（`DbSessionTools.cs:87-133`），INSERT 里**有** `scope` —— 只有 `create_session` 这条旁路漏了。

**修复方向（→ 已于 09:07 定案，见下）**：**A（推荐）** = `CreateSessionAsync` 让 `SessionEntity.Scope = "project"` 并补进 INSERT（**只补 `scope`** —— `collaboration_mode` / `permission_mode` 的缺省取决于渲染端用户设置，worker 读不到，硬写会盖掉用户设置，不如留 NULL 让 `rowToSession` 归一化）；**B（可选，互补）** = 把 `DbGlobalTaskDispatchTools.Create` 的判定改成与 `getSessionScope()` 同规则的 `project_id IS NOT NULL`。详见 `S-189.md` §四。

---

## 2026-10-12 09:07 —— S-189 修复口径**定案：A + B**（仍不动手）

**老大原话**：

> 「根据你的推荐登记，不着急动手」

**裁定**：采纳助手的推荐 —— **A（主改，补 `scope`）+ B（互补，判定改 `project_id IS NOT NULL`）**；**C 否决**（`DEFAULT 'global'` 不解决本 bug）。**「不着急动手」⇒ 只登记口径，不实施、不提交。**

**落档**：`requirements/S-189.md`（状态行 → **口径齐**；**§四 标题改为「已定：A + B」**，A / B 标「采纳」、C 标「否决」；**§六 开放问题收敛为开工时的两个顺手动作**）；`plan.md`（S-189 索引行 → 口径齐；**§五 加 09:07 定案条**）；`raw-requirements.md`（S-189 行 → 口径齐 / 不着急动手）。**一律不提交。** 行尾核验：`bareLF=0`、无 BOM。

**落档**：`requirements/S-189.md`（新建，含原话 / 现象 / 根因逐跳表 / 修复方向 / 验证方式 / 开放问题）；`plan.md`（状态行 → 7 条已实施 + S-189 待开工；登记过程补 10-12；**§二 索引 7 行「待开工」订正为「已实施 + commit」**，并加 S-189 行；**§五 加 10-12 登记条**）；`raw-requirements.md`（新增「2026-10-12」登记节；统计 7 → 8）；本 `changelog.md`。**文档改动一律不提交，攒进迭代收尾那一刀。** 行尾核验：`bareLF=0`、无 BOM。

---

## 2026-10-12 12:01 —— S-190 登记：**用量统计 · 请求明细增加筛选条件**

**老大原话**：

> 「登记一个需求 当前设置页 用量统计下的请求明细 没有搜索条件，增加模型筛选，以及其它你看有没有补充的条件」

**定性**：**体验优化 / 能力补充（非 bug）**。**归属待确认** —— 39 定位「只收 bug」（老大 2026-10-12 09:01 原话），本条**非 bug** ⇒ 是否按**例外**纳入 39（先例 S-182 / S-185 / S-186 / S-188），**待老大裁定**；助手暂按既往模式落档为「纳入 39（例外）」。

**现状（静态读码，未实机）**：对象 = 设置 → 用量统计 → **请求明细**（第 3 个 tab）。面板唯一条件是**时间窗口** `range`（24h / 7d / 30d，`UsagePanel.tsx:94-97`，**面板级**、作用于全部 5 个端点）；表格自带「显示列」与**服务端**分页；**明细表自身没有任何筛选与搜索**。server 侧 `db/usage-logs`（`DbUsageLogQueryTools.Logs`）只吃 `range` / `from` / `to` / `limit` / `offset`，WHERE 里只有时间条件。

**筛选集合**：

- **老大点名 1 条** —— **F1 模型**（按 `provider · model` **组合**多选：同 `model_id` 在多个服务商下会重名；选项来源**复用窗口内 `db/usage-by-model` 的行键** ⇒ 零额外查询、与图表口径天然一致）。
- **助手补充 5 条（待裁定）** —— F2 状态（成功 / 失败 + 「只看失败」）、F3 来源（`runtime_role` / `scope` / `collaboration_mode`，即表格「来源」列三段）、F4 关键字搜索（`error_message` + `session_id` 模糊匹配 —— 老大「没有搜索条件」的点名落地）、F5 HTTP 状态码（429 / 4xx / 5xx）、F6 只看重试行（`attempt_index > 1`）。
- **不纳入** —— 数值区间筛选（成本 / token / 耗时：频率低、工具栏会炸）、`session_id` 精确筛选（F4 覆盖）、表格排序（属另一件事，要就单开一条）。

**实施面（静态勘察，未开工）**：

- **C# 1 处** —— `DbUsageLogQueryTools.Logs`：`COUNT(*)`（`:272-276`）与明细查询（`:278-297`）**各自硬编码**同一段时间 WHERE ⇒ 必须抽成**共用构造**，否则 `total` 与 `rows` 口径不一致、**翻页会飘**（本需求最易回归点）；多选走已有的 `JsonHelpers.GetStringArray` ⇒ **不动协议层**。
- **渲染端 2~3 处** —— `UsagePanel.tsx`（含 **`onPageChange`:423 必须带筛选**，否则一翻页筛选就丢；`:204-232` 的越界回退逻辑同样要带筛选）、`usage-detail-table.tsx`（工具栏，放「显示列」左侧）、`locales/{zh,en}/settings.json`（`usage.detail.filters`）。
- **不改 DB**（无迁移）、**不加端点**（复用 `db/usage-logs`）、**不动上方 3 个统计端点**（按助手推荐口径）。

**待裁定（2 条）**：① **作用范围** —— 只作用明细表（助手推荐；改动面 1 个端点）还是也作用上方概览 / 图表 / 按模型汇总（方案 B；5 个端点全改）；② **归属与例外定性** —— 是否按例外纳入 39。

**落档**：`requirements/S-190.md`（新建，含原话 / 现状 / 筛选集合 / 关键口径 / 实施面 / 验证方式 / 开放问题）；`plan.md`（状态行补第 9 条；§一 需求清单 7 → 9；§二 索引加 S-190 行；§三 刀序加第 10 项；§五 加 12:01 登记条）；`raw-requirements.md`（新增 S-190 行 + 来源原文；**统计块订正** —— 登记 8 → 9、实施 **0 → 7**、纳入 39 8 条 + S-190 待确认）；本 `changelog.md`。**文档改动一律不提交，攒进迭代收尾那一刀。** 行尾核验：`bareLF=0`、无 BOM。

---

## 2026-10-12 12:34 —— S-190 筛选集合**收敛：只做 3 项**

**老大原话**：

> 「条件 不用那么多 状态加 http状态码 加模型 这几个」

**裁定**：助手 12:01 提的 **6 条砍到 3 条**，**筛选集合就此定案**（无需再议）：

| 保留 | 形态 | 选项 / 取值来源 |
|---|---|---|
| **模型** | 搜索式多选 | **复用窗口内 `db/usage-by-model` 的行键** `(providerId, modelId)` ⇒ 零额外查询 |
| **状态** | 成功 / 失败 多选 + 「只看失败」快捷 | 固定枚举（DB `status` 列只有 `success` / `error`） |
| **HTTP 状态码** | **文本输入框**，精确匹配，支持逗号分隔多值（`429,503`） | 手输 —— **无现成状态码聚合来源**，为它单加查询或端点不划算（助手拍定的实施细节） |

**砍掉**：来源筛选（`runtime_role` / `scope` / `collaboration_mode`）、关键字搜索（`error_message` / `session_id` 模糊匹配 —— **注意：「按报错内容搜」本次明确不做**）、只看重试行（`attempt_index > 1`）。**另不做**（非本次裁定，助手建议方向一致）：数值区间筛选、`session_id` 精确筛选、表格排序。

**⚠️ 对本需求的直接影响**：老大 12:01 原话里的「**没有搜索条件**」，经 12:34 收敛后**关键字搜索已被砍掉** —— 本需求交付的是**三个结构化筛选**（模型 / 状态 / 状态码），**不是一个搜索框**。若老大本意是「要能按报错内容搜」，需**另行开口径**；当前按「三个筛选」落档。

**余下待裁定（2 条）**：① **作用范围** —— 只作用明细表（助手推荐；1 个端点）还是也作用上方概览 / 图表 / 按模型汇总（5 个端点）；② **归属与例外定性** —— 是否按例外纳入 39。

**落档**：`requirements/S-190.md`（§三 收敛为 3 项 + 「被砍掉的候选」表；§五 参数面同步；§七 开放问题收敛）；`plan.md`（§二 索引行、§三 刀序第 10 项、§五 加 12:34 裁定条）；`raw-requirements.md`（进度行、S-190 表行、来源原文加 12:34 引文）。**文档改动一律不提交。** 行尾核验：`bareLF=0`、无 BOM。

---

## 2026-10-12 12:37 —— **迭代范围口径修订**：「不新做主打功能」+ S-190 归属确认

**老大原话**：

> 「这个也是归属39迭代， 39迭代的目的是不新做主打功能，体验优化 bug修复 这些都可以列入」

**裁定（迭代级，覆盖 2026-10-09 17:41 口径）**：

| 项 | 旧口径（10-09 17:41） | **现行口径（10-12 12:37）** |
|---|---|---|
| 收什么 | **只收 bug 修复** | **bug 修复 + 体验优化 / 能力补充** |
| 不收什么 | **新功能一律不列入** | **只排除「主打新功能」**（S-174 绘图工作台 / 自定义工作流 —— 顺延状态**不变**） |
| 版本规则 | 暂不改 | **不变**（仍暂不改，等转正确认时再定） |

⇒ **连带作废**：原**「例外记录」提法作废** —— S-182 / S-185 / S-186 / S-188 / **S-190** 在现行口径下**本就该收**，**不再是例外**。（旧档里「记为「只收 bug」原口径的例外」等表述**保留不动**，仅用于解释历史；新登记一律按现行口径走。）**S-189 不受影响** —— 本就是 bug，属核心范围。

⇒ **S-190 归属确认**：**纳入 39**，定性 **「体验优化」**（非 bug，但现行口径下可列入）。

⇒ **遗留影响面**：① 39 后续登记**不必再逐条问「能不能收」** —— 判据变成「**是不是主打新功能**」；② `S-190.md` 头部「归属待确认」与 §七「是否作例外」一问**已删**；③ 需求只要不是主打新功能，登记即可列入。

**落档**：`plan.md`（§一 范围口径段**新增现行口径条 + 例外记录作废说明**；§一 需求清单 8 → 9 条全纳入；§二 索引 S-190 归属改定；§三 刀序第 10 项；§五 加 12:37 裁定条）；`raw-requirements.md`（范围口径段加修订条；进度行 / S-190 表行 / 来源原文 / 统计块 8 → 9 条）；`requirements/S-190.md`（头部归属、§一 加 12:37 引文、§七 删归属一问）。**文档改动一律不提交。** 行尾核验：`bareLF=0`、无 BOM。

---

## 2026-10-12 13:42 —— S-190 作用范围裁定：**只作用明细表** ⇒ **口径齐**

**老大原话**：

> 「筛选只作用于明细表，上方概览的是全局条件」

**裁定**：筛选条件**只作用于「请求明细」表**；**上方概览数字 / 折线柱状图 / 按模型汇总一律保持「全局条件」**（只受时间窗口 `range` 影响，**不受明细筛选影响**）。

**由此锁定的实施面（1 个端点）**：

- **只改** `db/usage-logs`（`DbUsageLogQueryTools.Logs`）—— WHERE 抽成 `COUNT(*)` 与明细查询**共用构造**；
- **上方 4 个端点一律不动**：`usage-overview` / `usage-buckets` / `usage-model-buckets` / `usage-by-model`（`by-model` 仅被**读取**当模型选项来源，其查询本身不改）；
- **方案 B 已否决**（筛选同时作用于上方 5 个端点）—— 会让宏观数字随明细筛选缩水、**误导总量判断**，且改动面 ×4。

**S-190 口径齐（3 条裁定全部落定）**：① 归属 = 纳入 39 / 体验优化（12:37）；② 筛选集合 = 模型 / 状态 / HTTP 状态码（12:34）；③ 作用范围 = 只作用明细表（13:42）。**⇒ 待开工**（等老大开工指令）。

**助手拍定未变的实施细节（有异议再改）**：HTTP 状态码走**文本输入框**（精确匹配、逗号分隔多值）；模型选项来源于**当前窗口 `by-model` 结果**；筛选控件**内联在工具栏**（「显示列」左侧）。

**落档**：`requirements/S-190.md`（头部状态 → **口径齐**；§四 重写为**已定**并附否决理由；§五 端点面订正为「上方 4 个不动」；§六 验证步骤 1 改口径；§七 重写为**裁定状态表** + 拍定项）；`plan.md`（§二 索引行 → 口径齐；§三 刀序第 10 项 → 改动面锁定 1 个端点；§五 加 13:42 裁定条）；`raw-requirements.md`（进度行、S-190 表行、来源原文加 13:42 引文）。**文档改动一律不提交。** 行尾核验：`bareLF=0`、无 BOM。

---

## 2026-10-12 18:32 —— **进入实施态**：39 剩余需求按开发工作流推进

**老大原话**：

> 「39迭代内没做的需求 都根据开发工作流开始推进」

**裁定**：**讨论态 → 实施态**。S-189 / S-190 口径均已齐（见 09:07 / 13:42 两条），即刻按 `docs/dev-workflow.md` 六阶段推进。

---

## 2026-10-12 18:37 —— S-189 **已实施**（`66651053`）

**改动 3 处**（`+18 / −7`）：① `AgentRuntimeProjectExecutor.cs` 的 `CreateSessionAsync` —— `Scope = "project"` + INSERT 补 `scope`；② `DbGlobalTaskDispatchTools.cs` —— 派发校验 `scope = 'project'` → `project_id IS NOT NULL`；③ `DbPluginSessionTools.cs:159` —— 自查新增的第三条旁路 `CreatePluginSession` 同步补 `scope`。

**阶段五审查**（`plan-s189/review_report.md`）：**❌ 1 / ⚠️ 4**。

- **❌ #1（已修）**：S-115 夹具 `CreateSessionInsertTests.cs` 的 `CREATE TABLE sessions (...)` 缺 `scope` ⇒ 撞 `no such column: scope`。补 `scope TEXT`（对齐 `DbClient.cs:92`），`npm test` 68/68。**夹具修复未提交**（攒收尾刀）。
- ⚠️ #2（`DbGlobalTaskDispatchTools.cs:110-122` 判「死分支」）：**裁定订正，不改** —— `git show 66651053` 确认本刀只改 WHERE 一行，两段式判定为**既有结构**。
- ⚠️ #3（新判据 vs `session-context.ts:128` 对脏数据分歧）：**记录备查，不改**（正规路径产不出）。
- ⚠️ #4（`DbPluginSessionTools.cs:164` 注释引用不准）：**已订正**。
- ⚠️ #5（本刀无新增自动化断言）：实机验证项。

**阶段六验证**：`verification_report.md` §六 —— **PARTIAL**（静态对账 + `SessionTaskCascade 229 assertions` 通过；跨端端到端待实机）。

**收尾时的噪音修复**：审查阶段改注释时该文件的 UTF-8 BOM 被一并抹去，`git diff` 多出一行无关改动；已用 `UTF8Encoding($true)` 原样补回，diff 只剩注释两行。

---

## 2026-10-12 19:0x —— S-190 **已实施 + 审查 + 验证**（`269b38ea`）

**改动 11 文件**（`+821 / −197`）：

- **C#**：`DbUsageLogQueryTools.cs` 抽出共用 `BuildDetailWhere`（`COUNT(*)` 与明细查询同段 WHERE、同批参数），并拆出 `DbUsageLogQueryTools.Filters.cs`（101 行）/ `.Window.cs`（114 行）两个 `partial`；主文件回到 405 行。三个可选参数 `models`（US 分隔）/ `status` / `httpStatusCodes` + **NULL 哨兵**（`'(unknown)'`）。
- **渲染端**：拆出 `usage-detail-filters.tsx`（271 行）/ `usage-panel-types.ts`（66 行）；`UsagePanel.tsx` 只让筛选作用于明细表（`filtersRef` 刻意不进 `load` 依赖，上方 4 个统计端点调用一行未动）。
- **i18n**：`usage.detail.filters` 中英各 11 键。
- **测试**：`RunDetailFilterNullSuite()` 并入既有 `ProviderHeader` 套件 ⇒ **套件数仍 17 / 总数仍 68**（`plan-s190/plan.md` 步骤 2 原写「由 17 增加」，已订正）。

**阶段五审查**（`plan-s190/review_report.md`，由子 agent 落盘、主会话直接读文件）：**❌ 0 / ⚠️ 3**，主会话逐条处理 —— ① 拆文件（`DbUsageLogQueryTools.cs` 超 500 行规格）；② NULL 哨兵；③ 控件与类型外迁。

**实施中的两处返工**：① 一次失败的 CRLF 归一命令把 `\r` 当字面量写进两个新 C# 文件行尾 ⇒ `dotnet build` 报 736 个语法错，用 `.Replace("\r`r`n", "`r`n")` 清掉；② NULL 哨兵断言漏写 US 分隔符（写成 `"prov-1\u0000"`）⇒ 已修。

**阶段六验证**（主会话直接执行 —— 老大 19:2x 裁定「S-190 的审查与验证主会话自己做，不再派子 agent」）：三门禁复跑全绿，**PARTIAL**（参数契约 / 共用 WHERE / 作用范围 / i18n 静态核对全过；UI 交互待实机）。

---

## 2026-10-12 19:2x —— 老大追加两条指令（子 agent 疑云 + 主会话接管）

**老大原话**：

> 「还有需要搞清楚为什么子agent异常停止了，登记完成后继续处理之前你交给子agent处理的工作，建议主会话直接处理，因为现在子agent好像有问题了。。」

**结论 ① —— 子 agent「异常停止」实为「事件没投递」**：日志（`~/.wishful-claw/logs/2026-10-12.log`）411 WARN / 1 ERROR 且唯一 ERROR 与子 agent 无关；DB `SubAgentStatus` 里 5 个子 agent **全 `completed`**。根因 = `sub_agent_end` 走**父 run 那条 IPC stream**，父 run finalize 后 stream 已不可用（`SubAgentExecutor.Background.cs:68` 注释即写「S-36: 父 run 一死就断」），而卡片 `isRunning` **只由该事件收敛、代码里无超时 / 心跳兜底** ⇒ 卡片永挂「工作中」。**这直接坐实了 S-191。**

> **订正（2026-10-13，S-191 实施后回溯）**：**本条的根因判断已被证伪** —— 不是「父 run finalize 后 stream 不可用 ⇒ 事件必丢」。老大 2026-10-12 实测指出：「实际效果应该是同时多个导致的问题，同时跑 3 个，其中一个返回后，其它的返回好像就渲染不了卡片了」；S-191 现场勘测亦证实**父 run 已 finalize 仍能渲染卡片并唤起父 run**。真因 = **同会话并发子 Agent 的收敛竞态**（`resetLiveSessionExecution` 收窄过宽 / `sub_agent_end` 缺幂等 upsert / 缺 `abortOrphanedSubAgents` / C# `BackgroundSubAgentRegistry` 缺会话过滤），**另加一条独立的通道缺口** —— `sidecar:lifecycle` 此前**全仓无发出方**（S-191 方案 A 补上）。详见 `requirements/S-191.md` 与 `plan-s191/`。

**结论 ② —— 分工调整**：S-190 的审查与验证**改由主会话直接做**，不再派子 agent。

**落档**：`verification_report.md`（**新增 §六「补充验证 · S-189 / S-190」** + 汇总更新）；`requirements/S-189.md`（状态 → 已实施；§五 → 验证已执行；§七 → 实际改动 3 处）；`requirements/S-190.md`（状态 → 已实施；§五 加实施实况；§六 → 验证已执行；§七 标题）；`plan.md`（状态行、索引两行、刀序第 10 项）；`raw-requirements.md`（进度 +2 行、S-189 / S-190 状态、统计实施 8 → 9）；`plan-s189/plan.md` / `plan-s190/plan.md`（复选框 + 步骤 2 订正）；本 `changelog.md`。**文档改动一律不提交，攒进迭代收尾那一刀。** 行尾核验：`bareLF=0`、无 BOM。

---

## 2026-10-13 11:26 —— S-193 收口 + 登记第 13 条 S-194

**老大原话**：

> 「token 加 G 单位那事还没拍板（三套格式化实现也没合并）这个按照你的推荐登记」

**裁定 —— S-194 按推荐方案定案（登记待开工）**，见 `requirements/S-194.md` §四：① 三套格式化实现**合并成一份**；② 单位序列 `k / M / G / T`；③ 精度规则「同一单位内 <10 两位、<100 一位、≥100 整数」；④ 后缀**统一小写 `k`**；⑤ **进位升单位**（`999999` → `1.00M`，不再吐 `1000k`）；⑥ 防御 `非有限值 / ≤0` → `0`；⑦ **删除** `formatTokensDecimal`。落点 5 个渲染端源文件，无 C# / DB / i18n。

**同轮 S-193 收口**：

- **阶段五审查**由**独立 subagent** 出具（`plan-s193/review_report.md`，64 次工具调用）：**❌ 1 / ⚠️ 3**。
  - **❌-1 是真 bug** —— 重置后底部**不会归零**：`dbGetSessionUsageStats` 因 `hasUsage = AssistantReplies > 0` 返回 `null` ⇒ renderer 落到 `runtime-status.tsx` 兜底分支，把**驻留窗口（默认 15 轮）**的逐条 usage 相加，**重启后依旧**。**已根修**：`DbMessageCompactTools.cs` 把 `hasUsage` 改判为 `AssistantReplies > 0 || resetAt > 0`（重置过的会话「0」也是有效结果），一条修覆盖**重置 / 切会话重载 / 重启**三条路径；`session-slice.ts` 补 `ZERO_USAGE_BASELINE` 零值兜底。
  - **⚠️-1（已修）** 重置失败静默 ⇒ 补 `console.warn`。
  - **⚠️-2（留裁定）** `DbClient.EnsureColumn` 的 `catch {}` 静默吞异常 —— ALTER 失败会让聚合因 `no such column` 整体抛错，**全仓所有会话**的底部统计退化成兜底相加。属通用迁移原语改动，超出本条范围。
  - **⚠️-3（留裁定）** 无回归测试（`tests/**` 0 命中）；加套件会动 `package.json` 计数（69 → 70）。**与 S-194 的测试去留一并裁定。**
  - 文档端点名笔误已订正：`db/sessions-reset-usage-stats`（复数）→ **`db/session-reset-usage-stats`**（单数）。
- **阶段六验证**由主会话现场跑（`plan-s193/verification_report.md`）：**PARTIAL** —— 门禁三绿（`typecheck` 0 错 / `npm test` **69/69** / `dotnet build sln` 0 警告 0 错误）、13 项静态核实逐条通过、7 条非目标全守住；差 6 项实机（**E-1 ~ E-3 为验收主干**）。

**落档**：新建 `requirements/S-194.md`、`plan-s193/plan.md`、`plan-s193/review_report.md`、`plan-s193/verification_report.md`；迭代级 `verification_report.md` 增 **§七**（S-191 ~ S-193 索引 + 迭代总账：12 条全 PARTIAL、0 FAIL）；`plan.md`（状态行、登记过程行、需求表 +1、需求要点 +1）；`raw-requirements.md`（进度 +1 行、表格 +1 行、统计登记 12 → 13）；本 `changelog.md`。**顺带**：迭代目录里两份用 Write 建的报告（迭代级 `review_report.md` / `verification_report.md`）原为 LF，已归一为 CRLF。**文档改动一律不提交，攒迭代收尾刀。**

---

## 2026-10-13 18:54 —— S-194 实施（`f3eed21b`）

**改动**：三套 token 格式化实现合并成一份 `lib/format-tokens.ts`；单位序列补 `G / T`；精度规则「同一单位内 <10 两位 / <100 一位 / ≥100 整数」；后缀统一小写 `k`；**进位升单位**（`999999` → `1.00M`，不再吐 `1000k`）；删除 `formatTokensDecimal`。落地 **5 个渲染端源文件**。

**门禁**：`npm run typecheck` 0 错误；`npm test` **70/70**（TS 53 + C# 17，新套件 `tests/token-format` 纳册 ⇒ 计数 69 → 70）。纯渲染端，**无 C# / DB / i18n 键改动**。

---

## 2026-10-13 19:01 / 19:06 —— S-195 实施（`5b65a231`）+ S-196 实施（`11699421`）

**S-195**（老大 16:28 登记的桌面卡片误判失败）：`parseErrorMessage` 的兜底 `return output.trim() || null` 把**任何非空输出**都当错误 ⇒ 三处同源拷贝（`DesktopActionToolCard` / `BrowserToolCard` / `ImagePluginToolCard`）**一起改为 `return null`**，成败由 `status` / `error` prop 说。**同族一并修**：`lib/app-plugin/desktop-routing.ts` 的 `isDesktopControlToolName` 由恒 `false` 空壳改为按 `types.ts` 五个 `DESKTOP_*` 常量查表 ⇒ `execution-outline.ts:209` 的 desktop 分类变得可达（折叠态摘要走 `workbench.summaryDesktop` 而非「执行了 N 个操作」；可见性不变）。**浏览器那份同款空壳当时漏了** ⇒ 见文末 S-199。

**S-196**（老大 16:34 登记的 `481h56m`）：方案 **B + A 兜底** —— `adjustCompactArtifactTimestamps` 改写工件 `createdAt` **之前**把真实落刀时刻存进 `meta`；`renderable-chat-items.ts` 的 `resolveCutTime` **优先读 `meta`**、读不到时 clamp 兜底；`totalElapsedMs` 只在真切出 ≥2 段时才挂（`lib/api/types.ts` 同步补类型）。**原倾向的方案 C 已被实测证伪**（`displayAnchor.assistantMessageId` 恒等于要切的那条消息自己，取它的时间等于把切点拽回消息开头、会吃掉真分段）。

**门禁**：两刀各自 `npm run typecheck` 0 错误；`npm test` **70/70**（TS 53 + C# 17）。

**落档**：`requirements/S-194.md` / `S-195.md` / `S-196.md`、`plan-s194/` `plan-s195/` `plan-s196/`（各含 `plan.md` + `review_report.md`）。

---

## 2026-10-14 08:13 ~ 08:40 —— S-197 实施（`97495740`）+ S-198 实施（`35969c17`）

**S-197 三条裁定**（老大 08:36 原话）：

> 「197 根据你推荐来 耗时是整轮的 结束后不保留」

⇒ **① 显示形态 = B**（状态文案后右侧独立一段）/ **② 口径 = 整轮**（起点取流式消息 `createdAt`，天然不含排队 —— 会话忙时 `sendMessage` 前置入队并 return、消息不创建）/ **③ 跑完不保留**（起点消失即不渲染）。

**S-197 实施**：新增纯函数 `resolveRunningElapsedLabel`，落点 = **零依赖叶子模块** `lib/format-duration.ts`（第一版放 `InputArea/utils.ts` 实测跑挂 —— 依赖链经 chat-store 拉进 IPC，node 侧 `window is not defined`，bundle **2.7MB → 挪对后 7.4kb**）；`composer-status-indicator.tsx` 的 selector 带出 `streamingStartedAt` + 每秒 tick + 状态文案后追加 `shrink-0 tabular-nums` 耗时段；新套件 `tests/composer-status-elapsed`（**30 断言**）。

**S-197 审查 / 验证**：阶段五由**独立 subagent** 出具（`plan-s197/review_report.md`）—— **✅ 通过 / 无阻断**，7 条建议**全非阻断**，按纪律**不逐条提交、全部挂收尾刀**（S-1 `startedAt === 0` 未守门 / S-2 套件第 4 组 `includes` 误报风险 / S-3 已消解 —— 审查读到的是编辑前的 `plan.md` / S-4 对比度 a11y / S-5 ~ S-7 记录在案不改）；阶段六（`plan-s197/verification_report.md`）**VERDICT PARTIAL**（门禁 + 静态核实全过，实机 9 项待老大验，**E-2 = 跑工具期间不停表**为最关键）。

**S-198**：preset `version: 10 → 11`，`homepage` 由带作者邀请码的推广链接改回产品页 `https://opencode.ai/zh/go`（**去掉 `?ref=`**；新旧两址 10-14 实测**均 200**）；`reconcileProviders` 对**已物化的内置记录**只刷新 `homepage` 一个字段（`{ ...existing, homepage: preset.homepage }`），其余字段与 id 原样保留 ⇒ **不破 R-9.2**；`provider-presets` 套件新增 `R-9.C.9` 两条断言（**562 断言全过**）。

**S-198 流程裁定**（老大 08:20）：

> 「这个只是单纯的改一个内置地址，不走那些流程了」

⇒ **免阶段五审查 / 阶段六验证**。

**门禁**：`npm run typecheck` 0 错误；`npm test` **71/71**（TS 54 + C# 17，S-197 新套件纳册 ⇒ 70 → 71）；`dotnet build src/runtime/WishfulClaw.sln` **0 警告 0 错误**；官网 build 免跑（不触碰 `website/`）。

**落档**：`requirements/S-197.md`（§4.5 判据订正 + §4.7 + §五 三条裁定表）、`requirements/S-198.md`、`plan-s197/`（`plan.md` + `review_report.md` + `verification_report.md`）。

---

## 2026-10-14 08:45 —— 登记第 18 条 S-199（**自评发现，非老大登记**）

**来源**：做 S-195 时顺带坐实 —— `lib/app-plugin/browser-tool-names.ts` **全文 3 行**、`isBrowserToolName` 恒 `false`（`d6228b27` 全量移植时**即为空壳**，`git show d6228b27:…` 与今日工作区**逐字相同**）⇒ 两个消费点**全死**：`tool-block-renderer.tsx:220` 的 `BrowserToolCard`（491 行）**永不渲染**、`execution-outline.ts:208` 的 `'browser'` 分类**永不产生**（`workbench.summaryBrowser` 成**死 key**）。

**是默认路径不是死角**：`types.ts:81-92` 注册 7 个 `Browser*` 工具，且 `types.ts:50` `isAppPluginEnabledByDefault` **含 `BROWSER_PLUGIN_ID`**。

**定性**：**bug**，纳入 39。**同族先例**：S-195 已修 desktop 同款空壳，浏览器那份漏了。修法无歧义（约 15 行，照 `desktop-routing.ts` 对称）—— **但属可见行为变化**（修好会新增一处可见渲染），**等老大点头**。

**落档**：新建 `requirements/S-199.md`；`plan.md`（状态头刷新、§二 需求索引更新 S-194 ~ S-198 + 新增 S-199 行）；`raw-requirements.md`（补登 S-197 / S-198 / S-199 三条 + 统计块刷新 15 → 18 条）；本 `changelog.md`。**文档改动一律不提交，攒收尾刀。**

> **订正（2026-10-14，同日开工前自查）**：本条正文有两处**判断错误**，已改：
> 1. 「两个消费点**全死**」→ **只有一个消费点真死**。`tool-block-renderer.tsx:220`（卡片链）确实死；`execution-outline.ts:208` 的 `'browser'` 分类虽永不产生，但**经逐条查证无任何后果**。
> 2. 「`workbench.summaryBrowser` 成**死 key**」→ **不成立**。`process-summary.ts:29` 的 `classifyItem` 在 `switch (item.category)` **之前**就用 `item.name.startsWith('Browser')` 短路返回 `'browser'` ⇒ 折叠态摘要照常显示；`category === 'browser'` 全仓亦无其它消费者；`getToolVisibility` 里 `'browser'` 与 `'unknown'` **同属 `'force'`** ⇒ 那一处修好也是**行为中性**。
> 3. **连带**：`plan-s195/plan.md` §六-4 的「不动 `isBrowserToolName` … 改它无行为收益」**后半句不成立**（当时只查了摘要链、漏了卡片链）；`verification_report.md` §8.3 同漏，均已加订正。**桌面与浏览器不对称** —— desktop 卡片分支（`tool-block-renderer.tsx:262-268`）内联了 5 个 `DESKTOP_*` 常量、不走 `isDesktopControlToolName`，所以 S-195「仅摘要文案变化」**对 desktop 是对的**。
> **教训**：判「某分支不可达 ⇒ 某文案 / 组件成死物」这类**传导性结论**，必须**逐条列出该分支的全部消费者**再逐个验。

---

## 2026-10-14 —— 文档同步（补记 + 订正，**不动代码**）

**触发**：老大口径 —— 「迭代下具体情况需要以文档为准，文档落后那么就需要更新」。

**证据（本轮现场复跑，四道全绿）**：`npm run typecheck` **0 错** / `npm test` **71/71**（TS 54 + C# 17）/ `dotnet build src/runtime/WishfulClaw.sln` **0 警告 0 错误** / `cd website; npm run build` **0 错**。构建**未污染工作区**（`website/dist` 已 gitignore，跑完 `git status` 无新增未跟踪文件）。

**改了什么**：

| # | 文档 | 改动 |
|---|---|---|
| 1 | `requirements/S-199.md` | §三 影响面重写（去掉「死 key」）、新增 §八 订正记录 |
| 2 | `plan.md` | 状态头 **21 刀 → 20 刀**（实际提交数）；§一「需求清单 10 条」→ **18 条**（删逐条枚举，防再生锈）；**§三 刀序整体重写** —— 原「待定」列表里 S-187 / S-194 / S-195 / S-196 仍标「待开工」（实际已实施），改为**实际执行序表**（20 刀 + S-199 + 收尾刀）；§四 门禁基线 **68/68 → 71/71** |
| 3 | `raw-requirements.md` | 统计块 **21 刀 → 20 刀** |
| 4 | `plan-s192/verification_report.md` | **新建**（补记，结清迭代级报告 §七 的「文档欠账 ①」）⇒ S-192 复核为 **PASS** |
| 5 | `verification_report.md` | §七 S-192 行指向新报告（PARTIAL → **PASS**）+ 勾掉欠账 ①；§8.3 补 S-199 订正；§B1 补 `u` 参数订正；S-186 VERDICT 行加订正；**新增 §九**（S-197 / S-198 / S-199 索引 + 总账刷新 + 门禁漂移链 **68 → 69 → 70 → 71**） |
| 6 | `requirements/S-186.md` | **新增 §九 实施记录与后续修订**（原文档停在规划态，**两条提交 `2be923fb` + `bf4bd16f` 从未记录**）；§四-5 / §六 的 `u=` 旧形态加订正指针 |
| 7 | `requirements/S-182.md` | 中转页 `u=` 旧记载加订正指针 → S-186 §9.1 |
| 8 | `review_report.md` | ⚠️1（开放重定向）标 **✅ 已消解（`bf4bd16f`）** |
| 9 | `plan-s193/plan.md` | 状态行「阶段六待验证」→ 验证已出（**PARTIAL**） |
| 10 | `plan-s194` / `plan-s195` / `plan-s196` 的 `plan.md` | 状态行的报告指引改为**实际文件**（原指向计划内步骤号） |
| 11 | `plan-s195/plan.md` | §六-4 加订正块（`isBrowserToolName`） |
| 12 | 本 `changelog.md` | 2026-10-12 条「父 run finalize ⇒ 事件必丢」加**订正块**（S-191 已证伪） |

**未做（不伪造）**：**不回溯补写**阶段三 `compliance_report.md` 与各需求的 `verification_report.md`。iter-39 的实际做法是**迭代级** `review_report.md` / `verification_report.md` **按需求分节**（§六 / §七 / §八 / §九）+ 部分需求单开报告 ⇒ 缺的多数不是「报告」而是「分节」。**事后凭记忆编报告等于伪造证据** —— 是否要补、按什么口径补，**等老大裁定**。

**行尾核验**：本轮改动的 md 全部 `loneLF=0` / `bom=False`（CRLF）。

---

## 2026-10-14 —— 收尾轮（S-200 / S-201 / S-202 补记 + 报告补齐 + 门禁复跑，**不动代码**）

**触发**：老大 16:24「测试通过 根据 agents.md 进行迭代收尾」。

**门禁（本轮现场复跑，四道全绿）**：`npm run typecheck` **0 错** / `npm test` **72/72**（TS 54 + C# 18）/ `dotnet build src/runtime/WishfulClaw.sln` **0 警告 0 错误** / `cd website; npm run build` **0 错**。环境前置：仓库内**无 dev 实例**（只有打包版 `C:\Program Files\...\WishfulClaw.Worker.exe`，不锁 `bin\`）。

**补齐的报告（本轮新建 3 份）**：

| # | 文件 | 内容 |
|---|---|---|
| 1 | `plan-s202/review_report.md` | S-202 阶段五审查（独立 subagent，43 次工具调用）：**PASS，无阻断** —— 根因 / 修法 / 触发链全核实；1 处注释错号（`S-204` → `S-202`）**已修**；5 处同类点（子 agent / goal / 压缩表面）**待裁定是否扩面** |
| 2 | `plan-s202/verification_report.md` | S-202 阶段六验证（主会话）：**PASS** —— 4 条判据全绿（判据 1 由老大真机确认「真机测试可以了，真不容易」） |
| 3 | `plan-s200/verification_report.md` | S-200 阶段六验证（独立 subagent，`test-automator`）：**PASS** —— 8 条判据 1~7 全绿、判据 8 按指示跑 2/4 腿；套件 **37/37** |

**迭代级报告补索引**：

| # | 文件 | 改动 |
|---|---|---|
| 1 | `review_report.md` | **新增「补充轮 · S-189 ~ S-202 审查索引」** —— 14 行逐条结论（**❌ 4 全部已修** / ⚠️ ≥ 29，2 条留裁定）；第一轮结论行加「（第一轮范围 S-182 ~ S-188）」限定 |
| 2 | `verification_report.md` | **新增 §十**（S-200 / S-201 / S-202 索引 + 总账刷新）—— 总账 **20 条实施**（PASS 3 / PARTIAL 16 / N/A 1）、门禁终值 **72/72**（漂移链补至 72/72） |

**文档欠账清理（本轮，全部攒收尾刀）**：

| # | 项 | 结论 |
|---|---|---|
| 1 | 38 `progress` 回填 | ✅ 已改（`2c925c88`） |
| 2 | 38 `changelog.md` 误定性 | ✅ 已订正（「机器 B 不是 bug」的旧结论有 ❌/✅ 对照块） |
| 3 | `docs/iteration-plan.md` 停更 | ✅ **本轮补废弃标记**（自 iter-34 停更；现行口径见 `dev-workflow.md`） |
| 4 | 压缩比 3 处 | ✅ **本轮订正 4 处** —— `review_report.md` ×3 + `plan-s185/plan.md` ×1：`−26.5%` 系「基线字符 + 709 CRLF」与「归一 LF 字符」**混算**，同口径 = **−23.0%（LF↔LF）**。**S-185 的 commit message 仍留原口径**（改它需重写迭代 hash 链，代价大于收益） |
| 5 | S-186 旧记载 | ✅ 已订正（`/go?src=&u=` 形态 → `bf4bd16f` 已删 `u`） |
| 6 | `changelog.md` 父 run finalize 旧结论 | ✅ 已订正（S-191 已证伪，有订正块） |

**未做（不伪造）**：不回溯补写阶段三 `compliance_report.md`。**S-199 未开工**（唯一剩余项）。**S-185 commit message 的 `26.5%` 保留原口径**（同上）。

**行尾核验**：本轮新建的 3 份 md 已归一为 **CRLF + 无 BOM**；本轮编辑的 md 均保持 CRLF。
