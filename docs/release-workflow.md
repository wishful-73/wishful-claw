# 迭代收尾与发布（SOP）

> 「老大确认迭代完结」→「GitHub Release 上线」的完整流程。
> **本文件是收尾流程的唯一权威**；`AGENTS.md` 只保留触发条件与指向，不再维护副本。
> 迭代内的开发流程（六阶段、提交节奏、分支策略）见 `docs/dev-workflow.md`。

---

## 一、触发条件

**迭代是否完结由用户确认，且由用户手动发起**（原话口径："进行 xxx 迭代收尾"）。

- Agent **不得自行判定**迭代完成，也**不得提前催**收尾
- 收尾时把本迭代各需求 / 各 Plan 的 VERDICT 汇总给用户，由他裁定
- **收尾完成后当前会话结束**：下个会话直接从 main 拉最新代码开新迭代，不需要关心旧分支

## 二、版本规则

`v2-iter-{N}` 只是 MVP v2 阶段的**迭代编号**，不是产品主版本号。

正式版发布前，产品版本统一为 `0.2.{N}`，Git tag 为 `v0.2.{N}`。应用 UI 从 `package.json` 读版本号，README 徽章同步。

**收尾第一步就是把版本号升到 `0.2.{N}`，共 4 处**：

| 文件 | 位置 |
|------|------|
| `package.json` | 顶层 `"version"` |
| `package-lock.json` | 顶层 `"version"` **和** `packages[""].version`（两处，容易漏） |
| `README.md` | 版本徽章 |
| `docs/PROGRESS.md` | 总览表格新增一行（见第五节） |

扫旧版本号找遗漏的口径：

```
全仓搜 0.2.NN，排除 node_modules / out / release / dist / .git
```

逐条判断是**真版本引用**还是**历史文档 / 测试样本**——后者不要动。已知两处「看着像但不是」：

- `src/shared/browser-plugin.ts` 的 UA 注释
- `tests/browser-user-agent/program.ts` 里的 UA 样本

## 三、收尾步骤（git）

```bash
# 0. 更新产品版本（见上节）+ 写好进度文档（见第五节）

# 1. 合并到 main（--no-ff 保留迭代合并点）
git checkout main
git merge dev/v2-iter-{N} --no-ff -m "merge: v2-iter-{N} - {迭代名称}"

# 2. 打 tag（annotated；message 格式见 4.3「tag message 口径」）
git tag -a v0.2.{N} -m "v2-iter-{N}: {亮点1 + 亮点2 + 亮点3} - 验证通过"

# 3. 推送远程
git push origin main
git push origin v0.2.{N}

# 4. 删除本地迭代分支
git branch -d dev/v2-iter-{N}

# 5. 删除远程迭代分支（如果之前 push 过）
git push origin --delete dev/v2-iter-{N}
```

**推送：优先直连，失败再走代理**

```bash
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main
```

代理是 Clash Verge（`C:\Program Files\Clash Verge\clash-verge.exe`，端口 `7897`），**平时关着**，直连完全不通时可以自行启动。

- ⚠️ **端口在监听 ≠ 代理可用**。启动后先实测：`curl.exe -x http://127.0.0.1:7897 -s -o NUL -w "%{http_code}" -m 15 https://github.com/` → `200` 才算就绪
- ⚠️ **`fetch` / `ls-remote` 类命令也必须带代理**：`push` 直连失败会快速返回（`Recv failure: Connection was reset`），`fetch` 会**硬等 300s 超时**
- ⚠️ PowerShell 里 git 写 stderr 的正常进度会渲染成红字 `NativeCommandError`，**判断成败只看 `$LASTEXITCODE`**，别信红字

**验证收尾结果**：

```bash
git log --oneline -3        # main 顶部应是 merge commit
git rev-list -n 1 v0.2.{N}  # tag 应指向那个 merge commit
git remote -v               # 确认 remote 是 wishful-73/wishful-claw
```

> `git rev-parse v0.2.{N}^{commit}` 在 PowerShell 里会炸（`^` 是转义符），用 `git rev-list -n 1`。

## 四、发布（官网是更新源，GitHub 是存档）

> **两个发布面，顺序有讲究**（2026-09-23 调整）：
>
> 1. **官网下载目录**（`https://wishful-claw.work/downloads/`）= app 内自动更新的**唯一源**
>    —— S-129 起 `electron-builder.yml` 的 `publish` 是 `provider: generic` 指向它。
>    **漏传 = 所有已装客户端收不到更新** ⇒ **强制项**。
> 2. **GitHub Release**（<https://github.com/wishful-73/wishful-claw>）= **存档** + 「找旧版 / 回滚」
>    入口（官网只放最新版）。**建议做**；不做只影响回滚，不影响更新。
>
> **执行顺序：`4.1 打包` → `4.2 更新下载目录（三件）` → `4.3 建 Release` → `4.4 传资产`。**
> 原流程把「创建 Release」排在打包之前 —— 资产还不存在就先建了 Release，顺序是反的。

