# 审查报告：plan-s175（阶段五 · 审查态）

> 被审查对象：需求 `docs/plans/iter-v2-38/requirements/S-175.md`；计划 `docs/plans/iter-v2-38/plan-s175/plan.md`；落地提交 `149a0c9d`
> 审查方式：独立 subagent（code-reviewer，只读源码；未改任何文件、未跑构建/测试）
> 时间：2026-10-09

## 一、总体结论

**❌ 阻断项 = 0，⚠️ 建议项 = 9（含 1 条纯知晓级归类偏差，见「三、问题与建议」），可进入验证态（阶段六）。**

四处缺陷的修复各自闭环：③ 的键名/读取路径已在 `electron-updater` 源码中核实（`providerFactory.js:50`）；④ 的判据改为「盘上事实」，三条同族漂移路 + 在途下载 + 被取代包均被断言覆盖，且**不放开截断安装包**；② 的模块分层干净、零硬编码域名、失败即空态，但拉回的说明**只进事件不进状态快照**，托盘图标开窗前 `refreshStatus()` 会把它清空（本刀唯一有用户可见影响的问题，⚠️ #1）；① 的修复**不在版本库**（`scripts/deploy.mjs`，`.gitignore:57`），本机实现正确但换机不可复现，口径只落在 `docs/release-workflow.md`，且该文档同一次改动留下「三件/四件」两处漂移（⚠️ #3、#4）。

分层、硬编码、依赖三项均 ✅；回归风险 ✅（更新链路不会把原本能更新的用户挡在门外）。

## 二、逐项结论（审查项 5 条 + 回归风险 + 域外改动，共 7 行表）

| # | 审查项 | 结论 | 证据 / 说明 |
|---|--------|------|-------------|
| 1 | 分层约定（主进程 / 渲染端 / Worker） | ✅ 符合 | 新增 `src/main/lib/release-notes.ts` 落在主进程 lib 层（与 `src/main/lib/logger.ts`、`updater-error-format.ts` 同级），**不 import electron**（`release-notes.ts:24-25` 只依赖 `node:fs` / `node:path`），宿主信息由 `updater.ts:201-205` 从主进程注入（`app.isPackaged` / `process.resourcesPath` / `app.getAppPath()`）。渲染端（`use-app-updater.ts`）与 Worker 均未被本刀触碰；`getAppDistributionInfo` 等主进程专属能力仍只在主进程调用。差分下载/相位状态机改动全在 `src/main/`。 |
| 2 | 硬编码路径 / 密钥 / 更新源 URL | ✅ 源码零硬编码 | 更新源 URL 只从 `app-update.yml` / `dev-app-update.yml` 的 `url:` 读（`release-notes.ts:74-91`、`updater.ts:201-205`），源码里**没有** `wishful-claw.work` 字面量（已 grep 全 `src/`）。生产代码无密钥、无绝对路径。**测试** `tests/release-notes-fetch/program.ts` 内嵌 `BASE = 'https://wishful-claw.work/downloads/'` 作为纯字符串期望值（不发真实请求，`fetchImpl` 全部注入），属可接受的 fixture，记 ℹ️。 |
| 3 | 正确性（四处缺陷修复是否各自闭环、有无互相干扰） | ⚠️ 四处均闭环，② 有一处状态未落库 | 见「三、问题与建议」#1~#4。① 代码侧无改动（在 `scripts/deploy.mjs`，非版本库）⇒ 闭环但**不可复现**；② 模块与接线正确，但拉回的说明只进事件、不进 `getUpdateStatus()` 快照（#1）；③ 键名与读取路径已核实（`providerFactory.js:50` `options.useMultipleRangeRequest !== false && …`），机制正确、仅对新构建生效；④ 判据改为「盘上事实」，三条同族路 + 在途 + 被取代包全部覆盖，且**不放过截断安装包**（见 #4）。四处互不干扰：② 只改通报事件、不参与相位；④ 只改相位表与闸门；③ 只改打包配置。 |
| 4 | 错误处理充分性 | ✅ 充分（含 1 条 ℹ️） | `fetchReleaseNotes` 对 404 / 空文档 / 文件名不符 / 超时 / 网络错 / 非法版本 / 空地址**一律返回空串**（`release-notes.ts:106-126`），`AbortController` 超时 5s 且 `finally` 必清除（`:112,124`）；`resolveReleaseNotes` 的失败由 `announceUpdateAvailable` 的 `.catch` 兜住并**保证通报照发**（`updater.ts:221-236`）。下载中断沿用既有 `instance.on('error')` → `setError`（本刀未动）。多区间进度：关掉多区间后进度 transform 必然创建，前进量单调校验仍在（`updater-state.ts:219-226`）。ℹ️：`announceUpdateAvailable` 的 `.then` 若抛错无末端 catch（浮空 promise），但内部只有 `sendUpdateEvent`，风险极低。 |
| 5 | 是否引入不需要的依赖 | ✅ 未新增 | `package.json` 本刀仅 +1 行 `test:release-notes-fetch` 脚本（复用已有 `esbuild`），`dependencies` / `devDependencies` 一字未动。`release-notes.ts` 只用 Node 内置 `node:fs` / `node:path` 与全局 `fetch`（Electron ^43 主进程原生自带），无新第三方依赖。 |
| 6 | 回归风险（启动即跑的更新链路） | ✅ 不会让原本能更新的用户更新不了（1 条 ⚠️ UX 降级） | ④ 的判据是**放宽**：`idle/checking/available` 新增可达 `installing`，同时把「必须有匹配包」的检查从 `error` 分支提升为**全分支通用**（`updater-state.ts:256-266`）。唯一被收紧的旧行为是「`phase==='downloaded'` 但 `downloadedVersion===null` 也能装」—— 该状态不可达（`applyDownloaded` 必写版本，`updater-state.ts:248`）。`downloading` 一律拒绝，**截断包不可能被装**（详证见 #4）。③ 只影响吞吐不影响成败；② 见 #2 ⚠️（通报事件最多晚 5s，且离线时无额外阻塞）。三处对「新版本已发现」这一结论的产出均在 `applyAvailable` **同步**完成（`updater.ts:428-433`），`checkForUpdatesInternal` 读快照不受异步拉取影响。 |
| 7 | 域外顺手改动 | ⚠️ 文档批量夹带 | `git show --stat 149a0c9d` 除 7 个代码/测试文件外，还带进 **13 个文档**：`changelog.md`(+248)、`plan-s172/plan.md`(+100)、`plan-s173/plan.md`(+97)、`plan-s175/plan.md`(+119)、`plan-s176/plan.md`(+128)、`plan.md`(+74)、`raw-requirements.md`(+75)、`requirements/S-172/173/174/175/176.md`、`docs/release-workflow.md`。其中 `docs/release-workflow.md`（§4.2 / §4.2.1 / §4.3）**属本刀口径**（① 的唯一落点），其余为 38 迭代规划文档批量入库。**代码侧无域外改动**（无其他需求的功能代码被夹带）。 |

