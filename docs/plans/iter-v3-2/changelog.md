# v3-iter-2 裁定与口径流水

> 跨需求的口径变更、老大临时裁定、以及实施中发现需要记录的偏差，逐条落这里。
> 单需求的实施细节写各自 `requirements/S-{NNN}.md`。

## 2026-10-26 · 迭代启动

- 分支 `dev/v3-iter-2`，base = `9d6376fb`（= `main` = tag `v1.0.1`）。执行期内只 commit，不 push。
- 产品版本收尾时改 `1.0.2`，tag `v1.0.2`。
- 承接 v3-iter-1 候选池：**S-225 / S-226 / S-227** 三条正式登记。
- **S-228（回到顶部）/ S-229（OAuth 预设投影丢字段）/ S-231（附加块后置）已在 v3-iter-1 实施完毕**，
  候选池里那三条旧记录作废，不再列入。
- 门禁基线沿用 v3-iter-1 实测值：`typecheck` 0 错 / `npm test` 83/83 /
  `dotnet build` 0 警告 0 错误 / 官网 build 0 错。

## 2026-10-26 · 口径裁定流水

| 时间 | 裁定 | 落点 |
|---|---|---|
| 10:14 | 「它能干什么」**取 A · 替换** —— 左侧 tab 列表整个去掉，只留 banner 切换 | S-227 §3（否决 B 并存 / C 换皮） |
| 10:14 | **hover 切换随 tab 删除自然消失**，不必单独保留 | S-227 §3、§6 |
| 17:01 | **服务器用 SQLite 没问题** —— 后续心相运营站点也放上来 | S-226 §5 驱动定 `better-sqlite3` |
| 17:03 | **反馈正文纯文本**，不做 Markdown | S-226 §11 |
| 17:03 | **响应统一 `{code, msg, data}` 信封**，`data` 泛型 —— 「每一步都是在为以后铺路」 | S-226 §6 |
| 17:06 | **运营站点是给心相 App 用的** | 目录按角色分层：`/data/sites/` 静态产物、`/data/services/` 服务数据；`fb_entry` 加 `product` 字段 |
| 17:08 | S-227 形态 = **电商首页那种单张全宽大图 + 标题浮层** | S-227 §4 五项定稿 |
| 17:08 | S-227 **不分组、一屏一条**，靠轮播看全（分页会撑高，撞 2026-09-23「别撑到六千像素」） | S-227 §4 |
| 17:08 | S-227 375px 窄屏**文字挪到图下方** | S-227 §4 |
| 17:08 | **Qoder 先延后** | S-230 整体移出本迭代，编号保留不回收 |
| 17:25 | 老大点名「漏流程了」—— S-227 首次实施跳过了阶段三规划验证 | 补 `plan-s227/plan.md` + `compliance_report.md` |

### 新增长期口径（服务器侧）

- **`/data/` 目录按角色分层**：`sites/`（对外静态产物，整目录原子替换）、`services/`（有人守的服务
  数据：db + WAL + 日志）、`downloads/`、`stats/`、`backup/`。根下现有 6 项历史目录
  （`CoHeart.db` / `obsidian-vault` / `uploads` / `downloads` / `sites` / `stats`）**不动**。
- **服务数据必须在 `/data/sites/` 之外** —— `deploy site` 是整目录原子替换，放里面等于一次发布清库。
- **SQLite 备份一律 `.backup`，禁止裸 `cp`**（WAL 下会丢未 checkpoint 的数据）。
- **API 响应统一信封**：HTTP 状态码只表达「请求是否到达」，业务成败全看 `code`；
  码表分段（`1xxxx` 公共 / `2xxxx` 反馈 / `3xxxx` 管理 / `4xxxx` 心相运营 / `9xxxx` 兜底），永不复用旧码。
- **静态站加后端不走「套壳」**：不换静态宿主，nginx 继续供静态产物，只加 `location ^~ /api/` 反代。

## 已升级为长期口径（来自 v3-iter-1）

- **运行时附加块后置**（S-231）：`<memory-recall>` / `<memory-update>` / `<current_time>` 一律追加到
  用户消息**尾部**，前置会让第三方服务端把标签当会话标题截走。新代码不得再前置。
- **人格 / SOUL 注入不动**（2026-10-26 14:42 老大原话「workbuddy 有专家团」）。
- **OAuth 服务商收录范围 = 所有 `authMode === 'oauth'`**（S-229），不再只筛 `flow_type === 'server_poll'`。

## 2026-10-26 · S-225 实施与阶段五流水

| 事项 | 说明 |
|---|---|
| 三档定名 | `text` 纯文本 / `compact` 紧凑 / `detail` 详述；**默认 `compact`**，与 1.0.1 线上行为逐像素等价（有对拍用例） |
| 判定逻辑抽纯模块 | `components/chat/render-density.ts` 只导出纯函数，不 import React、不读 store ⇒ 可 `node` 直跑单测 |
| 手动开合不丢 | 用 `useDensityOverride` 的 override 带档位标记，**切档自动失效**；避开 `key` 重挂载（会丢滚动位置与流式池） |
| 入口点选择 | 全局在「设置 · 外观」滑块（照 OpenCode 文案）；聊天窗入口做成助手回复导轨上的齿轮钮，**不占输入框上方**（老大当天已提过那里太挤） |
| 阶段五结论 | PARTIAL，❌ 0 / ⚠️ 6，无必修项 —— 见 `plan-s225/compliance_report.md` |

