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

`v2-iter-{N}` 只是**迭代编号**，不是产品主版本号 —— 转正 `1.0.0` 之后分支名**照旧**（`dev/v2-iter-41`、`dev/v2-iter-42`…），对外版本与之无关。

**产品版本从 `1.0.0` 起走 `1.0.{N}`，Git tag 为 `v1.0.{N}`**（`1.0.0` 之前的 `0.2.{N}` 系列已随 `v0.2.39` 结束，见第七节清理口径）。应用 UI 从 `package.json` 读版本号，README 徽章同步。

**收尾第一步就是把版本号升到 `1.0.{N}`，共 4 处**：

| 文件 | 位置 |
|------|------|
| `package.json` | 顶层 `"version"` |
| `package-lock.json` | 顶层 `"version"` **和** `packages[""].version`（两处，容易漏） |
| `README.md` | 版本徽章 |
| `docs/PROGRESS.md` | 总览表格新增一行（见第五节） |

扫旧版本号找遗漏的口径：

```
全仓搜 1.0.NN，排除 node_modules / out / release / dist / .git
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
git tag -a v1.0.{N} -m "v2-iter-{N}: {亮点1 + 亮点2 + 亮点3} - 验证通过"

# 3. 推送远程
git push origin main
git push origin v1.0.{N}

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
git rev-list -n 1 v1.0.{N}  # tag 应指向那个 merge commit
git remote -v               # 确认 remote 是 wishful-73/wishful-claw
```

> `git rev-parse v1.0.{N}^{commit}` 在 PowerShell 里会炸（`^` 是转义符），用 `git rev-list -n 1`。

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
release/wishful-claw-1.0.{N}-setup.exe
release/latest.yml
release/wishful-claw-1.0.{N}-setup.exe.blockmap
```

- ⚠️ 打包前确认无残留 WishfulClaw / electron 进程（`tasklist` 检查），否则旧 `release/win-unpacked/` 被锁报 `EBUSY`
- ⚠️ 若 `win-unpacked/app.asar` 被锁（杀软 / 索引句柄）且杀进程无效，换输出目录绕开：
  `npx electron-builder --win -c.directories.output=release/v1.0.{N}`
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
├── release-notes-1.0.{N}.md                              ← 应用内更新弹窗的说明
├── wishful-claw-1.0.{N}-setup.exe                        ← 只留当前版
└── wishful-claw-1.0.{N}-setup.exe.blockmap               ← 最近 5 版都在
```

**四件必须同目录、成套覆盖。** `latest.yml` 里的 `url` / `path` 都是相对文件名，updater 与站点
下载按钮一律按「同目录」解析 —— 少任何一个，更新或下载都会 404。

`release-notes-1.0.{N}.md` 是**应用内更新弹窗**的正文（S-175 ②）：清单不带 `releaseNotes` 时，客户端
按自己那一版去清单同目录拉这份同名文件 —— **文件名必须带版本号**，写错版本等于没有。内容与 GitHub
Release 正文同源，见 4.3「一份真源喂两个发布面」。

**保留策略**（2026-10-08 修订，S-175）：

| 文件 | 保留 | 理由 |
|---|---|---|
| `*-setup.exe` | **只留当前版**（老大 2026-09-23 定） | 不攒历史安装包，回滚靠 GitHub Release |
| `*-setup.exe.blockmap` | **最近 5 版** | 差量下载要读**上一版**的 blockmap，那份 404 就整包回落全量 |

单份 blockmap 约 116 KB，5 版不到 600 KB。数量由 `deploy.mjs` 的 `CFG.blockmapKeepCount` 控制。

> ⚠️ 旧口径「差分不需要旧包」**只对 `.exe` 成立**。差分的旧安装包取**本地**
> `%LOCALAPPDATA%\wishful-claw-updater\installer.exe`（NSIS 装机时自拷的上一次那个包），
> 但旧 **blockmap 必须从服务器下** —— electron-updater 同时拉新旧两份 blockmap，任一 404 即
> 回落全量（`AppUpdater.js` 的 `Promise.all(blockmapFileUrls.map(downloadBlockMap))`）。
> 0.2.36 → 0.2.37 实测走全量 108 MB 就是这个原因，日志原文：
> `Cannot download differentially, fallback to full download: … 0.2.36-setup.exe.blockmap, status 404`。

一条命令搞定（上传三件 + 远端归位 + sha512 逐件校验 + 清旧包 + 报证书）：

