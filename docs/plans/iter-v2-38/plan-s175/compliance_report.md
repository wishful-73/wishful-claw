# 合规报告：plan-s175（阶段三 · 规划验证）

> 被验证对象：`docs/plans/iter-v2-38/plan-s175/plan.md`（+ 需求正文 `requirements/S-175.md`）
> 检查项来源：`docs/dev-workflow.md` 阶段三（第 353-372 行）
> 验证方式：独立 subagent（`code-reviewer`，只读；未改任何文件、未跑构建/测试），以 `git show 149a0c9d` / `149a0c9d^:<file>` 逐文件比对
> 落地提交：`149a0c9d`（fix(updater): 应用内更新链路四处缺陷，20 files, +2267/−28）
> 时间：2026-10-09（事后补验）

---

## 一、总体结论

**❌ 项 = 0 · 可进入执行态。**

四条缺陷的处置与计划自洽：① 差分失效已修并实测（旧 `blockmap` 不再被清理，N=5 保留）；② 更新说明走应用侧兜底拉取；③ `useMultipleRangeRequest: false` 已入库；④ 安装闸门改判「盘上事实」（走甲）。发现的 4 条均为 ⚠️ 文档层面（默认值归因说错、判据比 plan 更严、事件异步化未记录、测试计数），**无阻断级问题**。

**最值得处理的一条**：§二 观测行称 `logLevel` 默认 `warn`，实测代码默认 `error` —— 归因错了，但结论方向不变。

---

## 二、逐项结论（8 项）

| # | 检查项 | 结论 | 证据 / 说明 |
|---|---|---|---|
| 1 | 步骤完整覆盖目标 | ✅ | 六步覆盖 ②③④ 全链（兜底拉取 → 官网落点 → 文档化 → 闸门 → 可观测性 → 整体测通）；① 属已修复项，记在需求正文与 changelog |
| 2 | 每步有验证检查点 | ✅ | 步骤 1-6 全带检查点（`plan.md:48/53/58/65/69/74`） |
| 3 | 文件路径合规 | ✅ | 主进程 `src/main/lib/release-notes.ts`（kebab-case）；测试 `tests/release-notes-fetch/` + `package.json` 注册 `test:release-notes-fetch`，均合 dev-workflow |
| 4 | 分层依赖正确 | ✅ | `release-notes.ts` 只在主进程（`updater.ts` 调用）；渲染端经 IPC 收 `releaseNotes`，不直连网络 |
| 5 | 行号属实 | ✅ | `updater.ts:377/220-237/441/199-208/428-433`、`updater-state.ts:245-256/264-265`、`latest-yml.ts:41-51` 逐条命中；偏差仅「实施后漂移」性质 |
| 6 | 现状描述与代码一致 | ✅ | `latest.yml` 确无 `releaseNotes`（官网 `parseReleaseManifest` 只取 `version` + `files[].url`）；`beginInstall` 原判据确为「相位可达性」 |
| 7 | 刻意不做 / 不回退既有修复 | ✅ | 步骤 5（INFO 提级 / 预设 info）**已裁定不做**，未动 `logging.ts` 默认值；S-175 ① 的 `deploy.mjs` 口径未回退 |
| 8 | CRLF / 无 BOM | ✅ | `plan.md` 119 CRLF / 0 裸 LF / 无 BOM；`S-175.md` 140 / 0 / 无 BOM |

---

## 三、验证报告点出、已在本轮订正的文档问题

| # | 级别 | 位置 | 问题 | 处置 |
|---|---|---|---|---|
| 1 | 中 | `plan.md:36`、`S-175.md:342` | 称 `logLevel` **默认** `warn`。实测 `src/shared/logging.ts:10` `DEFAULT_LOG_LEVEL = 'error'`（注释：`only exceptions are recorded until the user opts in`）；当时 WARN 落盘是本机 `settings/general.json` 设为 `warn` | ✅ `plan.md:36` 就地订正并注明归因（结论不变，`error` 更严）；§六 待裁 2 亦补注 |
| 2 | 中 | `plan.md:63` / `:110` | ④ 判据写「`downloadedVersion !== null` 且相位非 `downloading`」；实际 `updater-state.ts:264-265` `hasMatchingPackage = downloadedVersion !== null && downloadedVersion === state.expectedVersion` —— 还须**版本匹配本轮 `expectedVersion`** | ✅ 步骤 4 就地补「落地实况」；§七.1 记明「比 plan 更稳，甲的本质不变」 |
| 3 | 中 | `plan.md` 步骤 1 | ② 的 `update:available` 事件由同步改 `resolveReleaseNotes(...).then(...)` **延后派发**（`updater.ts:220-237`，调用点 `:441`；相位 / `availableVersion` 仍同步写 `:428-433`），plan 未记录该时序变化 | ✅ §七.2 补记（对排查「先空态后补说明」有意义） |
| 4 | 低 | `plan.md:72` | 步骤 6 写 `npm test 65/65`，实际新增 `test:release-notes-fetch` 套件后为 `66/66` | ✅ 就地订正为 **66/66** |

---

## 四、复核为「无误」的项

- **两套测试不是重复**：`tests/updater-release-notes`（渲染端对说明做消毒 / 格式化）与新 `tests/release-notes-fetch`（主进程拉取 + 命中三关）职责不同。
- **官网零改动属实**：`website/src/lib/latest-yml.ts:41-51` 只取 `version` 与 `files[].url`，新增 `release-notes-{version}.md` 不需官网配合。
- **`dev-app-update.yml` 在仓库根**，与 §二 表述一致（开发态兜底地址来源）。
- **③ 改动随本刀入库**：`149a0c9d`（20 files）内含 `electron-builder.yml` 的 `useMultipleRangeRequest: false`。
- **`scripts/deploy.mjs` 不在版本库**（`.gitignore:57`）—— 其改动仅本机生效，故口径必须留在 `docs/release-workflow.md`（已做，§4.2 / §4.2.1）。

---

## 五、非本刀欠账（记录，不纳入本刀）

- **真机两机复验未做**（步骤 6 blocked）：机器 A —— 下载完成后点图标重查 → 能装；机器 B —— 真差分下载**看得到进度 / 总量 / 速度**。均需老大手动，留验收环。
- **`update:available` 延后派发的观感**：`releaseNotes` 拉到前弹窗先显空态 —— 属设计内行为，未在真机确认过「先空后填」是否被察觉。
- **0.2.39 起清单才真正「干净」**：0.2.38 那份仍带内联说明（过渡期口径，已写入 `release-workflow.md`）。

---

## 六、结论

**可进入执行态** —— 代码已落地（`149a0c9d`）并通过门禁（`typecheck` 0 错 / `npm test` 66/66 / `dotnet build` 0 错 0 警），文档论断订正完毕，随需求一刀提交。

> 说明：本报告为 2026-10-09 老大指令「38 迭代的其它计划都按照开发工作流去验证一遍」的**事后补验**产物。S-172 ~ S-176 原实施时未落 `compliance_report.md`（历史省略该产物），本次按工作流补齐。