## 三、问题与建议

| # | 级别 | 位置 | 问题 | 建议 |
|---|------|------|------|------|
| 1 | ⚠️ 建议 | `src/main/updater.ts:199-208,220-237` ↔ `src/renderer/src/App.tsx:81-87`、`use-app-updater.ts:61-64` | **② 拉回的说明只进「事件」，不进「状态快照」，两处真源不一致。** 协调器里的 `releaseNotes` 只由 `applyAvailable({ releaseNotes: formatReleaseNotes(info.releaseNotes) })` 写入（`updater.ts:423,429`），清单无内联时它是空串；异步补拉的正文只挂在 `update:available` 事件载荷上（`updater.ts:228-235`），`getUpdateStatus()`（`updater.ts:614-620`）永不带它。而设置面板点托盘图标开弹窗前会 `await updater.refreshStatus()` → `applyStatus(status)` **整体替换**渲染端 state（`use-app-updater.ts:61-64`），把事件里那份说明清空。若随后 `recheckLatest()` 未再触发 `update:available`（该版本已下载时 `updater.ts:418-421` 直接 `return`，不发通报；或重查静默失败），说明就**永久空态**，而界面仍显示「有更新 / 立即重启安装」。 | 把补拉结果也落到协调器：给 coordinator 加一个「补写 releaseNotes」的动作（或让 `applyAvailable` 接受一个可后填的说明），使 `update:status` 与事件同源；最省的做法是在 `announceUpdateAvailable` 的 `.then` 里同步写回 coordinator 后再发事件。 |
| 2 | ⚠️ 建议 | `src/main/updater.ts:220-237` | **通报事件被网络拉取推迟，最多 5s（`release-notes.ts:34` 超时）。** 清单带内联说明时（≤0.2.38 过渡期）走 `resolveReleaseNotes` 首行 `return inlineNotes`，仅多一跳微任务、无影响；一旦「清单干净」（0.2.39 起），每次 `update-available` 都会先发一次 HTTP。启动即跑的自动检查、6h 后台巡检（`updater.ts:57`）都会因此让顶栏图标/弹窗**最晚约 5s** 才亮。服务器黑洞（连接不 RST 只丢包）时即为此延时。 | 可接受；若要更快，可先把「有更新」事件发出、说明抵达后再补发一次带说明的更新（或另开 `update:notes` 事件），让相位与通报彻底解耦。 |
| 3 | ⚠️ 建议 | `scripts/deploy.mjs`（**不在版本库**，`.gitignore:57` `scripts/*`） | **① 的根因修复无代码侧可审查物。** `git log -- -1 -- scripts/deploy.mjs` 为空（该文件从未入库，仅 `after-pack-remove-files.cjs` / `publish-aot-worker.mjs` 有白名单例外）。本机文件确有正确实现（`CFG.blockmapKeepCount = 5`、`find … -name '*.blockmap' \| sort -V \| head -n -${keep} \| xargs -r rm -f`，`deploy.mjs:87,492-520`），但**换机器/新克隆不可复现**，且该修复无法随仓库分发。 | 与既有口径一致（文档兜底），但建议把这段远端清理逻辑（纯 shell 片段）**抽成一个入库的 `.sh` 或模板常量**，`deploy.mjs` 引用它 —— 既保留脚本整体不入库，又让 ① 的修复可被审查与复制。 |
| 4 | ⚠️ 建议 | `docs/release-workflow.md:98`、`:200` | **「三件 / 四件」口径漂移。** 同一次提交里 §4.2 已改写为「四件」（`:147`、`:173`、`:189`），但 `:98` 总览仍写「`4.2 更新下载目录（三件）`」，`:200` §4.2.1 仍写「`deploy.mjs installer` 只传当前版三件」——且后者与事实相反（缺说明 md 现在直接报错，见 `deploy.mjs:455`）。`scripts/deploy.mjs` 不入库 ⇒ **文档是 ① 与四件化的唯一真源**，这类漂移的代价被放大。 | 把 `:98` 改为「四件」、`:200` 改为「只传当前版四件」；顺带扫一遍 `:179`、`:361` 的「三件」是否指 GitHub 资产（若是则保留）。 |
| 5 | ℹ️ 知晓 | `src/main/updater.ts:236` | `announceUpdateAvailable` 末尾 `.then(...)` 无末端 `.catch`，浮空 promise；若 `sendUpdateEvent` 内部抛错会成为 unhandled rejection。 | 可加 `.catch(() => {})` 或把 `sendUpdateEvent` 包进 try；优先级低。 |
| 6 | ℹ️ 知晓 | `scripts/deploy.mjs:513-516` | ① 的远端清理依赖 **GNU `head -n -N`** 与 `sort -V`（Ubuntu 满足；若将来换成 busybox 或 macOS 语义不同，`head -n -5` 会报错而非静默）。注释已述「数量不足时 head 输出为空，不会误删」，逻辑正确。 | 无需动作；仅提示该片段对宿主环境有隐式要求。 |
| 7 | ℹ️ 知晓 | `electron-builder.yml:13-20` | ③ 的键只对**本次提交之后构建的包**生效（键随 `publish:` 段写进包内 `app-update.yml`），存量 0.2.37/0.2.38 客户端仍走多区间、仍无进度。这是「随下个构建生效」的既定口径，非缺陷。另：关掉多区间在带宽充足时会牺牲并行分片的吞吐，提交注释以「服务器带宽是瓶颈」作结，属**有意取舍**。 | 无需动作；验证态应明写「③ 只能拿新构建的包验」。 |
| 8 | ℹ️ 知晓 | `src/main/updater.ts:220-237` | 两次 `update-available`（如手工查 + 巡检）会并发两次 `announceUpdateAvailable`，两个 promise 谁先 resolve 不定 ⇒ 事件可能**乱序/重复**（后到的旧版通报覆盖新版展示）。概率低（同一版本两次都触发通报的场景少见，且 `updater.ts:418` 已挡住「同版本重复」）。 | 可给 announce 加一个「最新版本号」哨兵，丢弃过期通报；优先级低。 |
| 9 | ℹ️ 知晓 | `tests/release-notes-fetch/program.ts:29` | 测试内嵌生产域名 `https://wishful-claw.work/downloads/`（纯字符串期望，`fetchImpl` 全部注入，不发真实请求）。 | 无需动作；如需洁癖可改为常量导入或 `example.test`。 |

