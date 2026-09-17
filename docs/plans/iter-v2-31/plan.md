# Plan: v2-iter-31 死代码清理与侧栏体验收口

> 分支 `dev/v2-iter-31`（base `main` @ `f815e739`，v0.2.30）
> 需求文档（权威）：`docs/plans/iter-v2-31/raw-requirements.md`，编号 S-46 ~ S-50
> 本迭代仓促，后续可能追加需求；追加项直接续编号写进 raw-requirements 并在此文件追加小节。

## 目标

清掉一批用户永远碰不到的死入口（占位页路由、废弃功能入口、假承诺按钮），
补上右侧面板缺失的常规 Git 操作，并修掉侧栏首排组合按钮的样式突兀问题。

## 步骤清单

### S-46 废弃入口与占位页清理

范围（严格按 raw-requirements S-46「要清的东西」，`chatView: 'git'/'channels'` 不归本条）：
`skills` / `souls` / `sync` / `resources` / `codegraph` 五个开关 —— 实测全仓零调用方。

- [x] 步骤 1：`stores/ui-store.ts` 删 5 组 `xxxPageOpen` 状态 + `openXxxPage`/`closeXxxPage` 动作；同时清掉 `openFreeChatPage` 里对 `codeGraphPageOpen` 的引用
  - 验证：`npx tsc --noEmit -p tsconfig.web.json` 零错误（此处会先报错，随步骤 2/3 收敛）
- [x] 步骤 2：`stores/ui-store-interface.ts` 删对应 5 组声明
  - 验证：同上
- [x] 步骤 3：`components/layout/MainLayout.tsx` 删 `FEATURE_PAGES` 常量、`activeNavItem !== 'chat'` 分支、5 个 `if (xxxPageOpen)` 分支、5 个 selector、随之无用的 icon import
  - 验证：`npx tsc --noEmit -p tsconfig.web.json` 零错误
- [x] 步骤 4：`components/layout/TitleBar.tsx` 删 `isSessionPage` 里对应的 5 个条件
  - 验证：同上
- [x] 步骤 5：`stores/right-panel-tab-factories.ts` 的 `CHAT_SURFACE_NAV_RESET` 删 5 个字段
  - 验证：同上
- [x] 步骤 6：全量 gate —— `npx tsc --noEmit` 三个配置零错误 + 渲染端能启动 + 侧栏/聊天窗/设置页可正常切换
  - 验证：三个 tsconfig 全零错误；`PlaceholderPage` 仍有引用（draw / git / channels），故**保留**

### S-47 Channels 项目主页入口删除

- [x] 步骤 1：删 `components/chat/ProjectHomePage.tsx` 的渠道入口按钮（`:129`）
- [x] 步骤 2：删 `ui-store.ts` / `ui-store-interface.ts` 的 `navigateToChannels`（实测仅此一处调用）
- [x] 步骤 3：删 `MainLayout.tsx` 的 `chatView === 'channels'` 分支与 `FEATURE_PAGES.channels`
- [x] 步骤 4：清对应 locales key
  - 验证：三个 tsconfig 零错误；项目主页正常渲染，渠道配置（设置页）不受影响

### S-48 Translate 残留按钮清理

- [x] 步骤 1：`AssistantMessage/action-bar.tsx` 删翻译按钮 + `handleTranslate` + `useTranslateStore` 引用
- [x] 步骤 2：`UserMessage.tsx` 删同类调用与 `openTranslatePage`
- [x] 步骤 3：`ui-store.ts` / `ui-store-interface.ts` 删 `translatePageOpen` / `open` / `close`
- [x] 步骤 4：`MainLayout.tsx` 删 translate 分支与 `FEATURE_PAGES.translate`
- [x] 步骤 5：清对应 locales key
  - 验证：三个 tsconfig 零错误；消息操作栏与用户消息菜单正常渲染
  - 注意：**能力本体保留** —— `lib/translate-agent-service.ts`、`stores/translate-store.ts` 不动

### S-49 完善 Git 功能：右侧面板补常规 Git 操作

- [x] 步骤 1：确认方向（甲：挂 `GitPage` / 乙：给 `ChangesPanel` 补菜单）后按选定方向落地
- [x] 步骤 2：补 fetch / pull / 切分支 / 合并 / 刷新远程 / 分支管理入口
- [x] 步骤 3：删 `MainLayout.tsx` 的 `chatView === 'git'` 分支与 `FEATURE_PAGES.git`
  - 验证：三个 tsconfig 零错误；右侧面板 Git 操作可跑通（真机验证）

### S-50 左侧面板首排组合按钮重新设计样式

方向：**甲（分段控件）** —— 外层加容器底，内部两个等宽选项，hover/active 才浮起。

- [x] 步骤 1：改 `components/layout/workspace-sidebar-nav.tsx` 的 `renderSplitNavItem`，只动这一个函数
  - 验证：三个 tsconfig 零错误；真机看 light / dark 两套主题下的观感

## 涉及文件

- `src/renderer/src/stores/ui-store.ts` — 删死状态与动作
- `src/renderer/src/stores/ui-store-interface.ts` — 删对应声明
- `src/renderer/src/stores/right-panel-tab-factories.ts` — 删 reset 里的死字段
- `src/renderer/src/components/layout/MainLayout.tsx` — 删占位路由与死配置
- `src/renderer/src/components/layout/TitleBar.tsx` — 删对应可见性条件
- `src/renderer/src/components/layout/workspace-sidebar-nav.tsx` — 组合按钮样式
- `src/renderer/src/components/chat/ProjectHomePage.tsx` — 删渠道入口
- `src/renderer/src/components/chat/UserMessage.tsx`、`AssistantMessage/action-bar.tsx` — 删翻译入口
- `src/renderer/src/components/right-panel/**` 或 `components/git/**` — S-49 落点（待定向）
- `src/renderer/src/locales/{zh,en}/*.json` — 对应 key

## 参考源码

- 无外部参考。S-49 走既有 `stores/git-store.ts` + `main/ipc/git-page-handlers.ts` 能力，S-50 为纯样式调整。

## 门禁（每个需求做完必跑）

1. `npx tsc --noEmit -p tsconfig.web.json` / `tsconfig.node.json` / `tsconfig.json` —— 三个全零错误
2. 触碰文件 **BOM clean**（首 3 字节不得为 `EF BB BF`）
3. 涉及 C# 时：Worker 编译 + `tests/WishfulClaw.Tests.sln` 0 警告 0 错误
4. 提交：一个需求一刀，修复调整攒进收尾那一刀