### 4.1 打包安装包

```bash
npm run pack:installer:full   # AOT Worker → 前端打包 → electron-builder NSIS
```

典型产物：

```
release/wishful-claw-0.2.{N}-setup.exe
release/latest.yml
release/wishful-claw-0.2.{N}-setup.exe.blockmap
```

- ⚠️ 打包前确认无残留 WishfulClaw / electron 进程（`tasklist` 检查），否则旧 `release/win-unpacked/` 被锁报 `EBUSY`
- ⚠️ 若 `win-unpacked/app.asar` 被锁（杀软 / 索引句柄）且杀进程无效，换输出目录绕开：
  `npx electron-builder --win -c.directories.output=release/v0.2.{N}`
- ⚠️ 若报 `EPERM: operation not permitted, rename 'release\win-unpacked.tmp' -> 'release\win-unpacked'`：
  上一次打包失败留下的 `win-unpacked.tmp` 残留所致。删掉 `release/win-unpacked.tmp` 与 `release/win-unpacked` 后重跑即过。
- ✅ **更新源已指向官网**（S-129）：`electron-builder.yml` 用 `provider: generic` + `url: https://wishful-claw.work/downloads/`，
  包内 `resources/app-update.yml` 同址。打包后可这样核验：

  ```
  provider: generic
  url: https://wishful-claw.work/downloads/
  updaterCacheDirName: wishful-claw-updater
  ```

- ⚠️ **`app-update.yml` 只在带目标的打包（`--win` / `pack:installer*`）里生成** —— `npm run pack`（`--dir`）不产出它，用它验更新源会验空。

### 4.2 上传到官网下载目录（更新源，必做）

**这一步不做，所有客户端就收不到这次更新** —— 官网下载目录是 `provider: generic` 指向的更新源。

安装包与版本清单放在**站点目录之外**的下载目录，nginx 以 `/downloads` 映射对外 ——
因为官网静态发布是**整体替换站点目录**（`deploy.mjs` 的 `deploySite`：先把线上目录 `mv` 走，
再把新的 `mv` 进来），资产放站点里会被清掉。

```
/data/downloads/wishfulclaw/                              ← nginx: https://wishful-claw.work/downloads
├── latest.yml
├── wishful-claw-0.2.{N}-setup.exe
└── wishful-claw-0.2.{N}-setup.exe.blockmap
```

**三件必须同目录、成套覆盖。** `latest.yml` 里的 `url` / `path` 都是相对文件名，updater 与站点
下载按钮一律按「同目录」解析 —— 少任何一个，更新或下载都会 404。

**只放最新版本**（老大 2026-09-23 定）：不攒历史包，差分不需要旧包，回滚靠 GitHub Release。

一条命令搞定（上传三件 + 远端归位 + sha512 逐件校验 + 清旧包 + 报证书）：

```bash
node scripts/deploy.mjs installer   # 更新下载目录（三件：exe + blockmap + latest.yml）
node scripts/deploy.mjs site        # 官网自身内容有改动时才发 —— 发版不需要
node scripts/deploy.mjs cert        # 查证书状态
```

> **发版不重建官网**（2026-09-23 定）：站点前端是**运行时**读 `./downloads/latest.yml`，下载按钮
> 与版本号都由此而来，所以只换下载目录里的三件就生效。`installer` 动作**不碰官网**；仅当官网
> 自身内容有改动（文案、备案信息、配图）才另跑 `site`。