## 四、非本刀欠账（记录，不纳入本刀）

1. **`scripts/deploy.mjs` 整脚本不入库**（`.gitignore:57`，白名单仅 `after-pack-remove-files.cjs` / `publish-aot-worker.mjs`）—— 为隐藏服务器地址与部署密钥路径而刻意如此。代价是 ① 的修复无代码侧可审查物，见「三 #3」。
2. **更新链路 INFO 日志默认不落盘** —— `logLevel` 默认 `warn`（`plan.md` 勘测 §② 末），`Updater check started` / `kept the already-downloaded version` 等关键行看不到。`plan.md` 步骤 5（提级 / 预设 info）本次**未做**，仍是欠账。
3. **历史版（≤ 0.2.35）的 blockmap 官网仍缺** —— 从那些版本直升级仍回落全量（`requirements/S-175.md:247-249`，老大未定）。
4. **开发态也会向生产域名拉说明** —— `resolvePublishUrl` 在 `!app.isPackaged` 时读仓库根 `dev-app-update.yml`，其 `url` 即生产地址；`forceDevUpdateConfig` 下 `update-available` 成立时，dev 实例会真的发一次 GET 到线上（只读、无害但非预期）。
5. **`useMultipleRangeRequest` 的验证只能靠新构建包** —— 存量客户端不受影响，见「三 #7」。

