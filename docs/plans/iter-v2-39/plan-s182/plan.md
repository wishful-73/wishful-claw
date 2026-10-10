# Plan: S-182 官网侧统计 —— 记录「下载次数」与「访问次数」

> 所属迭代：iter-v2-39 ｜ 需求明细：[`../requirements/S-182.md`](../requirements/S-182.md)
> 类型：**服务器侧 + 官网侧** —— 主仓**业务代码零改动**；与软件版本号无关，**不阻塞发版**。
> **与 [S-186](../requirements/S-186.md) 一起收口**：S-186 落前端（下载按钮 + 中转页），S-182 落服务器 nginx 与聚合（含 `/go` 的 location 与 `clicks` 日志）。

---

## 一、目标

在官网下载页展示**下载次数**、在全站 footer 展示**访问次数**。数字来自服务器 nginx 日志的**每日聚合**（长期累积），**不新增后端服务**、**不写前端埋点**。

---

## 二、口径（已定）

| # | 事项 | 定 | 出处 |
|---|---|---|---|
| 1 | **下载次数** = 安装包被下载的总次数 | **官网点击 + 应用内自动更新都算** | 老大 10-10 08:35 |
| 2 | `latest.yml`（检查更新）/ `*.blockmap` | **不计入** | 老大 08:33 |
| 3 | 官网点击那一半 | 由**官网中转页 `/go`**（S-186）补 —— 页面请求即计数，**中转页不写任何上报代码** | 老大 10:21 / 10:38 |
| 4 | 访问次数 | **公开**，显示在**全站 footer** | 老大 08:41 |
| 5 | 计数规则 | **按 `客户端 IP + User-Agent + 文件名` 去重，窗口 1 小时** | 助手方案（`S-182.md` §四） |
| 6 | 两个日志源 | **正交、不重叠** ⇒ **各自去重后相加** | 10:21 修订 |

**计数规则的理由**：`electron-updater` 的**差分下载只发带 `Range` 的段请求**，可能**没有一次完整 GET** ⇒ 不能用「无 Range 的首次请求」计数，否则会把自动更新全漏掉。

### 实施细节（助手拍定，非老大裁定）

| # | 事项 | 定案 |
|---|---|---|
| 1 | 聚合位置 | **服务器侧每日 cron** 落 `/data/stats/YYYY-MM-DD.json` + `summary.json`（长期累积，不受 14 天轮转窗口限制） |
| 2 | 官网读哪份 | nginx 新增 `location = /stats.json` → `alias /data/stats/summary.json`（⚠️ **不能**写进站点目录 —— `deploy site` 是整目录原子替换，会覆盖） |
| 3 | `log_format` 落点 | snippet 是 **server 上下文**，`log_format` 只能在 **http 上下文** ⇒ 新建 `/etc/nginx/conf.d/wishfulclaw-logs.conf` 定义格式，snippet 里引用 |
| 4 | 起始口径 | 数字**从 0 起算**（历史无法回溯）；**不足 100 次不显示**（不造假起点） |
| 5 | 机器人 | **过滤**明显扫描器 / 爬虫（UA + 路径），报表标注「已过滤 N 条」 |
| 6 | 访问次数指标 | 显示 **PV（累计访问次数，已过滤机器人）**；后台报表保留 **PV + UV** 与分页维度 |
| 7 | 后台报表 | 保留**分源明细**：`web_click` / `web_download_local` / `app_update` |

---

## 三、步骤清单

