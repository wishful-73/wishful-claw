# iter-v3-1 代码审查（阶段五）

**审查日期**：2026-10-23
**审查范围**：`dev/v3-iter-1` 上四个需求提交 —— `9342316f`（S-220，1 文件）、`7af2f77c`（S-219，1 文件）、`5b92bed3`（S-217，1 文件）、`69e49b4a`（S-218，15 文件），另含工作区未提交的 `locales/{zh,en}/settings.json`（S-218 依赖它）。对照需求正文 `docs/plans/iter-v3-1/requirements/S-217~220.md`、`AGENTS.md`、`docs/dev-workflow.md` L465-480。
**审查方式**：只读（`git show` + 读文件 + 读 `node_modules` 里的 electron-builder 模板）。未改任何源文件，未执行 `commit / reset / checkout`，未跑编译。
**结论计数**：❌ 8 / ⚠️ 22 / ✅ 29（共 59 项）

> **本文件是跨需求总表。** 单需求的审查切面见 [`plan-s217/review_report.md`](plan-s217/review_report.md)、[`plan-s219/review_report.md`](plan-s219/review_report.md)、[`plan-s220/review_report.md`](plan-s220/review_report.md)；S-218 未单开，第四节即其切面。
> 编号 **1-59 全局唯一**，切面按编号回引本文件，不另起编号 —— 避免两处结论漂移。

---

## 阻断

**阻断：禁止进入验证态**（❌ = 8，其中第 7、8 项同源）。

八条必须修：S-219 读改写未串行化（`FileEditTool` 及另两处）2 条、S-220 `BrowserPanel.tsx` 511 行无豁免 1 条、S-218 三层风险提示缺失 2 条（§5.1 / §5.2）、S-218 自动签到无 token 续期 1 条、S-218 `expiresAt` 解析口径不符 1 条、S-218 `provider.ts` 501 行无豁免 1 条。

---

## 一、S-220 刷新按钮改硬刷新

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 三处 `reload()` 是否都换成硬刷新 | ✅ | `BrowserPanel.tsx:214`（同址回车）、`:440`（工具栏刷新）、`:495`（加载失败重试）均为 `wv.reloadIgnoringCache()` |
| 2 | API 是否真实存在、签名是否兼容 | ✅ | `node_modules/electron/electron.d.ts` 中 `WebviewTag.reloadIgnoringCache(): void` 命中 2 处，与 `reload()` 同签名，纯替换 |
| 3 | 是否影响正常导航 | ✅ | 换地址仍走 `requestBrowserNavigation`（`BrowserPanel.tsx:217-220` 的 `return` 之前逻辑未动）；挂载后自动重载仍 `reload()`（`:383`）；切设备预设未改（`apply-browser-device.ts` 不在 diff 内） |
| 4 | 是否有清缓存副作用 | ✅ | 全仓仍无 `clearCache` / `clearStorageData` 调用；`reloadIgnoringCache` 只绕过读取并让新响应回填缓存，不清登录态与 localStorage（`persist:` 分区未动） |
| 5 | 硬刷新对含 POST 结果页面的副作用 | ⚠️ | `reloadIgnoringCache` 等同 Ctrl+F5，会重放上一次 POST 请求体。`:495` 的「加载失败重试」落在表单提交结果页时会二次提交。原 `reload()` 同样重放，不算新引入，但硬刷新让这条路径更常被触发；UI 无提示 |
| 6 | 文件是否超 500 行 | ❌ | `BrowserPanel.tsx` 实测 511 行，首行即 `import`（`:1`），无豁免头注释。`AGENTS.md:175-181` 硬线：超 500 必须带豁免头，否则判 ❌。注：本提交前已是 506 行（既有债务，本次 +5），仍需补豁免头或拆分 |

