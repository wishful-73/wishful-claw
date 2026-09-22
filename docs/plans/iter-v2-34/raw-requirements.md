# iter-v2-34 原始需求登记（总览清单）

> 2026-09-20 建。2026-09-22 按 `docs/dev-workflow.md`「文档组织」节改为**总览清单 + 明细子文档**。
> 分支 `dev/v2-iter-34`（base `main` @ `02e57d3f`，v0.2.33）。本文件**只放清单**；需求正文见 `requirements/`，跨需求裁定流水见 `changelog.md`。
> **已登记 33 项**：S-107 ~ S-139（S-110 已撤销，实为 32 项有效）。S-135 ~ S-139 为 2026-09-22 验收后期追加、同日立项（老大拍定「直接在 `dev/v2-iter-34` 上做，编号顺延，一并收尾」）。

---

## 需求清单

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-107 | 请求上下文上限纳入全局设置，会话默认继承 | ✅ `df857315` + `466ca6a4` | [S-107.md](requirements/S-107.md) |
| S-108 | 模型窗口 384K 未生效：后端按 200K 兜底算触发线（未设会话上限） | ⚠️ 挂账不修（余项 `b447fd20`） | [S-108.md](requirements/S-108.md) |
| S-109 | 更新弹窗主按钮语义：先「开始下载」，下载中变「后台下载」并收起 | ✅ `e5dd5ee0` | [S-109.md](requirements/S-109.md) |
| S-110 | 更新下载悬浮窗默认位置移到最左侧 —— ❌ 已撤销（2026-09-21） | ❌ 已撤销 | [S-110.md](requirements/S-110.md) |
| S-111 | 更新机制调整：巡检策略 + 顶部黄色下载图标取代常驻悬浮块 | ✅ `31b53119` | [S-111.md](requirements/S-111.md) |
| S-112 | 顶栏问号图标改为打开设置页「关于」 | ✅ `14468e3f` | [S-112.md](requirements/S-112.md) |
| S-113 | 官网前端项目（`website/`） | ✅ `16aa97f4` | [S-113.md](requirements/S-113.md) |
| S-114 | 官网独立页：使用指引 + 更新日志 | ✅ `a4ce3c61` | [S-114.md](requirements/S-114.md) |
| S-115 | `create_session` 建会话必崩：`sessions.model_selection_mode` NOT NULL 约束失败 | ✅ `6fc9d72d` | [S-115.md](requirements/S-115.md) |
| S-116 | 指引页视觉改版（参考 reasonix.io/docs） | ✅ `a4ce3c61` | [S-116.md](requirements/S-116.md) |
| S-117 | 指引页正文右侧改卡片体系（承接 S-116） | ✅ `a4ce3c61` | [S-117.md](requirements/S-117.md) |
| S-118 | 第 2 章并入效率工具 + 修一处过时路径 | ✅ `a4ce3c61` | [S-118.md](requirements/S-118.md) |
| S-119 | 第 3 章配置模型描述重写 + 又查出两处过时按钮名 | ✅ `a4ce3c61` | [S-119.md](requirements/S-119.md) |
| S-120 | 锚点改英文 slug，同一个串兼作侧栏英文标签 | ✅ `a4ce3c61` | [S-120.md](requirements/S-120.md) |
| S-121 | 干净路由：`/guide` 而不是 `/guide.html` | ✅ `a4ce3c61` | [S-121.md](requirements/S-121.md) |
| S-122 | 删掉首页两个「对比大厂」板块 | ✅ `a4ce3c61` | [S-122.md](requirements/S-122.md) |
| S-123 | 对外全面撤掉「非正式版」自标，只留版本号 | ✅ `a4ce3c61` | [S-123.md](requirements/S-123.md) |
| S-124 | 删掉「服务商完全自由」整类优势 | ✅ `a4ce3c61` | [S-124.md](requirements/S-124.md) |
| S-125 | 首页顶部版本号徽章删除 | ✅ `a4ce3c61` | [S-125.md](requirements/S-125.md) |
| S-126 | 「不花钱，也能用起来」压到 Hero 之上当第一屏 | ✅ `a4ce3c61` | [S-126.md](requirements/S-126.md) |
| S-127 | 首页首屏结构：三层阶梯整块占满首屏，产品主标题被挤到首屏底部 | ✅ `a4ce3c61` | [S-127.md](requirements/S-127.md) |
| S-128 | 「自带 key、自选渠道，用多少花多少」歧义：两处歧义都指向相反意思 | ✅ `a4ce3c61` | [S-128.md](requirements/S-128.md) |
| S-129 | 更新源全面切换到官网：官网成为完整更新源（固定别名 + 整套发布资产） | ⏸ 待域名备案 | [S-129.md](requirements/S-129.md) |
| S-130 | 聊天窗最低宽度守卫 800 → 530（在原值上收缩 270） | ✅ `24311a9e` | [S-130.md](requirements/S-130.md) |
| S-131 | 左栏渲染漏按视口收窄：拖窄窗口时聊天窗被挤破底线 | ⚠️ `24311a9e`（路径二未修） | [S-131.md](requirements/S-131.md) |
| S-132 | 彻底去掉子代理轮次上限：撞上限即被截断、状态却报 completed、产出全丢 | ✅ `de390331` | [S-132.md](requirements/S-132.md) |
| S-133 | 流式正文被思考块 / 工具组件从中间打断 | ✅ `544e1eb7` | [S-133.md](requirements/S-133.md) |
| S-134 | 常驻终端：agent 可起、可读、可停的可见进程（落在底部终端面板） | ✅ `244e4d18` | [S-134.md](requirements/S-134.md) |
| S-135 | 流式渲染降级：渲染量过大时主动降频 | ✅ `951706d4` | [S-135.md](requirements/S-135.md) |
| S-136 | agent 回复操作栏「分叉」按钮点击必报失败 | ✅ `30c4392b` | [S-136.md](requirements/S-136.md) |
| S-137 | shell 渲染组件「停止进程」点击无反应 | ✅ `f0d99d4c` | [S-137.md](requirements/S-137.md) |
| S-138 | 朗读音色：放出本机已有语音 + 语速音调控制 + 设置页试听 | ✅ `4eb5fc05` | [S-138.md](requirements/S-138.md) |
| S-139 | 消息操作按钮组死链清理（重新生成 / 删除 / 继续执行 + `showContinue`）+ `UserMessage` 内联编辑态删除 + 「编辑」改为回填输入框 | ✅ `51571a62` | [S-139.md](requirements/S-139.md) |

---

## 候选池（未立项）

> **2026-09-22 转正变更**：原本节「流式渲染降级」「分叉按钮」「shell 停止进程」三条已转正为 **S-135 / S-136 / S-137**（正文见 `requirements/`），不再留在候选池。老大同日拍定：**直接在 `dev/v2-iter-34` 上做，编号顺延，一并收尾**（不走 iter-35）。
> **同日再转正一条**：「语音朗读音色难听」已转正为 **S-138**（老大 14:45「那就先登记成 s-138」），同样不再留在候选池；转正时**订正了本条内一处已被实测推翻的推断**（详见 S-138.md）。

- **语音朗读音色难听 / 换音色** → ✅ **已转正为 S-138**（2026-09-22 14:45，老大「那就先登记成 s-138」）⇒ 正文见 [S-138.md](requirements/S-138.md)，不再留在候选池。
  **转正时订正一处错误推断**：本条原写「Electron 内 `getVoices()` 未实测，按 Chromium 走 SAPI5 推断同此」——**已被实测推翻**：Chromium 读的是 **OneCore 语音库**，本机可见 **3 个中文语音**（Huihui / Kangkang / Yaoyao，全部 `localService: true`，本地离线免费）。实测数据与订正全文见 S-138.md。
