# v3-iter-5（产品 1.0.5）—— 承接清单与刀序

> 分支：`dev/v3-iter-5`（base = `3f27090d`，= v1.0.4 收尾合并点，即最新 `main`；tag `v1.0.4` → `3f27090d`）。执行期内只 commit，**不 push**。
> 产品版本：`1.0.5`（开工时 `package.json` 是 `1.0.4`，收尾时改），tag `v1.0.5`。
> 状态：**迭代已建立（2026-10-30 20:25）**，承接 15 条 + 挂账 2 条；知识库三条已核对完毕（结论见 [raw-requirements.md](raw-requirements.md) §三）。**刀序见 §六**，其中 S-285 / S-277 两条要动 schema、**开工前必须老大拍板**。
> 前置：v1.0.4 已发布（官网四件套 + GitHub Release 三资产，双面核验全绿），tag 已推远程。

## 一、从哪里来

v3-iter-4（1.0.4）收尾时，老大 2026-10-30 定「承接 15 条」。

本文件只做**承接索引**。需求正文一律留在原目录，不搬家：

- 十四条完整需求 → `../iter-v3-4/requirements/S-{NNN}.md`
- S-272 第二段 → `../iter-v3-4/requirements/S-272.md`（第一段已随 v3-iter-4 刀 12 交付）
- 挂账两条 → `../iter-v3-2/requirements/`

## 二、承接清单

### 2.1 阻断与纯消耗修复（4 条）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-282 | `WISHFULCLAW_DATA_DIR` 指向全新目录时首次启动静默退出 | **✅ 已交付（刀 0）** | 阻断级，实测连踩两次。`resolveDataPath` 只拼不建 ⇒ `SingletonLock` 父目录不存在 ⇒ 进程直接退出，**连日志都没建出来**。修法 `mkdirSync(..., { recursive: true })`，必须在 `requestSingleInstanceLock()` 之前。附加：决定逻辑抽成纯函数 `pickDataDir` 以可单测，新增 `tests/data-dir`（17 断言，含源码行序闸）。**真机 §六 1/2 待老大走** | [S-282](../iter-v3-4/requirements/S-282.md) |
| S-281 | 主窗口根容器全窗 `backdrop-blur-xl`，而窗口不透明 | **⛔ 前提不成立，待拍板** | **刀 1 未动工**。需求单路径少写一段：`src/renderer/src/main.tsx` 全文仅 10 行入口、无 JSX，真正带 `backdrop-blur-xl` 的是 **`clipboard/main.tsx:196/:302`** —— 剪贴板浮窗（窗口 `transparent: true`），正是 §八 说要保护的对象。主窗口 `App.tsx → MainLayout` 全链无 `backdrop-blur`。全仓 30 处逐处核完，**无一处压在不透明底上**。建议撤销，见 [S-281 §九](../iter-v3-4/requirements/S-281.md) | [S-281](../iter-v3-4/requirements/S-281.md) |
| S-289 | 折线图未 hover 时圆点太大太抢戏 | **✅ 已交付（刀 2）** | 按方案 A：整批 `buckets.map` 改成只画 `hoveredBucket` 那一列。连带去掉 `formatBucketLabel` 的死 import（删点即塌一处）。无新增套件（需求单 §五 预先裁定），真机 4 条待老大走 | [S-289](../iter-v3-4/requirements/S-289.md) |
| S-286 | 桌面截图尺寸摘要取自 base64 ⇒ 极简档显示 `8×5` | **✅ 已交付（刀 3）** | 真 bug，已实测复现。正则撞 base64 随机字节。修法：锚定 `Captured desktop screenshot (\d+)x(\d+)`（加 `/i`）+ 摘要专用短路 `outputTextForSummary`（**没动 `outputAsString`** —— 它还被结构化错误嗅探用着，短路会废掉那处判据）。新增 `tests/tool-call-summary` 11 断言，含诱饵在首位的守卫；反向验证：退回裸正则当场红 | [S-286](../iter-v3-4/requirements/S-286.md) |

