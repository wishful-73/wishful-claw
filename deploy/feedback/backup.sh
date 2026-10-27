#!/usr/bin/env bash
# S-226：反馈库备份
#
# ⚠️ 必须用 sqlite3 的 .backup，**禁止裸 cp**。
#    WAL 模式下 cp 拿到的可能是「还没 checkpoint 的主库」，最近写入直接丢。
#
# 装到 /data/services/wishfulclaw-feedback/backup.sh，chmod +x，
# root crontab 每天跑一次：
#   17 4 * * * /data/services/wishfulclaw-feedback/backup.sh >> /var/log/wishfulclaw-feedback-backup.log 2>&1
#
# 这个脚本本身**必须是 LF 行尾** —— CRLF 会让 bash 报 `$'\r': command not found`。

set -euo pipefail

# 前置：.backup 依赖 sqlite3 CLI（apt install sqlite3）。
# 2026-10-27 首次部署就在这里静默失败过一次：脚本跑了、备份目录是空的，
# 日志里只有一句 "sqlite3: command not found" 混在 cron 输出里，一整天没人发现。
# 缺了立刻带明确原因退出（非零），别让「备份从没成功」藏在日志里。
if ! command -v sqlite3 > /dev/null 2>&1; then
  echo "$(date '+%F %T') ERROR 找不到 sqlite3，备份未执行 —— 先 sudo apt-get install -y sqlite3" >&2
  exit 2
fi

DB=/data/services/wishfulclaw-feedback/feedback.db
DEST=/data/backup/wishfulclaw-feedback
KEEP_DAYS=30

if [ ! -f "$DB" ]; then
  echo "$(date '+%F %T') 没有库文件 $DB，跳过"
  exit 0
fi

mkdir -p "$DEST"
OUT="$DEST/feedback-$(date +%F).db"

# .backup 会自己处理 WAL；不需要先手动 checkpoint
sqlite3 "$DB" ".backup '$OUT'"

# 校验一下：能读出表结构才算备份成功（比只看退出码靠谱）
if ! sqlite3 "$OUT" "select count(*) from fb_entry" > /dev/null 2>&1; then
  echo "$(date '+%F %T') 备份校验失败：$OUT"
  exit 1
fi

# 只留最近 KEEP_DAYS 天
find "$DEST" -maxdepth 1 -name 'feedback-*.db' -mtime "+$KEEP_DAYS" -delete

echo "$(date '+%F %T') ok $(du -h "$OUT" | cut -f1) → $OUT（保留 ${KEEP_DAYS} 天）"
