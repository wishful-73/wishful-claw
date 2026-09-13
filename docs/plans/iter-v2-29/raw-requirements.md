# iter-v2-29 原始需求登记

> 2026-09-13 建档。S-16 / S-17 / S-18 三条来自 iter-28 收尾讨论（R-10 期间）派生，原登记于
> `docs/plans/iter-v2-28/raw-requirements.md` 后继需求表；2026-09-13 老大拍板三条**全部排 29 迭代**，
> 本文件为权威需求文档，28 侧仅留溯源行。
> S-19 是同日老大在授权 28 迭代收尾时**新增口述**的需求，不在 28 的后继表内，直接建在本文件。
> 勘测行号均为 2026-09-13 实读，立项时按当时代码复核。

## S-16 输入框长粘贴折叠块（复刻 DeepSeek-Reasonix）

**一句话**：长文本粘贴进输入框不整段展开，折成带标签的可折叠 chip；chip 原文无损保存，提交时替换回全文。

### 背景

老大 2026-09-13 R-10 吸附卡讨论原话「我在想要不要复刻 Reasonix 对粘贴文本的处理」。当次拍定吸附卡紧凑指示条（iter-28 `plan.md` R-10.5，已落地），粘贴折叠留到本迭代。

### 为何 28 不做

吸附卡指示条已解决「执行中当前轮长消息」的展示问题；粘贴折叠属**编辑器输入侧新机制**——undo/redo 栈、caret 管理、per-session 草稿状态都要与折叠块联动，改动面独立。

### Reasonix 实现勘测（2026-09-13）

来源 `D:\claw\DeepSeek-Reasonix\desktop\frontend\src\components\Composer.tsx`：

- 折叠阈值 `LONG_PASTE_MIN_CHARS=2000`／`LONG_PASTE_MIN_LINES=20`（`:98-99`，满足其一即折）
- `PastedBlock{label,text}` 原文无损保留（CRLF 原样）
- chip 标签形如「粘贴 #N · L 行」，带**显示预览／展开回填原文／移除**三操作（`:4402-4429`）
- 提交前 `expandPastedBlocks()` 把标签替换回原文（`:1817`）
- 图片粘贴走附件（`SavePastedImage`），PDF/doc 等二进制粘贴落盘为文件附件
- `pendingPaste` 计数在异步附件处理期间禁提交（`submitBlocked` 含 `pendingPaste > 0`）

### 接手要点

- wishful-claw 输入框在 `FileAwareEditor.tsx` 一族；undo 栈已有 iter-28 `editor-undo-selection-issue.md` 记录的既有问题，折叠块必须与 undo 联动设计（回填/移除是一条 undo 记录还是多条）
- caret 定位按 label 长度换算；展开回填与移除后 caret 的落点要跟 Reasonix 对齐实测

---

## S-17 代理调用状态显示真实工具名

**一句话**：Agent 经 `use_capability` 代理调用工具时，输入框左上角的运行状态条显示被代理的**实际工具**（如 `BrowserNavigate`／`skill:xxx`），而不是 `use_capability` 本身；审批提示文案同口径。

### 背景

老大 2026-09-13 R-10 收尾讨论原话「调用 use_capability 进行工具代理调用的时候写的是 use_capability 本身，我希望这里的状态也是显示被代理的工具」（同日老大更正：状态条位置在**输入框左上角**，首次描述误说为聊天窗左上角）。

### 现状勘测（2026-09-13 实读）

- 状态条文案源：`runtime-status.tsx:191`——`activeToolName` = 最近一条 `running`/`streaming` 工具记录的 `name`；代理调用时记录 name 即 `use_capability`
- 真实工具在该调用的 `arguments.capability_id`（形如 `mcp-tool:server/tool`／`builtin:toolName`／`skill:name`），解析即可得显示名
- 同文件 `:327-331` 审批提示（`pendingApprovalToolName`）同口径要一并改；`:361-365` 执行中文案与 `:411-412` 依赖数组联动

### 接手前要定的口径

- 显示裸工具名还是 `server/tool` 全路径；`action`（list/call）要不要带
- skill 与 mcp-tool 两种 capability_id 形态怎么显示

### 一处分歧要问老大

聊天窗内 `use_capability` 工具卡已被 `execution-outline.ts:111-112` 刻意隐藏（注释「an unresolved use_capability card is noise, so hide it」）——确认卡片与状态条是否统一口径（都显示真实工具名），还是维持卡片隐藏只改状态条。i18n 文案 key 随之补齐。

---

## S-18 右侧面板分支视图（本地/远程分支列表 + 提交图谱）