```bash
node scripts/deploy.mjs installer   # 更新下载目录（四件：exe + blockmap + latest.yml + 更新说明）
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

> ✅ **脚本已四件化**（2026-09-23 三件 → 2026-10-08 加更新说明）：`deploy.mjs` 收 exe + `.blockmap` +
> `latest.yml` + `release-notes-{版本}.md`（缺件直接报错），一次上传、远端解包归位、逐件 sha512 校验，
> 并**清旧件**（`.exe` 只留当前版、`.blockmap` 保留最近 `CFG.blockmapKeepCount` 版 —— 2026-10-08 修订，见上）；
> 人手写的 `latest.json` 已退役，清单唯一真源就是 electron-builder 的 `latest.yml`。
> 变更明细见 [iter-v2-36/S-129.md](../plans/iter-v2-36/requirements/S-129.md) §五。

> ⚠️ **`deploy.mjs` 不在版本库** —— `.gitignore:57` 的 `scripts/*`（白名单制）刻意排除它（内含服务器
> 地址与部署密钥路径）。换机器时手动拷过去，密钥生成见知识库《官网部署》。

#### 4.2.1 补传历史 blockmap（漏删时的补救）

`deploy.mjs installer` 只传当前版三件 —— **历史版的 blockmap 要单独补**：

```bash
# 1) 先落 /tmp（下载目录是 root 属主）
scp -i ~/.ssh/wishfulclaw_deploy release/wishful-claw-1.0.{M}-setup.exe.blockmap \
    ubuntu@119.45.103.252:/tmp/wc-patch.blockmap

# 2) 归位 + 权限 + 校验
ssh -i ~/.ssh/wishfulclaw_deploy ubuntu@119.45.103.252 \
  "sudo mv -f /tmp/wc-patch.blockmap '/data/downloads/wishfulclaw/wishful-claw-1.0.{M}-setup.exe.blockmap' \
   && sudo chown root:root '/data/downloads/wishfulclaw/wishful-claw-1.0.{M}-setup.exe.blockmap' \
   && sudo chmod 644 '/data/downloads/wishfulclaw/wishful-claw-1.0.{M}-setup.exe.blockmap' \
   && sha512sum '/data/downloads/wishfulclaw/wishful-claw-1.0.{M}-setup.exe.blockmap'"

# 3) 线上确认（sha512 应与本地 Get-FileHash -Algorithm SHA512 一致，且返回 200）
curl -s -o /dev/null -w '%{http_code}\n' \
  https://wishful-claw.work/downloads/wishful-claw-1.0.{M}-setup.exe.blockmap
```

历史 blockmap 从哪来：GitHub Release 对应 tag 的资产里那份。

> ⚠️ **Windows 的 `ssh.exe` 会把参数里的引号吃掉**，多行脚本不要直接拼在命令行上（远端 bash 会
> 报语法错）。最稳的传法是 base64：
> `$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))`，再
> `ssh … "echo $b64 | base64 -d | bash"` —— base64 只含 `A-Za-z0-9+/=`，不被任何一层改写。
> 2026-10-08 补传 0.2.36 的 blockmap（118,949 B）与验证新清理逻辑都是这么跑的。

#### 4.2.2 官网统计口径（下载次数 / 访问次数，S-182）

官网的「下载次数」与「访问次数」全部来自 **nginx 日志的定时聚合**（现为每 5 分钟一次）—— **没有后端服务、没有前端埋点**。

**三个日志源（互不重叠，各自去重后相加）**：

| 日志 | 内容 | 对应指标 | nginx 落点 |
|---|---|---|---|
| `/var/log/nginx/access.log` | 页面访问（`/`、`/download`、`/guide`、`*.html`） | **访问次数**（PV） | 默认 |
| `/var/log/nginx/wishfulclaw-clicks.log` | 官网点下载（中转页 `/go`） | 下载次数 · `web_click` | snippet `location = /go` |
| `/var/log/nginx/wishfulclaw-downloads.log` | 安装包被下载 | 下载次数 · `web_download_local`（浏览器）/ `app_update`（updater） | snippet `location ^~ /downloads/` |

- **`/downloads/` 原来是 `access_log off`** —— S-182 起改为记录；`latest.yml`（检查更新）与 `.blockmap` **不计入**。
- **下载的两个来源靠 UA 分**：含 `electron-updater` / `electron-builder` ⇒ 应用内自动更新，否则 ⇒ 官网点的「本站直链」。
- **中转页 `/go` 不写任何上报代码** —— 页面请求本身就被 nginx 记下。location 里写了 `access_log` 会**覆盖** server 级的 ⇒ `/go` 的请求不会同时进 `access.log`（这是「两源正交」的前提）。

**计数规则**：按「客户端 IP + User-Agent + 文件名」去重，**窗口 1 小时**（实现上按小时桶）。这样并掉浏览器多线程 `Range` 与 updater 的分段请求；代价是 NAT 出口同小时的多人并成 1 次。

**机器人过滤**：UA 为空或含 `bot|spider|crawl|scan|curl|wget|python-requests|zgrab|masscan|headless` 的行不计入，日文件里单独记 `filtered_bots`。

**服务器侧文件**：

```
/etc/nginx/conf.d/wishfulclaw-logs.conf      ← log_format wishfulclaw_dl（log_format 只能在 http 上下文）
/etc/nginx/snippets/wishfulclaw-site.conf    ← /go、/stats.json、/downloads/ 的 access_log
/usr/local/bin/wishfulclaw-stats.sh          ← 聚合脚本（cron 调用，也可手工 sudo 跑）
/data/stats/baseline.json                    ← 冻结的历史累计（含 100 补偿，带 as_of）
/data/stats/summary.json                     ← 对外累计 = baseline + 最近 KEEP_DAYS 天（明细在 .recent）
```

- cron：`*/5 * * * * /usr/local/bin/wishfulclaw-stats.sh >> /var/log/wishfulclaw-stats.log 2>&1`（**追加**一条，不动既有的 stargate 心跳与证书自检两条）。
  - **2026-10-13 由 `25 4 * * *` 改为每 5 分钟** —— 每日一次时页面数字最长滞后近 24 小时（老大反馈「访问次数滞后严重」）。脚本是幂等全量重算，14 天日志合计约 1 MB，5 分钟一轮毫无压力。
- ⚠️ **聚合脚本必须读全部分片，不能只 glob `*.gz`**：logrotate 是 `compress` + **`delaycompress`** ⇒ 最新一份轮转日志是未压缩的 `*.log.1`。原实现只读 `<base>` 与 `<base>.*.gz`，把 `.log.1` **整个漏掉** ⇒ **每天只统计到 00:00~04:25 那一段（约 20%），跨日轮转后那天的日文件永久冻结**。2026-10-13 实测：10-12 记 41，实际 416 条；`clicks` 里 6 次真实点击也被吞掉。修法：遍历 `"$base".[0-9]*`，`.gz` 走 `zcat`、其余 `cat`（用 `if [ -f "$base" ]` 而非 `[ -f ] && cat`，避免撞 `set -e`）。
- **存储只有两个文件**（老大 2026-10-13 定）：`baseline.json`（冻结的历史累计）+ `summary.json`（对外累计）。**不存日文件**。
  - `baseline.json` = `{ as_of, days, downloads, visits, sources, seeded_downloads }`，`as_of` 是**已折叠的最后一天**。
  - `summary.json` = `baseline` + 最近 `KEEP_DAYS` 天，逐字段相加；`days` 也是两段相加；最近几天的明细内嵌在 `summary.recent`（数组，每天一条，含 `sources` / `filtered_bots`）。
  - **滑出窗口的那天直接从 nginx 日志重算后折进 baseline**，不经中间产物 —— 窗口 3 天 < 日志 15 天，那天必然还在日志里。
- **累计下载数带 100 的补偿基线**（老大 2026-10-13 定）：上面那批历史漏计已随 14 天轮转丢失、无法回填，统一加 100 兜底，顺带让页面上「已下载 N 次」（不足 100 不显示）能显出来。**只在 `baseline.json` 首次生成时注入一次**（`SEED_DOWNLOADS=100`），之后就长在 `baseline.downloads` 里、**不每轮再加**（老大二次口径）。`summary.seeded_downloads` 透传该值供报表标注，`sources` 明细保持真实值。
- 聚合**幂等**：每次跑都按**日志内容**重算保留窗口内出现过的每一天；已折叠的天不会再算。
- **保留窗口默认 3 天**（`KEEP_DAYS=3`，今天 + 前 2 天）。实测一次聚合 **221 ms**（2026-10-13）。
  - ⚠️ **窗口起点取「`cutoff`」与「`baseline.as_of` 的次日」二者的较大者** —— 少了这道守卫，放大 `KEEP_DAYS` 回填时窗口会把**已折叠的天**再算一遍，与 baseline **双算**。
  - **折叠区间 = `[as_of + 1, cutoff - 1]`**；放大 `KEEP_DAYS` 时该区间天然为空，不会重复折叠。
  - 服务器时区就是 `Asia/Shanghai`（与 nginx 日志的 `+0800` 一致），`date -d "$((KEEP_DAYS-1)) days ago"` 直接取窗口起点，**不需要 TZ 换算**。
  - **折叠是单向的**：折进 baseline 就回不来。所以「窗口内（3 天）发现的问题」救得回来，超窗就没了 —— 放大 `KEEP_DAYS`（上限 15，= logrotate 的 `rotate 14` 加当前那一份）只扩大**重算**范围，**不能复活已折叠的天**。2026-10-13 实测：`09-26`~`09-28` 是旧脚本（漏读 `.log.1`）留下的低估值，日志已轮转掉，折叠时即固化，**永久无法修正**（那几天 downloads 都是 0，未污染下载数）。
  - 折叠**能自愈**：把 `baseline.as_of` 人为退回一天并扣掉对应数值，跑一次即自动从日志补回（`as_of` / `days` / `visits` 全部复原）—— 2026-10-13 实测过。
- ⚠️ **`/data/stats` 与 `/data/downloads/wishfulclaw` 同理，刻意放站点目录之外** —— `deploy site` 是整目录原子替换，放站点里会被清掉。对外由 `location = /stats.json { alias /data/stats/summary.json; expires -1; }` 提供。
- ⚠️ **这里别用 `add_header Cache-Control`** —— 会吃掉该 location 的安全头（见 snippet 文件头注释），用 `expires -1`。

**本地看报表**：

```bash
node scripts/site-stats.mjs            # 累计 + 最近 7 天
node scripts/site-stats.mjs --days 30
node scripts/site-stats.mjs --json     # 原样打印 summary.json
```

**前端展示**：`website/src/lib/site-stats.ts` 拉 `./stats.json`，下载页注脚显示「已下载 N 次」、全站 footer 显示「访问 N 次」。**不足 100 次不显示**（数字从 0 起算，不造假起点）；取不到 JSON 时整段不显示、不报错。

**已知偏差**：数的是「**点击**」（进了中转页），不是「加速站真实传输完成」—— 第三方不回报，这是能拿到的最接近分发量的数。

### 4.3 创建 GitHub Release（存档）

gh CLI 在固定路径 `D:\claw\tools\gh\bin\gh.exe`（**不在 PATH，必须绝对路径**调用）。

```bash
# 先把 notes 写到固定路径：.wishful-claw/notes/release-notes-v1.0.{N}.md（按下面模板写）
/d/claw/tools/gh/bin/gh.exe release create v1.0.{N} \
  --repo wishful-73/wishful-claw \
  --title "v1.0.{N}" \
  --notes-file ".wishful-claw/notes/release-notes-v1.0.{N}.md"
