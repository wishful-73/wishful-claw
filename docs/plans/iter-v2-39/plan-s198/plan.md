# S-198 计划（opencode-go 推广链接作废 + 内置 provider 的 `homepage` 只读刷新）

> 状态：**已实施**（`35969c17`，2026-10-14 08:40）；**免阶段五审查 / 阶段六验证**（老大 2026-10-14 08:20 裁定）。
> 需求：`requirements/S-198.md`。
> 归属：**iter-v2-39**。
> 说明：**本文件属事后补建** —— 实施先于登记（老大 08:17 才说「可以补一个登记」，08:20 即裁定免流程）。

---

## 一、目标

两件事裹一条改动：

1. **数据订正** —— `opencode-go` preset 的 `homepage` 不再指向带作者邀请码的推广链接（官方 2026-10-13 **取消推广返利**，该链接失去全部意义）。
2. **机制缺陷（真 bug）** —— 内置 provider 的 `homepage` 在 UI 里**只读**（是链接不是输入框）、而物化记录**永不重投影** ⇒ **官方一换地址，所有已配置过该 provider 的老用户永远看不到新地址**。

## 二、落点与步骤

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `src/renderer/src/stores/providers/opencode-go.ts` | `version: 10 → 11`；`homepage` 改为 `https://opencode.ai/zh/go`（产品页，**不带** `?ref=`）；v11 历史注释写明「官方已取消推广返利，旧值作废」 |
| 2 | `src/renderer/src/stores/provider-materialization.ts` | `reconcileProviders` 对**已物化的内置记录**：`existing ? { ...existing, homepage: preset.homepage } : createProviderFromPreset(preset)` —— **只刷新 `homepage`**；同步更新 R-9.2 段注释，点明「`upgradeProviderFromPreset` is dead code」这条前提 |
| 3 | `tests/provider-presets/program.ts` | 新增 `R-9.C.9` 两条断言：① 带陈旧 `homepage` 的物化记录重投影后 `homepage === preset.homepage`；② 其余字段（`apiKey = 'sk-stale'`）**不被覆盖** |

- [✓] 1. preset 升 v11 + 换地址（去邀请码）
- [✓] 2. `reconcileProviders` 只放行 `homepage` 一个字段
- [✓] 3. `R-9.C.9` 两条断言
- [✓] 4. 门禁：`npm run typecheck` 0 错误；`npm run test:provider-presets` **562 断言通过**
- [✓] 5. 两址实测：`https://opencode.ai/zh/go` 与 `https://opencode.ai/go` **均 200**
- [✓] 6. 提交（`35969c17`，3 文件）

## 三、门禁

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | **0 错误**（node + web 两段，`exit=0`） |
| `npm run test:provider-presets` | **562 断言 / 46 presets 全过**（含新增 `R-9.C.9` 两条） |
| `dotnet build src/runtime/WishfulClaw.sln` | **免跑** —— 无 C# 改动 |
| `cd website; npm run build` | **免跑** —— 不触碰官网 |

## 四、取舍（为什么这么改）

1. **只放开 `homepage` 一个字段，不放开整条记录。** R-9.2 那句「已物化的用户自己管理」保护的是 `apiKey` / `baseUrl` / 模型开关等**用户可编辑**字段 —— 那些**绝不能**被 preset 覆盖。`homepage` 是**唯一**同时满足「用户改不了 + 纯展示 + 会随官方变动」三个条件的字段。
2. **不引入「preset 版本比对」迁移框架。** 虽然 `version` 升到了 11，但本仓**没有**「按 version 触发迁移」的机制；本方案改成**每次重投影都刷新** —— 幂等、零新增状态、零迁移代码。
3. **`apiKeyUrl` 不动** —— 它没变，不在本次口径内。

## 五、影响面与风险

- **影响**：仅**内置** provider 的 `homepage` 显示值。自定义 provider 走后面的 `customProviders` 分支，**完全不受影响**。
- **风险**：**无数据风险**（纯显示字段，不落库变更）。若某内置 provider 的用户**故意**想保留旧 homepage —— 做不到（UI 不给改），所以不存在「覆盖用户意愿」。
- **回归面**：`tests/provider-presets` 全覆盖（46 个 preset 的一致性检查 + `R-9.C.9`）。

## 六、非目标

1. **不做 provider preset 的通用迁移框架**（version 比对 / 迁移脚本）。
2. **不放开除 `homepage` 外的任何字段**（尤其 `apiKey` / `baseUrl` / 模型开关）—— 那会踩穿 R-9.2。
3. **不在推荐位加「返利披露」** —— 返利已取消，iter-31 那个未决项自然作废。
4. **不顺手动其它 provider 的 `homepage`** —— 本次只 opencode-go 一家的数据变了。
5. **不走阶段五 / 阶段六** —— 老大裁定。

## 七、验收判据

1. 新装 / 未物化：provider 列表里 OpenCode Go 的 homepage 链接指向 `https://opencode.ai/zh/go`。
2. **已物化过该 provider 的老用户**（记录里存着旧推广链接）：重进设置页后 homepage **也变成新地址**（本条是这次修的核心）。
3. 老用户的 **`apiKey` / `baseUrl` / 模型开关全部原样**（不被 preset 覆盖）。
4. `R-9.C.9` 两条断言过；`test:provider-presets` 562 断言全过。