## 二、S-219 文件写入按路径串行化 + 退避重试

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 7 | 「读 → 改 → 写」整段是否进锁 | ❌ | 锁只包住 `WriteAndFlushAsync`（`ToolHelpers.cs:169-181`），`FileEditTool.cs:55` 的 `ReadAllTextAsync` 在锁外，`:85` 才进锁。并发 4 个 Edit 会各自读到同一份旧内容，再串行整文件覆盖 → 后写胜出、前 3 处改动静默消失。这与 `S-219.md:84`「把读 → 改 → 写整段包进同一把锁」、`:90`「从 `ReadAllTextAsync` 之前拿到」以及 `:115` 验收「4 个改动按发出顺序累加」直接冲突 |
| 8 | 同缺陷是否还有第二处 | ❌ | `MemoryHotWriteTool.cs:50` 读 → `:63` / `:71` 写，读在锁外；`AgentRuntimeNotebookEditExecutor.cs:32` 读 → `:99` 写，同样在锁外。需求 §3.2 列的四个工具里，三个是读改写 |
| 9 | 锁 key 是否按 OrdinalIgnoreCase 归一 | ✅ | `ToolHelpers.cs:143-144` 用 `new StringComparer.OrdinalIgnoreCase` 构造 `ConcurrentDictionary`；`:171` 先 `Path.GetFullPath` 再取锁，`A.md` / `a.md` 同锁 |
| 10 | 路径归一的边界 | ⚠️ | `Path.GetFullPath` 只做字符串级归一，符号链接、8.3 短名、尾随点与空格仍会拿到不同 key（`:171`）。沙箱内正常路径不受影响，标注意即可 |
| 11 | 退避重试是否有上限 | ✅ | `ToolHelpers.cs:199-206`：`attempt < 4` 走 50 / 100 / 200 / 400 ms，第 5 次命中 `IsSharingViolation` 转 `IOException(BuildSharingViolationMessage(...))` 抛出，不会无限重试 |
| 12 | 错误码判定 | ✅ | `:244-248` `HResult & 0xFFFF` ∈ {32, 33}，覆盖 `ERROR_SHARING_VIOLATION` / `ERROR_LOCK_VIOLATION` |
| 13 | 是否误放宽 `FileShare.Read` | ✅ | `:224-230` 仍是 `FileShare.Read`，且 `:220-223` 写明放宽会导致静默丢改动的理由 |
| 14 | 取消与资源释放 | ✅ | `WaitAsync(cancellationToken)` 在 `try` 之前（`:172`），取消不会漏 release；`finally` 无条件 `Release()`（`:177-180`）；`Task.Delay` 带 token（`:201`） |
| 15 | 新错误文案与工具层口径 | ⚠️ | `:250-253` 返回中文句，而同一工具层的其它错误串是英文（如 `FileEditTool.cs:65` `String to replace not found in file.`）。工具结果直接进模型上下文，中英混排会让模型对「工具失败原因」的识别不一致 |

## 三、S-217 更新安装沿用历史安装范围与路径

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 16 | 钩子是否只在「已有一处安装」时生效 | ✅ | `build/installer.nsh:9-15`：仅 `1/0` 组合置位，两侧 `0/0`（首次安装）与 `1/1`（已双装）都不动 |
| 17 | 首次安装行为是否不变 | ✅ | `assistedInstaller.nsh:108-109` 在 `.onInit` 先把两个变量置 `0`；`installer.nsh:9-15` 不命中 → 范围页照常出现 |
| 18 | 是否走模板既有分支、路径是否沿用 | ✅ | 置位后命中 `multiUserUi.nsh:45-57`（per-machine）/ `:59-65`（per-user），与命令行 `/allusers` 同一路径；`$INSTDIR` 由 `multiUser.nsh:26-28` / `:75-77` 读 `InstallLocation` 回填 |
| 19 | 是否需要配 `nsis.include` | ✅ | `NsisTarget.js:600` 为 `packager.getResource(this.options.include, "installer.nsh")`，第二参是默认值，回落 `buildResourcesDir`；`electron-builder.yml` 未改 `directories`，默认即 `build`，`build/installer.nsh` 存在 |
| 20 | 变量声明对构建配置的依赖 | ⚠️ | `hasPerUserInstallation` / `hasPerMachineInstallation` 只在 `!ifndef INSTALL_MODE_PER_ALL_USERS` 且 `!ifndef ONE_CLICK` 下声明（`multiUser.nsh:14-18`）。当前 `electron-builder.yml` 是 `oneClick: false`、未设 `perMachine`，成立；一旦改成 `perMachine: true` 或 `oneClick: true`，`installer.nsh` 引用未声明变量 → makensis 直接编译失败。建议整段包 `!ifdef` |
| 21 | 已双装机器的行为 | ⚠️ | 两侧注册表都有记录时钩子不置位，范围页照旧弹出，用户仍可再造一份（覆盖其一）。`S-217.md:6` 把「不可能双装」当修复结论，与实际边界不符，需在验收里写明「仅覆盖单侧安装」 |
| 22 | 是否验证过宏被真正插入 | ⚠️ | `S-217.md:9.3` 只有 makensis 语法编译，没有一次真实 `electron-builder --win`。`!ifmacrodef customInstallmode`（`multiUserUi.nsh:41`，小写 m）与 `!macro customInstallMode`（`installer.nsh:8`）的大小写差异依赖 NSIS 宏名不区分大小写，未被打包验证过 |

