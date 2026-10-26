# v3-iter-1 裁定与口径变更流水

> 按日期追加。跨需求的裁定写这里；单需求正文只保留「老大裁定（日期）」小节与结论。
> 每条格式：`日期 · 需求 · 议题 → 结论（原话摘要）`

---

## 2026-10-22

### 08:24 — 08:33 · S-217 · 需求定性与范围

- 老大提出：更新安装时每次都要选「所有用户 / 当前用户」和路径，能否沿用历史值。
- **08:30 收敛诉求**：「我的意思就是能默认值加载历史路径就行」→ **只要求默认值沿用，不要求跳过页面本身**。
- **08:33 补充背景**：用户反映选过自定义路径，更新时又回默认路径；这是历史遗留，此前一直没管，**老大本人也不确定问题是否真实存在**。
- 处置：登记 S-217，分现象 A（范围页跳不过，确定）/ B（改选导致换家 + 双安装，确定）/ C（未改选仍回落，**未确认**）三种，实施前需真机复现定性 C。

### 09:23 · S-218 · UI 落点

- 原话：「UI落点不对，这个实际上是AI服务商  只是是反代服务商」
- 结论：**走现有 `BuiltinProviderPreset` 体系，不新建渠道概念、不新增 provider `type`**，继续 `openai-chat` + `providerBuiltinId: "workbuddy"`。

### 15:40 · S-218 · 设置页落点

- 原话：「页面的话设置页现在跟它不是很搭 可以考虑新启一个授权AI服务商」
- 结论：**新增「授权 AI 服务商」tab**；Codex / Copilot / Moonshot 一并迁；模型管理 / 回退不跟着分（跨服务商，拆开会割裂）。
- 判据：`AI 服务商` = `authMode !== 'oauth'`；`授权 AI 服务商` = `authMode === 'oauth'`。**不能用 `requiresApiKey === false`**（`ollama` / `lmstudio` 无 `authMode`，会被误分）。

### 15:55 · S-218 · 四条议题裁定（「根据你的推荐来」）

| # | 议题 | 裁定 |
|---|---|---|
| 1 | 自动签到触发时刻 | 见 16:09（后被推翻重定） |
| 2 | `/v3/config` 拉不到 | **静默落兜底表 + 服务商卡片小字「模型清单以本地内置为准」** |
| 3 | `X-Conversation-*` 映射 | 直接复用现有 `sessionId` 作 `convKey` 的 `session:` 分支 |
| 4 | 设置页落点 | 新增「授权 AI 服务商」tab（同 15:40） |

### 16:09 · S-218 · 签到定时（两次推翻后的最终口径）

- 原话：「**8点以后触发签到 随机个几分钟发送签到请求**」；「简单明了，就按这个来。我原来那套『跟随真实对话』现在是多余的，撤掉。」
- **被推翻的方案（不实现）**：
  1. 「当日首次启动后延迟 90 秒」—— 老大：「我们软件的初衷是 **24 小时不关机 不启动**，你这个跟我们冲突」
  2. 「常驻定时器 + `00:30 + hash(北京日期) % 90 分钟`」—— 落到 00:30~01:59 窄窗口，30 天全挤同一窗口，比随机更易识别
  3. 「跟随真实流量」（有对话→结束后随机 2~15 min；无对话→08:00~23:30 随机抽点）—— 全部撤销
- **最终行为**：8:00 后随机等 1~30 分钟发签到；当天已签则跳过；每分钟 tick 检查（能自愈睡眠唤醒）；判定按固定 UTC+8；定时器跑主进程（多窗口会重复签到）。

### 16:20 · S-219 · 登记

- 老大：「没有其它进程，只有你自己在改，这种异步修改同一个文件，有解决方案没，需要登记一个优化需求不」→「**登记**」。
- 定性：**缺陷（工具健壮性）**，非体验优化。

### 17:46 — 17:56 · S-220 · 登记与口径三次收敛

