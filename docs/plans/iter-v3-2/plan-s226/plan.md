# S-226 实施规划（阶段二产物）

> 需求正文见 [requirements/S-226.md](../requirements/S-226.md)。本文件只回答「怎么做」。
> 阶段一/二勘测与裁定已在需求正文定稿（档 A、信封、码表、端点、表结构、审核双通道），
> 本文件不重复，只把它们拆成可执行的文件清单与顺序。

## 一、文件清单

### 1.1 服务端（新增，进仓库）

| 文件 | 职责 | 是否纯逻辑 |
|---|---|---|
| `server/feedback/package.json` | `type: module`、`better-sqlite3` 单一依赖、`start` / `cli` 脚本 | — |
| `server/feedback/lib/codes.mjs` | 码表常量（§6.2），**唯一真源**；前端 `lib/api-codes.ts` 照抄 | ✅ |
| `server/feedback/lib/status.mjs` | 四状态常量、公开集判定、状态转移合法性（§9.7） | ✅ |
| `server/feedback/lib/validate.mjs` | 提交体校验：类型、必填、长度、蜜罐（§10） | ✅ |
| `server/feedback/lib/rate-limit.mjs` | 同 IP 小时窗限流，注入 `now()` 可测 | ✅ |
| `server/feedback/lib/envelope.mjs` | `ok()` / `fail()` / `writeJson()`，信封唯一构造点 | ✅ |
| `server/feedback/lib/db.mjs` | `better-sqlite3` 打开、建表、六个查询；WAL + `busy_timeout` | ❌（要驱动） |
| `server/feedback/app.mjs` | HTTP 入口：路由分发、管理页静态读出、未捕获异常兜底 | ❌ |
| `server/feedback/admin/index.html` | 管理页单文件（§9.2），服务进程直接返回 | ❌ |
| `server/feedback/cli.mjs` | §9.6 四个子命令，走 `fetch` 打本机 7860 | ❌ |

**为什么要拆 `lib/`**：`app.mjs` 里的路由和 `better-sqlite3` 没法在 Windows 本地跑（驱动要编译）。把
校验 / 状态机 / 限流 / 码表抽成纯 ESM 模块，本地 `node tests/feedback-api/program.mjs` 就能全测，
服务器侧只剩「接线」这一层没覆盖。

### 1.2 官网前端（改动 `website/src/`）

| 文件 | 动作 | 说明 |
|---|---|---|
| `lib/api-codes.ts` | 新增 | 码表前端副本 + `FB_CODE` 语义别名 |
| `lib/api.ts` | 新增 | §8.2 两层封装：`apiRequest` / `apiData` / `ApiError` |
| `lib/feedback.ts` | 新增 | `FbEntry` 类型、`useFeedbackList()`（空态口径同 `site-stats`） |
| `components/feedback-dialog.tsx` | 新增 | 原生 `<dialog>` + 表单；无第三方依赖 |
| `sections/feedback.tsx` | 新增 | 首页反馈 section：两个提交按钮 + 公开列表 |
| `sections/site-footer.tsx` | 改动 | 等 feedback section 产出后再评估是否需要在页脚加入口（见 §四 未决） |
| `App.tsx` | 改动 | 在 `<Faq />` 之后挂 `<Feedback />` |
| `content/site.ts` | 改动 | 新增 `feedback` 片段（标题、说明、按钮文案、空态） |

### 1.3 部署模板（新增，进仓库）

| 文件 | 内容 |
|---|---|
| `deploy/feedback/nginx-location.conf` | 两段 `location`（`^~ /api/`、`^~ /admin/feedback/`） |
| `deploy/feedback/wishfulclaw-feedback.service` | systemd unit（单实例、`Restart=always`、日志重定向） |
| `deploy/feedback/backup.sh` | `sqlite3 .backup`，**禁止 `cp`** |
| `deploy/feedback/logrotate.conf` | `feedback.log` 按周切、留 8 份 |
| `deploy/feedback/install.md` | 从零到能用的步骤（Node 依赖、htpasswd、systemd、nginx reload、验收命令） |

**为什么不做进 `scripts/deploy.mjs`**：`.gitignore` 把 `scripts/*` 排除在版本控制外（只白名单了
`run-tests.mjs` 等四个），改成那样等于部署步骤既不入库也没人能复现。模板进 `deploy/`，
`deploy.mjs` 一字不动。

### 1.4 测试（新增）

| 文件 | 内容 |
|---|---|
| `tests/feedback-api/program.mjs` | 纯逻辑断言：校验 8 例、状态机 16 组转移、限流窗口、公开集 |
| `package.json` | 加 `"test:feedback-api": "node tests/feedback-api/program.mjs"` |

**为什么是 `.mjs` 不是 `.program.ts`**：被测源码本身是 `.mjs`（服务器零构建），
走 esbuild 反而要额外一套 tsconfig；`run-tests.mjs` 只认 `package.json` 里 `test:*` 的命令字符串，
不关心语言。

## 二、实施顺序

```
① codes / status / validate / rate-limit / envelope   ← 纯逻辑，先写先测
② tests/feedback-api + package.json 挂载              ← 立刻跑，红了就修
③ db.mjs → app.mjs → admin/index.html → cli.mjs        ← 接线层
④ lib/api-codes.ts → lib/api.ts → lib/feedback.ts      ← 前端底座
⑤ components/feedback-dialog.tsx → sections/feedback.tsx → App.tsx → site.ts
⑥ deploy/feedback/*                                    ← 部署模板
⑦ 门禁 + 自查 + 审查 + 验证
```