### 2.2 图片与截图链路（3 条）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-290 | 截图经能力代理调用时 image 块被 32 KB 截断 | **✅ 已交付**（刀 4） | 落库出口与送模型出口不是同一份内容。方案 A：按「输出里存在带 `filePath` 的 image 块」短路豁免 —— 判内容不判工具名。实施：整份 `return output`（与字面「只截文本块」有偏差，理由见 §8.1）+ 新套件 13 断言 | [S-290](../iter-v3-4/requirements/S-290.md) |
| S-288 | 聊天窗图片点开不能放大 | **✅ 已交付**（刀 5） | 浮层拆成 `ImageLightbox.tsx` 并换 `ImageViewer`（缩放/旋转/拖拽/复制），自己补下载；顺带修 `sm:max-w-lg` 压掉 `max-w-[95vw]` 的真因（浮层一直只有 512px 宽）。缩略加 `max-h-[320px]`。新套件 13 断言 | [S-288](../iter-v3-4/requirements/S-288.md) |
| S-268 | `DesktopScreenshot` 的 `path` 参数完全无效 | **✅ 已交付**（刀 6） | 假成功比报错更糟。查清后发现 `persistImageBuffer` 早就支持 `targetPath`，缺的只是透传；抽出 `ResolveCaptureTargetPath` 两处共用，描述与 `CaptureAppWindow` 对齐。新套件 14 断言 | [S-268](../iter-v3-4/requirements/S-268.md) |

### 2.3 桌面操作（2 条）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-272 第二段 | 相对坐标 / 网格 / 窗口枚举 | **待开工** | **本迭代参数面最大的一条**：三个新参数。第一段（元数据 + DPI 判定）已在 v3-iter-4 刀 12 交付 | [S-272](../iter-v3-4/requirements/S-272.md) |
| S-273 | UI Automation 直接找元素 | **待开工** | S-272 的换路径版。开工前四件待查（见需求单 §「开工前」） | [S-273](../iter-v3-4/requirements/S-273.md) |

### 2.4 全局会话 ↔ 项目会话通信（3 条，**一组**）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-278 | 全局 → 项目的消息是裸文本 | **待开工** | 打底：给 `send-session-message` 补 meta 通道，协议说明移出消息正文。附带收敛两份漂移的实现 | [S-278](../iter-v3-4/requirements/S-278.md) |
| S-279 | 普通消息需要轻量回执 | **待开工** | 扩 `kind`，建议 `gm_` 前缀，复用同一个回执工具**不拆两个** | [S-279](../iter-v3-4/requirements/S-279.md) |
| S-280 | 回执不能只靠 agent 自觉 | **待开工** | 借 S-278 的 meta 做确定性归档。三条硬规矩：显式覆盖隐式 / 隐式必须标明「未显式回复」/ 自动归档只写 dispatch 记录不塞消息 | [S-280](../iter-v3-4/requirements/S-280.md) |

> ⚠️ **别拆散**：S-278 打底、S-279 扩 `kind`、S-280 借 meta 做强判据。拆开做会各自半好，而且 S-280 的核心难点（这一轮是不是在干这个 dispatch）依赖 S-278 的 meta 做判据。

### 2.5 数据结构与持久化（2 条，**开工前必须拍板**）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-285 | 助手消息块拆 `message_parts` 表 | **待拍板** | 动 schema。方案是「零迁移 + 老消息走原路径逐字节不变」，但仍是结构性改动 | [S-285](../iter-v3-4/requirements/S-285.md) |
| S-277 | 压缩产物在 `messages` 表永久累积 | **待拍板** | 三方案（`superseded_by` / 删旧行 / 纯渲染合并）各有代价，其中两个动 schema 或分页口径 | [S-277](../iter-v3-4/requirements/S-277.md) |

### 2.6 归因不明（1 条）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-265 | 裸 body 400（`{"model":"xxx"}`），30~52 秒慢拒绝 | **待勘察** | S-262 已保证不钉死会话。**定性需要完整请求体**，本地无该会话 | [S-265](../iter-v3-4/requirements/S-265.md) |

