# iter-v2-39 阶段六验证报告

**总 VERDICT: PARTIAL**

一句话结论：门禁三绿、静态一致性全数通过、官网统计链路（含服务器侧真实日志）已被**逐日复算证实可用**；但本迭代 7 条需求里有 **6 条的核心验收动作必须实机或真实流量才能兑现**（渲染端 UI 行为 3 条、外部下载/更新链路 2 条、跨端 PM 桥路 1 条），故整体判 **PARTIAL**，无 FAIL、无阻断项。

> 验证者：阶段六验证 subagent（独立于实施与审查）。
> 范围：`dev/v2-iter-39`（base `2c925c88`）。**本报告为增量叠加**：§一 ~ §五 是第一轮（截至 HEAD `f111da66`，覆盖 S-182 ~ S-188），§六 是 10-12 补充轮（S-189 / S-190），§七 是 10-12 ~ 10-13 补充轮（S-191 / S-192 / S-193），§八 是 10-13 补充轮（S-194 / S-195 / S-196，最新 HEAD `11699421`）。判定基准：`plan.md` + `requirements/S-182.md` ~ `S-196.md` + 各 `plan-s*/review_report.md`。
>
> ⚠️ 读法：**§一 的门禁数（68/68）与 §四 的待实机编号（1 ~ 11）是第一轮的快照，未回改**（保留历史现场）；迭代当前门禁与总数以最后一次补充轮为准 —— **门禁 `npm test` 70/70（TS 53 + C# 17）**，**待实机项累计 16 条**（§四 11 + §6.4 2 + §7 三条需求的实机项 + §8.5 3）。
> 纪律：**未改任何代码/文档**（本报告除外），**未执行任何 git 写操作**；临时脚本与产物**全部落在 `%TEMP%`**（`…\Temp\wc-iter39-b2\`、`…\Temp\wc-iter39-b3*\`），仓库内**零新增未跟踪文件**。
> 服务器访问**一律只读**（`cat / gzip / awk / jq / ls`，输出全走 stdout，**未写任何文件、未改配置、未重启服务**）。

---

## 一、门禁证据

**环境前置**：按 `ExecutablePath` 过滤，仓库内**无** electron / `WishfulClaw.Worker` 进程命中 —— 仅有打包版 `C:\Program Files\WishfulClaw\...\WishfulClaw.Worker.exe`（PID 12056，不锁仓库 `bin\`）⇒ **门禁可跑**（与上一轮结论一致）。

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `npm run typecheck` | **0 错误** | `typecheck:node` 与 `typecheck:web` 两段均无任何诊断输出（tsc 静默即通过） |
| `npm test` | **68 / 68 通过**（TS 51 + C# 17） | 汇总行 `68/68 通过`；含 `Goal 335 assertions`、`JsonHelpers 24 assertions`、`SessionTaskCascade 229` |
| `dotnet build src/runtime/WishfulClaw.sln` | **0 警告 0 错误** | `已成功生成。0 个警告 0 个错误`，`WishfulClaw.Worker -> …\bin\Debug\net11.0\WishfulClaw.Worker.dll` |

三条门禁与 `plan.md` §四基线**一致**，无回归。

---

## 二、动态验证结果

### B1 · 官网构建产物与 `/go` 中转页

**验证**：读 `website/dist/**`、`website/src/go-page.tsx`；grep 线上站点目录与 assets。

**证据**

- 本地 `website/dist/` 含 **4 个 MPA 入口**：`index.html` / `download.html` / `guide.html` / **`go.html`**（+ `assets/`、`screenshots/`、`logo.png`、`police-badge.png`）。
- 构建产物 `assets/site-data-B2hP1Am3.js` 内含 **`./go?src=${encodeURIComponent(e)}&u=${encodeURIComponent(t)}`**（与 `latest-yml.ts` 的构造逐字符一致），且平台主按钮与全部加速站菜单项都走它；**唯一例外是「本站直链」项，带 `download` 属性** ⇒ 口径 c（下拉保留本站直链、不走 `/go`）在**产物里**成立。
- 页脚来源说明「下载由第三方公益加速站提供；若某个源不可用，请点右侧箭头换一个。」在产物中可见。
- **线上一致性**：`/data/sites/wishfulclaw/` 有 `go.html`（839 B，与本地 dist 同名同尺寸），`assets/go-CDceQa2R.js` 的 hash 与本地 dist **完全一致** ⇒ 线上跑的正是本分支构建产物。
- `go-page.tsx:14`：`const target = rawTarget.startsWith('https://') ? rawTarget : ''` —— **只认 `https://` 前缀，无主机白名单**（`⚠️1` 第一手坐实）。

> **订正（2026-10-14）**：上两条是**修订前形态**的快照。`bf4bd16f`（2026-10-11）已把 `u` 参数**整体删除**：
> - 产物里的 href 现为 **`./go?src=${encodeURIComponent(e)}`**（`website/src/lib/latest-yml.ts:91`）—— **不再带 `u`**；
> - `go-page.tsx` 也不再读 `u`：改为按 `src` 从 `downloadSources` 查源、再读 `latest.yml` 拼目标（`go-page.tsx:6-15` 注释 / `:19` / `:31-36`），`src` 查不到即回落默认源 ⇒ **`⚠️1` 开放重定向已关闭**；
> - 因此上文 `site-data-B2hP1Am3.js` 的内容与 `go-CDceQa2R.js` 的 hash **均已失效**（那是修订前的产物）⇒ 以**当前构建产物**为准。详见 [`requirements/S-186.md`](requirements/S-186.md) §9.1。

**结论**：PASS（构建产物 + 线上部署 + href 构造 + 口径 c 均成立）。**下载行为本身（跨域 `Content-Disposition`）不在本项**，见 §四。

### B2 · 官网统计脚本（两源分别计数 / 去重 / 排除项）

**B2-a 合成日志（`%TEMP%\wc-iter39-b2\`，绝对路径）**：用**逐字复制自服务器 `/usr/local/bin/wishfulclaw-stats.sh` 的 `aggregate()` awk**（awk 正文一个字符未改，只把日志路径换成 temp 合成日志）跑一份覆盖全部边界用例的样例：

| 断言 | 期望 | 实测 |
|---|---|---|
| `visits`（页面访问：`/`、`/download`、`/guide`；assets 与非 GET 排除；同 IP+UA+小时去重） | 3 | **3** ✅ |
| `web_click`（`/go?src=…`；重复点击去重；不同 `src` 分列；无 `src` 计 `go`；日志里混进的 `/downloads/…` 越界 URL 不计） | 5 | **5** ✅ |
| `web_download_local`（浏览器 UA 的 `.exe`；多线程/Range 去重） | 2 | **2** ✅ |
| `app_update`（`electron-updater` UA 的 `.exe`；分段 Range 去重） | 2 | **2** ✅ |
| `downloads` = click + local + app | 9 | **9** ✅ |
| `filtered_bots`（Googlebot、`curl/8.4.0`） | 2 | **2** ✅ |
| `latest.yml` / `.blockmap` | 排除 | ✅ 排除 |

⇒ **6/6 断言全过**：两源**正交不重叠**（`/go` 只进 click 源、`/downloads/` 只进 dl 源、跨源 URL 互不计）、1 小时桶去重、排除项全部生效。

**B2-b 真实日志复算（只读）**：把同一段 awk 与真实日志（`access.log(+.1 +.gz)` / `wishfulclaw-clicks.log` / `wishfulclaw-downloads.log`）对跑，输出全走 stdout（**未在服务器落任何文件**），与 `/data/stats/*.json` 逐日对照：

- **2026-09-27 ~ 2026-10-09 共 13 天：`visits` 与日文件完全一致**（如 09-27 `237`、10-07 `249`、10-09 `245`）；`2026-10-10` 亦一致（`0`）。
- `2026-10-11`：复算 `visits 91 / bots 152`，日文件为 `38`（bots 25）—— 差异**唯一来源**是 cron（`25 4 * * *`）在 04:25 之后日志仍在增长（`access.log` mtime 09:43）。
  ⇒ 说明聚合是**幂等重算**且在真实日志上**可复现**（含 HTTP/1.0、HTTP/2.0、`?noCache=` query、`.gz` 轮转读取）。
- 服务器侧聚合脚本头注释与实现一致：三源分工 `access.log→visits` / `clicks.log→web_click` / `downloads.log→web_download_local+app_update`；UA 分类正则 `electron-updater|electron-builder`。

**B2-c 真实日志的实际内容（重要）**：

- `wishfulclaw-clicks.log`：**仅 1 条**，为 `171.91.245.25 … "GET /go?src=ghproxy.net&u=<GitHub 直链>" 200 839 … "curl/8.21.0"` —— 即一次**手工 curl 测试**，且因 UA 命中机器人规则**被正确过滤** ⇒ 日文件 `web_click: 0` 是**对的**。
- `wishfulclaw-downloads.log`：**23 条全是 `latest.yml`**（含多条 `electron-builder` UA 的 `?noCache=` 请求），**一条 `.exe` 都没有** ⇒ 日文件 `downloads: 0` 是**真实的 0**（不是管线没通）。
- 旁证：`/data/stats/summary.json` = `days:16, downloads_total:0, visits_total:3448, sources{全 0}`；nginx snippet 里 `location = /stats.json { alias /data/stats/summary.json; }`、`location = /go { access_log …clicks.log combined; }`、`location ^~ /downloads/ { … access_log …downloads.log wishfulclaw_dl; }` 三处**均已就位**；`conf.d/wishfulclaw-logs.conf` 的 `wishfulclaw_dl` 格式把 UA 放在第 6 个引号段（与 `combined` 同构）⇒ awk 能一套解析吃两种格式（实测通过）。

**B2-d 本地读取侧**：`node scripts/site-stats.mjs --json` → 原样打印 `summary.json`；`--days 2` → 打印「累计下载 0 次 / 累计访问 3,448 次 / 分源明细 / 最近 2 天」。字段名 `downloads_total` / `visits_total` / `sources.{web_click,web_download_local,app_update}` 与前端 `website/src/lib/site-stats.ts:36` 的读取键**逐字一致**；`MIN_VISIBLE_COUNT = 100` 落地 §五第 6 条。

**结论**：聚合与本地读取两侧**逻辑与真实日志均已验证**；但**真实流量里至今没有任何一次 `.exe` 下载**，以及点击侧唯一真实样本被当机器人过滤 ⇒ **端到端数字尚未在真实流量上兑现**（机制已验证，兑现待流量）。

### B3 · 内置人格文本压缩比

**口径**：读字节 → `UTF8.GetString` → 去 BOM → `\r\n`→`\n` 归一 → 数**字符**（避免 PowerShell `Get-Content -Raw` 的 GBK 乱码坑）。基线取 `2c925c88:…` 与 `87f90902:…`（S-185 那刀的父提交）两个 ref，二者**完全相同**。

| 口径 | 基线 | 现状 | 比值 | 变化 |
|---|---|---|---|---|
| **LF 归一（字符）** | **14,726** | **11,344** | **77.0%** | **−23.0%** |
| CRLF 保留（字符，工作区口径） | 15,435 | 12,028 | 77.9% | −22.1% |

**逐人格（LF 归一字符）**

| 人格 | 基线 | 现状 | 比值 |
|---|---|---|---|
| aming | 2,906 | 2,212 | 76.1% |
| default | 1,341 | 1,155 | 86.1% |
| jarvis | 2,358 | 1,780 | 75.5% |
| lao-zheng | 3,788 | 2,895 | 76.4% |
| taozi | 1,865 | 1,418 | 76.0% |
| tingjie | 2,468 | 1,884 | 76.3% |

**3 个人格「意思不变」抽查**（逐行比对删/增行）：

- **lao-zheng**：无新增意思、无人格取向反转；「不是工具」「信息不够也敢拍板」等保留。**但有 2 处静默丢失** —— ① `SOUL.md` 整条 **`**不需要安慰，需要行动**：心情不好时别说"没事的""会好的"这种废话…`** 被删，且 `IDENTITY.md` 的对应落点（`心情不好时不需要安慰，需要具体信息或可执行方案`）也删了，`SOUL.md` 的「兄弟心情不好」条里那句 `不说"没事的""会好的"` 同样没了（只剩 `直接问"怎么了"，听完给具体建议或帮着分析`）⇒ **「别说没事的/会好的」这条具体行为规则全无落点**；② `ONTOLOGY.md` 的 `做不到的事诚实说`、`先干了再调` 被删（同文件「能做」清单仍在）。
- **tingjie**：`SOUL.md` 的 **`**信息密度**：高。每句话都有用不填充 —— "说重点"本来就该如此，不需要被提醒。`整条删除**且未在别处补回；`行动 > 分析` 的解释「不分析瘫痪」也被删（仅剩标签）。取向（高标准、结论先行、替你做决定但不双标）**完整保留**。
- **taozi**：`ONTOLOGY.md` 4 条价值观 **只剩标签**，解释从句全删（`1. **正确性 > 有趣** — 说得多嗨，技术判断不能错` → `1. 正确性 > 有趣`）——比之前记录的「去掉加粗、文字全在」**更严重一点**（解释没了）；`IDENTITY.md` 的 `关键技术判断不含糊`/`热情是真的不是表演` 被删（`SOUL.md` 有对应保留）。取向（活泼、爱跑题、技术不含糊）**保留**。

**结论**：**无新增意思、无取向反转**（需求 §三 5 条「不允许」中 4 条可判定为守住）；压缩比 **−23.0%**（低于 plan 自设参考区间 30%~45%，但需求 §一 明文「不设压缩指标」⇒ **不构成 FAIL**）。**「意思不变」这条硬约束只能抽样判定，且已确认 3 处语义落点静默丢失** ⇒ 需实机观感兜底（§四）。

### B4 · `Goal` 套件断言（S-188 相关）

`npm test` 输出中 `ok Goal 0.7s 335 assertions` —— 与本轮断言更新一致，**通过**。

### B5 · S-187 静态一致性 + `-uall` 效果实测

- `src/renderer/src/components/chat/**` 下 `compact` / `ResizeObserver` / `scmWidth` / `GIT_PAGE_COMPACT_MAX_WIDTH` **Grep 零匹配**；
- `src/renderer/src/hooks/use-git-panel-split.ts` **文件不存在**，且全仓 `use-git-panel-split` / `useGitPanelSplit` **零引用**；
- `GitPage/utils.tsx:201-293` 的 `ScmFileRowView` 挂 `ContextMenu` + `onShowHistory?` / `historyLabel?`，`ScmSidebar.tsx:552/600/648` **三处（conflict / staged / unstaged）同时调用** ✅；
- `GitStatusTools.cs:16` = `new[] { "status", "--porcelain=v1", "-b", "--untracked-files=all" }` ✅；
- **`-uall` 效果本机实测**（同一工作区、只读）：默认 `--untracked-files=normal` 输出折叠目录 `?? docs/plans/iter-v2-39/plan-s187/`；加 `--untracked-files=all` 后展开成 `?? docs/plans/iter-v2-39/plan-s187/plan.md` ⇒ **C# 侧那行改动的行为符合口径 4**。

### B6 · S-188 关键行为静态推演（审查 ⚠️5 的落点）

**问题**：PM `stop_session_run` 之后「发一条新消息是否会自动恢复旧队列的派发？」

**推演**（读 `use-chat-actions.ts` / `chat-store/index.ts`）：

- `cancelStream(sessionId)`（`chat-store/index.ts:541-561`）在取消前调 `pausePendingSessionDispatch(sessionId)`；运行结束事件 `aborted` 又调一次（`:1741-1743`）。注意 `pausePendingSessionDispatch`（`:840-845`）**队列为空时直接 return**，所以「空队列 + 停止」不留暂停态（无害）。
- 解除暂停**只有三条路**：`dispatchNextQueuedMessageForSession(sid, resumePaused=true)`（`:872-874`，默认 true）、`removePendingSessionMessage` 把队列删空（`:851-854`）、`clearPendingSessionMessages`（`:297-301`）。
- 而 `dispatchNextQueuedMessageForSession` 的调用点只有三处：UI 队列面板的「恢复派发」（`use-queued-messages.ts:113`，**UI 专有**）、运行结束回调（`chat-store/index.ts:1750`，**传 `false` ⇒ 不解除暂停**）、自重试（`use-chat-actions.ts:936`，**传 `false`**）。
- `handleSendMessage` 入队时是**加**暂停（`:120`），**全程没有任何「发消息 ⇒ 解除暂停」的分支**。

**结论（静态）**：**发新消息不会恢复旧队列的派发**。停完可以立刻再发消息（无活跃 run ⇒ 立刻起跑 ✅），但**旧队列会停在「暂停」态**，而 **PM 侧没有「恢复派发」工具** —— PM 手里唯一能解除的办法是 `clear_session_queue`（清空，等于丢弃）。⇒ 这是**真实功能缺口**，见 §五 第 3 条（需实机确认收尾）。

---

## 三、逐需求 VERDICT

| 编号 | VERDICT | 依据 |
|---|---|---|
| **S-182** | **PARTIAL** | 服务器侧三源链路**结构齐备**（nginx 3 处 location + `wishfulclaw_dl` 格式 + crontab `25 4 * * *` + `/data/stats/` 16 天日文件 + `summary.json`），**聚合逻辑用逐字 awk 在合成日志上 6/6 断言通过、在真实日志上逐日复算与日文件一致**；本地 `site-stats.mjs` 与前端 `site-stats.ts` 字段名一致、失败静默；`MIN_VISIBLE_COUNT=100` 落地。**未兑现**：真实流量里 `.exe` 下载 0 条、点击侧唯一真实样本被机器人过滤 ⇒ 「下载次数」在真实数据上仍为 0，端到端数字未验；页面上的数字展示未实机看。 |
| **S-183** | **PARTIAL** | 静态改动逐条对得上 requirements §四（`mx-auto … min-h-0 … flex-1 flex-col`、三层 `shrink-0`、tab 内容区 `overflow-hidden`、外层保留 `overflow-hidden`）—— 见 `review_report.md` S-183 节。**实机未验**：出滚动条 / 底部可达 / 矮窄窗口（需求 §五 验证表）。 |
| **S-184** | **PARTIAL** | B（选中态 + 预览跟随 + 删除后回落）与 C（`confirm({variant:'destructive'})` 文案逐字一致 + 删后回灌 `usePersonaStore` + 失败不吞异常）静态齐；偏离（改走 `IPC.FS_DELETE` 而非 `persona/delete`）理由充分且已注释（`⚠️7`）。**实机未验**：点击切换、删除后落盘消失、两处列表一致。 |
| **S-185** | **PARTIAL** | 24 文件、**−23.0%（LF）/ −22.1%（CRLF）**，抽样 3 人格**无新增意思、无取向反转**，结构未破。**但**：已确认 3 处语义落点静默丢失；无任何自动化护栏（测试不覆盖）；plan §五 步骤 6「实机观感」仍未勾选 ⇒ 硬约束「意思不变」**不能仅凭离线判定收口**。 |
| **S-186** | **PARTIAL** | 本地 dist 与**线上站点**均含 `go.html`（assets hash 一致）；加速站 href 全走 `./go?src=&u=`、本站直链保留 `download`（口径 b + c）；`/go` 在线上确实落进 `clicks.log`（真实 1 条）。**未验**：跨域 `Content-Disposition` 透传 / 点击后是否真下载（需求自标「开工时必测」，`⚠️6`）；`⚠️1` 开放重定向**未修**（`go-page.tsx:14` 仅 `https://` 前缀）。<br>**订正（2026-10-14）**：本行是**修订前**快照 —— `bf4bd16f` 已把 href 收紧为 `./go?src=<源名>`（去掉 `u`）并**关掉 `⚠️1`**；**但「未验」两项仍未结清** ⇒ 本条维持 **PARTIAL**。详见 [`requirements/S-186.md`](requirements/S-186.md) §9.1。 |
| **S-187** | **PARTIAL** | 6 条口径静态全绿（单列收敛、阈值/`compact`/`ResizeObserver` 零残留、`use-git-panel-split.ts` 整文件删除且零引用、右键历史入口三处生效、`-uall` 生效、无条目上限）；`-uall` 行为本机实测有效。**实机未验**：右键开历史弹窗、未跟踪文件逐条列出、长列表走滚动条、diff 弹窗行为。 |
| **S-188** | **PARTIAL** | 桥路四处登记逐字符一致（审查专项）、三态错误处理齐、`stop_session_run` 只调 `cancelStream` 且文案声明「队列保留」。**未验**：PM 真实会话里三个工具的端到端调用；且静态推演确认「停后队列**暂停**派发」（需求 §二「派发照旧」与实现不符，`⚠️3`）＋ **PM 无恢复工具**（`⚠️5`，B6 结论：发新消息**不会**恢复）⇒ 需实机确认影响面。 |

---

## 四、未能自动验证的项（待实机 / 待服务器）

1. **S-187 的 UI 交互**（最高优先，本迭代唯一 C# 改动的可见面）
   验什么：右侧面板 Git 选项卡只剩一列文件列表；未跟踪目录**逐文件展开**；右键文件行弹出「文件历史」弹窗、弹窗内提交列表与 diff 正常；宽窄拖动不再重叠；长列表出滚动条。
   怎么验：起 `npm run dev:full`，打开一个含未跟踪目录的仓库 → 文件板块 → Git；对照 `plan-s187/plan.md` §七。
2. **S-183 的布局行为**
   验什么：项目档案页内容被裁是否消失、是否出现滚动条、底部内容可达；**矮 / 窄窗口**下仍可达（需求 §五 3 条）。
   怎么验：实机缩放窗口 + 打开项目档案页；亦可叠 Chrome DevTools 改设备尺寸。
3. **S-184 的项目人格交互**
   验什么：点人格卡片切换查看（预览跟随）、删当前选中项后预览回落、删除后**项目目录落盘消失**且设置页列表同步、`confirm` 文案与实测一致。
   怎么验：实机打开项目档案页 · 人格档。
4. **S-185 实机观感（唯一能兜住「意思不变」的手段）**
   验什么：`lao-zheng` 与 `default` 各跑一轮对话，确认说话风格与行为准则没走样；**重点复核**「不需要安慰/别说没事的会好的」这条规则消失后的实际表现。
   怎么验：新建会话选人格 → 抛一个「我心情不好 + 一个技术问题」的复合输入，看回应形态。
5. **S-186 跨域下载行为（需求自标「开工时必测」）**
   验什么：两个当下可用加速站（`ghproxy.net` / `v6.gh-proxy.org`）是否透传 `Content-Disposition`（若不透传，点击会变成**页面导航**而不是下载）；`/go` 自动跳转是否被浏览器拦掉、兜底链接是否可用。
   怎么验：用真实安装包链接在 Chrome / Edge 各点一次，看是否进下载列表、文件名是否正常。
6. **S-182「下载次数」的真实兑现**
   验什么：真实流量里出现第一条 `.exe` 请求（浏览器本站直链 or 应用内更新）后，`wishfulclaw-downloads.log` 是否按 `web_download_local` / `app_update` 正确分流、日文件与 `summary.json` 是否同步刷新。
   怎么验：等一次真实下载或应用内更新后，跑 `node scripts/site-stats.mjs --days 2` 对照；也可在服务器侧只读 `grep -c setup.exe` 确认落库。
7. **S-182/S-186 页面上的数字展示**
   验什么：`/download` 页「已下载 N 次」与 footer「访问次数」的展示位置/文案；`< 100` 时不显示；`stats.json` 取不到时**静默不显示 0**。
   怎么验：实机访问 `https://wishful-claw.work/download`（或本地起 site + 伪造 `stats.json`）。
8. **S-188 跨端桥路端到端 + 停止 / 恢复语义**（**2026-10-11 更新：第三刀 `689e031c` 已加 `resume_session_queue`**）
   验什么：全局 PM 会话里依次调 `get_session_queue` / `remove_session_queue_message` / `clear_session_queue` / `stop_session_run` / **`resume_session_queue`**，返回文案与队列实际变化一致；**重点**：「停 → `resume_session_queue` → 旧队列是否继续派发」（B6 的静态结论「发新消息不会恢复」**仍然成立** —— 恢复必须显式调新工具；需实机确认工具真能解冻）＋ 停止后队列是否仍可见 ＋ 有活跃 run 时调恢复是否表现为「本轮结束自动续上」。
   怎么验：实机起一个项目会话跑长任务 + 排 2~3 条消息 → 全局 PM 侧调 `stop_session_run`（观察 UI 队列面板进入暂停态）→ 再调 `resume_session_queue`（观察队列继续出队、暂停态消失）。
9. **`latest.yml` UA 样本留档**（B2-c 副产品）
   验什么：应用内自动更新的真实 UA 究竟是 `electron-updater/…` 还是观测到的 `electron-builder`；分类正则目前两者都覆盖，但**只写 `electron-updater` 会全漏**。
   怎么验：等一条真实 `.exe` 的 `app_update` 记录后只读 `grep electron-updater /var/log/nginx/wishfulclaw-downloads.log`。
10. **`docs/release-workflow.md` 里留档的服务器侧配置与线上实际一致**（`⚠️10`）
    验什么：`summary.json` 字段名与读取键一致（**本报告已证**）、`/stats.json` 已 alias（**本报告已证**）、`/go` 已进 `clicks` 日志（**本报告已证**）—— 余下仅「换机器能否按文档复原」不可验。
11. **38 遗留：应用内更新链路的实机升级**（`plan.md` §六 第 3 条）
    验什么：`0.2.38` 客户端实升 `0.2.39`（下载进度、下载完成可重启安装、说明兜底拉取）。
    怎么验：**必须在 `0.2.39` 发布之后** —— 本迭代不可验。

---

## 五、新发现的问题

1. **（文档数字 · 中）压缩比口径不一致 —— `−26.5%` 是两种口径混算出来的。**
   `review_report.md` S-185 节、`plan-s185` 与 S-185 的 commit message 都记「15,435 → 11,344 = −26.5%」，但 **15,435 = 基线字符 + 709 个 CRLF**（工作区口径），而 **11,344 是归一 LF 后的字符**。同口径复算：**14,726 → 11,344 = −23.0%（LF↔LF）**、**15,435 → 12,028 = −22.1%（CRLF↔CRLF）**（`core.autocrlf=true`、仓库无 `.gitattributes` ⇒ 工作区必然 CRLF）。不改变结论（需求明文不设压缩指标），但**建议把三处数字订正为 −23.0%**，否则下游按 26.5% 验收会误判。
2. **（语义丢失 · 中）S-185 的 3 处静默丢失比 `⚠️9` 记录得更具体/更重。**
   ① `lao-zheng`：**「别说"没事的""会好的"」+「不需要安慰，需要行动」两处落点全无**（`SOUL` 整条 + `IDENTITY` 对应条 + `SOUL` 兄弟心情不好条里的从句）；② `tingjie`：**「信息密度」整条删除**（未补回）；③ `taozi`：`ONTOLOGY` 4 条价值观**只剩标签、解释从句全删**（`⚠️9` 记的是「去掉加粗、文字全在」，实测**文字也少了一半**）。⇒ 建议 §四第 4 项实机观感时把这三处列为重点。
3. **（功能缺口 · 中）S-188「停止」后 PM 无法恢复派发，且需求 §二 与实现不符。**
   静态推演（B6）：`cancelStream` 会暂停派发；运行结束时 `dispatchNextQueuedMessageForSession(sid, false)` **不解除暂停**；**发送新消息也不会解除**；PM 侧唯一的解除手段是 `clear_session_queue`（清空 = 丢弃）。⇒ 与需求 §二「队列保留、**派发照旧**、不丢队列、不暂停派发」矛盾（同 `⚠️3`），且**实际存在缺口**（同 `⚠️5`，本报告给出静态结论：**不会自动恢复**）。
   建议二选一并回填需求：① 给 PM 补一个 `resume_session_queue`（复用 `dispatchNextQueuedMessageForSession(sid, true)`）；或 ② 明确「停 = 队列暂停，恢复需用户/清空」，并同步 `stop_session_run` 的返回文案（当前文案只说「队列保留」，没说「派发暂停」）。

   **→ 已处理（2026-10-11，第三刀 `689e031c`）**：采纳建议 ①，工具名即 `resume_session_queue`。实现上**没有**直接用 `dispatchNextQueuedMessageForSession(sid, true)` —— 那条路在「有活跃 run」时会直接 `return false` 且**不解冻**（`use-chat-actions.ts:872-874`），故先加渲染端 `resumePendingSessionDispatch(sid)`（只解冻、与 `pause` 对称），再由处理器决定立即派发还是等本轮结束。`stop_session_run` 的返回文案也一并补了「派发已暂停 + 可调 `resume_session_queue`」，本报告 §四 第 8 项（实机端到端）随之更新为「含恢复动作」。
4. **（真实数据 · 中）「下载次数」至今为 0 是真实 0，但代价是「计入逻辑」在真实数据上零样本。**
   `wishfulclaw-downloads.log` 23 条**全是 `latest.yml`**（被正确排除）；**没有任何 `.exe`**。⇒ `web_download_local` / `app_update` 的分流规则、以及「浏览器多线程/Range 去重」在**真实**流量上尚未被触发。**同时观测到真实 updater UA 是 `electron-builder`（不是 `electron-updater`）** —— 现有正则 `electron-updater|electron-builder` 覆盖了它（若当初只写前者，应用内更新会 100% 漏计）。建议把这条观测补进 `release-workflow.md` 的留档。
5. **（口径边界 · 低）`site` 源的去重粒度是「IP+UA+小时」，不是「PV」。**
   `src == "site"` 时 `file` 恒为 `"page"` ⇒ 同一访客在同一小时内浏览 `/`、`/download`、`/guide` **只算 1 次**。`site-stats.ts` 的注释写「累计访问次数（PV）」，**名不副实**（更接近「每小时独立访客」）。建议把注释/文案改成「访问次数（按访客小时去重）」或按 path 拆 key。
6. **（文档 · 低）`⚠️1` 开放重定向仍未被修**（`go-page.tsx:14` 仅校验 `https://` 前缀）：一行白名单（`target.startsWith(GITHUB_RELEASES_BASE)`）即可收口，且「下载链接无效」分支已存在。本迭代未见修复。
7. **（观察 · 低 · 非缺陷）服务器日文件 `2026-10-10.json` 的 `visits: 0`** —— 该日真实页面访问只有 3 条机器人（无真人访问），聚合结果正确。
8. **（观察 · 低 · 非缺陷）发布产物与仓库一致**：线上 `assets/*.js` 的 hash 与本地 `website/dist/` 完全对应，站点已随本迭代构建产物部署（含 `go.html`），且 `logo.png` / `police-badge.png` / `screenshots/` 都源自 `website/public/`（**不是手工落在服务器上的孤儿文件**），整目录替换式发布不会丢它们。

---

## 六、补充验证 · S-189 / S-190（2026-10-12，主会话执行）

> 背景：S-189 / S-190 是 2026-10-12 追加的需求，晚于上文阶段六报告。按老大当日裁定「**S-190 的审查与验证主会话自己做，不再派子 agent**」，本节由主会话在完成审查 ⚠️ 修复后直接验证，证据口径与上文一致：能跑必须跑、必须有工具证据。
> 范围：工作区**未提交**改动（S-189 夹具修复 + S-190 全部改动）；分支 `dev/v2-iter-39`，HEAD `66651053`（S-189 源码刀）。

### 6.1 门禁（本轮现场复跑）

环境前置：按 `ExecutablePath` 过滤，仓库内**无** electron / `WishfulClaw.Worker` 进程命中（本机仅有打包版 `C:\Program Files\WishfulClaw\...`，不锁仓库 `bin\`）⇒ 门禁可跑。

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `npm run typecheck` | **0 错误** | `typecheck:node` / `typecheck:web` 静默通过，`EXIT=0` |
| `npm test` | **68 / 68 通过**（TS 51 + C# 17） | 汇总行 `68/68 通过`；`ProviderHeader` 通过（内含 S-190 新增 NULL 哨兵断言）；`SessionTaskCascade 229 assertions` 通过（含 S-189 夹具 `scope TEXT`） |
| `dotnet build src/runtime/WishfulClaw.sln` | **0 警告 0 错误** | `已成功生成。0 个警告 0 个错误` |

⇒ 与 §一 基线一致，**无回归**。

**订正（`plan-s190/plan.md` 步骤 2）**：计划写「C# 用例数**由 17 增加**」，**实际未增加套件数** —— S-190 的 C# 断言以 `RunDetailFilterNullSuite()` 并入既有 `ProviderHeader` 套件（`UsageLogChecks.Queries.cs:182`，由 `RunDetailQuerySuite()` 调用），C# 套件**仍 17 个**、总数仍 **68**。计划文本按实现回填。

### 6.2 S-189（PM 建会话后首次派发失败）

**静态一致性（逐条对账 `requirements/S-189.md`）**

- `AgentRuntimeProjectExecutor.cs` → `CreateSessionAsync` 的 `SessionEntity` 补 `Scope = "project"` 并写进 INSERT（只补 `scope` 一列）。
- `DbGlobalTaskDispatchTools.cs` → 派发校验由 `scope = 'project'` 改 `project_id IS NOT NULL`（两段式判定为**既有结构**，本刀只改 WHERE 一行）。
- `DbPluginSessionTools.cs:159` → 同类旁路（`CreatePluginSession`）同步补 `scope`，值 `projectId is not null ? "project" : "global"`；`:164` 注释已订正为「与 `DbPluginSessionRouting:69` 同口径；`DbSessionTools.Create` 的 scope 由渲染端传入，不在此参照」。
- **夹具**（审查 ❌#1 修复）：`tests/WishfulClaw.SessionTaskCascadeRegressionTests/CreateSessionInsertTests.cs` 的 `CREATE TABLE sessions (...)` 补 `scope TEXT` —— 对齐 `DbClient.cs:92` 的建表形态（`scope` 是 `DbClient.cs:535` `EnsureColumn("sessions","scope","TEXT")` 补的**可空列**）。**该套件本机跑绿**（229 assertions），改造前会撞 `no such column: scope`。

**BOM 噪音修复（本轮）**：审查阶段改完 `DbPluginSessionTools.cs` 的注释后，该文件的 UTF-8 BOM 被一并抹去（`-﻿/*` → `+/*`），diff 里多出一行与需求无关的改动。已用 `UTF8Encoding($true)` 原样补回 ⇒ `git diff` 现在**只剩注释那两行**。（该项目多数 C# 文件无 BOM（548/613），但此文件在 HEAD 里自带 BOM，按「最小 diff」保持原样。）

**未验**：全局 PM 真实会话里「建会话 → 首次派发」端到端（见 §6.4）。

### 6.3 S-190（用量统计 · 请求明细筛选）

**参数契约（前后端逐字符核对）**

| 项 | 前端 | 后端 | 结论 |
|---|---|---|---|
| 模型键分隔符 | `MODEL_FILTER_SEP = '\u001F'`（`usage-detail-filters.tsx:51`） | `models[i].Split('\u001F', 2)`（`DbUsageLogQueryTools.Filters.cs:43`） | ✅ 零歧义一致 |
| NULL 哨兵 | `UNKNOWN_MODEL_LABEL = '(unknown)'`（`:57`） | `COALESCE(...)` 同字面量 | ✅ 能命中 NULL 行 |
| 参数名 | `params.models` / `params.status` / `params.httpStatusCodes`（`UsagePanel.tsx` `requestUsageLogs`） | `JsonHelpers.GetStringArray(parameters, "models"/"status"/"httpStatusCodes")` | ✅ 三个名字全对得上 |
| 状态码切分 | `parseHttpStatusCodes`：按 `[\s,]+` 切、去空；空 ⇒ **不发该参数** | `int.TryParse`，解析失败项**丢弃不报错** | ✅ 契约层 `string[]`，UI 层是单行文本框，二者不矛盾（`plan.md` 已钉死） |

**共用 WHERE（本需求最易回归的点）**

- `DbUsageLogQueryTools.cs:266` `var detailWhere = BuildDetailWhere(parameters, window, filterArgs);`，随后 `:270`（`COUNT(*)`）与 `:285`（明细查询）**共用同一个 `detailWhere` + 同批参数** ⇒ `total` 与 `rows` 口径一致，翻页不会飘。✅

**作用范围（13:42 口径）**

- `git diff UsagePanel.tsx` 逐行核对：上方 4 个统计端点调用（`db/usage-overview` / `db/usage-buckets` / `db/usage-model-buckets` / `db/usage-by-model`）**参数一行未动**；筛选经 `filtersRef` 传入 `requestUsageLogs`，`load()` 未被筛选触发（刻意不把 `filters` 塞进依赖）。改筛选只做三件事：`setFilters` + 页码归零 + `loadLogsPage(...)`。✅
- `handleFiltersChange` 只重取明细页，**不碰上方 4 个端点**。✅

**C# 侧 NULL 哨兵与拆分**

- `DbUsageLogQueryTools.cs` 现 **405 行**（原超 500 行规格）⇒ 按 `dev-workflow.md` §阶段四拆出两个 `partial` 文件：`DbUsageLogQueryTools.Filters.cs`（101 行，`BuildDetailWhere` + 哨兵）、`DbUsageLogQueryTools.Window.cs`（114 行，窗口/桶常量与助手）。行为等价，无功能变化。✅
- 渲染端同类拆分：`usage-detail-filters.tsx`（271 行，三控件 + 解析助手）、`usage-panel-types.ts`（66 行，面板 DTO）；`UsagePanel.tsx`（459 行）、`usage-detail-table.tsx`（438 行）均在区间内。（`UsagePanelParts.tsx` 585 行是**既有文件**，本刀只改一行 import 来源，未扩张。）

**i18n**

- 中英 `usage.detail.filters` 各 **11 键**，键路径零差异（`model` / `modelCount` / `modelSearch` / `modelEmpty` / `status` / `statusCount` / `statusSuccess` / `statusError` / `onlyFailed` / `httpStatusPlaceholder` / `httpStatusHint`）；`git diff` 两个 json 各自只**新增** 13 行（含括号），无既有键改动。✅

**未验**：全部 UI 交互（见 §6.4）。

### 6.4 追加的待实机项（S-189 / S-190）

12. **S-190 的筛选 UI 交互**（`S-190.md` §六 7 项 + 1 项补充）
    验什么：选模型 / 「只看失败」/ 状态码输入 / **三项叠加** / 翻页保持筛选 / 清空回全量 / 筛到 0 条出空态；**外加「切到按模型图确认上方数字未受影响」**（验证 13:42 口径在真机成立）。
    怎么验：起 `npm run dev:full` → 设置 · 用量统计 → 请求明细 → 依次操作工具栏三个控件。

13. **S-189 的跨端端到端**
    验什么：全局 PM 会话里调 `create_session` 建项目会话，**紧接着首次派发任务**是否成功（改造前必失败，报「不是项目会话」）。
    怎么验：实机起全局 PM → 建项目会话 → 立刻派活；并顺带确认新建 `sessions` 行 `scope = 'project'`。

### 6.5 本节小结

- **门禁**：`typecheck` 0 错误 / `npm test` 68/68 / `dotnet build sln` 0 警告 0 错误（复跑，与 §一 一致）。
- **S-189**：**PARTIAL** —— 3 处源码改动 + 夹具修复静态逐条对账，`SessionTaskCascade` 实跑通过；差跨端端到端。
- **S-190**：**PARTIAL** —— 参数契约 / 共用 WHERE / 作用范围 / NULL 哨兵 / i18n / 文件拆分**全部静态核对通过**；差全部 UI 交互。
- 两条**均无 FAIL、无阻断项**；待实机项 +2（§6.4 第 12 / 13 项）。

---

## 汇总

- **门禁**：`typecheck` 0 错误 / `npm test` 68/68 / `dotnet build sln` 0 警告 0 错误。
- **动态验证**：B1 PASS（产物 + 线上部署一致）、B2 6/6 断言 PASS + 真实日志逐日复算一致、B3 −23.0%（3 人格抽样无取向反转）、B4 PASS、B5 静态全绿 + `-uall` 实测有效、B6 静态结论「停后不会自动恢复派发」。
- **逐需求**：S-182 ~ S-190 **9 条全部 PARTIAL**（0 PASS / 0 FAIL）—— 静态与服务器侧能验的都验了、全过；差的是**实机 UI**、**外部下载链路**与**跨端 PM 桥路**的端到端兑现。
- **待实机/待服务器项**：**13 条**（§四 11 条 + §6.4 2 条）。
- **新发现问题**：8 条（其中 1 / 2 / 3 / 4 建议在收尾刀处理）。
- **补充（2026-10-12，S-189 / S-190）**：见 §六 —— 三门禁现场复跑全绿；S-189 / S-190 均 **PARTIAL**、无 FAIL、无阻断项。

---

## 七、补充验证 · S-191 / S-192 / S-193（2026-10-12 ~ 10-13）

> 背景：S-191 ~ S-193 是 10-12 ~ 10-13 追加的需求，晚于上文阶段六主报告。**这三条的验证报告各自落在需求目录下**，本节只做索引与总账，细节见各自文件。

| 编号 | 验证报告 | VERDICT | 门禁（现场复跑） | 待实机 |
|---|---|---|---|---|
| **S-191** | `plan-s191/verification_report.md` | **PARTIAL** | `typecheck` 0 错 / `npm test` **69/69** / `test:subagent-concurrency` **25 断言** / `dotnet build` 0 警告 0 错误 | E-1 ~ E-5：并发 3 个子 Agent 的卡片收敛与唤醒 / Worker 崩溃收敛 / 断连后重连自愈 |
| **S-192** | [`plan-s192/verification_report.md`](plan-s192/verification_report.md)（**2026-10-14 补记**） | **PASS** | 2026-10-14 现场复跑：`typecheck` 0 错 / `npm test` **71/71** / `dotnet build` 0 警告 0 错误 / 官网 `build` 0 错（当轮基线为 69/69，见下方漂移说明） | **已结清** —— 老大实机确认通过；另记 1 条**已知缺口**（悬浮窗停止不自动续，待裁定） |
| **S-193** | `plan-s193/verification_report.md` | **PARTIAL** | `typecheck` 0 错 / `npm test` **69/69** / `dotnet build` 0 警告 0 错误 | E-1 ~ E-6：**E-1** 重置归零（含切回 / 重启）/ **E-2** 消息与逐条摘要不变 / **E-3** 重置后只累计新增 ⇒ 三条为验收主干；E-4 ~ E-6 可选 |

**迭代总账（更新至 2026-10-13）**：12 条需求（S-182 ~ S-193）**全部 PARTIAL、0 PASS、0 FAIL、0 阻断项**；待实机/待服务器项 = 上文 **13 条**（§四 11 + §6.4 2）+ §七 三条需求各自的实机项。

**门禁基线漂移说明**：主报告 §一 / §六 记 `npm test` **68/68**，那是 S-191 之前的口径；S-191 新增 `tests/subagent-concurrency`（25 断言）后基线升为 **69/69**（TS 52 + C# 17），此后 S-192 / S-193 均按 **69/69** 复核。

**文档欠账（收尾刀处理）**：① ~~S-192 的验证结论未落盘，建议补 `plan-s192/verification_report.md`~~ —— **2026-10-14 已补记**（[`plan-s192/verification_report.md`](plan-s192/verification_report.md)，复核为 **PASS**）；② 本报告头部「范围 HEAD `f111da66`」为出报告时的快照，当前 HEAD 已远超该点，**迭代级审查 / 验证范围应以收尾时的 `2c925c88..HEAD` 重新表述**。

---

## 八、补充验证 · S-194 / S-195 / S-196（2026-10-13，主会话执行）

> 背景：S-194 ~ S-196 是 10-13 追加的最后三条。与 §六 同口径 —— 门禁由主会话现场复跑，静态核对逐条对账需求与计划正文，UI 交互留实机。
> 范围：`dev/v2-iter-39`，三刀 `f3eed21b`(S-194) / `5b65a231`(S-195) / `11699421`(S-196) 之后的 `HEAD`。
> 纪律：本节的验证**未改任何源码**（只写报告）；临时产物不落仓库。

### 8.1 门禁（本轮现场复跑）

环境前置：按 `ExecutablePath` 过滤，仓库内**无** electron / `WishfulClaw.Worker` 进程命中 ⇒ 门禁可跑（与 §一 / §六 一致）。

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `dotnet build src/runtime/WishfulClaw.sln` | **0 警告 0 错误** | `已成功生成。0 个警告 0 个错误`，`WishfulClaw.Worker -> …\bin\Debug\net11.0\WishfulClaw.Worker.dll` |
| `npm run typecheck` | **0 错误** | `typecheck:node` / `typecheck:web` 静默通过，`EXIT=0` |
| `npm test` | **70 / 70 通过**（TS 53 + C# 17） | 汇总行 `70/70 通过`；TS 侧含 **`ok test:token-format`**（S-194 新增套件）、`ok test:subagent-concurrency`、`ok test:renderable-chat-items`；C# 侧 17 套件全 `ok` |
| `cd website; npm run build` | **0 错误** | `✓ 296 modules transformed` / `✓ built in 322ms`；产物含 `dist/go.html`、`dist/download.html` 等 4 个 MPA 入口 |

⇒ 与 `plan.md` §四基线一致，**无回归**。门禁基线由 **69/69** 升为 **70/70**（S-194 新增 `tests/token-format`），此后按 70/70 复核。

### 8.2 S-194（token 显示统一 + G/T 单位）

- **收敛检查**：`lib/format-tokens.ts` 为仓内唯一实现；`UsagePanelParts.tsx` / `UsagePanel.tsx` / `usage-detail-table.tsx` / `TokenCounter.tsx` 均改为 import 它；`formatTokensDecimal` **全仓零引用**（已删）。
- **进位缺陷**：`999_600` 一类「取整后跨过 1000」的值按升档重算，不再出现 `1000k`。
- **单位阶梯**：`k` 小写、`M` / `G` / `T` 大写；`<1000` 输出整数原值不带单位；非有限值（`NaN` / `Infinity`）有防御。
- **测试**：`tests/token-format/program.ts` 现场跑 `ok 0.4s`，含「仓内只剩一份实现」的扫描断言。
- **未验**：三处**同屏对照**的实际观感（`1127.85M → 1.13G` 是否在三处一致）—— 见 §8.5 第 14 项。

### 8.3 S-195（工具卡片误判「失败」）

- **改法**：三处 `parseErrorMessage` 的兜底行 `return output.trim() || null` → `return null`（`DesktopActionToolCard.tsx` / `BrowserToolCard.tsx` / `ImagePluginToolCard.tsx`），错误判定权交回 `status` / `error` prop。
- **顺带**：`lib/app-plugin/desktop-routing.ts` 的 `isDesktopControlToolName` 由 `return false` 空壳改为按 `DESKTOP_*` 常量的 `Set` 查表 ⇒ `execution-outline.ts` 的 `'desktop'` 分类从不可达变为可达（折叠态过程摘要文案随之变化；**可见性不变** —— `desktop` 与 `unknown` 同属 force 类）。
- **同源未动**：`lib/app-plugin/browser-tool-names.ts` 的 `isBrowserToolName(_name) { return false }` 是同类空壳（同一提交 `d6228b27` 引入），本轮**刻意未动**，已记入 §五。**若它的不可达也会影响折叠态摘要文案，属同源遗留，需老大裁定是否补**。

  > **订正（2026-10-14，登记 S-199 时自查）**：**摘要文案不受影响** —— `process-summary.ts:29` 在 `switch (item.category)` **之前**已用 `startsWith('Browser')` 短路（`category === 'browser'` 全仓也无其它消费者）。真正的后果在**卡片**那条链：`tool-block-renderer.tsx:220` 被该空壳挡死 ⇒ `BrowserToolCard`（491 行）**从未渲染**，7 个浏览器工具全落通用 `ToolCallCard`。已另立 **S-199**（修法照 `desktop-routing.ts` 对称查表，属可见行为变化，等老大点头），详见 [`requirements/S-199.md`](requirements/S-199.md)。
- **未验**：桌面操作工具实机调用时卡片不再标红（见 §8.5 第 15 项）。

### 8.4 S-196（压缩后耗时 481h56m）

- **方案 B**：`lib/api/types.ts` 两处 `meta` 加 `cutAt?: number`；`adjustCompactArtifactTimestamps` 在改写 `createdAt` **之前**把 `max(boundary.createdAt, summary.createdAt)` 写进 `compactBoundary.cutAt` / `compactSummary.cutAt`。**动的是 `meta`（JSON 列），不是 DDL** ⇒ 无迁移，老数据读不到 `cutAt` 走兜底。
- **方案 A 兜底**：`renderable-chat-items.ts` 新增 `clampCutTime`，把切点夹进 `[message.createdAt, message.updatedAt]`（`updatedAt` 缺失只夹下界）⇒ 彻底杜绝「切点被拽回 20 天前」这种荒谬值。
- **段数补丁**：末段挂 `totalElapsedMs` 前先判 `wasSplit`（该 pair 是否真被切成 ≥2 段），为 `false` 时不挂「共 X」。
- **回归**：`npm run test:renderable-chat-items` 由 17 项升 **18 项**，新增 `testRelocatedArtifactCutTime` 三组断言（`cutAt` 优先 / 无 `cutAt` 时 clamp / 切点在开头不挂总耗时）。
- **代价（已接受，见需求 §六）**：老数据兜底后首段 `createdAt == updatedAt`，各段耗时趋同（「看着像重复」）—— 全库仅 3 条，且不夹的后果是显示 `481h56m`。**取舍口径：宁可想不起分段，也不能报出荒谬数字。**
- **未验**：压缩后操作栏的时间串实机观感（见 §8.5 第 16 项）。

### 8.5 追加的待实机项（S-194 / S-195 / S-196）

14. **S-194 · 三处显示对照**
    验什么：同一会话的 token 数在 ①上下文环 ②输入框下方 ③设置 · 用量统计 三处**串完全一致**；且大值走 `G`（如 `1.13G`）、后缀大小写统一（`k` 小写 / `M` `G` `T` 大写）、`<1000` 不带单位。
    怎么验：起 `npm run dev:full`，挑一个 token 数大的长会话，三处对一眼；再在设置页找一个六位以上数值看单位。

15. **S-195 · 工具卡片不标红**
    验什么：调用桌面操作工具（截图 / 窗口操作）时，卡片**不再显示「失败」**，且下方返回数据照旧可见（改造前是「上面红字失败、下面数据成功」）。
    怎么验：让 agent 调一次桌面操作工具，看卡片标题栏状态。

16. **S-196 · 压缩后耗时**
    验什么：在上下文接近压缩点时发一条消息 → 触发压缩 → 压缩后那段消息的耗时**不再是几百小时**；各段耗时读数合理。
    怎么验：把上下文压到接近阈值（或调低阈值），发一条消息触发压缩，看操作栏时间串。

### 8.6 本节小结

- **门禁**：`typecheck` 0 错误 / `npm test` **70/70**（TS 53 + C# 17）/ `dotnet build sln` 0 警告 0 错误 / 官网 `build` 0 错误 —— **四道全绿，无回归**。
- **S-194 / S-195 / S-196**：三条均判 **PARTIAL** —— 静态改动逐条对账通过、套件实跑通过；差的是**同屏观感**与**触发式实机行为**（UI 验证属老大分工）。
- **待实机项 +3**（第 14 / 15 / 16 项）。
- **迭代总账更新**：15 条需求（S-182 ~ S-196）**15 条全部 PARTIAL、0 PASS、0 FAIL、0 阻断项**。

---

## 九、补充验证 · S-197 / S-198 / S-199（2026-10-14，索引与总账刷新）

> 背景：S-197 ~ S-199 是 10-14 追加 / 补登记的收尾三条。**S-197 的验证报告落在需求目录下**；S-198 经老大裁定**免验**；S-199 **尚未开工** ⇒ 本节只做索引与总账刷新。

| 编号 | 验证报告 | VERDICT | 门禁（现场复跑） | 待实机 |
|---|---|---|---|---|
| **S-197** | [`plan-s197/verification_report.md`](plan-s197/verification_report.md) | **PARTIAL** | `typecheck` 0 错 / `npm test` **71/71** / `dotnet build` 0 警告 0 错误 | 实机 9 项 —— 其中 **E-2「运行中 `Running {{tool}}` 期间仍走表」最关键** |
| **S-198** | —（**免验**） | **N/A** | 老大 2026-10-14 08:20 裁定：**单纯改内置地址**，不走阶段五 / 六；另有 `npm run test:provider-presets` 现场复跑 **562 断言 / 46 presets，EXIT=0** 作护栏 | 无 |
| **S-199** | —（**未开工**） | **N/A** | 等老大点头后走完整六阶段 | — |

**迭代总账（更新至 2026-10-14）**：已实施 **17** 条（S-182 ~ S-198）—— **PASS 1**（S-192，老大实机确认）/ **PARTIAL 15**（S-182 ~ S-196 **除 S-192** ⇒ 14 条，**加 S-197**）/ **N/A 1**（S-198 免验）/ **FAIL 0** / **阻断项 0**；另 **S-199 待开工**。

**门禁基线（截至 §九 时点）**：`npm test` **71 / 71**（TS 54 + C# 17）。漂移链：**68/68 → 69/69（S-191 加 `subagent-concurrency`）→ 70/70（S-194 加 `token-format`）→ 71/71（S-197 加 `composer-status-elapsed`）**。

---

## 十、补充验证 · S-200 / S-201 / S-202（2026-10-14，收尾轮）

> 背景：S-200 ~ S-202 是 10-14 追加 / 事后补登记的三条。**三份验证报告各自落在需求目录下** —— S-200 由独立 subagent（`test-automator`）执行，S-201 由独立 subagent 执行，S-202 由主会话执行。本节只做索引与总账刷新。

| 编号 | 验证报告 | VERDICT | 门禁（现场复跑） | 待实机 |
|---|---|---|---|---|
| **S-200** | [`plan-s200/verification_report.md`](plan-s200/verification_report.md) | **PASS** | `dotnet build` 0 警 0 错 + 本套件 **37/37**（判据 8 其余 3 腿按指示未跑，由本节门禁补足） | 无 |
| **S-201** | [`plan-s201/verification_report.md`](plan-s201/verification_report.md) | **PARTIAL** | `typecheck` 0 错 / `npm test` **72/72** / `dotnet build` 0 警 0 错；加载层 27/27 断言 + 反向验证 PASS | 实机项待老大（该报告 V-5） |
| **S-202** | [`plan-s202/verification_report.md`](plan-s202/verification_report.md) | **PASS** | **四绿**（typecheck 0 错 / `npm test` **72/72** / `dotnet build` 0 警 0 错 / 官网 build 0 错） | 无（判据 1 老大 15:41 真机确认「真机测试可以了」） |

**迭代总账（终值，2026-10-14）**：登记 **21** 条 / 已实施 **20** 条（S-182 ~ S-198 + S-200 ~ S-202）—— **PASS 3**（S-192 老大实机 / S-200 / S-202）/ **PARTIAL 16**（S-182 ~ S-191、S-193 ~ S-197、S-201）/ **N/A 1**（S-198 免验）/ **FAIL 0** / **阻断项 0**；另 **S-199 待开工**（唯一未开工项）。

**门禁基线终值**：`npm test` **72 / 72**（TS 54 + C# 18）。漂移链：**68/68 → 69/69（S-191 加 `subagent-concurrency`）→ 70/70（S-194 加 `token-format`）→ 71/71（S-197 加 `composer-status-elapsed`）→ 72/72（S-200 加 `SearchToolTarget`）**。本轮四绿现场复跑：`typecheck` 0 错 / `npm test` **72/72** / `dotnet build src/runtime/WishfulClaw.sln` **0 警告 0 错误** / `cd website; npm run build` **0 错**。

**待实机项累计**：**16 条**（§四 11 + §6.4 2 + §7 三条需求的实机项 + §8.5 3）—— 本条（§十）三条需求中 S-200 / S-202 无待实机项，S-201 的实机项并入上述累计。

