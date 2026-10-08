# v2-iter-37：S-156 ~ S-171

- 状态：**收尾中**（老大 2026-10-08 13:42 发起「真机走查我已经测试过了，进行迭代收尾」）
- 分支：`dev/v2-iter-37`（base `main` @ `77adb84b`，即 v0.2.36 收尾点）
- Plan：`docs/plans/iter-v2-37/`（`plan.md` / `raw-requirements.md` / `changelog.md` / `requirements/` / `review_report.md` / `verification_report.md`）
- 产品版本：`0.2.37`
- 日期：2026-09-29 ~ 2026-10-08

## 已落刀（17 + 收尾）

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
| `21591cfc` | — | ⚠️ **误标为「迭代收尾刀」，实为 S-167 同族清扫 + `send-model-resolution` 套件**（定性订正见 `changelog.md`） |
| `5243936d` | S-168 | AI 辅助创建人格：入口挪进新增人格页 + 生成结果回填 + 模型可当场选 |
| `e2df23a0` | S-170 | DeepSeek 内置服务商默认协议改为 OpenAI Chat |
| `c2c61640` | S-171 | 辅助通道补头链 + persona 生成退出后端（删后端 `PersonaGenerator.cs`） |
| `a85460d9` | S-169 | OpenCode Go 内置模型清单全量刷新（价格 + 无效模型去除） |
| `6209f136` | — | 37 迭代修复项 ①②③④：人格作用域解析与保存回环 |
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

### S-168：AI 辅助创建人格（S-156 的形态调整）

- **背景**：S-156 把入口接在设置页人格区工具栏；老大 09-30 10:27 实测后要求改形态 —— 入口落在**新增人格页**里，弹窗生成成功**直接回填表单**（而非原「按钮带回填」），provider / model 允许**当场选**。10:31 裁定「A+B（弹窗默认带出已配的，允许当场改）　按钮撤掉　弹窗生成成功就回填」。
- **改动**：`PersonaGeneratorDialog.tsx` 重写，`PersonaPanel.tsx` / `PersonaEditor.tsx` 小改，locale 两份同步；摘掉 `providerRole: 'global'` 硬绑定 ⇒ 项目上下文也能正常生成。

### S-170：DeepSeek 内置服务商默认协议改为 OpenAI Chat

- **性质**：默认选型调整（**非 bug**）。原默认 Anthropic 协议（`type: 'anthropic'`、端点 `https://api.deepseek.com/anthropic`），改为 OpenAI Chat（`type: 'openai-chat'`、端点 `https://api.deepseek.com`），`version` 3→4。
- **口径（老大 08:41）**：**只改内置虚拟定义，已配置用户不动** ⇒ 走 A。登记时勘出的升级路径坑（`isUnownedBuiltin` 要求 `baseUrl === preset.defaultBaseUrl`，改 `defaultBaseUrl` 后老记录永远不满足判据）**按此口径无需处理**。

### S-171：辅助通道补头链 + persona 生成退出后端

- **病根**：辅助通道（提示词优化 + persona 生成）**一条头链都没有** —— renderer 只传 `providerId / type / baseUrl / apiKey / model`，后端 `ProviderCompletionService` 只加 `Authorization` ⇒ 缺 `userAgent` / `requestOverrides` / opencode-go 的 `x-opencode-session`，与主链行为不一致（个别网关据此判非法请求）。
- **裁定（老大 08:54 / 08:55）**：① 仿造主链补头链；② **请求应统一到一个地方，persona 不应有请求** ⇒ persona 生成退出后端、解析与请求构造放到渲染端。
- **收敛**：新增 `Agent/ProviderHttpHeaders.cs`（`ApplyOpenAiChat` / `ApplyAnthropic`，各带 debug 版），`ProviderCompletionService` 按协议调用；渲染端新增 `lib/persona/generator.ts`；**删掉后端 `PersonaGenerator.cs` / `PersonaGenerationPrompt.cs` 与 `PersonaModule.cs` 的 `persona/generate` 注册**。
- **姊妹项 S-172**（主链流式头链 5 份收敛：`OpenAIChatHeaders` / `AnthropicMessagesProvider` / `OpenAIResponsesProvider` / `ContextCompression` ×2）**本次不做**，已移入 iter-38。

### S-169：OpenCode Go 内置模型清单全量刷新

- **范围（老大 09:26 补）**：更新各模型价格 + 去除无效模型；09:42 拍定「**以官方文档为准，分档定价取最高档**」。
- **落地**：`opencode-go.ts` 按官方文档 **31 条**刷新（+229 / −73，version 8→9）。原登记时列过 A（models.dev 33 个）/ B（网关 43 个）/ C（只修 400 + 改名）三档待裁，最终按官方文档 31 条。

