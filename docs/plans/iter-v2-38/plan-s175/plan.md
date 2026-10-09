# Plan-S175：应用内更新链路四处缺陷（②更新说明 / ④已下载却装不上；①③已落地）

> 归属 iter-v2-38。需求正文见 [`../requirements/S-175.md`](../requirements/S-175.md)。
> 状态：**已实施完成并提交**（`149a0c9d`，2026-10-08 17:30）。① 已修复并实测；③ 已定案并落地（`electron-builder.yml` 一行，随本刀入库）；② 走兜底拉取；④ 走**甲**。
> **两条待裁**已在实施前裁定：步骤 4 走甲；步骤 5（INFO 提级）**不做**（2026-10-08 16:32 老大：日志级别是用户自选项，不纳入需求）。
> 事后补验（阶段三）订正见 **§七**。

---

## 一、目标

- **② 更新说明缺失**：`latest.yml` 不带 `releaseNotes`（electron-builder 默认行为，**不用改**）；应用侧在说明为空时按版本号去官网拉独立 md，拉不到就留空态。
- **④ 已下载却装不上**：安装闸门判的是「相位可达性」而不是「盘上有没有包」⇒ 改成判盘上事实。
- 顺带把 ①③ 的成果与本次口径写进发布流程文档。

---

## 二、勘测结论（实测）

### ② 更新说明

| 环节 | 位置 | 现状 |
|---|---|---|
| 唯一天源 | `updater.ts:377` `formatReleaseNotes(info.releaseNotes)` | `latest.yml` 不带 `releaseNotes` ⇒ `info.releaseNotes` 恒空 ⇒ 弹窗走「本次发布未提供更新说明」空态 |
| 官网侧 | `website/src/lib/latest-yml.ts:41-51` `parseReleaseManifest` | 只取 `version` 与安装包文件名，**其余字段留给 updater** ⇒ 官网**零改动** |
| 官方工具链 | 仓库无 `build/` 目录、未配 `releaseInfo` | 说明该字段「从来不是我们发出来的」，不是被谁弄丢 |
| 发布地址（唯一真源） | 开发态 `dev-app-update.yml` 的 `url:`；打包态包内 `resources/app-update.yml` 的 `url:`（由 `electron-builder.yml` 的 `publish:` 段生成） | 兜底拉取的 base URL 从这里读，**不在代码里手写域名** |
| 发版流程对「正文」的要求 | `docs/release-workflow.md:237-270`（Release notes 模板 + 硬规则） | 已有一份用户视角正文的写法与固定路径 `.wishful-claw/notes/release-notes-v0.2.{N}.md` |

### ④ 已下载却装不上

| 环节 | 位置 | 现状 |
|---|---|---|
| 闸门 | `updater-state.ts:245-256` `beginInstall` | `hasMatchingPackage` **只在 `phase === 'error'` 分支上**用于拒绝；其余相位一律走 `transition('installing')`，而 `checking` / `idle` **不可达 `installing`** ⇒ 被拒 |
| 触发点 | `updater.ts:370-375` | 用户点图标重查 ⇒ `update-available` ⇒ **相位被推到 `checking`**，而 `downloadedVersion` 仍在（守卫只 `return`，不动相位） |
| 同族第二、三条路 | `applyNotAvailable`（`:177-183`：`downloaded → idle`，且 `downloadedVersion` 非空时**故意不清**）、`failSilently`（`:266-271`：`→ idle`） | 同样把相位留在 `idle` ⇒ 同样拒装 |
| 观测 | `logLevel` 当时**生效值** `warn`（⚠️ 事后补验订正：代码默认是 `DEFAULT_LOG_LEVEL = 'error'`，见 `src/shared/logging.ts:10`；判成 `warn` 是因为本机 `settings/general.json` 设了 `warn`，**不是代码默认**） | updater 的 `Updater check started` / `kept the already-downloaded version` / `logDownload` 等关键 INFO **一条都落不到盘**（当日 807 行日志：INFO 0 / WARN 773 / ERROR 17）。归因订正不影响结论 —— `error` 比 `warn` 更严，INFO 同样不落盘 |

