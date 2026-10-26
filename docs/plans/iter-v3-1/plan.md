# v3-iter-1：正式版首个迭代 —— 内置浏览器缓存、文件写入并发、安装路径沿用、WorkBuddy 接入

> 代际切换：v2 代际止于 `v2-iter-40`（产品 `1.0.0`）。本迭代起为 `v3-iter-{M}`，产品版本从 `1.0.1` 开始。
> 分支：`dev/v3-iter-1`（base = `6c66de97`）。执行期内只 commit，**不 push**。

## 一、目标

清掉三条长期欠账（内置浏览器缓存、文件写入并发、安装路径沿用），并接入 WorkBuddy 账号（A 形态：复用用户已有套餐额度），为 `1.0.1` 出包。

## 二、需求索引

| 编号 | 标题 | 状态 | 明细 | 六阶段产物 |
|---|---|---|---|---|
| S-217 | 更新安装沿用历史安装范围与安装路径 | **已实施**（真机装包待验） | [S-217](requirements/S-217.md) | [plan](plan-s217/plan.md) · [合规](plan-s217/compliance_report.md) · [审查](plan-s217/review_report.md) · [验证](plan-s217/verification_report.md) |
| S-218 | WorkBuddy 账号接入（A 形态 · 复用用户已有套餐额度） | **已验证**（真机通过：登录 / 签到 / 风险确认） | [S-218](requirements/S-218.md) | [plan](plan-s218/plan.md) · [合规](plan-s218/compliance_report.md) · [审查](review_report.md) · [验证](plan-s218/verification_report.md) |
| S-219 | 文件写入工具并发冲突（同 turn 多次编辑同一文件报 SharingViolation） | **已验证**（真机并发各情形通过） | [S-219](requirements/S-219.md) | [plan](plan-s219/plan.md) · [合规](plan-s219/compliance_report.md) · [审查](plan-s219/review_report.md) · [验证](plan-s219/verification_report.md) |
| S-220 | 内置浏览器按地址导航后仍加载旧页面（刷新按钮改硬刷新） | **已实施**（真机待验） | [S-220](requirements/S-220.md) | [plan](plan-s220/plan.md) · [合规](plan-s220/compliance_report.md) · [审查](plan-s220/review_report.md) · [验证](plan-s220/verification_report.md) |
| S-221 | 官网右侧悬浮联动导航 | **已验证**（观感与联动通过） | [S-221](requirements/S-221.md) | [plan](plan-s221/plan.md) · [合规](plan-s221/compliance_report.md) · [审查](plan-s221/review_report.md) · [验证](plan-s221/verification_report.md) |
| S-222 | 聊天窗时间显示（HH:MM，跨天补日期） | **已验证**（格式通过） | [S-222](requirements/S-222.md) | [plan](plan-s222/plan.md) · [合规](plan-s222/compliance_report.md) · [审查](plan-s222/review_report.md) · [验证](plan-s222/verification_report.md) |
| S-223 | dev 实例的项目级数据目录与生产隔离 | **已实施**（真机通过） | [S-223](requirements/S-223.md) | [plan](plan-s223/plan.md) |
| S-224 | 聊天图片落盘按月份桶，DB 只存路径 | **已实施**（真机待验） | [S-224](requirements/S-224.md) | [plan](plan-s224/plan.md) |
| S-228 | 官网右下角「回到顶部」浮动按钮 | **已实施**（观感待过目） | — | [plan](plan-s228/plan.md) |
| S-229 | 内置 OAuth 预设投影补齐协议字段 | **已实施** | — | [plan](plan-s229/plan.md) |
| S-231 | 运行时附加块改为后置（修第三方会话标题被标签污染） | **已实施**（首段已干净；短消息仍可能截到块，见 §9） | [S-231](requirements/S-231.md) | [plan](plan-s231/plan.md) |

> **阶段一产物为迭代级**：`exploration_findings.md` 一份覆盖六条需求（勘察按需求分节），未再按 `plan-s{NNN}/` 拆分 —— 拆开会产生六份重复结论。
> **阶段五产物两处**：`review_report.md` 为跨需求总表（含汇总与门禁复跑），`plan-s{NNN}/review_report.md` 为单需求切面（便于按需求追溯）；S-218 未单开切面，明细在总表第四节。