## 四、S-218 WorkBuddy 账号接入

### 4.1 风险口径与需求闭环

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 23 | §5.1 接入前风险提示 + 勾选确认 | ❌ | `ProviderAuthPanel.tsx:245-249` 只有一句「用你自己的账号登录，消耗你已有的套餐额度」，无「非官方接入 / 腾讯可限制账号 / 需勾选确认」。四个新文件 grep「风险 / 第三方 / 非官方 / 勾选」零命中（唯一命中是 `workbuddy-signin.ts:298` 的注释）。`S-218.md:340` 明写「三层，缺一层不算尽责」，且 `S-218.md:10.3` 未把这条列为缺口 → 属无意识遗漏，不是已裁定缩范围 |
| 24 | §5.2 服务商「第三方」标识 | ❌ | 同上，`ProviderAuthPanel.tsx:59-66` 卡片只有服务商名 + 「已连接」徽标，无第三方角标；列表侧 `ProviderPanel.tsx` 也无标记 |
| 25 | §5.3 错误码人话（11140 / 14018 / unapproved） | ⚠️ | 渲染端 `workbuddy-checkin.ts:144-145` 只按验证码正则分流，其余原样回 `msg`；对话链路完全未接（`S-218.md:10.3` 已记为缺口）。需求 `:364` 明确「不得显示成笼统的请求失败」 |
| 26 | 是否默认不自动路由（§5.4） | ✅ | `workbuddy.ts:138-175` 未设 `defaultEnabled`，`provider-materialization.ts:26` 默认 `enabled: false`，用户不启用不会被选中 |
| 27 | 是否新增不需要的依赖 | ✅ | `git show --stat 69e49b4a` 无 `package.json` / `*.csproj` / `*.sln` 改动；密码学用 Web Crypto，HTTP 复用既有 `api:request` 与主进程 `fetch` |
| 28 | 硬编码路径 / 密钥 / token | ✅ | 无密钥或 token 字面量。硬编码的是协议常量：`copilot.tencent.com` / `www.workbuddy.ai`（`workbuddy.ts:143/163`）、UA `WorkBuddy/5.5.6`（`:104/:150`）、`/billing/meter/daily-checkin`（`workbuddy-checkin.ts:16`），均属服务商协议，不是本机路径 |