```

- 直连失败加代理前缀：`HTTPS_PROXY=http://127.0.0.1:7897 /d/claw/tools/gh/bin/gh.exe ...`
- gh 不可用时用浏览器手建：Releases → Draft a new release → 选 tag → 填 notes → Publish

#### Release notes 模板（固定）

**基准 = v0.2.29 的写法，后续版本一律照此，不要每版换格式。**

写 notes 前先用 `git log v1.0.{N-1}..v1.0.{N} --oneline` 拉一遍本迭代的提交（提交粒度已是一个需求一刀，提交标题可直接当素材）。

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

- 标题固定 `## 迭代 {N}` —— **不写** `v1.0.{N}` 前缀，**不加** `— v2-iter-{N}` 之类的后缀
- 正文第一段是**范围概括**，不是标题的重复
- 小节名固定这三个：`### 新增能力` / `### 修复` / `### 校验`。不要写「新增」「优化」「其它修复」「验证」这类同义变体
- 条目固定 `- **{名字}（{编号}）** — {说明}`：**编号在括号内跟在名字后面**，不要写成 `- **S-26 名字** —`
- 条目一律写**用户视角**：说清「解决什么问题 / 怎么用」。**不写 commit hash、不写文件路径、不写实现细节**（那些在 `docs/progress/` 里）
- 确实需要用户知晓的限制或不兼容，在 `### 校验` **之后**加 `### 已知限制` —— 这是**唯一**允许的可选小节

