# S-216 阶段五审查报告

- 审查对象：iter-40 / S-216（内置浏览器设备模拟 + 站内跳转不重载）
- 审查时间：2026-10-21
- 审查人：老郑（自审）
- 结论：**❌ 0 / ⚠️ 5**，其中 1 条已在本轮修掉

---

## 一、审查范围

本轮改动 20 个文件（新建 8 / 修改 12），逐项过：

| 层 | 文件 | 结论 |
| --- | --- | --- |
| 共享层 | `src/shared/browser-device-presets.ts`（新） | 纯数据 + 纯函数，无副作用，可单测 |
| 渲染·纯逻辑 | `src/renderer/src/lib/browser/committed-url.ts`（新） | 导航目标状态机，单测覆盖 |
| 渲染·副作用 | `src/renderer/src/lib/browser/apply-browser-device.ts`（新） | 补仿真 / 切设备职责分离，在途去重 |
| 渲染·组件 | `browser-toolbar.tsx` / `browser-device-picker.tsx` / `use-browser-device-emulation.ts`（新） | 从 `BrowserPanel` 抽出，`BrowserPanel` 485 → 465 行 |
| 渲染·面板 | `BrowserPanel.tsx` | 导航语义拆分 + dom-ready 补仿真 + UA prop |
| 渲染·store | `ui-store.ts` / `ui-store-browser-slice.ts` / `ui-store-interface.ts` / `browser-session-helpers.ts` | 新增两个 action，`ensureBrowserTab` 递增序号 |
| 渲染·工具 | `browser-device-native.ts`（新）/ `browser-native-ui.ts` / `browser-tool.ts` / `app-plugin/types.ts` | 登记 + 分发 + 占位 definition |
| 主进程 | `misc-handlers.ts` / `channels.ts` / `messagepack-channel-routing.ts` | 新通道 `browser:set-device` |
| 后端 | `BrowserToolProvider.cs` / `AgentRuntimeBrowserExecutor.cs` | 注册 + 白名单 |
| 文案 | `locales/{zh,en}/{layout,chat,settings}.json` | 4 类键 |
| 测试 | `tests/browser-device/program.ts`（新）/ `BrowserSurfaceAccessChecks.cs` | 53 断言 + 两处数量期望 9/6 → 10/7 |

---

## 二、发现的问题

### ⚠️1（已修）设备选择器的自定义尺寸草稿不跟随外部改动

`browser-device-picker.tsx` 的 `draft` 初值只在挂载时从 store 读一次。agent 用 `BrowserSetDevice` 把 custom 尺寸改成 500×900 之后，用户再打开面板仍看到旧数字，一点「自定义尺寸」就用旧值覆盖了 agent 刚设的值。

**修法**：`useEffect([open, customViewport])` —— 每次打开面板按 store 最新值重置草稿；只在打开时同步，用户编辑期间不会被自己的输入打断。

### ⚠️2 `BrowserToolProvider` 的注册顺序与其它工具不一致

`BrowserSetDevice` 插在 `BrowserEvaluate` 之后、`WebSearch` 之前。功能无影响，但 `BrowserEvaluate` 在 `app-plugin/types.ts` 里本就没有常量（只有 Navigate/GetContent/Screenshot/Snapshot/Click/Type/Scroll 七个），本次也没补。

**处置**：不动。补 `BROWSER_EVALUATE_TOOL_NAME` 属于另一条线（Evaluate 的插件门面缺失），混进来会让本次改动语义不纯。记入 tech-debt。

### ⚠️3 `inFlight` 键是 `webContentsId`，重建后依赖 `forgetBrowserDeviceState` 兜底

webview 重建（切「复用浏览器数据」开关）后 guest id 变化，旧条目若不清理会一直留在 Map 里。当前在 `handleWebviewRef` 的 cleanup 里调了 `forgetBrowserDeviceState(wv)`，但 `wv.getWebContentsId()` 在销毁后可能抛异常 —— 已用 try/catch 兜住。

**残余风险**：宿主进程被强制杀掉时 cleanup 不执行，条目泄漏。Map 条目只有一个 promise，量级可忽略，不做额外处理。

### ⚠️4 三处数量断言是硬编码

`BrowserSurfaceAccessChecks.cs` 里 `browserTools.Length == 10` 与 `expected = workRun ? 10 : 7` 都是写死的。新增浏览器工具时必须同步改，否则 `npm test` 红。

**这是有意为之**：它正是为了在新增工具时强制人工确认「该工具的可见性给到了哪些角色」。保留。

### ⚠️5（已验证）真机冒烟

自动化只能证明纯函数与注册表正确，以下原定必须真机过。**老大 2026-10-21 14:04 确认已全部测试通过**，清单保留作为回归基线：

| # | 场景 | 期望 |
| --- | --- | --- |
| a | 浏览器面板从没开过，点链接外部打开 | 面板出现并加载该页 |
| b | 面板已开，点另一个链接 | 跳到新地址，**只加载一次** |
| c | 站内点链接 / 切 tab / 改 hash | **页面不整页重载**（← 本次核心） |
| d | 地址栏输入新地址回车 | 跳转，只重载一次 |
| e | 地址栏输入当前地址回车 | 重载一次 |
| f | 切会话再切回 | 各自地址正确恢复 |
| g | 切「复用浏览器数据」开关 | 重载，最终停在当前地址 |
| h | agent 调 `BrowserNavigate` | 正常跳转 |
| i | 工具栏五个设备逐个点 | iphone/pixel/ipad 出移动布局；pc 回桌面 |
| j | 切设备后 `BrowserEvaluate` 读 `window.innerWidth` | 等于该设备宽（390 / 412 / 820） |
| k | 反复点同一个设备 | 仍重载一次（不会「没反应」） |
| l | 面板首次挂载 | **不产生额外 reload** |

---

## 三、确认无问题的点

- `nextCommittedUrl` 的五条规则优先级明确，`scopeChanged > 序号 > 空目标 > 复用开关 > 保持`，且「站内跳转不改变导航目标」有专门断言兜住回归。
- `dom-ready` 只补视口、不 reload —— 这是「无限重载」的唯一防线，两条触发源已物理分离到 `apply-browser-device.ts` 的两个函数。
- `applyBrowserDevice` 的并发：同配置复用 promise，不同配置排队；`finally` 里用 `promise` 身份校验再删表，避免误删后来者。
- `reloadAndWait` 跳过 `errorCode === -3`（ERR_ABORTED）与子帧失败，且有 10s 超时兜底。
- 运行时切设备走 `setUserAgent`（属性只对导航前生效），重建靠 `useragent` prop —— 两条路各管一段，不打架。
- `BrowserPanel.tsx` 465 行、`browser-native-ui.ts` 451 行，均未越 500 行线；`ui-store.ts` 573 行属存量越线，已补豁免头。
- 单测 53 断言覆盖：五条导航规则 + 优先级 + 同址判定 + 三个预置宽高/DPR + custom 缺省与夹取 + UA 不含 Electron + 枚举拒绝 + 去重键。

---

## 四、tech-debt（本次不处理）

1. `app-plugin/types.ts` 缺 `BROWSER_EVALUATE_TOOL_NAME`，`BrowserEvaluate` 不在插件门面里。
2. `ui-store.ts` 573 行，按 slice 继续收敛到各自文件（store 聚合入口的老账）。
3. `enableDeviceEmulation` 的 `screenPosition` 未用，多设备并排时视口原点都在左上角 —— 单设备场景无影响。