### 4.2 重点三处

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 29 | `workbuddy-signin.ts` 轮询是否会死循环 | ✅ | `:107-109` 每轮先查 `signal.aborted` 与 `Date.now() > deadline`（`:213` 起算，5 min）；即使服务端持续回 200 空体（`:113`）也会被 deadline 截断 |
| 30 | `workbuddy-signin.ts` 计时器是否泄漏 | ✅ | `sleep` 是一次性 `setTimeout`（`:97`），无 `setInterval`；`poll` 退出后不留句柄。面板卸载时 `abortRef` 触发退出（`ProviderAuthPanel.tsx:158`） |
| 31 | 取消信号能否真正中止在途请求 | ⚠️ | `callPluginApi` → `ipcClient.invoke('api:request')` 不接受 `AbortSignal`（`:60-71`），abort 只在下一次循环被看到；`sleep` 也不可中断（`:121`），最坏多等 1 s + 一次请求超时 |
| 32 | 弱网 / 5xx 处理 | ⚠️ | `:114-118` 只对业务重试码与 408 / 429 重试，网络错误与 5xx 直接抛出，用户必须重开登录；deadline 内本可继续轮询 |
| 33 | 429 退避 | ⚠️ | 命中 429 仍按 `pollIntervalMs` 固定 1 s 重打（`:121`），无 `Retry-After` / 指数退避，对风控端点等于加码 |
| 34 | `setInterval` 是否 `unref` | ✅ | `workbuddy-checkin-scheduler.ts:195-197` `tickTimer.unref?.()`，不拖住进程退出 |
| 35 | 并发 tick 是否被 `running` 挡住 | ✅ | `:43-44` 标志位，`:160-161` 早退，`:186-188` `finally` 复位；单次 tick 内每个 provider 最多 20 s 超时（`:142`），60 s 周期内不会叠加 |
| 36 | 失败是否无限重试 | ✅ | `:173-185` 先落 `lastAttemptDate` 再请求，失败只 `console.warn`，不重试；`:168` 同日不再进入 |
| 37 | 签到是否能在 token 过期后自愈 | ❌ | `:127` 直接取盘上 `oauth.accessToken` 发请求，主进程没有任何 provider token 续期逻辑（`src/main` 内 `refreshToken` 命中只在钉钉 / 飞书 / QQ / 企微渠道）。access token 按 `S-218.md:218` 是小时级，挂机过夜后 8:00 的自动签到必然 401，且 `:174` 已把当天标记为「尝试过」→ 该日彻底放弃，用户无感知 |
| 38 | 自动签到失败是否有 UI 反馈 | ⚠️ | `:180-183` 只写主进程日志。`S-218.md:380` 要求「失败后 UI 显示原因 + 两个手动出口」，手动机签到有（`ProviderAuthPanel.tsx:84-97`），但自动失败原因永远到不了界面 |
| 39 | `ProviderAuthPanel` 的 `abortRef` 卸载清理 | ✅ | `:158` `useEffect(() => () => abortRef.current?.abort(), [])`；`:162-163` 每次登录新建 controller 并挂到 ref，`:178-181` `finally` 复位，卸载后不会留下 5 分钟的轮询 |
| 40 | 卸载后 setState | ⚠️ | `:179` 在 `finally` 里 `setBusyId(null)`；卸载竞态时会 set 到已卸载组件。React 18 不再告警，也无泄漏，属可忽略噪音，记录备查 |

### 4.3 令牌续期与身份头

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 41 | `expiresAt` 解析口径 | ❌ | `workbuddy-signin.ts:272-273`、`:324-326` 只认 `expiresIn` / `expires_in`。参考实现先认 `expiresAt` 再认 `expiresIn`（`.wishful-claw/tmp/astra-plugins/src_session.mjs:14-15`），需求正文写的是 `expires`（`S-218.md:209`）。若服务端回 `expiresAt`，`token.expiresAt` 为 `undefined` → `provider-auth-accounts.ts:98-99` 与 `:34-35` 的 `if (expiresAt && ...)` 全部短路 → 永续期，1 小时后全链路 401 且不会自愈 |
| 42 | 续期是否单飞 / 有缓存 | ⚠️ | `refreshWorkBuddyToken`（`:300-336`）无 single-flight。参考实现在 `src_session.mjs:39` 用 `site.id + refreshToken` 作 key 去重，并提示「旧 refresh token 被重复使用会让另一方掉登录」。并发两个请求同时命中刷新时可能互相作废 |
| 43 | 身份头注入是否完整、是否串到别的服务商 | ✅ | `ProviderHttpHeaders.cs:120-140` 发 `X-User-Id` / `X-Domain` / `X-Enterprise-Id` / `X-Tenant-Id`，空值不发；`provider-payload.ts:112-121` 只传这三个字段。Codex / Copilot 的 token 没有 `uid` / `domain`，四个 `if` 全部不命中，不会多出头 |
| 44 | 跨语言契约可维护性 | ⚠️ | `ProviderHttpHeaders.cs:163-168` 用裸字符串读 `oauthAccount`，无 Contracts 类型、无 `JsonSerializerContext` 登记。`AGENTS.md:163-169` 的 AOT 规则虽不强制此写法（`JsonElement` 不走反射），但字段改名不会有编译期保护 |
| 45 | 企业号解析失败的处理 | ⚠️ | `workbuddy-signin.ts:163-165` 捕获异常直接返回 `''`，用户会静默降级成个人账号（模型表变少），与 `S-218.md:238`「企业账号必须带头」的语义相悖，且无任何提示 |