### 2.7 挂账 / 阻塞（2 条，不占刀序）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-233 | 聊天窗抖动复发（非「组件回收高度」路径） | **继续挂账** | v3-iter-4 修的是 S-274（`scrollTop` 被 clamp 绕过），**根因不同**，修完 S-274 后 S-233 仍未解决。重开前先补 §三 两处判据盲区 | [S-233](../iter-v3-2/requirements/S-233.md) |
| S-230 | Qoder 账号接入 | **阻塞在契约** | 全树搜 `qoder` 零命中，契约不到不写任何请求代码 | [S-230](../iter-v3-2/requirements/S-230.md) |

### 2.8 本次新登记（1 条，**待老大点头**）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-291 | 渠道消息重复投递 —— 投递层无 messageId 去重，而长轮询是 at-least-once | **已登记，待老大拍板是否本迭代做** | 知识库 2026-10-30 那条。**根因已从代码定性，不需要降日志级别**：`weixin-service.ts` 的 `handleIncomingMessage`（`:346-435`）全程没有去重表，`messageId` 只当 `messageReplyMeta` 的 Map key（`:378`）用；`request_timeout` 后 2 秒带**旧 `syncBuf`** 重试（`:322-323`）、`session_timeout` 直接 `resetPollingCursor()` 清空 buf（`:235-238`）—— 两条都是结构性 at-least-once。`:361-364` 的 15 分钟窗口挡住了老消息、放行了 15 分钟内的重放，正好解释知识库 09:13:22 → 09:16:07（2 分 45 秒）那一对。**修法不动 schema**：有界 `Set<messageId>`（保留最近 N 条），命中即 return。建议本迭代做，理由见 [raw-requirements.md](raw-requirements.md) §3.1 | 见 [raw-requirements.md](raw-requirements.md) §3.1 |

## 三、S-233 移交时必须带走的两条盲区

（原样从 v3-iter-4 §三 承接，重开 S-233 前必须先补）

1. **`overflow-anchor` 未排除** —— 浏览器原生 scroll anchoring 会在内容高度变化时静默改 `scrollTop`，探针读的是 `scrollTop` 变化，分不清是自己写的还是浏览器改的。
2. **探针只在 24 条心跳下跑过** —— 真实抖动场景是「长会话 + 流式 + 多轮工具调用」，采样密度不足。

## 四、门禁基线

**v3-iter-4 收尾值（2026-10-30 20:00 实测），本迭代开工需复跑确认未漂**：

| 命令 | 结果 |
|---|---|
| `npm run typecheck`（node + web） | exit 0，0 错 |
| `npm test` | **104/104** |
| `dotnet build tests\WishfulClaw.Tests.sln` | 0 警告 0 错误 |
| `node scripts/ci-checks.mjs` | 全过 |

**刀 0 收刀时实测（2026-10-30 21:0x）—— 基线未漂，`npm test` +1 套件**：

| 命令 | 结果 |
|---|---|
| `npm run typecheck`（node + web） | exit 0，0 错 |
| `npm test` | **105/105**（104 + `data-dir`） |
| `dotnet build src\runtime\WishfulClaw.sln` | 0 警告 0 错误 |
| `dotnet build tests\WishfulClaw.Tests.sln` | 0 警告 0 错误 |
| `node scripts/ci-checks.mjs` | **81/81 通过** |

**规矩**：

- 新增门禁一律做**反向验证** —— 把实现改回错误版本必须变红，撤销后必须复绿。这是 v3-iter-4 反复验证过的规矩。
- 超过 500 行的文件必须有豁免头，**豁免注释不写死行数**，写「行数以实际为准」。
- 文档改动攒进结尾那一刀。
- **`.sln` 是两套，不是一套**：`src\runtime\WishfulClaw.sln`（运行时）+ `tests\WishfulClaw.Tests.sln`（测试）。根目录没有 `.sln`。开工时本文件原写「只有 tests 那套」，实测两套都要编，刀 0 已订正。