**一句话**：右侧面板（已有「文件树 / 变更」双 Tab，`layout/AgentFilesPanel.tsx`）增加 Git 分支视角：远程有哪些分支、本地有哪些分支、提交图谱（分支线可视化）。

### 背景

老大 2026-09-13 R-10 收尾讨论原话「右侧面板文件树块，之前增加了文件变更，希望能找位置再可以看分支线，比如远程有哪些分支，本地有哪些分支，有哪些提交的图谱」。

### 现状勘测（2026-09-13 实读）

- 面板落点 = `layout/AgentFilesPanel.tsx`；iter-v2-26 Plan H 已接入「文件树/变更」Tab（`docs/plans/iter-v2-26/plan-changes-panel.md`），分支视图顺势成第三 Tab 或在变更 Tab 内找锚点——**位置取舍由老大定**
- 数据层大半已有：`git:list-branches`（`git-handlers.ts:160`，走 `queryGit`）、`git:create/checkout/merge/rebase-branch`、`git:fetch` 均已注册
- **提交图谱无现成 IPC**——须新增（`git log --graph --all --date-order` 结构化，或按 refs+parents 自行组装拓扑），并考虑挂 `git-cache.ts` 缓存
- 渲染复用 `useGitStore`；图谱绘制无现成组件，SVG 手绘或引依赖（isomorphic-git-graph 类）要选型
- 多仓库工作区场景（`git:scan-repositories` 支持扫描）图谱按单仓库展示，入口层级接手时对齐现有变更 Tab 的仓库选择逻辑

---

## S-19 软件自身界面截图能力 —— 使用指引配图由 Agent 自建

**一句话**：让 Agent 能在应用里截取**软件自身界面**并**落盘到仓库路径**，用来补全 iter-28 R-4 交付的《使用指引》配图；即"指引由 agent 自己建、自己配图"。

### 背景

老大 2026-09-13 授权 28 迭代收尾时的原话：

> 「我需要 29 迭代可以进行软件本身截图，因为我需要补充使用指引中的截图，我希望到时候 agent 自己自建指引这种方式」

这条推翻了 iter-28 当时的判断。iter-28 R-4 把《使用指引》文档骨架、README 拆分、应用内双入口都交付了，但 **R-4.5 配图明确记为"本次不做、且属人类动作"**（`docs/plans/iter-v2-28/plan.md:969` 步骤至今未勾，`verification_report.md` §4 R-4 行记为 PARTIAL），理由是整桌面截图会把别人的窗口和凭据一并拍进公开仓库，"清场只能本人做"。本需求把这件事**从人类专属动作变成 agent 可自助完成的闭环**，因此 29 迭代要交付的是**能力**，不只是那批图。

### iter-28 侧已记录的缺口（接手时的起点，须按当时代码复核）

来源 `docs/plans/iter-v2-28/raw-requirements.md` R-4 段与 `verification_report.md` §4/§5：

- 应用自带 `DesktopScreenshot` 工具**只截主显示器**（返回的 `displayCount` 只是附带信息，不是多屏都截）、**只回 base64 不落盘**，且无窗口/区域入参
- 现成的 `image:persist-generated` 能落文件，但**目录写死在用户 home 下**，指不到仓库路径
- **截图工具无窗口/区域入参**这件事当时被判定"符合预期、不算缺口"（因为老大只要整桌面）；本需求改口径后，它成为**必须先补的主缺口**——只截应用自身窗口才能天然避开别的窗口入镜
- 外部通路也不可用（当时实测，勿重复踩）：`mcp__browser-use__take_screenshot` 报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE (visible=false)`；把 in-app browser 指向 dev 渲染进程 `127.0.0.1:5173` 后 `take_snapshot` 只拿到空 `RootWebArea`，原因是没有 Electron preload 桥、IPC 支撑的界面全空。**浏览器通路不能替代真机**
- 待配图落点清单**已成文**：`docs/user-guide.md` 文末列了 10 处（iter-28 R-4.5 记账），本需求接手时先核对这份清单还差哪些

### 接手时要定的取舍（原话未覆盖，须问老大）

- 截**自身窗口**（干净、无脱敏负担）还是仍**整桌面 + 清场**（能拍到悬浮窗、多窗口关系，但需要脱敏）——两条路的能力面不同，老大这句只点名了"软件本身截图"
- 产物落盘约定：`docs/assets/` 之类的仓库目录、命名规则、以及是否要求与指引里的引用路径单点对应
- 脱敏底线沿用 iter-28 已立口径：**含完整用户路径/凭据的图像不得入公开仓库**（当时据此把启动日志证据排除在库外，见 `verification_report.md` §2 开头）