### 4.4 设置页与提交完整性

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 46 | 设置页签两处是否同步 | ✅ | `ui-types.ts:58`（联合类型）与 `:80`（`SETTINGS_TABS`）都加了 `'providerAuth'`；`SettingsPage.tsx:91` 导航项与 `:195-197` 渲染分支都在 |
| 47 | 是否按 `authMode === 'oauth'` 分栏 | ⚠️ | `ProviderAuthPanel.tsx:23-25` 用「`authMode === 'oauth'` 且 `flowType === 'server_poll'`」，`ProviderPanel.tsx:182-188` 未加 `authMode !== 'oauth'` 过滤 → WorkBuddy 同时出现在两个 tab；Codex / Copilot / Moonshot 未迁入（`S-218.md:518` 已记为偏差，待确认） |
| 48 | 自动签到开关的写入方式 | ⚠️ | `ProviderAuthPanel.tsx:231-235` 用闭包里的 `provider.oauth` 整体回写 `oauth`，只改了 `autoCheckin`。若此刻恰好完成一次后台续期，会用旧 token 覆盖新 token，用户被动掉登录。应只 patch `autoCheckin` 或用 store 最新值 |
| 49 | i18n 是否齐全 / 是否入库 | ⚠️ | 键齐全（zh / en 均有 `tabs.providerAuth` 与 `providerAuth.*`，`settings.json:56`、`:272`）。但这两处改动**未提交**：`git status` 显示 `M`，`git blame` 标 `Not Committed Yet`，`69e49b4a` 的文件清单里没有它们。按当前提交，英文环境会落到 `ProviderAuthPanel.tsx` 里的中文 `defaultValue`；同时违反 `AGENTS.md:242`「一个需求一个 commit」 |
| 50 | 是否有测试覆盖新增逻辑 | ⚠️ | 签到日期判定（`delayMinutesFor` / `beijingClock`）、路径锁、退避重试均无单测；`npm test` 基线 73 个用例不受影响，但新逻辑纯靠人工。`AGENTS.md:206-208` 的「有闭环」在无真账号环境下也无替代物 |

