# Plan: S-220 内置浏览器刷新按钮改硬刷新

> **补写于 2026-10-23。** 阶段二产物事后补齐（首轮跳流程）。步骤按实际实施还原，**保留首版方案的错误方向** —— 这条需求经历了一次方案整体推翻，不记下来等于把最有价值的部分删了。
> 实施提交：`9342316f`（`fix(browser)`，`BrowserPanel.tsx` 13 行）。
> 需求正文见 `../requirements/S-220.md`；两条导航路径与缓存语义的对照表在其 §3.1-§3.2。

## 目标

让内置浏览器工具栏的**刷新按钮必然拿到最新内容**（绕过缓存），解决「本地改了页面、手输地址后仍是旧版」的困扰。

## 步骤清单

| # | 步骤 | 验证检查点 | 状态 |
|---|---|---|---|
| 1 | 只读勘察两条导航路径 | 命令式导航走 `<webview src>` 属性变化 → Electron `loadURL`；刷新走 `runWebviewCommand` → `reload()` | [✓] |
| 2 | 查清 `reload()` / `loadURL()` / `reloadIgnoringCache()` 三档缓存语义 | `electron.d.ts:20073` 确认 `reloadIgnoringCache(): void` 存在，与 `reload()` 同签名 | [✓] |
| 3 | 实测定性（17:49 - 17:50） | 刷新后是新内容 ⇒ **刷新路径本来就对**，旧内容是 `loadURL` 命中启发式缓存 | [✓] |
| 4 | 收窄口径（17:52 老大定义） | 诉求 = 「点刷新就一定新」，不是「手输地址也不吃缓存」 | [✓] |
| 5 | 改工具栏刷新：`reload()` → `reloadIgnoringCache()` | `BrowserPanel.tsx:440` 一行替换 | [✓] |
| 6 | 连带改同址回车与失败重试（`:214` / `:495`） | 三处均为硬刷新；`committed-url` 状态机未动 | [✓] |
| 7 | **保留**挂载 / 连接后自动重载为软刷新 | `:383` 仍 `reload()` —— 自动路径硬刷新会让每次挂载全量拉 | [✓] |
| 8 | 不碰设备切换与自由对话页 | `apply-browser-device.ts:200`（应用 UA）、`FreeChatPage.tsx:83` 未改 | [✓] |
| 9 | 类型门禁 | `npm run typecheck` 0 错误 | [✓] |
| 10 | 真机验收 | 改本地页面 → 手输地址（旧）→ 点刷新（新）→ 再手输同址（新） | [ ] |

## 首版方案的错误方向（已推翻）

初版登记把根因判成「`reload()` 吃缓存」，方案是**改 session 缓存策略 / 重构导航**（备选 A：main 进程 `webRequest.onBeforeSendHeaders` 按 host 注入 `no-cache`）。

17:50 实测推翻：**刷新本来就是好的**，坏的是手输地址那条路。于是 17:52 按老大定义把方案整体收敛为「刷新按钮改硬刷新」，原方案降级为备选（`S-220.md §5.3`）。

**教训**：现象与根因之间隔着一层「用户实际怎么操作」。初版把「手输地址看到旧页面」直接读成「刷新也吃缓存」，没验证「用户手动刷新一下会怎样」—— 而这个一分钟的验证就能否掉整个 session 层方案。

## 涉及文件

### 修改

- `src/renderer/src/components/layout/BrowserPanel.tsx` — 三处 `reload()` → `reloadIgnoringCache()`（`:214` 同址回车、`:440` 工具栏刷新、`:495` 加载失败重试）

### 不改

- `src/renderer/src/components/layout/BrowserPanel.tsx:383` — 挂载 / 连接后自动重载，保持软刷新
- `src/renderer/src/lib/browser/apply-browser-device.ts:200` — 切设备只为应用 UA
- `src/renderer/src/lib/browser/browser-native-ui.ts:139` — 模型调用 refresh（待定项，未纳入）
- `src/renderer/src/pages/FreeChatPage.tsx:83` — 自由对话页刷新（待定项，未纳入）
- `src/shared/browser-plugin.ts:8` — `persist:` 分区不动（去掉会连登录态一起丢）

## 参考源码

无。判断依据是 Electron 类型声明与 Chromium 缓存语义，不涉及参考项目。

## 规模

`BrowserPanel.tsx` 本提交 +5 行，累计 515 行 —— **超 500 线且无豁免头**，阶段五判 ❌（见 `review_report.md`）。