**① ② 先行的理由**：这批是「写错一行、线上就在漏数据」的地方（公开集判定、蜜罐、长度上限）。
先把它们钉死并有回归，③ 只是把结果搬到 HTTP 上。

## 三、关键实现决策

| # | 决策 | 理由 |
|---|---|---|
| 1 | `validate.mjs` 返回 `{ ok, code, data }` 而不是抛异常 | 路由层只需 `if (!r.ok) fail(r.code)`，异常留给真正的 bug |
| 2 | 限流用**进程内 Map**，不落库 | 单实例 systemd；重启丢计数是可接受的代价，落库反而要每次写 WAL |
| 3 | `ip_hash` 取 `sha256(ip + 固定盐)` 前 16 位 | 永不公开，也不存明文 IP（备案与最小化原则） |
| 4 | 公开查询**在 SQL 里就带 `status in ('todo','done')`** | 不靠应用层过滤 —— 应用层漏一处就是一个信息泄露 |
| 5 | 管理页 `/admin/feedback/` 由服务进程**读文件返回**，不做模板拼接 | 无变量，纯静态读；避免把一次 `replace` 写成注入点 |
| 6 | 前端 `apiData` 抛 `ApiError`，`ApiResult` 原样返回 | 需求 §8.2 定的两层；列表用 `apiData`，提交要按码给不同提示时用 `apiRequest` |
| 7 | 提交成功**不清空、不跳转**，就地换成成功态 + 「再提一条」 | Dialog 关掉就丢内容最招人恨；再提一条比重新点按钮少一次点击 |
| 8 | 列表默认 6 条，展开全部在**原地**展开，不做详情页 | 需求 §8.3；也避免多一条路由要处理 SPA 回退 |
| 9 | 正文渲染 `whitespace-pre-wrap` + React 文本节点 | 纯文本零解析，XSS 面为零（需求 §11 拍板） |
| 10 | dev 环境 `/api/feedback` 404 时**整段不渲染** | 与 `site-stats` 同口径；本地 `npm run dev` 没有后端，页面必须照常好看 |

## 四、未决 / 待观察

| # | 项 | 处置 |
|---|---|---|
| 1 | 页脚是否要有「提反馈」入口 | 首页 section 已有两个按钮；页脚再加就是第三个入口，先不做，等看效果 |
| 2 | 是否需要「已修复版本」外露 | 需求只定「待办 / 已做」两态；`review_note` 永不公开，先不外露版本号 |
| 3 | 列表条数上限 | 公开读默认 50 条封顶，超出靠「已做」折叠；真到那天再加分页 |

## 五、验证方式

| 层 | 怎么验 | 判据 |
|---|---|---|
| 纯逻辑 | `npm run test:feedback-api` | 全绿 |
| 前端类型 | `cd website && npm run typecheck` | 0 错 |
| 官网构建 | `cd website && npm run build` | 0 错 |
| 本地页面 | `npm run dev` → 5280 | 无后端时反馈 section 整段不出现，控制台无未捕获异常 |
| 全量门禁 | `npm test` / `dotnet build` | 83+1 通过 / 0 警告 0 错误 |
| 服务器侧 | 部署后 §六 的 curl 三连 | 见下 |

### 5.1 部署后验收（服务器上跑）

```bash
# ① 提交 → 应返回 code=0
curl -s -X POST https://wishful-claw.work/api/feedback \
  -H 'content-type: application/json' \
  -d '{"type":"bug","title":"自测","content":"部署自测，稍后驳回","product":"wishfulclaw","website":""}'

# ② 公开读 → 待审条目不得出现
curl -s https://wishful-claw.work/api/feedback | head -c 400

# ③ 蜜罐 → 应返回 code=10004
curl -s -X POST https://wishful-claw.work/api/feedback \
  -H 'content-type: application/json' \
  -d '{"type":"bug","title":"x","content":"y","website":"http://spam"}'

# ④ 管理面未带口令 → 401
curl -s -o /dev/null -w '%{http_code}\n' https://wishful-claw.work/admin/feedback/
```

## 六、风险

| # | 风险 | 处置 |
|---|---|---|
| 1 | `better-sqlite3` 在服务器首次 `npm ci` 要编译 | 编译链已实测齐全（gcc 13.3 / python3 3.12）；预编译包命中就不用编 |
| 2 | nginx 的 `error_page` 把 `/api/` 的 4xx 换成 HTML | nginx 片段里 `proxy_intercept_errors off`；进程内业务错一律 200 + 信封 |
| 3 | 管理页与公开读共用进程，一个慢查询拖死两边 | 单表 + 索引 `IX_fb_entry_product_status_created`，查询都走索引；无长事务 |
| 4 | 反馈成了绕过迭代流程的通道 | §9.4 已写死上限；「直接做」仍要走登记 + 一个需求一刀 commit |
| 5 | 前端拿 `page` 字段记当前路径时把查询串也带进去 | 取 `location.pathname`，不带 `search` / `hash` |

## 七、阶段状态

| 阶段 | 状态 |
|---|---|
| 一 · 探索 | 完成（需求正文 §4 服务器实测） |
| 二 · 规划 | **完成（2026-10-26，本文件）** |
| 三 · 实施 | 未开始 |
| 四 · 自查 | 未开始 |
| 五 · 审查 | 未开始 |
| 六 · 验证 | 未开始 |
