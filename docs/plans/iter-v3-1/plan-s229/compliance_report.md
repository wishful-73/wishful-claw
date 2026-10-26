# S-229 合规审查（阶段三）

> 2026-10-26 · 对照 `AGENTS.md` / `docs/dev-workflow.md` 硬线逐条自查
> 范围：内置 OAuth 预设投影丢协议字段（Bug）

## 一、硬线核对

| # | 硬线 | 结论 | 说明 |
|---|---|---|---|
| 1 | 单文件 >500 行必须拆分或写豁免头 | ✅ 通过 | 唯一越线文件 `src/shared/types/provider.ts` **513 行**，**本就有豁免头**（同质 `export interface` 声明表），本次把行数从 505 订正为 513；其余改动文件 `provider-materialization.ts` 223、`workbuddy.ts` 177、`ProviderAuthPanel.tsx` 326、`tests/provider-presets/program.ts` 476，均在线内 |
| 2 | 文件编码无 BOM | ✅ 通过 | 5 个改动文件逐字节确认前 3 字节不是 `EF BB BF` |
| 3 | 行尾与仓库现状一致 | ✅ 通过 | `provider.ts` / `provider-materialization.ts` / `program.ts` 为 CRLF；`workbuddy.ts` / `ProviderAuthPanel.tsx` **改前本就是 LF**（`git diff` 各 1~2 行，未整文件重写），保持原状不动 |
| 4 | 修改面最小，不动无关代码 | ✅ 通过 | 只碰 5 个文件：类型加字段、投影函数补字段、两个 preset 加 `tagline`、卡片副标题与签到按钮守卫、回归用例 |
| 5 | 不新引第三方依赖 | ✅ 通过 | 零新增依赖 |
| 6 | 不改预设清单 / 不 bump preset version | ✅ 通过 | `providers/index.ts` 未动；虚拟投影每次重建即生效，已物化记录由 `fillMissingProtocolFields` 补齐 |
| 7 | 用户配置不被静默覆盖 | ✅ 通过 | `fillMissingProtocolFields` 只在字段为 `undefined` 时写入；`homepage` / `tagline` 属只读展示字段，维持 R-9.C.9 的刷新语义 |
| 8 | 不共享可变对象 | ✅ 通过 | `oauthConfig` / `ui` / `channelConfig` 浅拷贝；`requestOverrides` 两层结构化拷贝（`headers` / `body`），回归用例覆盖「改一个投影不影响下一个」 |
| 9 | 只 commit 不 push | ✅ 通过 | 提交后不推送 |
| 10 | 一个需求一刀 | ✅ 通过 | 全部改动随 S-229 单次提交；文档（本文件、review、verification）随之提交 |

## 二、与既有需求的边界

| 需求 | 关系 | 处理 |
|---|---|---|
| S-218 WorkBuddy 接入 | 同一通道，长期 `blocked` 在真账号实测 | 本需求修的就是 S-218 的真机阻断点；S-218 文档里的「需真账号实测」结论待真机验收后回填 |
| S-230 Qoder 接入（新登记） | 老大 11:04「WorkBuddy 和 Qoder 这些也列出来」 | **Qoder 代码 0 命中、无契约来源**，本需求不做，单列 S-230 |
| S-231 放宽收录范围到 codex / copilot / moonshot | 同一面板 | 需先做通用登录分发（`handleSignIn` 硬编码 `signInWithWorkBuddy`）；本需求保持 `server_poll` 筛选，签到按钮加 `flowType` 守卫为将来放宽铺路 |

## 三、口径确认

- **预设名不动**（老大 11:04 裁定）：`WorkBuddy` / `WorkBuddy AI` 保持原名，用新增只读字段 `tagline`（国内版 / 国际版）在卡片副标题里区分。
- `tagline` 走 `AIProvider` 还是渲染层常量：选前者，与 `homepage` 同契约（预设拥有、UI 只读、每次重投影刷新），否则面板要去 import 预设表，等于把展示逻辑绑死在预设模块。

## 四、合规结论

**❌ 0 项 / ⚠️ 1 项（真机验收未做，阶段六闭环）** ⇒ 允许进入阶段四（已实施完毕，见 `plan.md` §五）。