## 三、刀序（一需求一刀）

**实际落刀**（六条需求各一刀，另加两轮审查修复）：

| # | commit | 需求 | 说明 |
|---|---|---|---|
| 1 | `9342316f` | S-220 | `fix(browser)` 三处 `reload()` → `reloadIgnoringCache()` |
| 2 | `7af2f77c` | S-219 | `fix(tools)` 路径锁 + 退避重试 |
| 3 | `5b92bed3` | S-217 | `fix(installer)` NSIS `customInstallMode` 钩子 |
| 4 | `bbcb140b` | S-218 | `feat(provider)` WorkBuddy 接入（17 文件；含 i18n 补键 amend） |
| 5 | `402a109d` | 收尾 | `fix(迭代1)` 阶段五审查 8 条 ❌ 修复 + 流程产物补齐（24 文件） |
| 6 | `455eb8db` | S-222 | `feat(chat)` 聊天窗时刻统一为时分，跨天补日期 |
| 7 | 待提交 | S-221 | `feat(website)` 首页右侧悬浮联动导航 |

**依赖关系**：四条互不交叉（S-218 与 S-217/S-219/S-220 零文件重叠）。S-218 若做不完，可整体移出本迭代而不影响出包。

## 四、门禁基线

| 门禁 | 命令 | 基线 |
|---|---|---|
| TS 类型 | `npm run typecheck`（node + web 两配置） | 0 错误 |
| 单测 | `npm test` | 79/79（iter-40 的 73 + 本迭代补的 6 个套件） |
| C# 编译 | `dotnet build src\runtime\WishfulClaw.sln` | 0 警告 0 错误 |
| 官网 | `cd website && npm run build` | 0 错误 |

**注意**：`dotnet build` 与本机开发实例（dev）不冲突；生产实例在跑才需要先停。

## 五、范围外

- **S-199**（iter-39 遗留）—— 等老大点头，未登记进本迭代
- **S-177**（渠道空闲后首条消息误报）—— 复发才立
- **S-174 绘图工作台** —— 新功能，不列入
- **签到自动化的「跟随真实对话」方案** —— 已被老大 16:09 撤销，不实现
- **WorkBuddy 成长任务自动化 / 套餐明细 / 多账号池 / Anthropic 旁路** —— S-218 §7 明确不做

## 六、遗留与风险

| # | 风险 | 处置 |
|---|---|---|
| 1 | **S-217 需真机装包验证** —— 静态代码无法证明注册表读值在真实安装器里生效 | 实施后打包，在本机按 S-217 §8 六场景实测 |
| 2 | **S-218 端点全部来自第三方逆向源码**，参考实现自标「未对真账号验证」 | 首版按契约实现 + 出错翻译兜底；真账号联调需老大提供账号 |
| 3 | **S-218 双版契约**（国内 / 国际）字段差异已勘察，但国际版签到端点未实测 | 首版先做国内，国际版按同一套抽象接入，签到单独开关 |
| 4 | **S-219 锁是进程内的**，跨进程（用户另开实例 / 外部编辑器）仍需靠退避重试兜 | 已在 S-219 §6 写明，不追求跨进程文件锁 |

## 七、文档状态

- `plan.md`（本文件）—— 迭代总览，随需求提交入库
- `raw-requirements.md` —— 需求清单，一行一需求
- `requirements/S-{NNN}.md` —— 单需求明细
- `plan-s{217,218,219,220}/` —— 单需求的 `plan` / `compliance_report` / `review_report` / `verification_report`
- `exploration_findings.md` —— 阶段一勘察汇总（**迭代级一份**，按需求分节）
- `review_report.md` —— 阶段五跨需求总表
- `changelog.md` —— 跨需求裁定与口径变更流水
- `docs/PROGRESS.md` 的 v3 表 —— **迭代收尾时才加行**（判完结由老大发起）