#### 一份真源喂两个发布面

收尾时写的**那一份** `.wishful-claw/notes/release-notes-v1.0.{N}.md` 同时喂两个面，不另写第二份、不靠人工对齐：

| 面 | 喂法 | 谁读 |
|---|---|---|
| GitHub Release 正文（存档） | `gh release create --notes-file …`（见上） | 人 —— 找旧版 / 回滚时看 |
| 官网下载目录（应用内弹窗） | `deploy.mjs installer` 把它传成 `release-notes-{N}.md` | 应用 —— `src/main/lib/release-notes.ts` 按版本拉 |

**为什么放清单外**：`latest.yml` 由 electron-builder 生成，本项目没配 `releaseInfo`、也没有
`build/release-notes.md`，所以清单里**没有 `releaseNotes` 字段**。说明只能单独放一份，由客户端按自己那一版
去清单同目录拉。**清单不带 `releaseNotes` 是正常状态，不是缺陷。**

**拉不到就显示空态**：404 / 超时 / 空文档 / 版本对不上，一律当「没有说明」—— **绝不回落显示上一版的说明**
（文件名带版本号就是为了这个）。与 blockmap 那条同一取向：宁缺勿错。

> ⚠️ **过渡期：0.2.38 的 `latest.yml` 仍要手工补 `releaseNotes`**
>
> 已发出去的 ≤ 0.2.37 客户端**只认清单内联说明**（那时还没有兜底拉取这个能力）。若 0.2.38 的清单是干净的，
> **0.2.37 用户升上来反而一个字都看不到**。所以这一次照旧，在打包生成 `release/latest.yml` 之后手工内联：
>
> ```yaml
> releaseNotes: |
>   ## 迭代 38
>
>   ...（notes 文件的原文，每行缩进两格）
> ```
>
> 只动 `latest.yml`：exe / blockmap 不变，清单里的 `sha512` 是 exe 的，不受影响。内联内容与官网
> `release-notes-0.2.38.md`、GitHub 正文**仍是同一份**。**真正「清单干净」最早从 0.2.39 起** —— 那时线上
> 客户端都已具备兜底拉取能力。

