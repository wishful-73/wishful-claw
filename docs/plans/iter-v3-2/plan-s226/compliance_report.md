# S-226 阶段五审查报告

> 审查对象：`dev/v3-iter-2` 上 S-226 的全部实施改动（30 个文件）
> 审查时间：2026-10-26
> 结论：**PARTIAL** —— ❌ 1（已修）/ ⚠️ 7。阶段六仍需部署后跑一遍 curl 四连。

---

## 一、需求符合性

| # | 需求条款 | 落地情况 | 判定 |
|---|---|---|---|
| 1 | 官网可提交反馈（bug / 需求两类） | `<Feedback />` 区 + `feedback-dialog.tsx`，`TYPES = ['bug','feature']` | ✅ |
| 2 | 首页底部渲染出来 | `App.tsx` 里插在 `<Faq />` 之后 | ✅ |
| 3 | **必须先在后台审核** | 公开读走 `listPublic`，SQL 内固定 `status in ('todo','done')` ⇒ `pending` 永远不对外 | ✅ |
| 4 | 可标记「待办 / 已做」 | `STATUS` 四态 pending/todo/done/rejected，管理页 + CLI 双通道 | ✅ |
| 5 | **只要审核过的就公开** | 进 `todo` 或 `done` 即公开，`rejected` 永不公开 | ✅ |
| 6 | 管理面可用（老大：能看能审） | `/admin/feedback/` 单页 + basic auth；`cli.mjs` 兜底 | ✅ |

## 二、安全审查（这类「静态站第一次引入后端」的重点）

| # | 检查项 | 结果 |
|---|---|---|
| 1 | 用户内容有没有进 `innerHTML` | 全站 `textContent`，`admin/index.html` 内无一处 `innerHTML` ✅ |
| 2 | SQL 注入 | `better-sqlite3` 全部走参数绑定，无字符串拼 SQL ✅ |
| 3 | 防刷 | 进程内滑动窗口 5 次/小时 + 蜜罐字段 ✅ |
| 4 | 正文长度 | `LIMITS` 上限齐备，超限返回 `TOO_LONG` 而不是截断 ✅ |
| 5 | 服务暴露面 | 只监听 `127.0.0.1:7860`，外部只能经 nginx ✅ |
| 6 | 管理面鉴权 | basic auth（.htpasswd 600 权限）+ `X-Robots-Tag: noindex` + 页面 `meta robots` ✅ |
| 7 | 错误信封 | 业务错一律 HTTP 200 承载 `{code,msg,data}`；只有 404 路由与 500 未捕获用非 200 ✅ |
| 8 | **客户端 IP 可信性** | ❌ **见下** |

### ❌ 1（已修）限流可被 `X-Forwarded-For` 绕过

- **现象**：`deploy/feedback/nginx-location.conf` 用 `$proxy_add_x_forwarded_for`（**追加**写），
  而 `app.mjs:clientIp` 取 **split(',')[0]（第一段）**。客户端自带
  `X-Forwarded-For: 1.2.3.4` 时 nginx 会把它接在最前面 ⇒ 攻击者每次换一个伪造值就能
  无限提交，5 次/小时的限流形同虚设。
- **修法（两处一起改，互为兜底）**：
  1. nginx 两条 location 改 `$remote_addr`（覆盖写）；
  2. `clientIp` 改取**最后一段** —— 覆盖写下两者等价，万一哪天被改回追加写，最后一段
     仍是 nginx 自己看到的那一跳。
- **验证**：`node --check` 通过；`tests/feedback-api` 111 断言仍全绿（`clientIp` 不在
  单测覆盖范围内，属部署侧行为，留阶段六真机验）。

## 三、⚠️ 观察项（不阻塞，但要知道）

| # | 观察 | 影响 | 处置 |
|---|---|---|---|
| 1 | 限流器是**进程内 Map**，服务重启即清零 | 单实例 + 4 点备份的部署形态下可接受 | 记 `tech-debt`：将来多实例必须换 Redis |
| 2 | 管理页没有「删除」操作，只有四态互转 | `rejected` 即等同下架，够用 | 有意为之 |
| 3 | 反馈正文按**纯文本**存与展示，不支持 markdown | 防 XSS 的代价 | 需求已定稿口径 |
| 4 | 公开列表没有分页 | 首版量级（几十条）无压力 | 量涨到 200 条以上再加 |
| 5 | `.gitattributes` 新增 `*.sh` / `deploy/**` 的 `eol=lf` 强制 | 无 | 见 §四 |
| 6 | 服务未在服务器上部署，systemd / nginx 片段未贴 | 功能线上不存在 | 阶段六做 |
| 7 | `better-sqlite3` 未在服务器 `npm install` | 同上 | 阶段六做 |

## 四、顺带补的工程基建（入选原因：不加就会在部署时炸）

`core.autocrlf = true` 且原先没有 `.gitattributes` ⇒ 工作区检出的是 **CRLF**，而
`deploy/feedback/backup.sh` 是直接 scp 上服务器的 bash 脚本，第一行会变成
`#!/usr/bin/env bash\r`，执行时报 `$'\r': command not found`。

已加 `.gitattributes`：

```
*.sh                text eol=lf
deploy/**/*.conf    text eol=lf
deploy/**/*.service text eol=lf
```

`*.conf` 与 `*.service` 同理（systemd 会直接拒绝 CRLF 的单元文件）。加完做了
`git add --renormalize` 并**删文件重新检出**验证：`backup.sh` 与 `nginx-location.conf`
均为纯 LF。

## 五、门禁结果

| 项 | 结果 |
|---|---|
| `node --check`（app / cli / lib 八个模块） | 全 ok |
| `node tests/feedback-api/program.mjs` | **111 断言通过** |
| `npm run typecheck` | 0 错 |
| `npm test` | 85/85 |
| `cd website && npm run build` | 0 错 |

## 六、给阶段六的验证清单（部署后）

1. `systemctl start wishfulclaw-feedback` → `curl 127.0.0.1:7860/api/feedback` 返回信封。
2. 外网 `POST /api/feedback` 提交一条 ⇒ 管理页看到 `pending` ⇒ 首页**看不到**。
3. 改成 `todo` ⇒ 首页出现。
4. **伪造 `X-Forwarded-For` 连发 6 次** ⇒ 第 6 次返回 `TOO_FREQUENT`。
5. `sudo bash backup.sh` ⇒ 用 `sqlite3 db .tables` 验证备份可读（禁裸 `cp`）。
6. `logrotate -d` 试运行，确认 `copytruncate` 生效。