---

## 三、步骤清单

### ② 更新说明兜底拉取

- [ ] **步骤 1：应用侧兜底拉取**
  - 新建 `src/main/lib/release-notes.ts`：`resolvePublishUrl()`（读打包态 `process.resourcesPath/app-update.yml`、开发态仓库根 `dev-app-update.yml` 的 `url:`）+ `fetchReleaseNotes(publishUrl, version, fetchImpl?)` → 拉 `${url}release-notes-${version}.md`。
  - 命中判定三关：HTTP 200 + 正文非空 + **文件名版本 = 本次版本**（版本对不上按未命中，**绝不显示上一版的说明**，与 blockmap 那次同一取向）。
  - `updater.ts:377`：`info.releaseNotes` 为空时才去拉；命中才填 `releaseNotes`，任何失败**静默留空态**（不阻塞更新链路、不弹错）。
  - **验证检查点**：`npm run typecheck` 三配置 0 错；新增断言覆盖四态 —— 命中 / 404 / 版本不匹配 / 空文档（落 `tests/release-notes-fetch/` 新套件，或并入 `tests/updater-release-notes/`；**落地时二选一，不两处都放**）。

- [ ] **步骤 2：官网侧落点（不改官网代码）**
  - `release-notes-{version}.md` 与 `latest.yml` 放同一个下载目录 `/data/downloads/wishfulclaw/`，由 `scripts/deploy.mjs`（**不在版本库**，`.gitignore:57`）随发版一起上传。
  - 官网**零代码改动**：`latest-yml.ts` 只解析 `version` / `setupFile`。
  - **验证检查点**：线上 `curl https://wishful-claw.work/downloads/release-notes-0.2.38.md` 返回 200 且内容与本地一致（与 0.2.36 blockmap 的补传同一验证手法）。

- [ ] **步骤 3：发版流程文档化（一份真源喂两个发布面）**
  - `docs/release-workflow.md`：在手写正文那节写明 —— 收尾时写 `.wishful-claw/notes/release-notes-v0.2.{N}.md`，**一份给 `gh release create --notes-file`（GitHub 正文）、一份传官网（应用内弹窗）**；`latest.yml` 保持不带 `releaseNotes`。
  - 过渡期口径：**0.2.38 那份仍带内联说明**（已发的 ≤ 0.2.37 客户端只认清单内联），真正「清单干净」最早从 0.2.39 起。
  - **验证检查点**：文档口径与 §4.3 的 notes 模板不打架；不新增第二份正文文件（避免两处文本需人工对齐）。

### ④ 安装闸门

- [x] **步骤 4：改闸门判据（走**甲**）**
  - **甲（治本）**：`beginInstall` 改为「**盘上有包**且相位不是 `downloading`（在途不许退到安装）」即可进 `installing` —— `idle` / `checking` / `available` / `error` 四条路一起通。
    - **落地实况（事后补验订正）**：实际判据比本行更严 —— `updater-state.ts:264-265` `hasMatchingPackage = downloadedVersion !== null && downloadedVersion === state.expectedVersion`，即「盘上有包 **且版本 = 本轮目标版本**」，非在途。**甲的本质不变**（把「相位可达性」换成「盘上事实」），此处补记以免后人照抄到宽松版。
  - **乙（治标）**：只在 `updater.ts:372-375` 守卫处补一次「相位复位」（`checking | available → downloaded` + 重播 `update:downloaded`），`applyNotAvailable` / `failSilently` 那两条仍会拒装。
  - **验证检查点**：`tests/updater-state` 新增断言 —— ① `downloaded → (重查) checking → beginInstall` 为 `true`（甲）/ 由守卫复位兜住（乙）；② `downloading` 相位下 `beginInstall` 仍为 `false`（不许在途装）；③ 无包（`downloadedVersion === null`）仍为 `false`。全套件全绿。

