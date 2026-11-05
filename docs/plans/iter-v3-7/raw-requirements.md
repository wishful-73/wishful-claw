# v3-iter-7 需求清单

> 拆分于 2026-11-04 17:1x。来源 = v3-iter-6 收尾移交 + 该迭代「已实施待真机验收」六条。
> 本文件只列清单与依据，刀序见 [plan.md](plan.md)。

## 一、本迭代实施（4 条）

| 编号 | 标题 | 现状 / 依据 | 正文 |
|---|---|---|---|
| S-305 | 插件卡片渲染通道是死的 | 6 种渲染器 + iframe 沙箱 + 高度协商**全部完工**，总闸没合：`parseExtensionToolResult`（`extension-result.ts:4-6`）无条件 `return null`；`__wishfulClawExtensionResult` 全仓只在类型定义里出现一次、主进程零产出 ⇒ 插件卡片一张都出不来。老大 2026-11-03 09:12「登记一个需求，这个需求暂时不在本迭代处理」，并定「CodeGraph 先走普通工具卡片」（MCP `content:[{type:'text'}]`，零改动） | [../iter-v3-6/requirements/S-305.md](../iter-v3-6/requirements/S-305.md) |
| S-313 | 把「开发工作流 + 迭代文档 + 计划」做成产品能力，产出落项目 `.wishful-claw/` | 五项已定：①目录名 `.wishful-claw/workflow/`（`plans` / `goals` 已被占用）②注入**指针式**，新建项目复制一份模板、系统提示只提一句路径，**读不读由 AGENTS.md 决定**，软件侧零开关零 UI ③本仓 `docs/` 一字不动 ④本期只做核心三件 ⑤热记忆同构改造（§6.6） | [requirements/S-313.md](requirements/S-313.md) |
| S-314 | 热记忆变更后系统提示不重建，提示里长期是过期快照 | 三条实测证据：`SystemPromptCache.cs:46-47` 注释承诺刷新，但 `GetPersonaFingerprint`（`:83-124`）只扫 personas 目录 ⇒ MEMORY.md 没进 cacheKey；`Invalidate` / `Clear` 全仓 0 调用 ⇒ 实际是「worker 重启才重建」。根因结构性：「内容新」与「前缀缓存命中」在「塞全文」这个结构下天然互斥 | [requirements/S-314.md](requirements/S-314.md) |
| S-315 | 连续工具调用时，工具 run 折叠块每个工具都开合一次 | 老大 11-05 08:35 报「一个工具调用就展开，这个工具结束就收起，下一个继续展开，频率太高」。根因：`deriveToolRunCollapsed`（`render-density.ts:102-110`）拿 `activeCount > 0` 一个三目当开关，而 `compact`（**默认档**）两值恰好是 `false` / `true` ⇒ 每完成一个工具就收一次。**只有默认档抖**，`text` 恒收、`detail` 恒展 | [requirements/S-315.md](requirements/S-315.md) |

## 二、承接上一迭代的真机验收（6 条，**已实施未验收**）