- [ ] **步骤 1：nginx 日志格式与落点**
  - 新建 `/etc/nginx/conf.d/wishfulclaw-logs.conf`（**http 上下文**）：
    ```nginx
    log_format wishfulclaw_dl '$remote_addr - $remote_user [$time_local] "$request" '
                              '$status $body_bytes_sent "$http_referer" "$http_user_agent" '
                              'range="$http_range" xff="$http_x_forwarded_for"';
    ```
  - 改 `/etc/nginx/snippets/wishfulclaw-site.conf`：
    - `/downloads/` 的 `access_log off;` → `access_log /var/log/nginx/wishfulclaw-downloads.log wishfulclaw_dl;`
    - 新增 `location = /go { access_log /var/log/nginx/wishfulclaw-clicks.log combined; try_files $uri.html =404; }`
    - 尾斜杠正则补 `go`：`location ~ ^/(download|guide|changelog|go)/$ { return 301 /$1; }`
    - 新增 `location = /stats.json { alias /data/stats/summary.json; add_header Cache-Control "no-store"; }`
  - **验证检查点**：`sudo nginx -t` 通过；`sudo systemctl reload nginx` 后 `curl -I https://wishful-claw.work/downloads/latest.yml` 与 `curl -I https://wishful-claw.work/go?...` 各产生一条对应日志（`ls -la /var/log/nginx/wishfulclaw-*.log` 有增长）。
- [ ] **步骤 2：建统计目录与部署脚本落点**
  - `sudo mkdir -p /data/stats && sudo chown www-data:www-data /data/stats`（nginx 要读 `summary.json`）。
  - 服务器聚合脚本落 `/usr/local/bin/wishfulclaw-stats.sh`（与既有 `wishfulclaw-cert-check.sh` 同址、同风格）。
  - **验证检查点**：目录存在且属主正确；`sudo -u www-data test -r /data/stats` 通过。
- [ ] **步骤 3：服务器聚合脚本**
  - 逐日抽取 `wishfulclaw-downloads.log` + `wishfulclaw-clicks.log` 中**前一天**的记录（已轮转的 `.gz` 一并读，`zcat`）；
  - 按 §二 规则去重计数；分离机器人；按来源归类（`web_click` / `web_download_local` / `app_update`）；
  - 写 `/data/stats/YYYY-MM-DD.json` 与累加后的 `/data/stats/summary.json`（含 `downloads_total` / `visits_total` / `generated_at` / `sources`）；
  - 幂等：同日重跑覆盖当日文件、`summary.json` 由全部日文件重算（避免累加漂移）。
  - cron：照既有证书自检的写法加一条（**不要动现有两条**）—— `25 4 * * * /usr/local/bin/wishfulclaw-stats.sh >> /var/log/wishfulclaw-stats.log 2>&1`。
  - **验证检查点**：手工跑一次脚本 ⇒ 两个 JSON 生成、字段齐全、数字为非零（若日志已有数据）；隔日重跑幂等。
- [ ] **步骤 4：本地查看脚本 + 入库**
  - 新建 `D:\claw\wishful-claw\scripts\site-stats.mjs`：复用 `deploy.mjs` 的 `ssh()` 式写法（**stdin 传 bash 脚本**，绕开 Windows 转义），拉取 `/data/stats/summary.json` 并打印报表（总下载 / 总访问 / 分源明细）。
  - ⚠️ **`.gitignore` 白名单**：`L57 scripts/*` 会忽略新文件，需在 `L61` 后加 `!scripts/site-stats.mjs`（与既有四个白名单项同风格）。
  - **验证检查点**：`node scripts/site-stats.mjs` 能打印报表；`git status --porcelain` 显示该文件**未被忽略**。
- [ ] **步骤 5：官网展示（前端，与 S-186 同批部署）**
  - 新增 `website/src/lib/site-stats.ts`：`fetch('./stats.json', { cache: 'no-store' })`，含**失败静默**与「不足 100 次不显示」。
  - `website/src/download-page.tsx` 注脚（参考 `:32-39`）追加 `· 已下载 N 次`。
  - `website/src/sections/site-footer.tsx`（46 行）：在**左列链接组**（`:13-20`）追加「访问 N 次」。
  - **验证检查点**：`website: npm run typecheck` 零错误；本地 `npm run dev` 配合一份样例 `stats.json` 渲染正确；拿不到 JSON 时**不报错、不显示 0**。
- [ ] **步骤 6：口径留档（不入版本库的部分）**
  - 在 `docs/release-workflow.md` 补一小节「官网统计口径」（log_format / 日志路径 / 去重规则 / cron / `/data/stats` 结构），使换机器后口径不丢。
  - **验证检查点**：文档能独立复现整套配置（逐条对得上步骤 1~3 的实际值）。