| 时刻 | 内容 | 影响 |
|---|---|---|
| 17:46 | 「手输地址跳转又是旧结构，感觉加载到缓存了」 | 登记 S-220，初版判断为「reload 吃缓存」 |
| 17:49 | 「我测试的是localhost」 | 排除 `file://` 路径 |
| 17:50 | 「**刷新是好的**，刷新以后能看到是新内容，但是地址栏手输地址跳转 又是加载旧缓存」 | **推翻初版判断**：刷新走 `reload()`（重验证）正常，导航走 `loadURL`（遵守缓存头）中招 |
| 17:52 | 「我的意思是**顶部的刷新点击以后可以强制刷新缓存**不 诉求是这个」 | 口径收敛：**只做刷新按钮硬刷新**，session 层拦截降为备选 |
| 17:56 | 「点击刷新后就是新内容了，下次进来是点击刷新后的缓存也是能接受的」 | **放弃 session 层 host 拦截**，不做 per-host 缓存策略 |

---

## 2026-10-23

### 08:47 · 全迭代 · 进入实施态

- 老大：「根据工作流推进，缺步骤的补充文档，还有其它登记的需求一起也推进了」
- 判为**实施态**：补 `plan.md` / `changelog.md`（`PROGRESS.md` 留到收尾），四条需求依次推进。
- 刀序：S-220 → S-219 → S-217 → S-218。

### 09:59 · 全迭代 · 补流程产物（老大指出跳了工作流）

- 老大：「查看 agents.md 找到工作流，你之前做的那些需求跳流程了，补一下」
- 实情：四条需求直接进了实施，**阶段一（探索态）无产物、阶段三（合规检查）与阶段五（独立审查）未做**，`plan-s218/` 只有事后补写的 `plan.md`。
- 补做：`exploration_findings.md`（新建，六条需求勘察结论汇总）、`plan-s218/compliance_report.md`、`review_report.md`、`plan-s218/verification_report.md`（重写）。
- **阶段五审查判 ❌ 8 条**，全部必修 —— 详见 `review_report.md`。最重的一条是 S-219 锁范围错了。

### 10:20 · S-219 · 锁范围从「只锁写」提到「读 → 改 → 写」事务级

- 审查 ❌1/❌2：首版 `WriteGates` 只包住 `WriteAndFlushAsync`，而 `Edit` 的读（`FileEditTool.cs:55`）在锁外 ⇒ 并发 Edit 各读旧内容、后写整文件覆盖，**改动静默丢失**。
- 这比修复前更糟：原来第二个写者报 `IO_SharingViolation_File`，用户知道重试；加锁后两个都「成功」，只是丢了一处改动。
- 修：`ToolHelpers.WithWriteGateAsync`（无返回值 + 泛型两个重载），`WriteAndFlushAsync` 改薄封装，`WriteWithSharingRetryAsync` 提为 `internal` 供锁内落盘（锁内不得再调 `WriteAndFlushAsync`，同路径会自锁死）。三个读改写工具整段入锁：`FileEditTool` / `MemoryHotWriteTool` / `AgentRuntimeNotebookEditExecutor`。`FileWriteTool` 是纯覆盖写，不需要改。
- 实施过程中真机复现两次 `IO_SharingViolation_File`（并发两个 `Edit` 打同一文件）—— 因为运行中的生产实例加载的仍是修复前二进制，这反过来印证了旧行为「报错不丢数据」。

### 10:35 · S-218 · 三项必修（风险口径 + token 续期 + expiresAt）

- ❌4 §5.1：`ProviderAuthPanel.tsx` 面板顶部写死风险块（非官方接入 / 腾讯可限制账号 / 勾选确认），未勾选时「登录」按钮 `disabled`。**不折叠**，直接放在页面上。
- ❌5 §5.2：服务商名后加琥珀色「第三方」角标，与「已连接」绿标视觉区分。
- ❌6 自动签到无续期：主进程加 `tokenStale`（到期前 5 分钟）/ `expiresAtOf` / `renewTokenIfStale`，签到前先续期并**回写 provider store**（否则下一 tick 又读旧 token），`pressCheckin` 改为接收 `accessToken` 参数。原来过夜后 8:00 必 401 且当天彻底放弃。
- ❌7 `expiresAt` 解析：渲染端抽 `resolveExpiresAt`（先认绝对 `expiresAt`，10 位当秒、13 位当毫秒；再认 `expiresIn`/`expires_in`/`expires`），两处调用点统一；主进程同口径。原来只认 `expiresIn` ⇒ 回 `expiresAt` 时落成 `undefined` ⇒ `if (expiresAt && …)` 短路 ⇒ 永久不续期。
- i18n 补 6 键（`thirdParty` / `riskTitle` / `riskUnofficial` / `riskRestrict` / `riskAcknowledge` / `riskRequired`），zh/en 各一份。

