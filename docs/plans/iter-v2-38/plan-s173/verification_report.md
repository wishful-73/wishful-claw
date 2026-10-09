# 验证报告：plan-s173（阶段六 · 验证态）

> 被验证对象：`docs/plans/iter-v2-38/plan-s173/plan.md`（+ 需求正文 `requirements/S-173.md`）
> 落地提交：`17dafdc1`（feat(image)，11 files，+271/−39）
> 验证方式：独立跑门禁 + 本需求专项回归套件（`tests/image-endpoint`）。
> 验证时间：2026-10-09（事后补验）

---

## 一、总体结论

**PARTIAL** —— 编译与回归**全绿**（typecheck 0 错 / `npm test` 67/67 / **`test:image-endpoint` 43 checks**），三个核定口径（**方案 A** / **接线走甲** / **悬空即报错不回落**）与 S-166「一行未改」均经代码与断言双重确认；但**真机生图验证未做**（需真实 provider），故不判 PASS。

---

## 二、编译证据

| # | 命令 | 退出码 | 关键输出 |
|---|---|---|---|
| 1 | `npm run typecheck`（两配置） | **0** | 0 错 |
| 2 | `dotnet build src/runtime/WishfulClaw.sln` | **0** | `已成功生成。0 个警告 0 个错误` |

本刀含 C# 改动（`ProviderCompletionSettings*.cs`、`AgentRuntimeImageGenerateExecutor.cs`），编译必须过 ⇒ 已验证。

---

## 三、测试证据

### 3.1 总门禁

```
npm test  →  67/67 通过      （ES 51 + C# 16）  退出码 0
```

### 3.2 专项套件（本需求）

| 套件 | 结果 |
|---|---|
| `test:image-endpoint` | **`image-endpoint: 43 checks passed`**（退出码 0） |

覆盖的三块断言（`tests/image-endpoint/program.ts` §7，本刀新增 12 条）：

- 命中显式指定位时**压过** active provider（5 条）；
- 指定位**悬空**的三种情形各自报错、**不回落**（6 条）；
- 未指定时仍走 S-166 三级回落（1 条，参数与改前一致）。

---

## 四、逐项验证（对照 plan 步骤 1-6）

| 步骤 | 检查点 | 结论 | 证据 |
|---|---|---|---|
| 1-3 | 配置扩容 → 渲染第四档 → 主进程解析 | ✅ | 编译 0 错；第四档位序 `promptOptimizer→persona→fallback→image`；主进程零 `config.json` 读取 |
| 4 | **真机**：生图打的是指定位 provider/model；清空后回落不变 | ❌ **未做** | 需真实 provider；plan 已标「待老大真机」 |
| 5 | 整体测通（typecheck 0 错 / `npm test`） | ✅ | 全绿；本轮计数为 **67/67**（本刀实施时 66/66，后续仅 **S-176** 新增 `test:scroll-watermark` 一套 ⇒ 66→67，**S-177 未新增套件**；plan 计数为实施时点快照） |
| 6 | 文档回填（§四 补 `ProviderCompletionSettingsService.cs`、参考路径订正等） | ✅ | 已在阶段三订正落地（见 `compliance_report.md` §三） |

**三个核定口径复核**：

| 口径 | 结论 | 证据 |
|---|---|---|
| 方案 A（同一面板加第四档，不另起 UI） | ✅ | `ProviderCompletionSettingsPanel.tsx` 内 `route('image')` |
| 接线走甲（Worker 送达；主进程不读 `config.json`） | ✅ | 主进程全目录 grep `config.json` **0 命中**；渲染端全程 Worker RPC |
| 指定位悬空即报错、**不回落** | ✅ | 反向处理器遇 `explicit.error` 直接 `return { success: false }`，绝不进回落分支 |

**S-166「一行未改」复核**：✅
- `resolveImageEndpoint` 逐字未动（本刀改动是**追加**新函数，旧函数无 `-` 行）；
- `tests/image-endpoint` 既有断言文本未改（只追加 §7 新块 + 注释重编号）。

---

## 五、未覆盖项（PARTIAL 的直接原因）

| # | 项 | 为什么没做 | 谁来做 |
|---|---|---|---|
| 1 | **真机：指定位生效 / 悬空报错 / 清空后回落不变**（plan 步骤 4） | 需真实图片生成 provider 与真机抓 `image:generate` 请求 | 老大侧 |
| 2 | 生图链路的**端到端**观感（第四档 UI 交互细节） | 同上（需真机 + 真 provider） | 老大侧 |

---

## 六、补充审查发现（阶段五第二轮，须跟进，不阻断）

| # | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| 1 | ⚠️ 需修 | `ProviderCompletionSettingsPanel.tsx:70,74` + `ProviderCompletionSettingsService.cs:32,34,46-47` | **图片档可触发的保存闸门边角**：若「图片生成」档选中的 provider **没有任何 `category === 'image'` 的启用模型**，`modelId` 落 `null` 而 providerId 非空 ⇒ `IsPair` 判「不成对」**整单保存失败**，连带其余三档改动一起失败。前三档基本不可达，**图片档是新增可达面** | 二选一：下拉只列「含可用图像模型」的 provider；或无匹配模型时把 providerId/modelId 一起清空 |
| 2 | 💡 建议 | `image-endpoint.ts:140-152` vs `ProviderCompletionSettingsPanel.tsx:22-25` | 显式解析只校验 id 存在，**未校验**该模型仍为 `category === 'image'` 且未被禁用；与面板过滤口径不一致（模型事后被改成 chat / 被禁用时，显式位仍会用） | 补一条能力位校验（失败即报错，契合本刀「宁缺勿错」），或文档明写「显式位不复查能力位」 |
| 3 | 💡 建议（docs） | `plan-s173/plan.md` §五 | 引用的 OpenCowork `activeImageProviderId` / `activeImageModelId` 符号在源仓库**并不存在**（实测 0 命中）；实际可参照的是 `ModelPage.tsx:1383-1388` 的 `imageOutput` 能力位 | 回填订正引用出处，避免下轮按错误线索去源仓库找 |
| 4 | 💡 建议 | `image-endpoint.ts:130,136,150` | 主进程报错串中英混排（英文句子里嵌「模型管理」） | 与 S-166 既有英文错误串对齐，或统一中文标签口径 |

---

## 七、结论

| 项 | 结果 |
|---|---|
| 编译 | ✅ 0 错 / 0 警 |
| 回归 | ✅ `npm test` 67/67；`test:image-endpoint` **43 checks** |
| 三个核定口径 | ✅ 全部如实落地 |
| S-166 既有断言 | ✅ 一行未改 |
| 真机验收 | ❌ 未做（需真实 provider） |
| 阶段五 ⚠️ 项 | 1 条（图片档保存闸门边角，建议随收尾刀处置） |

**最终判定：PARTIAL**（工程侧全绿，真机生图与第四档交互待老大侧闭合）。

> 说明：本报告为 2026-10-09 老大指令「按开发工作流推进」的**事后补验**产物。