**S-226 阶段五补记**：审查抓到限流可被 `X-Forwarded-For` 伪造绕过（nginx 追加写 + 取第一段），
已改 `$remote_addr` 覆盖写 + `clientIp` 取最后一段；顺带新增 `.gitattributes` 给
`*.sh` / `deploy/**/*.{conf,service}` 强制 LF（`core.autocrlf=true` 会把 `backup.sh` 检出成 CRLF）。

## 2026-10-27 · 真机验证流水

| 时间 | 事项 | 落点 |
|---|---|---|
| — | 官网反馈弹窗贴左上角（`<dialog>` 居中失效）—— Tailwind v4 preflight 的 `* { margin: 0 }` 压过 UA `margin: auto` | `website/src/index.css` 加 `.fb-dialog { margin: auto }`，浏览器实测四边间隙对称 |
| 08:5x | 「它能干什么」→「**能干什么**」（板块标题 + 右侧悬浮导航同名，否则点导航跳过去标题对不上） | `website/src/content/site.ts` 两处 |
| 09:19 | **S-232 密钥脱敏无限期搁置** —— 不排期、不再追问，编号保留不回收 | [S-232](requirements/S-232.md) §10 |
| 09:2x | S-225 真机反馈①：聊天窗齿轮钮「没看到」—— 图标是三条横杆 + 60% 透明度，近乎隐形 | 换 `Settings2`、去透明度折扣（S-225 §15.1） |
| 09:28 | S-225 真机反馈②：设置页滑块**从「外观」拆成独立卡片块** —— 老大原话「我之前找的时候也没找到，还是问的 dev 实例才知道的」 | 独立 `SettingsSection` + 锚点导航项；i18n 从 `general.appearance.renderDensity.*` 提到 `general.renderDensity.*`（S-225 §15.2） |
| 09:31 | **S-233 登记**：聊天窗抖动复发，且当时**没有组件在回收高度** | [S-233](requirements/S-233.md) —— 只登记，未排期 |
| 09:34 | **S-233 判据收窄**：抖动 = 内容抖，执行中，**思考流输出时 与 等模型响应（屏幕无任何输出）时都抖** | 无输出也抖 ⇒ 高度恒定 ⇒ 驱动源只能是**按周期写 `scrollTop` 的定时器**，假说收到「执行期唯二自排程链」（S-176 的 `scheduleShrinkProbe` / `scheduleReclaimRetry`） |
| 09:47 | S-226 前端两条调整：①反馈区去掉 `mx-auto max-w-3xl` 收窄居中（大屏两侧空几百 px，与全站「铺满屏宽」口径不一致）；②两个提交按钮合成一个，需求/Bug 分类挪进弹窗现选 | S-226 §17。后端、管理页、DB schema 零改动 |
| 09:58 | S-226 启动与发布收敛：本地一条命令（`npm run dev` = vite 5280 + 反馈服务 7860，新增 `website/dev.mjs`）；`deploy.mjs site` 默认连带同步反馈服务并重启 | S-226 §18。线上结构不变（nginx 静态 + `/api/` 反代 node），对外仍是单一地址 |
| 10:08 | 老大：「先发布官网吧」⇒ `deploy.mjs site` 一次跑完：官网四路径 200 + 反馈服务首次上线（health 200）+ nginx 片段手工贴好（443 块，改前备份） | S-226 §19。踩到 `.htpasswd` 600 权限导致管理页 500，已修脚本与文档；验收 8 项全过，自测条目已驳回 |
| 10:35 | S-225 真机反馈③：老大「在聊天窗没找到地方」——09:2x 换图标后仍不够，导轨齿轮钮位置本身就不对 | 从 `.VirtualListContent` 摘掉，**并进右上角会话操作块**（`SessionConversationPane`）。那块 `right-3 top-3 z-30` 绝对定位，原位置会被整个盖住；`AssistantReplyRail` 的 `top-12` 留白注释同步改写（S-225 §15.3） |
| 10:39 | 设置页导航：老大「主题外观 时间轴下应该增加 语音朗读的导航锚点」 ⇒ 左侧锚点导航补 `anchorNav.renderDensity` / `anchorNav.speech` 两项，双语 verbatim | `SettingsPage.tsx` 的 `GENERAL_ANCHORS` + zh/en `settings.json`。`sec-general-speech` 是既有 Section，只是此前没挂锚点 |
| 10:44 | S-227 真机反馈：banner **高度超出一屏** | 根因是舞台高度按「视口**宽**÷1.567」算（1920 屏 ≈1154px、2560 屏 ≈1562px），分母用错了维度（S-227 §13） |
| 10:58 | 承接上条，老大给定修法：「可以用 vw vh 去给高宽，还有需要居中」 | 反过来先框可用高度（`100vh - 18rem`，扣顶栏/标题/指示点/余量），再按 2520/1608 反推宽度上限 + `mx-auto` 居中；窄屏仍吃满 100% 宽。图完整显示不裁上下，超宽屏两侧留白 |
| 11:5x | 迭代收尾：门禁四项全绿（`typecheck` 0 错 / `npm test` **85/85** / `dotnet build` 0 警告 0 错误 / 官网 build 0 错 371ms） | `dotnet build` 因运行中实例（PID 29460）锁 `bin\Debug`，改用 `--artifacts-path` 重定向输出等价完成，**未杀实例** |

**S-233 的边界（记一笔免得又修错方向）**：S-150 的冷却锁只作用于「回收方向」（`bottom < scrollTop`），
本条既然没有回收，加码那把锁毫无作用。处置顺序固定为「先取证、再定修法」。