### 10:45 · 全迭代 · 500 行豁免（本轮改动过的越线文件 2 个）

- `BrowserPanel.tsx` 515 行、`shared/types/provider.ts` 505 行，原先都只有普通文件头注释，补 500 行豁免头。
- 分类：`BrowserPanel` 第 5 条第 3 类（单一组件，拆出去要搬 `navigationSeq` / `committedUrl` 等 state）；`provider.ts` 第 5 条第 1 类（同质类型表）。
- 行数实测与注释一致。

### 10:50 · 全迭代 · 第二轮门禁复跑

- `npx tsc --noEmit` web / node 双配置 **0 错**；`dotnet build src\runtime\WishfulClaw.sln` **0 警告 0 错误**；`npm test` **78/78**；`cd website; npm run build` **0 错误**。
- 真机验证仍未做（四条需求全部待老大补），S-218 真实账号链路未跑。

### 11:05 · 全迭代 · 三条需求的阶段二/三/五/六产物补齐

- 老大：「你只补了一个需求的，其它做的也一并都补上流程」
- 实情：09:59 那轮只给 S-218 开了 `plan-s218/`（含 plan / 合规 / 审查 / 验证），S-217 / S-219 / S-220 只有 `requirements/` 正文与迭代级总表，**单需求目录缺四份**。
- 补做：`plan-s217/`、`plan-s219/`、`plan-s220/` 各四份（`plan.md` / `compliance_report.md` / `review_report.md` / `verification_report.md`）。
- **按需求回溯检查，查出三条规划态的问题，全部保留在文档里**：
  - **S-219 ❌1**：§5 明写「读 → 改 → 写整段入锁」，但步骤表只写到 `WriteAndFlushAsync` 加锁，三个读改写调用方无人认领 ⇒ 阶段五判「核心目标未达成」。**方案对、步骤没承接**，这是本轮最该记的一条。
  - **S-220 ❌2**：首版把根因判成「`reload()` 吃缓存」，上 session 层拦截 + 导航重构；实测早已证明刷新正常，一行替换即可。教训是**写方案前没做一分钟对照实验**。
  - **S-217 ⚠️3**：钩子逻辑正确，但漏了「已双装机器」与「构建配置依赖」两条边界；另缺真实 `electron-builder --win` 打包（宏是否真被插入无证据）。
- 三条需求的验证结论均为 **PARTIAL**：编译 / 类型门禁全过，真机行为全部未验。
- 产物挂载：`plan.md §二` 需求索引加「六阶段产物」列；`raw-requirements.md` 补 plan-s 链接、S-218 状态由「实施中」改为「已实施（缺口 §10.3，真账号待验）」。
- **大文件行数实测复核**（`Measure-Object -Line` 不计空行，会低估）：`BrowserPanel.tsx` 515（豁免头一致）、`shared/types/provider.ts` 505（一致）、`ToolHelpers.cs` 342、`FileEditTool.cs` 134、`MemoryHotWriteTool.cs` 227、`build/installer.nsh` 16。

### 11:14 · S-221 · 六阶段全程走完（阶段三三轮 / 阶段五 ❌0）