- [ ] **步骤 5：updater 关键 INFO 可观测性（待裁，可与步骤 4 分开）**
  - 候选：把 `updater.ts` 关键 INFO 提级到 warn；或在发版流程预设 `logLevel = info`。
  - **验证检查点**：改后当日日志能看到 `Updater check started` / `kept the already-downloaded version`；等级口径写进 `docs/dev-workflow.md` 或 `docs/release-workflow.md`（**不两处都写**）。

- [ ] **步骤 6：整体测通**（blocked：真机两机复验待老大）
  - `npm run typecheck` 三配置 0 错；`npm test` **66/66**（事后补验订正：原写 65/65，实际新增 `test:release-notes-fetch` 套件后为 66/66）；`dotnet build` 0 错 0 警。
  - 真机两机复验（老大手动）：机器 A —— 下载完成后点图标重查 → **能装**；机器 B —— 真差分下载**看得到进度 / 总量 / 速度**（③ 的验证，`useMultipleRangeRequest: false` 已在工作区）。
  - **验证检查点**：两机现象都对 ⇒ 本刀测通，按一需求一刀提交（**`electron-builder.yml` 的 ③ 改动随本刀入库**）。

---

## 四、涉及文件

| 文件 | 动作 |
|---|---|
| `src/main/lib/release-notes.ts` | **新建**：发布地址解析 + 说明拉取 |
| `src/main/updater.ts` | 修改：`releaseNotes` 为空时兜底拉取（`~:377`）；④ 若走乙另加守卫复位 |
| `src/main/updater-state.ts` | 修改（④ 甲）：`beginInstall` 判据改「盘上事实」 |
| `tests/release-notes-fetch/*` 或 `tests/updater-release-notes/*` | 新增断言（首处新文件） |
| `tests/updater-state/*` | 修改：闸门相位断言 |
| `docs/release-workflow.md` | 修改：一份真源喂两个发布面 + 过渡期口径（**已在工作区改过，继续攒着**） |
| `electron-builder.yml` | **已改未提交**（③ `useMultipleRangeRequest: false`），随本刀入库 |
| `scripts/deploy.mjs` | 修改（**不在版本库**）：上传 `release-notes-{version}.md` |
| `docs/plans/iter-v2-38/requirements/S-175.md` | 回填实施记录与最终口径 |

---

## 五、参考源码

| 来源 | 位置 | 参考什么 |
|---|---|---|
| electron-updater（依赖，非参考项目） | `node_modules/electron-updater/out/` 的 `providers/providerFactory.js`、`differentialDownloader/DifferentialDownloader.js` | ③ 的取证（多区间分支不建进度 transform）；**只读不搬** |
| 本仓 | `updater-state.ts` 相位转移表、`updater.ts` 的事件装配 | ④ 的收敛对象 |
| 本仓 | `docs/release-workflow.md:237-270` | ② 的正文口径（模板已定，不改格式） |

---

## 六、待裁（阻塞步骤 4 / 5）

### 待裁 1：④ 走甲还是乙？

| 方案 | 覆盖面 | 代价 |
|---|---|---|
| **甲（治本，倾向）** | 三条同族路（守卫重查 / `applyNotAvailable` / `failSilently`）一起堵住：只要盘上有包就能装 | 动相位转移表，需重跑 `updater-state` 全套断言；「盘上有包」与「包是当前版本」两件事从此分开判 |
| 乙（治标） | 只堵机器 A 那条（用户点图标重查） | 改动小，但同族两条路仍在，问题会以别的形态回来 |

**我的倾向：甲。** 理由：④ 的根因是「判相位可达性而不判盘上事实」，乙没有动根因，只是把机器 A 那条相位不漂了 —— 而「相位会漂」这件事本身还在。

**新证据（2026-10-08 16:59 老大实测确认）**：**退出应用重开即可装上** ⇒ 相位是纯内存态、**包从头到尾是好的** ⇒ **进一步支持甲** —— 判据换成盘上事实后，「相位漂到哪儿」都不再决定能否安装，**重启也不再是必要动作**。详见需求正文 §3.5 末。