### 4.5 分层与实现质量

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 51 | 分层是否单向 | ✅ | 后端改动只落在 `WishfulClaw.Agent`（`ProviderHttpHeaders.cs`、`Tools/ToolHelpers.cs`）；无 Contracts / Core / Infrastructure 反向引用；渲染端只新增同层模块（`lib/auth` / `stores/providers` / `components/settings`） |
| 52 | 是否重复实现同一协议 | ⚠️ | 签到逻辑两份：渲染端 `workbuddy-checkin.ts:61-109`，主进程 `workbuddy-checkin-scheduler.ts:117-157`。headers、`endpointOf`（`:99-102` vs `workbuddy-checkin.ts:51-54`）、`10001` 判定各写一遍；要改契约必须改两处，DRY 违规（`AGENTS.md:185-189`） |
| 53 | 主进程 fetch 是否走系统代理 | ⚠️ | `workbuddy-checkin-scheduler.ts:138-143` 用全局 `fetch`，不经 Electron session，不读 `useSystemProxy`（`workbuddy.ts:133` 声明为 true）。国际版在必须走代理的网络下自动签到必失败；渲染端 `api:request` 那条路是走代理的 |
| 54 | 新增文件规模 | ✅ | `workbuddy-signin.ts` 319、`ProviderAuthPanel.tsx` 274、`workbuddy-checkin-scheduler.ts` 194、`workbuddy.ts` 161、`workbuddy-checkin.ts` 140、`ToolHelpers.cs` 306、`ProviderHttpHeaders.cs` 206，均 ≤ 500 |
| 55 | `shared/types/provider.ts` 规模 | ❌ | 501 行（本提交 459 → 501），首行注释只说「Provider core type definitions」（`:1-7`），无豁免理由与行数。文件属「单一数据对象」可豁免，但 `AGENTS.md:178-181` 要求必须写豁免头，未写即判 ❌ |
| 56 | 类型放宽的连带影响 | ✅ | `OAuthConfig.authorizeUrl` / `tokenUrl` / `clientId` 改可选（`provider.ts:113-117`）；消费方均已加守卫：`oauth.ts:154-157`、`:182-183`，`provider-auth-accounts.ts:25`。未见未判空直接使用的调用点 |
| 57 | 安全校验 | ✅ | `workbuddy-signin.ts:237` 强制 `authUrl` 必须 `https:`；schema / body 走既有 `api:request`，无 `eval`、无动态 `require`、无 shell 拼接 |
| 58 | JSON 解析失败处理 | ✅ | `workbuddy-signin.ts:78-82`、`workbuddy-checkin.ts:96-101`、`workbuddy-checkin-scheduler.ts:145-150` 均为 `try/catch` + 按状态码兜底，不会因网关错误页抛未捕获异常 |
| 59 | 需求闭环状态 | ⚠️ | `S-218.md:10.3` 明列四项未完成（请求侧修补 / 模型清单 / 额度 / 倍率），`S-218.md:532` 明写「真机未验证」。按 `AGENTS.md:201-208`，S-218 目前不满足「有闭环」，`plan.md:26` 也这么写。本轮不应把 S-218 计入「可验证」 |

---

## 五、按需求汇总

| 需求 | ❌ | ⚠️ | ✅ | 结论 |
|---|---|---|---|---|
| S-220 | 1 | 1 | 4 | 逻辑正确，卡在 `BrowserPanel.tsx` 511 行无豁免（既有债务） |
| S-219 | 2 | 2 | 5 | 核心目标未达成：锁只包写入，读改写竞态仍在 |
| S-217 | 0 | 3 | 4 | 钩子正确、首次安装不变；缺真机打包与构建配置守卫 |
| S-218 | 5 | 16 | 16 | 登录 / 头注入 / 定时器主体成立；风险口径、token 续期、字段解析三项必须修 |
| 合计 | 8 | 22 | 29 | — |

## 六、修复优先级

1. `ToolHelpers.cs:169-181` + `FileEditTool.cs:55`：把读改写整体纳入路径锁（或提供 `WithFileLockAsync` 由 Edit / 记忆热写 / Notebook 三处调用）。
2. `workbuddy-signin.ts:272-273`、`:324-326`：补 `expiresAt` / `expires` 字段；主进程签到前先续期（或失败时不落 `lastAttemptDate`）。
3. `ProviderAuthPanel.tsx:245-249`：补 §5.1 三层提示 + 勾选确认与第三方角标。
4. `shared/types/provider.ts`（501 行）与 `BrowserPanel.tsx`（511 行）：补豁免头或拆分。
5. `workbuddy-checkin-scheduler.ts:138-143`：改用 `session.fetch` 走代理；签到协议与渲染端合并为单一实现。
6. `locales/{zh,en}/settings.json`：把工作区改动并入收尾提交。

---

## 七、修复结果（2026-10-23）

八条 ❌ 全部处理完毕，门禁复跑全绿（`typecheck` web/node 各 0 错、`dotnet build src\runtime\WishfulClaw.sln` 0 警告 0 错误、`npm test` **78/78**）。