- **阶段三三轮**：首轮 ❌1 / ⚠️6 → 二轮 ❌2 → **三轮 ❌0 / ⚠️6 / ✅11，判定可进入阶段四**。三轮拉锯的核心只有两条：① `frame` 不复位会让高亮冻在首帧（伪代码漏了「声明 / 复位 / 首帧」三要素）；② 需求正文的口径必须跟 plan 一起改，否则「按需求实现」会写出不合验收的代码。
- **阶段三最值钱的一条**（第三轮 ⚠️-新2）：`[writing-mode:vertical-rl]` 下块流方向是**右→左**，裸 `<li>` 会排成 7 列「书脊」≈110px 宽、压进正文 ≈70px；必须给 `ul` 显式 `flex`（**`flex-col` 同样错**，仍走块轴）。这条写进 plan §十 后，实施一次到位。
- **阶段四实施**：`section-rail.tsx` 新建 100 行、`site.ts` +15（`sectionRail` 常量）、`App.tsx` +6（零高 `#top` + 挂载）。`hero.tsx` / `index.css` 零改动。
- **阶段五 ❌0 / ⚠️6 / ✅18**，判定可进入阶段六。其中**唯一行为缺陷已修**：只订阅 `scroll` / `resize`，features 切 tab、手风琴展开、图片加载都会移动板块边界却不发 `scroll` ⇒ 高亮停在旧值；补 `ResizeObserver(document.body)` 复用同一 rAF（步骤 9b）。
- **行数记账翻车一次**：PowerShell `(Get-Content f).Count` 对无 BOM 的 UTF-8 文件数出 **86**，实际 **100**（`split('\n')` 得 101 行含末尾空行）。**以后核行数只信 node `split` 或 `[IO.File]::ReadAllLines().Count`，别用 `Get-Content`** —— 这与 10:23 记的「`Measure-Object -Line` 不计空行」是两个坑。
- **行号漂移**：`site.ts` 插入 15 行后，全部既有引用 +15（`:176→:191`、`:84→:99`、`:218→:233`、`:242→:257`、`:150→:165`）；`App.tsx` 区块 `:27-33` → `:33-39`。plan 与需求正文已同步，并在 plan §二 加了一句「日后按符号名 grep，别信数字」。

### 11:35 · S-222 · 六阶段全程走完（阶段五 ❌0 / 阶段六 PARTIAL）

- **阶段四实施**（提交 `455eb8db`）：新增 `lib/utils/chat-time.ts`（35 行）+ `tests/chat-time/program.ts`（24 assertions）+ `package.json:55` 挂 `test:chat-time`；三处落点统一 —— `chat/UserMessage.tsx:244`、`chat/AssistantMessage/action-bar.tsx:19/:159-171`、`chat/ContextCompressionMessage.tsx`。
- **规则**：今日只 `HH:MM`，非今日 `MM-DD HH:MM`，跨年 `YYYY-MM-DD HH:MM`，无效值返回空串由调用方决定不渲染。活动面板 / 会话列表 / 用量明细三处**不动**（有回归断言）。
- **阶段五 ❌0 / ⚠️6 / ✅18**，六条 ⚠️ 全部收口：
  - ⚠️1（唯一行为缺陷）：`action-bar` 在「时刻无效且无耗时」时仍渲染空 `<p>`（留 6px）⇒ 渲染判据由 `finishedAt != null` 改为 `timeLine` 非空，计算提到组件顶层。
  - ⚠️3 / ⚠️4 / ⚠️6：测试补齐跨午夜只取一次 `now`、锁住「去年同月同日不能漏年份」的变异、补 `now` 非法断言（22 → 24 assertions）。
  - ⚠️2 / ⚠️5：卡片字符串层与英文面口径写进 `S-222.md §9` 与验证报告，属**明示取舍**而非遗漏。
- **阶段六 PARTIAL**：`npm run typecheck` 0 错、`npm test` **79/79**、`node tests/chat-time/out/program.cjs` 24 assertions 全过；真机步骤 11-12（消息流 / 压缩卡片）待老大过目。
- **预期副作用**（决策 3 的后果，已记录）：英文面时刻 `09:55 AM` → `09:55`；压缩卡片分隔符原本随 locale 变（`10/22`），现固定 `10-22`。

---

## 2026-10-26

### 16:25 · 全迭代 · 收尾（11 条需求归档 + 版本号升 1.0.1）

- **本迭代实到 11 条**：S-217 / S-218 / S-219 / S-220 / S-221 / S-222 / S-223 / S-224 / S-228 / S-229 / S-231。提交序列（`main..dev/v3-iter-1`）：
  `6c66de97` 代际切 v3 · `9342316f` S-220 · `7af2f77c` + `5fc0a6f0` S-219 · `5b92bed3` S-217 · `bbcb140b` S-218 · `402a109d` 阶段五审查 8 条 ❌ 修复 + 流程产物 · `455eb8db` S-222 · `ed7bf907` S-221 · `498d83a1` S-223 · `fb7b5beb` S-224 · `a6bdf221` S-228 · `add11d00` S-229 · `b2a2f1c0` S-231 · `d0b60bfb` S-218 补刀。