| 编号 | 已实施的改动 | 验收点（本迭代刀 0 结账） | 正文 |
|---|---|---|---|
| S-303 | CodeGraph 剥离为可选插件，主仓只留插件配置与下载通道 | **装 / 停 / 卸 / 重装** 4 步：装后 agent 能查符号；停用后工具消失但配置留存；卸载后无残留；重装能回到已启用 | [../iter-v3-6/requirements/S-303.md](../iter-v3-6/requirements/S-303.md) |
| S-308 | 子 agent 停止：`toolUseId → CTS` 注册表 + `SubAgentStop` 工具 + UI 入口 | **跨 run 停止**（background 子 agent 活得比父 run 长时仍能停）+ **派停 20 次 CTS 不泄漏**（`ObjectDisposedException` 是本条唯一技术风险） | [../iter-v3-6/requirements/S-308.md](../iter-v3-6/requirements/S-308.md) |
| S-309 | 工具调用超时收口在调用方 `DispatchWithTimeoutAsync` 竞速 | §4.3 **UI 弱提示**（`ToolCallTimeout.ShortReason()` `ToolCallTimeout.cs:237` 全仓无调用点，死代码）+ §4.4「卡住时仍能收消息」+ §4.2.4「ask-user 超时后用户再答，答案被丢弃」 | [../iter-v3-6/requirements/S-309.md](../iter-v3-6/requirements/S-309.md) |
| S-310 | 子 agent 卡片 header 整行点击只切展开，另给「查看详情」纯文字入口 | 点 header 只展开、不弹右侧面板；点「查看详情」才开面板；中英文案同步 | [../iter-v3-6/requirements/S-310.md](../iter-v3-6/requirements/S-310.md) |
| S-311 | 子 agent 运行期进度经 `SubAgentRunCollector.ProgressChanged` 实时上报 | 运行中（非结束）状态工具即报非 0 的 calls / iterations；前台、后台、goal 三条路径都覆盖 | [../iter-v3-6/requirements/S-311.md](../iter-v3-6/requirements/S-311.md) |
| S-312 | 视口低于 `MIN_REAL_VIEWPORT_WIDTH = 480` 时跳过窄窗判定 | 左栏展开 ⇒ 切走 ⇒ 切回，左栏不再自己收起；真实拖窄到 480 以上仍然正常收起 | [../iter-v3-6/requirements/S-312.md](../iter-v3-6/requirements/S-312.md) |

## 三、挂账 / 阻塞（三条，不占刀序）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-233 | 聊天窗抖动复发（非「组件回收高度」路径） | **继续挂账** | 频率低、**只在新版本第一个会话偶发**；老大 2026-10-31 定「先登记等以后模型牛掰了再试试能解决不」 | [../iter-v3-2/requirements/S-233.md](../iter-v3-2/requirements/S-233.md) |
| S-230 | Qoder 账号接入 | **阻塞在契约** | 全树搜 `qoder` 零命中，契约不到不写任何请求代码 | [../iter-v3-2/requirements/S-230.md](../iter-v3-2/requirements/S-230.md) |
| S-273 段 B | 第三方窗口的元素树（`EnumChildWindows`） | **待拍板** | 段 A（自家窗口走 CDP）已随 v3-iter-5 交付。段 B 只覆盖 Win32 控件，Chromium 系第三方窗口拿不到 ⇒ 收益存疑，拍板前不动 | [../iter-v3-4/requirements/S-273.md](../iter-v3-4/requirements/S-273.md) |

## 四、候选池（老大提过但暂不做）

| 编号 | 标题 | 为什么现在不做 |
|---|---|---|
| S-232 | 安全加固 | 老大 2026-10-27 裁定「无限期搁置」 | [../iter-v3-2/requirements/S-232.md](../iter-v3-2/requirements/S-232.md) |

## 五、本轮核对掉的（**防重复登记**，不立项）

拆分时把上一迭代文档里的过期结论逐条核了一遍，四条要更正：

1. **「官网反馈看板『已做 / 待办』标记无限期搁置」—— 作废。** 这条记在 v3-iter-6 raw §四，但 S-226 早已上线并投入实际使用：2026-11-04 16:5x 把反馈 #5 从「待办」改「已做」，公开列表随即变化。候选池里不该再有它。

2. **S-207 不进挂账。** 单据状态是「**已完成（阶段五审查修复 + 真机验证通过，2026-10-20）**」，热记忆里「从未排查」那条记错了。真正的报错 `Sandbox elevation tool execution failed: CannotWritePropertyWithinArray, None` 是 10-16 实施期的一次工具执行错误，后续真机已通过。

3. **「内置浏览器清除缓存」不要再登记。** v3-iter-6 raw §3.5 已逐行确认**功能已实现，不是欠账**（当时是按 S-281 那类错法的教训重查的：没打开文件确认闸在哪一层就下结论）。

4. **S-265 / S-277 / 原拟 S-299 已撤销，编号不重用。** 撤销理由在 v3-iter-6 raw §3.7 / §3.8 / §3.6，重开需满足各自列出的前置条件，不要凭印象重新立单。