### 待裁 2：updater 关键 INFO 提级做不做？（步骤 5）

本次 ④ 的定位**全靠磁盘文件 + electron-updater 自己那条 error 行倒推**，因为 `logLevel` 默认 `warn`，INFO 一条不落盘。做的话两种口径：**提级到 warn**（改代码）或**发版流程预设 `info` 级**（改文档）。也可以先不做，只在文档里记一句「排查更新链路时临时开 info」。

> **裁定结果（2026-10-08 16:32）**：**不做**。老大原话 ——「日志本身是用户自己可以设置级别的，这个不纳入 bug 修复和需求」。故步骤 5 关闭，提级与预设两条路都不走；本段结论保留作排查手法备查。
> 注：本段「`logLevel` 默认 `warn`」的表述同 §二 订正 —— 代码默认是 `error`，`warn` 是本机设置值。

---

## 七、事后补验订正（阶段三，2026-10-09）

本节记录实施完成后回看 plan 发现的偏差。**结论不变，均为归因/粒度订正**；上文中受影响的三处（§二 观测行、步骤 4 判据、步骤 6 计数）已就地订正。

### 7.1 ④ 判据比 plan 写得更严（已就地订正）

- plan 原写「盘上有包 **且** 相位非 `downloading`」。
- 落地实况：`updater-state.ts:264-265` `hasMatchingPackage = downloadedVersion !== null && downloadedVersion === state.expectedVersion` —— 还要**版本匹配本轮 `expectedVersion`**。
- 评价：比 plan 更稳（避免「上一版残留包」被当成可装），**甲的本质不变**。plan 未反映此点，已补。

### 7.2 ② 的通报事件由同步改异步（plan 未覆盖）

- 新增 `announceUpdateAvailable()`；`update:available` 事件由**同步派发**改为 `resolveReleaseNotes(...).then(...)` **延后派发**（`updater.ts:220-237`，调用点 `:441`，助手 `resolveReleaseNotes` `:199-208`）。
- 相位与 `availableVersion` **仍同步写**（`:428-433`）⇒ 渲染端看到的相位时序不变，只有 `releaseNotes` 内容到得晚一点，符合「说明为空先给空态、拉到再补」的设计。
- plan 步骤 1 只写了「为空才去拉」，**没写事件时序变化** ⇒ 此处补记（对排查「弹窗先空后填」有意义）。

### 7.3 归因订正：`logLevel` 默认值

- plan §二 / §六 原称默认 `warn`。实测 `src/shared/logging.ts:10` `DEFAULT_LOG_LEVEL = 'error'`（注释：`only exceptions are recorded until the user opts in`）。
- 当时 WARN 能落盘是本机 `settings/general.json` 设了 `warn`。**结论方向不变**（`error` 比 `warn` 更严），但「默认值」这个事实说错了，已就地订正。

### 7.4 测试计数

- 步骤 6 原写 `65/65`；实际新增 `tests/release-notes-fetch/` 套件（`package.json` 加 `test:release-notes-fetch`）后为 **66/66**（本轮 S-177 之后再 +1 为 67/67，属 38 迭代整体基线，见 changelog）。已就地订正。

### 7.5 复核为「无误」的项

- **两套测试不重复**：`tests/updater-release-notes`（渲染端对说明做消毒/格式化）与新 `tests/release-notes-fetch`（主进程拉取与命中三关）职责不同，**不是重复实现**。
- **官网零改动属实**：`website/src/lib/latest-yml.ts:41-51` 只取 `version` 与 `files[].url`，新增 `release-notes-{version}.md` 不需要官网配合。
- **`dev-app-update.yml` 在仓库根**（开发态兜底地址来源），与 plan §二 表述一致。
- **未提交项**：`electron-builder.yml` 的 ③ 改动随本刀入库 —— 已核 `149a0c9d`（20 files）内含之。