- **S-218 补刀**（`d0b60bfb`）：`lib/auth/*` 从 OpenCowork 移植时就调 `api:request`，但主进程从未注册 handler（2026-08-27 审计 `5faa16ba` 当死代码从 messagepack 白名单删掉）⇒ 每次落到裸 `ipcRenderer.invoke` 抛 `No handler registered`。新建 `src/main/ipc/api-request-handler.ts`（163 行）走 Chromium `net.request`，继承系统代理与证书策略，`useSystemProxy === false` 时强制 direct。风险确认从 checkbox 改为一次性 `Button`（确认后锁存、无取消入口）。
- **S-223 / S-224 / S-228 / S-229 / S-231 五条补做并归档**：dev 实例项目级目录改 `.wishful-claw-dev`（不迁移历史数据）；聊天图片落盘 `{dataRoot}/images/yyyy-MM/`、DB 只存路径；官网右下角回顶按钮；OAuth 预设投影补齐 10 个协议字段；运行时附加块（`<current_time>` / `<memory-*>`）改为后置。
- **S-230 Qoder 接入未做** —— 缺契约（端点 / 鉴权头 / 额度形态均无资料），不硬编，单列下个迭代。
- **门禁复跑全绿**：`npx tsc --noEmit` 三配置 0 错；`npm test` **83/83**；`dotnet build src\runtime\WishfulClaw.sln` 0 警告 0 错误；`cd website; npm run build` 0 错（358ms）。
- **版本号 1.0.0 → 1.0.1**：`package.json:3`、`package-lock.json` 两处（顶层 `version` 与 `packages[""].version`）、`README.md:19` 徽章。`AGENTS.md` 里出现的 `1.0.0` 是规则叙述与历史记录，不动。
- **文档归档**：`PROGRESS.md` 新增「v3 迭代（正式版）」小节 + `v3-iter-1` 行；新建 `docs/progress/v3-iter-1.md`；`plan.md §二` 需求索引补齐 S-224 / S-228 / S-229 / S-231 四行并刷新全部状态列。
- **遗留**：S-231 标题仍可能被截到附加块（第三方按长度截取，首段已干净）、S-217 待真机装包验、S-220 硬刷新待真机复验、S-224 落盘路径与 DB 一致性待真机验、`release/` 里 0.2.38 及更早产物待清理。

### 16:40 · 全迭代 · 发布 1.0.1（官网先发，软件随后）

- **官网先单独发一次**（老大 16:23 要求）：本迭代官网侧有 S-221 悬浮导航与 S-228 回顶两处真实改动 ⇒ 走 `deploy.mjs site`（默认带构建）。构建 274ms，2.4 MB 上传，服务器侧 `mv` 原子替换。抽查四路径全 200，证书剩 56 天。
- **新指纹核验**：线上首页引用 `back-to-top-CGUV-09h.js` / `src-Bs2wKFwP.js` / `index-DwL4IOkZ.js`，与本地构建产物一致，三个 chunk 单独 GET 均 200 —— 确认新内容真上线，不是旧缓存骗人。
- **git 收尾**：`main` 无分叉（`main..dev` 16 刀、`dev..main` 0 刀）⇒ `--no-ff` 合并得 `43d1bbdc`，打 annotated tag `v1.0.1`，直连推送 `main` + tag 均成功（未启用代理），删本地 `dev/v3-iter-1`。
- **打包**：`npm run pack:installer:full` 157 s，产出 `wishful-claw-1.0.1-setup.exe` 108.38 MB + blockmap。`app-update.yml` 确认 `provider: generic` → `https://wishful-claw.work/downloads/`；`latest.yml` 无 `releaseNotes` 字段（0.2.39 起的正常态）。
- **下载目录**：四件 108.5 MB 一次上传，逐件 sha512 校验通过，blockmap 自动保 5 版。
- **GitHub Release**：`gh release create` + 三件资产上传，`--json` 直读会坏（PowerShell 流带 BOM），改重定向后解析；确认 `isLatest` = v1.0.1、三件 state=uploaded。
- **核验一条容易翻车的**：`curl -o NUL` 查 108 MB 的 exe 会把整个包下下来（第一次核验就是这么超时的）—— 大文件一律 `-I` 只取状态码。
- **清理**：`release/` 删 0.2.38 / 0.2.39 / 1.0.0 六件（三个版本在 GitHub 均有 Release 存档），只剩 1.0.1 三件 + `win-unpacked/`，523 MB。`.wishful-claw/notes/` 删 19 个一次性草稿（提交消息、探针、测试视频），只留 release-notes 系列与设计稿。