## 五、文档状态

- `plan.md`（本文件）—— 承接索引 + 刀序
- `raw-requirements.md` —— 需求清单 + 知识库核对结论
- `changelog.md` —— 裁定与口径流水
- 需求正文**不复制**，一律链接原目录；本迭代**新登记**的才落 `requirements/`

## 六、刀序

排序依据两条：**依赖**、**不确定性先暴露**。同一依赖链内不并行，避免改同一批文件。

| 刀 | 需求 | 为什么排在这 |
|---|---|---|
| 0 | S-282 | **✅ 已交付**。**排第一的唯一理由：它是「起不来」级别**。`WISHFULCLAW_DATA_DIR` 指向新目录就静默退出、连日志都没有 —— 后面所有真机验证都可能需要换数据目录（S-223 工作区隔离的基础），先把它通了。改动 5 行、单文件、与任何线零交集 |
| 1 | S-281 | **⛔ 前提不成立，跳过待拍板**。原排位理由（吃 CPU/GPU、流式卡顿放大器）在代码里找不到对应物 —— 主窗口根本没有 `backdrop-blur`。详见 S-281 §九 |
| 2 | S-289 | **✅ 已交付**。纯视觉、单文件、零风险。与刀 1 同在渲染层，可以在同一次真机里一起看 |
| 3 | S-286 | **✅ 已交付**。单文件正则锚定。**排在这里**：它与刀 2 都在「显示层说假话」这条线上（S-286 报错尺寸、S-289 视觉噪声），连着做能一次把「极简档过程行」的显示质量收干净 |
| 4 | S-290 | **✅ 已交付**。C# `OutputLimit` 短路豁免，**判内容不判工具名**。排在图片链路最前：它决定模型这一轮到底看不看得见图，后面 S-288 的验收（图能不能放大）也依赖它先把图完整送到 |
| 5 | S-288 | **✅ 已交付**。图片浮层换 `ImageViewer`。与刀 4 同属图片链路，刀 4 修「送达」、本条修「查看」，同一批真机验收 |
| 6 | S-268 | **✅ 已交付**。`DesktopScreenshot` 补 `path`。**排在桌面操作最前**：它和 S-272 第二段改的是同一批工具（`DesktopToolProvider` / `AgentRuntimeDesktopExecutor`），先把「假成功」修掉，第二段加参数时模型不会继续被骗 |
| 7 | S-272 第二段 | **✅ 已交付**。`grid` / `window` / 相对坐标三个参数全部落地，另加 `DesktopListWindows`。第一段已让模型知道「坐标就是这张图里的像素」，但点得准不准仍取决于它自己估 —— 第二段才真正给参照系。紧接刀 6 |
| 8 | S-273 | UI Automation 换路径。**依赖刀 7 的 `DesktopListWindows`**（`DesktopClick({ window, element })` 要先能枚举窗口）。作增强路径，不替代坐标路径 |
| 9 | S-278 | **通信三连的打底刀**。给 `send-session-message` 补 meta 通道、协议说明移出正文、收敛两份漂移的实现。S-279 / S-280 全依赖它 |
| 10 | S-279 | 扩 `kind`（`gm_` 前缀 + `hidden_from_board`）。**必须紧跟刀 9**：复用同一套 meta 形状，分开做要把同一个协议改两遍 |
| 11 | S-280 | 确定性归档。**三连的收口**：核心判据「这一轮是不是在干这个 dispatch」直接用刀 9 的 meta。三条硬规矩在需求单里写死 |
| 12 | S-285 | **待拍板**。要动 schema（虽是零迁移方案），按纪律不自行拍板 |
| 13 | S-277 | **待拍板**。三个方案里两个动 schema 或分页口径 |
| 14 | S-265 | **待勘察**。归因不明，需要完整请求体；本地无该会话，可能做不了 |

**不占刀序**：S-233（挂账，重开前先补 §三 两处盲区）、S-230（阻塞在契约）、S-291（待老大点头）。
