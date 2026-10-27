# 反馈服务部署（S-226）

> 从零到能用。命令都在服务器上跑（`ssh -i ~/.ssh/wishfulclaw_deploy ubuntu@119.45.103.252`）。
> 本文件随 `deploy/feedback/` 一起入库，和代码同版本 —— 别在别处另写一份。

## 0. 为什么服务不在站点目录里

`deploy site` 是**整目录原子替换**（`mv` 旧的、`mv` 新的）。服务与数据库放进
`/data/sites/wishfulclaw` 等于每次发官网清一次库。

所以：

| 东西 | 位置 |
|---|---|
| 对外静态产物 | `/data/sites/wishfulclaw`（每次发布整目录替换） |
| 反馈服务代码 | `/data/services/wishfulclaw-feedback/app` |
| 反馈数据库 | `/data/services/wishfulclaw-feedback/feedback.db` + `-wal` + `-shm` |
| 日志 | `/data/services/wishfulclaw-feedback/feedback.log` |
| 管理口令 | `/data/services/wishfulclaw-feedback/.htpasswd` |
| 备份 | `/data/backup/wishfulclaw-feedback/` |

## 1. 前置

```bash
node -v          # 需要 >= 20（服务器实测 v22.22.1）
sqlite3 --version || sudo apt-get install -y sqlite3
# 服务进程本身不依赖 sqlite3 CLI，但**备份脚本依赖**（sqlite3 .backup）。
# 不装的话每天 04:17 的备份会失败 —— 2026-10-27 首次部署就踩了，已装 3.45.1。
```

## 2. 上传代码与依赖（一条命令）

日常发布**不用手工 scp** —— `deploy.mjs site` 会把 `server/feedback/` 一起发上去：

```bash
node scripts/deploy.mjs site            # 构建官网 + 同步反馈服务 + 重启 + 自检
node scripts/deploy.mjs site --no-api   # 只发静态站，不动服务
```

脚本做的（都可重复跑，幂等）：

1. 本地打 tar（排除 `node_modules`）→ scp 到 `/tmp`
2. 远端 `rsync -a --delete` 覆盖代码 —— `node_modules` / `*.db*` / `*.log` / `.htpasswd` / `backup.sh` 一律不动
3. `package.json` 的 sha256 变了（或从没装过依赖）才 `npm install --omit=dev`
4. 写 systemd 单元 → `daemon-reload` → `enable` → `restart`
5. 写 logrotate、备份 cron（crontab 里 grep -v 去重，不会攒出两条）
6. `curl 127.0.0.1:7860/api/health` 自检 + 检查 nginx 是否已贴 `/api/` 片段

**首次跑额外做**：建 `/data/services/wishfulclaw-feedback`、生成管理口令（见 §4，只打印一次）。
**nginx 片段不自动改**（改错一个字符整站挂）—— 缺了脚本会明确提示，按 §6 手工贴。

<details>
<summary>手工上传（脚本不通时的兜底）</summary>

```bash
cd server/feedback
scp -i ~/.ssh/wishfulclaw_deploy -r \
  app.mjs cli.mjs package.json package-lock.json lib admin \
  ubuntu@119.45.103.252:/data/services/wishfulclaw-feedback/app/
```

```bash
cd /data/services/wishfulclaw-feedback/app
npm install --omit=dev
node -e "import('better-sqlite3').then(m=>console.log('driver ok', typeof m.default))"
```
</details>

## 2.1 本地开发

官网本地也是一条命令（前端 + 反馈服务，数据落 `.wishful-claw-dev/feedback/`，与 dev 实例隔离目录同源）：

```bash
cd website
npm run dev                  # 前端 5280 + 反馈服务 7860
npm run dev -- --web-only    # 只前端（不改反馈那块够用）
npm run dev:api              # 只反馈服务
npm run preview              # 预览构建产物 + 反馈服务
```

对外只有一个地址 `http://localhost:5280/`，`/api` 由 vite 代理转给 7860（`vite.config.ts` 的 `apiProxy`）。
7860 已被占用时脚本会**复用**现有服务，不重复起第二份。

## 3. 先手动跑一次，确认能起

```bash
cd /data/services/wishfulclaw-feedback/app
WC_FEEDBACK_DIR=/data/services/wishfulclaw-feedback WC_FEEDBACK_PORT=7860 node app.mjs
```

另一个终端：

```bash
curl -s http://127.0.0.1:7860/api/health
# {"code":0,"msg":"ok","data":{"up":true}}
```

通了再 Ctrl+C 换成 systemd —— 别在「手动都起不来」的状态下去配服务。

## 4. 管理口令（basic auth）

用户名固定 **`alwy`**（老大 2026-10-26 17:17 指定，不用 `admin` 这种通用名）。

> `deploy.mjs site` 首次跑会**自动生成**这份口令（用 `openssl passwd -apr1`，不依赖 apache2-utils），
> 只在日志里打印一次；文件已存在就绝不覆盖。
> 下面是手工兜底 / 主动改密码时用。