发布后立即抽查（这几条也是第六节的核验项）：

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://wishful-claw.work/downloads/latest.yml
curl -s https://wishful-claw.work/downloads/latest.yml | Select-String 'version:'
```

> ✅ **脚本已三件化**（2026-09-23）：`deploy.mjs` 收 exe + `.blockmap` + `latest.yml`（缺件直接报错），
> 一次上传、远端解包归位、逐件 sha512 校验，并**清掉下载目录里的非当前版本旧包**（只留最新）；
> 人手写的 `latest.json` 已退役，清单唯一真源就是 electron-builder 的 `latest.yml`。
> 变更明细见 [iter-v2-36/S-129.md](../plans/iter-v2-36/requirements/S-129.md) §五。

> ⚠️ **`deploy.mjs` 不在版本库** —— `.gitignore:53` 的 `scripts/*` 刻意排除它（内含服务器地址与
> 部署密钥路径）。换机器时手动拷过去，密钥生成见知识库《官网部署》。

### 4.3 创建 GitHub Release（存档）

gh CLI 在固定路径 `D:\claw\tools\gh\bin\gh.exe`（**不在 PATH，必须绝对路径**调用）。

```bash
# 先把 notes 写到固定路径：.wishful-claw/notes/release-notes-v0.2.{N}.md（按下面模板写）
/d/claw/tools/gh/bin/gh.exe release create v0.2.{N} \
  --repo wishful-73/wishful-claw \
  --title "v0.2.{N}" \
  --notes-file ".wishful-claw/notes/release-notes-v0.2.{N}.md"
```

- 直连失败加代理前缀：`HTTPS_PROXY=http://127.0.0.1:7897 /d/claw/tools/gh/bin/gh.exe ...`
- gh 不可用时用浏览器手建：Releases → Draft a new release → 选 tag → 填 notes → Publish

#### Release notes 模板（固定）

**基准 = v0.2.29 的写法，后续版本一律照此，不要每版换格式。**

写 notes 前先用 `git log v0.2.{N-1}..v0.2.{N} --oneline` 拉一遍本迭代的提交（提交粒度已是一个需求一刀，提交标题可直接当素材）。

```markdown
## 迭代 {N}

{一句话范围概括，本迭代的几块内容用「+」连接}。

### 新增能力

- **{功能名}（{编号}）** — {用户视角说明：解决什么问题、怎么用}

### 修复

- {问题现象}（{可选：修复要点}）

### 校验

- TypeScript 三配置 0 错误；{M} 套前端回归全过
- C# 0 警告 0 错误；10 个回归工程全过
- Native AOT 编译无 IL2026 / IL3050 / IL3051
```

**硬规则**：

- 标题固定 `## 迭代 {N}` —— **不写** `v0.2.{N}` 前缀，**不加** `— v2-iter-{N}` 之类的后缀
- 正文第一段是**范围概括**，不是标题的重复
- 小节名固定这三个：`### 新增能力` / `### 修复` / `### 校验`。不要写「新增」「优化」「其它修复」「验证」这类同义变体
- 条目固定 `- **{名字}（{编号}）** — {说明}`：**编号在括号内跟在名字后面**，不要写成 `- **S-26 名字** —`
- 条目一律写**用户视角**：说清「解决什么问题 / 怎么用」。**不写 commit hash、不写文件路径、不写实现细节**（那些在 `docs/progress/` 里）
- 确实需要用户知晓的限制或不兼容，在 `### 校验` **之后**加 `### 已知限制` —— 这是**唯一**允许的可选小节

#### tag message 口径

tag message 与 Release notes 分工：**前者一行亮点摘要，后者完整清单**。

```bash
git tag -a v0.2.{N} -m "v2-iter-{N}: {亮点1 + 亮点2 + 亮点3} - 验证通过"
```

亮点用 ` + ` 连接，取本迭代最值得说的几件事（3~5 个为宜），不写编号、不写「N 项需求」这种计数。

### 4.4 上传资产到 Release（存档）

```bash
# setup.exe + latest.yml 必须一起传
/d/claw/tools/gh/bin/gh.exe release upload v0.2.{N} \
  --repo wishful-73/wishful-claw \
  "release/wishful-claw-0.2.{N}-setup.exe" \
  "release/latest.yml" \
  --clobber

# .blockmap 若生成，也必须传到同一个 Release
/d/claw/tools/gh/bin/gh.exe release upload v0.2.{N} \
  --repo wishful-73/wishful-claw \
  "release/wishful-claw-0.2.{N}-setup.exe.blockmap" \
  --clobber
```

**`latest.yml` 是 electron-updater 检查更新的必需元数据，不能只传 setup.exe。**

> ⚠️ **GitHub 是存档面**：app 内更新走官网（4.2），这里的资产用于「找旧版 / 回滚 / 手动下载」。
> 但**仍要传全三件** —— 回滚时那份 `latest.yml` 就是历史版本的清单，缺了说不清那个版本对应哪个包。

## 五、进度文档

收尾时两步：

1. `docs/PROGRESS.md` — 总览表格新增一行（迭代号 + Tag + 日期 + 简述），链接到明细
2. `docs/progress/v2-iter-{N}.md` — 新建明细

明细格式见 `docs/dev-workflow.md`「进度文档结构」。

## 六、发布后核验

**官网侧（更新源，必做）** —— 这一面不过，客户端就收不到更新：

- `downloads/latest.yml` 可达（HTTP 200），且 `version` 与本次发布一致
- `downloads/<setup>.exe` 与 `downloads/<setup>.exe.blockmap` 均非 404（差分下载靠 blockmap）
- 本地三件的 sha512 与线上一致（`deploy.mjs` 上传后已自动逐件校验，这里只需确认它没报错）
- 站点下载按钮指向的地址能下到包（与 `latest.yml` 的 `files[0].url` 同源）

**GitHub 侧（存档）**：

- main 分支 / tag / Release 三者均到位
- Release 资产齐全且 `state=uploaded`：`setup.exe` + `latest.yml` + `.blockmap`（若有）
- `latest.yml` 与实际 setup.exe **逐项对上**：`version`、`path`、`files[].url`、`sha512`、`size`
- `latest.yml` 的 `sha512` 与 setup.exe 的**实际 sha512 一致**
- `.blockmap` 的下载地址不返回 404
- Release 状态：`draft=false`、`prerelease=false`、**是 Latest**（`isLatest=true`）

**端到端**：用低于当前版本的本地包实际跑一次 `electron-updater.checkForUpdates()`（此时更新源是官网），
确认进入 `update-available`，再测下载确认与安装确认流程。

> 核验 gh 输出时注意：`gh release view --json` 直接接 `ConvertFrom-Json` 会被流混入搞坏，**先重定向到临时文件再解析**。

## 七、清理本地产物

**前提：官网与 GitHub 两个发布面都已完成、第六节核验全部通过。** 发布没成功之前，本地旧产物是**回滚备份**，一个都不能删。

### 7.1 `release/` 只留当前版本

历史安装包（每个 100+ MB）已在 GitHub Release 上，本地留着的唯一价值是回滚，而回滚只需**上一个**版本——攒着就是纯占盘。

核验通过后，只保留当前版本的三个文件：

```
release/wishful-claw-0.2.{N}-setup.exe
release/wishful-claw-0.2.{N}-setup.exe.blockmap
release/latest.yml
```

清掉更早版本：

```powershell
$keep = '0.2.{N}'   # 换成刚发布的版本号
Get-ChildItem release -File |
  Where-Object { $_.Name -match '^wishful-claw-0\.2\.\d+-' -and $_.Name -notlike "*$keep*" } |
  Remove-Item -Force
```

> 📌 **实测**：iter-31 收尾时 `release/` 攒了 `0.2.23` ~ `0.2.31` 共 9 个版本、**4.9 GB**；2026-09-18 按本节清理后降到 **521 MB**。

**历史版本目录才是大头，也要一并清** —— 每个 `v0.2.x/` 目录里都躺着一份完整的 `win-unpacked/`（300~570 MB），比根下的安装包还占地方：

```powershell
Get-ChildItem release -Directory | Where-Object { $_.Name -match '^v0\.2\.\d+$' } | Remove-Item -Recurse -Force
```

清理后 `release/` 应只剩当前版本相关的东西：

| 保留 | 说明 |
|------|------|
| `wishful-claw-0.2.{N}-setup.exe` + `.blockmap` | 当前版安装包（本地回滚用） |
| `latest.yml` / `builder-debug.yml` / `builder-effective-config.yaml` | electron-builder 元数据 |
| `win-unpacked/` | 当前版的解包目录（下次打包会重建，不需要本地回滚的话也可删，再省约 400 MB） |
| `build/` | **仅当里面是当前版产物**；若是上古残留（如 `wishful-0.2.11.zip`）一并删 |

### 7.2 顺带清掉临时验证产物

- **临时编译输出目录** —— 为绕开运行实例锁 dll（`MSB3021` / `MSB3027`）而用 `-p:BaseOutputPath=` 指到工程外的目录（如 `D:\claw\wc-verify*`），**跑完门禁当次就删**，不要跨会话攒着。删前确认没有进程在用那批 dll（dev 实例跑的是 `src/runtime/**/bin/Debug/`，与这些外置目录无关，删了安全）。
- **`.wishful-claw/notes/` 草稿区** —— 一次性探针（`probe-*` / `check-*` / `inspect-*`）**定位完即删**，只留仍有复用价值的（当前版 release notes、审查报告）。**这是草稿区，不是存档区**。

## 八、收尾之后

当前会话结束。下个会话从 main 拉最新代码开新迭代：

```bash
git checkout main
git pull origin main
git checkout -b dev/v2-iter-{N+1}
```

> 新分支**必须从最新 main 拆出**，禁止从旧迭代分支拆 —— 否则会缺前序迭代的变更，导致编译错误或功能缺失。
