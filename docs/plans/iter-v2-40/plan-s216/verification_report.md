# S-216 阶段六验证报告

- 验证时间：2026-10-21
- 验证环境：Windows / node v24.14.1 / dotnet SDK 11.0.100-preview.7 / electron 43.2.0
- 分支：`dev/v2-iter-40`
- 结论：**自动化门禁全绿**；真机冒烟待老大验收（清单见 `review_report.md` 第二节 ⚠️5）

---

## 一、门禁结果

| 项 | 命令 | 结果 |
| --- | --- | --- |
| TypeScript 类型（node） | `tsc --noEmit -p tsconfig.node.json` | **0 错误** |
| TypeScript 类型（web） | `tsc --noEmit -p tsconfig.web.json` | **0 错误** |
| 全量测试 | `npm test` | **78/78 通过**（TS 60 + C# 18） |
| 新增专项 | `npm run test:browser-device` | **53 assertions passed** |
| 后端编译 | `dotnet build src\runtime\WishfulClaw.sln` | **0 警告 / 0 错误** |

迭代基线为 73/73（iter-40 收尾值），本次新增 `test:browser-device` 一套 ⇒ 78/78 的增量来自新套件 + 既有套件无回归。

---

## 二、修复过的回落

| 轮次 | 现象 | 处置 |
| --- | --- | --- |
| 首轮 `npm test` | `ProviderHeader` FAIL：`all 9 browser tools are registered (found 10)` | 断言 9 → 10，并同步注释 |
| 第二轮 `npm test` | `ProviderHeader` FAIL：`project:chat sees 7 browser tools, expected 6` | 非 work run 期望 6 → 7、work run 9 → 10（`BrowserSetDevice` 是 `Everywhere` + 排除无人值守，故两侧各 +1） |
| 首次 `dotnet build` | `MSB3027` 文件被 `WishfulClaw.Worker (17876)` 锁定 | 按纪律先停 dev 实例再编译 |
| 首轮 `typecheck:web` | `AppPluginPanel.tsx(100)`: `TOOL_ARG_LABELS` 缺 `BrowserSetDevice` | 补键 + 补 import |

---

## 三、行为验证（可自动化的部分）

| 断言组 | 覆盖 | 结果 |
| --- | --- | --- |
| `nextCommittedUrl` | 切会话 / 序号变 / 目标为空 / 复用开关变 / **站内跳转不变** + 多条件优先级 | pass |
| `isSameBrowserUrl` | 尾斜杠、主机名大小写、默认端口、不同路径、不同协议 | pass |
| `resolveBrowserDeviceViewport` | `pc → null`；iphone 390×844@3；pixel 412×915@2.625；ipad 820×1180@2；custom 缺省 390×844@3 | pass |
| UA 清洗 | 三个预置 + custom 的 UA 非空且**不含 `Electron`** | pass |
| `normalizeViewportSide` | 0 / 负数 / NaN / 非数字 → 回落；超界 → 夹取；小数 → 取整 | pass |
| `isBrowserDeviceMode` | 拒 `desktop` / `null` / `1` | pass |
| `browserDeviceKey` | 同输入同键、不同尺寸不同键、**夹取后等值 ⇒ 同键** | pass |
| 工具注册面 | 浏览器类工具 10 个全部登记；`use_capability` 代理侧 work run 10 / 非 work run 7；无人值守 0 | pass |

---

## 四、未验证（需真机）

见 `review_report.md` 第二节 ⚠️5 的 a–l 十二条。重点三条：

1. **站内点链接不整页重载** —— 本次核心诉求，自动化只能验状态机，验不了真实 webview 行为。
2. **面板首次挂载不产生额外 reload** —— 靠「首帧只记基线不触发」保证，需肉眼确认无闪一下。
3. **agent 切设备后 `window.innerWidth` 等于设备宽** —— 验主进程 `enableDeviceEmulation` 真的生效。

---

## 五、遗留

- `S-213` 仍 blocked（缺钉钉 `appKey` / `appSecret`），与本需求无关。
- backend `src/runtime` 与前端 `browser:set-device` 通道均已通，但**未做端到端联调**（agent 真实发起 → 主进程执行 → 面板响应），归入真机项 i/j/k。
