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
sqlite3 --version || sudo apt install -y sqlite3    # 运维查库要用，服务本身不依赖 CLI
```

## 2. 上传代码

在**本地**仓库根跑（`scripts/` 被 gitignore，别指望 rsync 整个仓库）：

```bash
cd server/feedback
scp -i ~/.ssh/wishfulclaw_deploy -r \
  app.mjs cli.mjs package.json lib admin \
  ubuntu@119.45.103.252:/data/services/wishfulclaw-feedback/app/
```

然后服务器上装依赖（`better-sqlite3` 首次会编译，编译链已实测齐全）：

```bash
cd /data/services/wishfulclaw-feedback/app
npm install --omit=dev
node -e "import('better-sqlite3').then(m=>console.log('driver ok', typeof m.default))"
```

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

```bash
sudo apt install -y apache2-utils          # 提供 htpasswd
# 密码用 24 位随机串，别用可猜的
PASS=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-24)
htpasswd -c -b /data/services/wishfulclaw-feedback/.htpasswd alwy "$PASS"
chmod 600 /data/services/wishfulclaw-feedback/.htpasswd
echo "用户名 alwy  密码 $PASS"     # ← 抄进会话给老大，然后不要留在任何文件里
```

`.htpasswd` 天然支持多行，心相运营站点复用时直接 `htpasswd -b 同一个文件 另一个用户名 密码`。

## 5. systemd

```bash
sudo cp wishfulclaw-feedback.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wishfulclaw-feedback
systemctl status wishfulclaw-feedback --no-pager
tail -n 5 /data/services/wishfulclaw-feedback/feedback.log
```

日志里应能看到 `feedback service listening on 127.0.0.1:7860`。

## 6. nginx

把 `nginx-location.conf` 里的两个 `location` 贴进 `wishful-claw.work` 的 server 块
（**不要动静态站原有的 location**），然后：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

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