```bash
sudo apt install -y apache2-utils          # 提供 htpasswd
# 密码用 24 位随机串，别用可猜的
PASS=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-24)
htpasswd -c -b /data/services/wishfulclaw-feedback/.htpasswd alwy "$PASS"

# ⚠️ 属主必须是 root:www-data、权限 640。
# 曾经写成 chmod 600 + ubuntu 属主，结果 nginx worker 读不到，管理页直接 500：
#   [crit] open() "/data/services/wishfulclaw-feedback/.htpasswd" failed (13: Permission denied)
sudo chown root:www-data /data/services/wishfulclaw-feedback/.htpasswd
sudo chmod 640 /data/services/wishfulclaw-feedback/.htpasswd

echo "用户名 alwy  密码 $PASS"     # ← 抄进会话给老大，然后不要留在任何文件里
```

`.htpasswd` 天然支持多行，心相运营站点复用时直接 `htpasswd -b 同一个文件 另一个用户名 密码`。

## 5. systemd

> `deploy.mjs site` 每次都会覆盖这个单元文件并 `restart`，不用手工 cp。
> 下面是从零手装时的步骤。

```bash
sudo cp wishfulclaw-feedback.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wishfulclaw-feedback
systemctl status wishfulclaw-feedback --no-pager
tail -n 5 /data/services/wishfulclaw-feedback/feedback.log
```

日志里应能看到 `feedback service listening on 127.0.0.1:7860`。

## 6. nginx

把 `nginx-location.conf` 里的两个 `location`（实际是三段：`^~ /api/`、`= /admin/feedback` 跳转、
`^~ /admin/feedback/`）贴进 `wishful-claw.work` 的 **443 server 块**
（**不要动静态站原有的 location**），然后：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

> 2026-10-27 已在服务器上贴好（改动落在 `/etc/nginx/sites-available/wishfulclaw` 的 443 块，
> 改前备份为 `wishfulclaw.bak-<时间戳>`）。验收：`/api/health` 200、管理页无口令 401、
> 带口令 200、不带尾斜杠 301。脚本 `deploy.mjs site` 只**检测**是否已贴，不会自动改这一段。

## 7. 日志轮转 + 备份

```bash
sudo cp logrotate.conf /etc/logrotate.d/wishfulclaw-feedback
sudo logrotate -d /etc/logrotate.d/wishfulclaw-feedback      # -d 只演练不真转

sudo cp backup.sh /data/services/wishfulclaw-feedback/backup.sh
sudo chmod +x /data/services/wishfulclaw-feedback/backup.sh
sudo /data/services/wishfulclaw-feedback/backup.sh            # 先手动跑一次

# root crontab 每天 04:17
( sudo crontab -l 2>/dev/null; echo '17 4 * * * /data/services/wishfulclaw-feedback/backup.sh >> /var/log/wishfulclaw-feedback-backup.log 2>&1' ) | sudo crontab -
```

## 8. 验收（四条，必须全过）

```bash
# ① 提交 → code=0，data.id 有值
curl -s -X POST https://wishful-claw.work/api/feedback \
  -H 'content-type: application/json' \
  -d '{"type":"bug","title":"部署自测","content":"这条是我部署时提的，稍后驳回","product":"wishfulclaw","website":""}'

# ② 公开读 → 刚才那条**不能**出现（它是 pending）
curl -s https://wishful-claw.work/api/feedback

# ③ 蜜罐 → code=10004
curl -s -X POST https://wishful-claw.work/api/feedback \
  -H 'content-type: application/json' \
  -d '{"type":"bug","title":"x","content":"y","website":"http://spam"}'

# ④ 管理面未带口令 → 401；带口令能出页面
curl -s -o /dev/null -w '%{http_code}\n' https://wishful-claw.work/admin/feedback/
curl -s -u alwy:"$PASS" -o /dev/null -w '%{http_code}\n' https://wishful-claw.work/admin/feedback/
```

然后把我自己提的那条驳回（`node cli.mjs set <id> rejected`），别让测试数据留在库里。

## 9. 日常

```bash
cd /data/services/wishfulclaw-feedback/app
node cli.mjs stats
node cli.mjs list --status pending
node cli.mjs set 12 todo
node cli.mjs note 12 "并入 S-233，下个版本修"

systemctl restart wishfulclaw-feedback       # 改了 admin/index.html 要重启（启动时读一次）
```

## 10. 排障

| 现象 | 先看什么 |
|---|---|
| 提交一直 `网络好像不通` | `curl 127.0.0.1:7860/api/health` 通不通；不通看 `journalctl -u wishfulclaw-feedback -n 50` |
| 提交返 90001（存储层失败） | `feedback.log` 里的 `ERROR` 行；多半是 `/data` 权限或磁盘满 |
| 管理页 500 | `.htpasswd` 权限（要 `600` 且属主可读）、`/data/services/...` 是否可读 |
| 前端拿到 HTML 而不是 JSON | nginx 片段里的 `proxy_intercept_errors off` 漏了 |
| 日志不更新了 | logrotate 用了 `create` 而不是 `copytruncate` |
| 库文件突然变小 | 有人手动 `cp` 当备份了；WAL 下这样会丢数据，改用 `.backup` |