- [ ] **步骤 7：部署与端到端实测**
  - 部署：服务器配置改动（步骤 1~3）+ `node scripts/deploy.mjs site`（步骤 5 的前端）。
  - 实测：点一次加速站选项 ⇒ `clicks` 日志 +1；点一次本站直链 ⇒ `downloads` 日志 +1；跑一次脚本 ⇒ 页面上数字变化。
  - **验证检查点**：三件事逐条亲眼确认；页面显示的数字与 `summary.json` 一致。

---

## 四、涉及文件

| # | 侧 | 位置 | 动作 |
|---|---|---|---|
| 1 | 服务器 | `/etc/nginx/conf.d/wishfulclaw-logs.conf` | **新建**（`log_format`） |
| 2 | 服务器 | `/etc/nginx/snippets/wishfulclaw-site.conf` | 改 —— 下载日志 / `/go` / 301 正则 / `/stats.json` |
| 3 | 服务器 | `/usr/local/bin/wishfulclaw-stats.sh` | **新建**（聚合，cron 调用） |
| 4 | 服务器 | `/data/stats/` | **新建**（JSON 产物） |
| 5 | 服务器 | root crontab | 改 —— **追加**一条（不动现有两条） |
| 6 | 本地 | `scripts/site-stats.mjs` | **新建**（查看报表，入库） |
| 7 | 本地 | `.gitignore` | 改 —— 加白名单 `!scripts/site-stats.mjs` |
| 8 | 官网 | `website/src/lib/site-stats.ts` | **新建** |
| 9 | 官网 | `website/src/download-page.tsx` | 改 —— 注脚加下载次数 |
| 10 | 官网 | `website/src/sections/site-footer.tsx` | 改 —— 加访问次数 |
| 11 | 文档 | `docs/release-workflow.md` | 改 —— 补「官网统计口径」小节 |

**不动**：主仓 `src/**`；`scripts/deploy.mjs` 的现有子命令（只**追加**一个 `site-stats` 子命令用于部署步骤 2/3 的服务器文件）。

---

## 五、参考源码

- `scripts/deploy.mjs`（**不入版本库**）—— `ssh()`（`:156-177`，**bash 走 stdin**）、`upload()`（`:180-184`）、`deploySite()`（`:199`，含 `sudo` + 原子替换）、`CFG`（`:64-88`）；本需求的新子命令照它的形状写。⚠️ **不要动 `deploySite` 的原子替换** —— 步骤 5 的 `stats.json` 因此**不能**放站点目录。
- `/usr/local/bin/wishfulclaw-cert-check.sh`（服务器）—— 既有 cron 脚本风格模板。
- `website/src/lib/site-data.ts:12` —— `fetch('./downloads/latest.yml', { cache: 'no-store' })`，步骤 5 的取数写法照它。
- `docs/release-workflow.md` L131-203（`4.2 上传到官网下载目录`）、L195-196（`deploy.mjs` 不入库的理由）—— 口径留档落点。
- 无外部参考项目。

---

## 六、风险

1. **`nginx -t` 需要 sudo**（证书目录 root 0700）—— 步骤 1 的验证项必须带 `sudo`，否则会看到误导性的 `Permission denied`。
2. **两个 server 块都会记下载**（IP 直访 + HTTPS 域名）—— 聚合时无需区分，但要知道 IP 直访流量也计入。
3. **`/data` 与 `/data/downloads/wishfulclaw/` 属主 `root:root`** —— 建目录与部署需 `sudo`。
4. **`scripts/` 是白名单制** —— 忘了加 `!scripts/site-stats.mjs` 会导致脚本不入库而悄悄丢失。
5. **不能动现有两条 crontab**（`stargate` 心跳 + 证书自检）—— 只追加。
6. **数字从 0 起算**，页面初始很难看 ⇒ 已定「不足 100 次不显示」，**不造假起点**。
7. **数的是「点击」不是「下载完成」**（走加速站那段的传输量第三方不回报）—— 已知偏差，记为最佳可得近似。
