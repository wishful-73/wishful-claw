# v2-iter-37：S-156 ~ S-167

- 状态：**已收尾**（合并 main + tag `v0.2.37`）
- 分支：`dev/v2-iter-37`（base `main` @ `77adb84b`，即 v0.2.36 收尾点）
- Plan：`docs/plans/iter-v2-37/`（`plan.md` / `raw-requirements.md` / `changelog.md` / `requirements/` / `review_report.md` / `verification_report.md`）
- 产品版本：`0.2.37`
- 日期：2026-09-29 ~ 2026-09-30

## 已落刀（11 + 收尾）

| 提交 | 需求 | 内容 |
|---|---|---|
| `f82b2689` | S-167 | 外部投递统一走 `resolveSendModel` —— 不再用全局模型顶掉会话绑定 |
| `4df95a9b` | S-156 | 设置页人格区接入「AI 创建人格」入口 |
| `c2455f92` | S-157 | 数据目录名收敛到 `WISHFUL_CLAW_DATA_DIR_NAME`，代码内字面量清零 |
| `57766f72` | S-158 | 删除渠道「按工具逐个开关」死配置全链路 |
| `c16f71a4` | S-159 | 删除设置项「新会话默认模型」死字段 `newSessionDefaultModel` |
| `99a07798` | S-160 | 关于页补官网信息 + 使用指引改指官网，停维护仓库侧指引 |
| `764f9c72` | S-161 | 压缩产物剥离压缩前旧 usage，修「压缩后中断重发又触发压缩」 |
| `37fe4f51` | S-162 | 生图卡片就地出口 + `SaveImage` 工具 + 扩展名按字节魔数判 |
| `cc26da7e` | S-166 | 通用生图：按激活 provider 解析图像端点，不再要求单独配 OpenAI provider |
| `5cf0c100` | S-163 | 新增 `docs/design-system.md`（按现有 theme-presets 反向固化） |
| `53a9c938` | S-164 | `dev-workflow.md` 补「需求正文段落模板」七段 |
| （本刀） | — | 迭代收尾：审查与验证修复调整（见下「收尾刀」） |

## 范围与要点

### S-167：外部投递必须用会话本身的设置

- **病根**：给**已知 sessionId** 发消息的路径绕过了统一解析 —— `project-send-message.ts` 读全局 `getActiveProvider()` + `activeModelId`，`targetSession.providerId` / `modelId` 一次都没读；而 UI 显示走 `resolveSessionModelSelection`（会话绑定）⇒ **显示与实际必然劈叉**。表现：多会话串台、外部投递把手切模型顶回去、手切切不回来、个别上游报错。
- **裁定（老大 08:31）**：外部投递**不是特殊通道**，必须与「用户在该会话自己发消息」走完全一致的设置解析 —— 模型与**思考档位**都跟随会话，投递路径**不允许自带任何 override**（原先硬编码的 `{ thinkingEnabled: false }` 一并去掉）。
- **收敛**：统一入口从 `hooks/use-chat-actions.ts` 搬到 `lib/send-model-resolution.ts`（原位置有模块环：`use-chat-actions` 顶层反向 import 了渠道自动回复），既有调用方零改动。
- **覆盖面**：全局 PM → 项目会话的**两条投递途径**（派工单 `send_work_request` / 临时小任务 `send_session_message`，外加 Task Board 手投与 followUp 定时追问两个本地发起方）+ 反向的 `reply_global_dispatch` + 后台子 agent 唤醒 + 渠道自动回复。
- **收尾刀清扫同族**：`cancelPlan` 的取消通知、`cron-runtime.ts` 的 `new_session` 分支（原先自己再解析一遍 ⇒ 回落全局）；sidecar / bot 路径**有意保留**（无目标会话，按任务指定走）。

### S-161：压缩刚完成即中断，重发又触发压缩

- **病根**：运行中压缩把压缩前的 wire 消息原样复制进产物，**旧 usage（压缩前的高水位）留在新对话里**；水位已 Reset 到压缩后的新 count，此后任意新消息都能越过闸门。平时不暴露是因为紧接那轮 provider turn 会用新 usage 覆盖尾部 —— **一旦该轮被用户中断**（usage 在流末尾才到），旧高值就留在尾部 ⇒ 下个 run 又压一次。
- **裁定（老大 09:27）**：关键不是「把旧 usage 删掉」，而是**复发那一轮要复用已经压好的快照**。
- 与 S-141 同族：那条修的是**恢复路径**（重启后首次加载），本条补上**运行中压缩**这条入口。

### S-162 + S-166：生图