### 37 迭代修复项 ①②③④：人格作用域解析与保存回环（不占需求编号）

- **来源**：老大 10-08 10:28 ~ 11:41 测试暴露，**明确定性为 bug 修复、不单开需求**（「这个不单开，就是 bug 修复」）。
- **四项**：① 人格 ID 生成改为**拼音 + 12 位短 GUID**（重名提示冲突，已存在的不迁）；② 一句话标语 / 描述 / 名称**保存不上**（`PersonaStore.SavePersona` 原先只写 4 个 md，`config` 三字段从未落盘）；③ AI 辅助生成人格**太啰嗦**（按桃子档压字数上限）；④ **会话人格信息丢失**（`GetPersona` 非内置 ID 无全局回落 + `ListPersonas` 不合并两层 + `composer-toolbar` 未传 `workingFolder`）。
- **口径**：**人格只有两层** —— 全局层（出厂自带 + 用户自建）+ 项目层（项目自建、独立一份、可任意改）；无独立「内置人格」层级。同名 ID **不拦**，自建加后缀保留、出厂内置也留着。

## `21591cfc`（⚠️ 误标为「迭代收尾刀」）

- **定性订正**：该提交信息自称「迭代37 收尾」，**实际迭代并未收尾**（其后又落五刀：S-168 / S-170 / S-171 / S-169 / 人格修复）。真实内容 = **S-167 同族清扫 + 新增 `send-model-resolution` 套件 + 文档订正 + 版本号预升**。
- **内容**：`cancelPlan` 与 `cron-runtime` 的 `new_session` 分支拉回统一入口；新增 `tests/send-model-resolution/`（9 断言，store 走 stub）；补 `sendSites` 覆盖面并给 `cron-runtime.ts` 显式豁免（它的 `buildProviderConfig` 产的是带 `apiKey` 的 `ProviderConfig`，与 agent/run payload 不同型）；清 `any`、修过期注释、把两处优先级细节写进注释。**未采纳** Goal 恢复读全局模型那条（C# 侧注释明示那是 Goal 自身的 legacy fallback，另案）。
- 门禁：`npm run typecheck` **EXIT=0**；`npm test` **65/65**（TS 49 + C# 16）—— 迭代基线 61/61，至此 +4 套。

## 收尾刀

- **门禁**：`npm run typecheck`（`typecheck:node` + `typecheck:web`）**EXIT=0**；`npm test` **65 / 65**（TS 49 + C# 16）。
- **版本号核对**：`package.json` / `package-lock.json`（顶层与 `packages['']`）均 `0.2.37` —— 由 `21591cfc` 预升，本次无需再动。
- **文档订正**（本次收尾的主体）：① `changelog.md` 给 `21591cfc` 定性订正（「收尾刀」→「误标」）并补 09-30 / 10-08 两节流水；② `plan.md` / `raw-requirements.md` 补 S-169 / S-171 索引与刀序、修正编号（S-165 不占刀位）；③ 本文件按实际刀序重写刀表与要点；④ `PROGRESS.md` 的 v2-iter-37 行补全本迭代全部内容、日期改 10-08；⑤ `S-168.md` / `S-170.md` 状态行由「已登记，待实施」改为「已实施」。
- **静态复核 S-168 ~ 人格修复五刀**（第 13~17 刀）：
  - `persona/generate` 注册与 `PersonaGenerator.cs` / `PersonaGenerationPrompt.cs` 删除**无残留引用**（`Persona` 目录已无该两文件；`EmptyProviderJson` 已随 `ProviderCompletionService` 迁到 Agent 且在用）。
  - **修一处过期注释**：`PromptProfile.cs` 的 `Bootstrap` 档位原注「Used by PersonaGenerator (iteration 6)」，而该类已删 —— 改为指向真实消费方（`tests/.../Program.SandboxPrompt.cs`）。**核实结论：`Bootstrap` 不是死代码**（测试在用），故保留枚举值与其分支。
  - S-170 的 `version` 3→4 与注释齐全；S-169 的清单改动为数据类，由既有回归套件覆盖。
- **如实记**：第 1~12 刀**没有做过真机走查**，只到「编译 + 回归套件」级别（S-167 与 S-161 两条是老大报的原始 bug，风险最高）；**第 13~17 刀（S-168 / S-170 / S-171 / S-169 / 人格修复）由老大在 dev 实例逐条真机验证过**（10-08 13:42「真机走查我已经测试过了，进行迭代收尾」）。本迭代仅第 1 刀走了独立 subagent 审查，其余各刀由 `21591cfc` 与本次收尾刀静态复核。

## 发布

- 按 `docs/release-workflow.md` 走，**含 4.2「上传官网下载目录」**（本迭代与 iter-36 一样要传三件套：`setup.exe` + `latest.yml` + `.blockmap`）。