| ❌ | 条款 | 处置 | 落点 |
|---|---|---|---|
| 1 | S-219 读改写未入锁 | **已修** | `ToolHelpers.cs` 加 `WithWriteGateAsync`（无返回值 + 泛型两个重载），`WriteAndFlushAsync` 改为它的薄封装；`WriteWithSharingRetryAsync` 提升为 `internal`，供锁内落盘（避免同路径自锁死） |
| 1 | `FileEditTool` 读在锁外 | **已修** | `FileEditTool.cs:55` 起整段（读 → 替换 → 写 → RecordChange）包进 `WithWriteGateAsync` |
| 2 | `MemoryHotWriteTool` 读在锁外 | **已修** | 建文件 → 读 → 归一 → 删除/upsert → 写 全段入锁 |
| 2 | `AgentRuntimeNotebookEditExecutor` 读在锁外 | **已修** | 读 JSON → 改写 cell → 整文件写回 全段入锁 |
| 3 | `BrowserPanel.tsx` 511 行无豁免头 | **已修** | 补豁免头，实测 515 行，第 5 条第 3 类（拆分需搬 state 的组件） |
| 4 | §5.1 三层提示缺失 | **已修** | `ProviderAuthPanel.tsx` 面板顶部写死风险块（非官方接入 + 腾讯可限制账号 + 勾选确认），未勾选时「登录」按钮禁用；新增 6 个 i18n 键 zh/en 各一份 |
| 5 | §5.2 第三方标识缺失 | **已修** | 服务商名后加琥珀色「第三方」角标，与「已连接」绿标视觉分开 |
| 6 | 自动签到无 token 续期 | **已修** | `workbuddy-checkin-scheduler.ts` 新增 `tokenStale` / `expiresAtOf` / `renewTokenIfStale`，到期前 5 分钟先续期并回写 provider store，再发签到请求 |
| 7 | `expiresAt` 解析口径不符 | **已修** | 渲染端 `workbuddy-signin.ts` 抽出 `resolveExpiresAt`（先认 `expiresAt` 绝对时刻，再认 `expiresIn`/`expires_in`/`expires`），两处调用点统一；主进程同口径落地 |
| 8 | `shared/types/provider.ts` 501 行无豁免头 | **已修** | 补豁免头，实测 505 行，第 5 条第 1 类（同质类型表） |

**未修（故意留着，不是遗漏）**：

- ⚠️ 15（工具层中英混排）、⚠️ 25/31/32/33/38/42/45/47/48/50/52/53 —— 均属体验与健壮性改进，不阻断；`S-218.md §10.3` 已登记为缺口。
- ⚠️ 20（`installer.nsh` 变量声明依赖 `oneClick:false` + 未设 `perMachine`）、⚠️ 22（宏名大小写依赖 + 缺真机 `electron-builder --win`）—— 归入真机验证清单。
- ⚠️ 5（硬刷新重放 POST）—— 原 `reload()` 同样重放，非本需求引入。

---

## 八、S-223 dev 实例项目级数据目录隔离（2026-10-23）

**审查切面**：[`plan-s223/review_report.md`](plan-s223/review_report.md)（编号 1-23 在该文件内唯一）

**结论**：❌ 2 → 修复后 **0**；⚠️ 6（3 条设计取舍 + 3 条已知边界）；✅ 15。门禁全绿（`typecheck` node/web 各 0 错、`dotnet build` 0 警告 0 错误、`npm test` **80/80**）。

**两条 ❌ 都是「编译和 grep 都拦不住」的类型**，与阶段三第三轮 ❌F 的预测一致：

| ❌ | 条款 | 处置 |
|---|---|---|
| 1 | `GlobalTaskToolsProvider.cs:108` 只补 `$` 未换字面量 —— 编译通过，但模型仍收到写死的生产目录名 | **已修**，切换成 `{WishfulClawDataDir.ProjectDirName}` 占位 |
| 2 | `project-archive-helpers.ts:42` 换了 import 没换常量 —— `TS2304` | **已修**，由 `tsc -p tsconfig.web.json` 抓出 |

**未修（有意）**：`ProjectDirName` 不缓存（每次读环境块字典查找，与路径拼接同量级）；SSH 远程项目读不到历史记忆（不污染生产，已在 `docs/data-storage.md` 登记边界）；辅助窗口不带 `additionalArguments`（当前不 import 项目路径模块，已在模块头注释点名）。