## 五、结论

**❌ 项 = 0（无阻断项）。⇒ 可进入验证态（阶段六）。**

- 7 个 ⚠️ 建议级问题（#1~#4 及行 6/7/9）均为**改进项**，不影响本刀四处缺陷的功能闭环与门禁；其中 **#1（说明只在事件、不在快照）** 建议在验证态一并复验「托盘图标开窗后说明是否还在」，因为它决定的正是 ② 的用户可见效果。
- 验证态务必覆盖 plan 步骤 6 的两机复验：机器 A（下载后点图标重查 → 能装）、机器 B（真差分看得到进度/总量/速度，**需用含本刀 `electron-builder.yml` 的新构建包**）。

## 六、审查范围自述

**读过的文件**（全部只读）：
- 提交与文档：`git show --stat 149a0c9d`、`git show 149a0c9d -- <7 个代码/测试文件>`、`docs/plans/iter-v2-38/plan-s175/plan.md`、`docs/plans/iter-v2-38/requirements/S-175.md`（§3.2/§3.3/§3.4/§3.5）、`docs/release-workflow.md`（§四 4.2 / 4.2.1 / 4.3 及相关行）。
- 源码：`src/main/lib/release-notes.ts`（全文 133 行）、`src/main/updater.ts`（1-60 / 181-237 / 330-460 / 545-640）、`src/main/updater-state.ts`（1-190 / 190-290）、`src/renderer/src/hooks/use-app-updater.ts`（38-139 / 141-179）、`src/renderer/src/App.tsx:78-95`。
- 测试与配置：`tests/release-notes-fetch/program.ts`、`tests/updater-state/program.ts`（相关段落）、`electron-builder.yml`、`package.json`、`dev-app-update.yml`、`.gitignore`、`scripts/deploy.mjs`（清理段，**只读**）。
- 依赖证据：`node_modules/electron-updater/out/providerFactory.js`、`AppUpdater.js`、`AppImageUpdater.js`、`NsisUpdater.js`。

**跑过的命令**（全部只读，未改任何文件、未跑构建/测试）：
- `git log --oneline -5`、`git log --oneline -1 -- scripts/deploy.mjs`、`git show --stat 149a0c9d`、`git show 149a0c9d -- <files>`
- `git status --short`
- `git check-ignore -v scripts/deploy.mjs`
- PowerShell `Select-String` / `Grep` 工具：在 `src/`、`src/renderer/`、`docs/`、`tests/`、`node_modules/electron-updater/out/*.js` 上做模式检索（`useMultipleRangeRequest`、`update:available`、`beginInstall`、`checkIsPeriodic`、`三件|四件`、`blockmap` 等）
- PowerShell 只读字节检查：对 9 个改动文件核对 `bom=` / `barelf=`（结果：全部 `bom=False barelf=0`）
- `node -e` 读取 `package.json` 版本（electron ^43.2.0 / electron-updater ^6.6.2 / electron-builder ^26.15.3）

**未做**：任何 Write/Edit 到源码、计划、需求文档；未运行 typecheck / npm test / 构建。