**上传顺序**：`deploy.mjs installer` 把说明与三件一次打包上传，不存在「清单先到、说明还没到」的空窗。
**若手工分传，说明 md 必须先传、`latest.yml` 后传。**



tag message 与 Release notes 分工：**前者一行亮点摘要，后者完整清单**。

```bash
git tag -a v1.0.{N} -m "v2-iter-{N}: {亮点1 + 亮点2 + 亮点3} - 验证通过"
```

亮点用 ` + ` 连接，取本迭代最值得说的几件事（3~5 个为宜），不写编号、不写「N 项需求」这种计数。

### 4.4 上传资产到 Release（存档）

```bash
# setup.exe + latest.yml 必须一起传
/d/claw/tools/gh/bin/gh.exe release upload v1.0.{N} \
  --repo wishful-73/wishful-claw \
  "release/wishful-claw-1.0.{N}-setup.exe" \
  "release/latest.yml" \
  --clobber

# .blockmap 若生成，也必须传到同一个 Release
/d/claw/tools/gh/bin/gh.exe release upload v1.0.{N} \
  --repo wishful-73/wishful-claw \
  "release/wishful-claw-1.0.{N}-setup.exe.blockmap" \
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
- **最近 5 版的 `downloads/<setup>.exe.blockmap` 均非 404** —— 历史版 `.exe` 返回 404 是正常的
  （官网不放历史安装包），但 blockmap 必须在，逐版 curl 一遍确认（见 4.2 保留策略）
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
release/wishful-claw-1.0.{N}-setup.exe
release/wishful-claw-1.0.{N}-setup.exe.blockmap
release/latest.yml
```

清掉更早版本：

```powershell
$keep = '1.0.{N}'   # 换成刚发布的版本号
Get-ChildItem release -File |
  Where-Object { $_.Name -match '^wishful-claw-\d+\.\d+\.\d+-' -and $_.Name -notlike "*$keep*" } |
  Remove-Item -Force
```

> ⚠️ **正则不许写死 `0\.2\.`** —— 转正 `1.0.0` 时踩过：`'^wishful-claw-0\.2\.\d+-'` 匹配不上 `wishful-claw-1.0.0-setup.exe`，
> 清理**静默失效**（不报错、旧包一直堆着）。一律用 `\d+\.\d+\.\d+`，跨大版本无需再改。

> 📌 **实测**：iter-31 收尾时 `release/` 攒了 `0.2.23` ~ `0.2.31` 共 9 个版本、**4.9 GB**；2026-09-18 按本节清理后降到 **521 MB**。

**历史版本目录才是大头，也要一并清** —— 每个旧版本目录（如 `v0.2.31/`）里都躺着一份完整的 `win-unpacked/`（300~570 MB），比根下的安装包还占地方：

```powershell
Get-ChildItem release -Directory | Where-Object { $_.Name -match '^v\d+\.\d+\.\d+$' } | Remove-Item -Recurse -Force
```

清理后 `release/` 应只剩当前版本相关的东西：

| 保留 | 说明 |
|------|------|
| `wishful-claw-1.0.{N}-setup.exe` + `.blockmap` | 当前版安装包（本地回滚用） |
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