- **S-166（图怎么出来）**：原链路只认 `type === 'openai'` 的 provider、模型默认硬编码 `dall-e-3` ⇒ 「需要配专门的模型」的确切含义是**必须额外有一个 OpenAI 类型的 provider**，用 DeepSeek / 智谱 / Anthropic 的用户直接不可用。改为三级解析：**激活 provider（声明 `category === 'image'`）→ baseUrl host 映射表 → 任何有图像能力的 provider**，都没有时给可操作的明确报错。老大口径「我用 DeepSeek v4.1 flash / GLM-5.3 Flash 这些模型」⇒ 都是 chat 模型、不产图像块，故否掉「解析模型自产图像」那条路。顺带修掉张数读不到（executor 送 `count`、handler 读 `n`，永远只出一张）。
- **S-162（图出来之后怎么拿走）**：出口能力**本就在**预览浮层里，缺的是生图卡片上就地可达；另补 `SaveImage` 工具（agent 存图进工作区）与「扩展名按**字节魔数**判」（原先按 src 字符串猜）。

### S-160：官网收口进应用内

- 关于页补官网入口（地址 + 心相团队），「查看指引」由 GitHub `docs/user-guide.md` 改指官网 `/guide`；**按裁定停维护仓库侧那份指引**（`git rm`），`README.md` / `docs/development.md` 的引用一并改指官网。
- **顺带揪出一处真死链**：`ConversationGuideDialog.tsx:313` 硬编码的 `https://wishful-claw.shop/`（域名不存在，curl 实测 000）。错因是我登记时**直接采信了代码、没做交叉验证**，老大当场纠正为 `.work`。

### S-156 ~ S-159：死配置 / 遗留清扫

- **S-156**：`PersonaGeneratorDialog` 组件与后端链路都在，**只缺挂载点** ⇒ 设置页人格区加入口（文案复用既有 i18n key，locale 未改）。
- **S-157**：裸 `.wishful-claw` 字面量收敛到单一常量。登记列三处，实做**五处**（另有 UI 空态文案与派工单提示词里的路径示例）。
- **S-158**：渠道「按工具逐个开关」全链路删除。**登记漏掉的关联面一并清** —— `buildToolsMap` 是这张表的**写入方**，每次列渠道都在重写，所以它一直有内容、只是没人读（这正是「死配置看起来是活的」的原因）。
- **S-159**：`newSessionDefaultModel` 四处全删（无 UI、无读取方，恒为 `null`）。

### S-163 / S-164：规范成文

- **S-163**：新增 `docs/design-system.md`（198 行 / 13.9 KB）—— **只梳理现有**，不做改造。三条此前未成文的结构事实：`--radius` 不在预设 `cssVars` 里；面板 token 无 `--color-*` 映射、不能当 utility 用；`html font-size` 跟随 `--app-font-size`，写死 px 的尺寸不随字号缩放。
- **S-164**：`dev-workflow.md` 新增「需求正文段落模板」七段（原话/来源 → 现象 → 代码链路 → 根因 → 修复方向 → 代价与取舍 → 刻意不做），**仅对新登记需求适用**，历史需求不回溯补。

### S-165：暂不实施（备查）

- 裁定不做（老大 09-29 17:51）。**核实后订正了理由**：不是「已经被 iter-35 修掉了」，而是「暂时不值得做」—— S-142 修的是 thinking / text 两条流的分段归属，`OpenAIChatSseParser.cs` 在 iter-35 三刀里**零改动**。保留登记，归格语义偏差是客观事实。

## 收尾刀

- **门禁**：`npm run typecheck`（`typecheck:node` + `typecheck:web`）**EXIT=0**；`npm test` **65 / 65**（TS 49 + C# 16）。迭代基线 61/61，收尾时 +4 套。
- **执行 S-167 审查报告的建议项**：`cancelPlan` 与 `cron-runtime` 的 `new_session` 分支拉回统一入口；新增 `tests/send-model-resolution/`（9 断言，store 走 stub）；补 `sendSites` 覆盖面并给 `cron-runtime.ts` 显式豁免（它的 `buildProviderConfig` 产的是带 `apiKey` 的 `ProviderConfig`，与 agent/run payload 不同型）；清 `any`、修过期注释、把两处优先级细节写进注释。**未采纳** Goal 恢复读全局模型那条（C# 侧注释明示那是 Goal 自身的 legacy fallback，另案）。
- **如实记**：11 刀**都没有做过真机走查**，只到「编译 + 回归套件」级别；S-167 与 S-161 两条是老大报的原始 bug，**风险最高**，待真机确认。另：本迭代只有第 1 刀走了独立 subagent 审查，第 2～11 刀由收尾刀静态复核。

## 发布

- 按 `docs/release-workflow.md` 走，**含 4.2「上传官网下载目录」**（本迭代与 iter-36 一样要传三件套：`setup.exe` + `latest.yml` + `.blockmap`）。
