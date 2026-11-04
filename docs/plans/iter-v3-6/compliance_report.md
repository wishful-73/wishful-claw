# S-296 规划合规审查报告（v3-iter-6 刀 0）

> 审查时间：2026-11-02
> 审查者：独立 subagent（reviewer，只读）
> 审查对象：`docs/plans/iter-v3-6/plan.md` 刀 0 行 + `docs/plans/iter-v3-5/requirements/S-296.md`
> 总判：**FAIL** —— ❌ 项 **5 个**。按 `dev-workflow.md:502`「❌ 项 > 0 时禁止进入用户确认环节」，**当前不得进入执行态**。

---

## 一、五条检查项

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 步骤是否完整覆盖任务目标 | ❌ | `docs/plans/iter-v3-6/` 下**没有** `plan-s296/`，无步骤清单 / 涉及文件清单 / 参考源码清单。唯一一份 4 条步骤（S-296.md:101-106）已被文档自身在 :99 标注作废。违反 `dev-workflow.md:443-449` |
| 2 | 每步是否有明确的验证检查点 | ❌ | 判据只有 §五 一条，且**不可鉴别**（详见 §C）—— 既有 12 个 `TS2322` 会让「改后必须报 TS2322」在挂账态恒绿 |
| 3 | 文件路径是否符合项目结构 | ✅ | `tsconfig.test.json` 落仓库根，与 `tsconfig.web.json` / `tsconfig.node.json` 同级，符合既有惯例 |
| 4 | 分层依赖是否正确 | ✅ | 本刀只碰 `tests/**` 与根级 tsconfig，不涉及 Core / Workspace / Worker / Contracts 分层 |
| 5 | 是否参考了正确的源码文件 | ⚠️ | 参考的 tsconfig 与 `package.json:22-24` 正确；但**测量基座**（`extends tsconfig.node.json`，S-296.md:51）与**采用基座**（方案 A 的 `extends tsconfig.web.json`，:45 / :103）**不是同一个配置**，两处口径不一致 |

---

## 二、额外四点核实

### A. 新配置与 `tsconfig.json` 的 `references` 关系 —— ❌ 文档完全没答

**现状**（`tsconfig.json:2-6`）：`files: []` + `references: [node, web]`，标准 solution shell。`package.json:22-24` 三个脚本都是 `tsc --noEmit -p <单个配置> --composite false`，**从不跑 `tsc -b`**。

**加进 references 会出事，三条硬约束：**

1. `tsconfig.test.json` extends 的 `tsconfig.web.json` 是 `composite: true`（`tsconfig.web.json:10`）。`composite` 隐含 `declaration: true` + 增量，`tsc -b` 会给每个源文件**就地吐 `.d.ts`** —— 没设 `outDir`，25 个测试文件旁边会多出 25 个 `.d.ts`（`*.tsbuildinfo` 被 `.gitignore:22` 挡住，`.d.ts` 没有）。
2. 想避免污染就得写 `noEmit: true`，但被 references 引用的工程**不能 disable emit**（TS6310）—— 两条路互斥。
3. 现有三个脚本都要显式带 `--composite false`（`package.json:22-24`），说明作者早知 composite 是坑。

**结论：不要加进 references。** 但代价文档没写：

- `tsc -b` / `tsc -p tsconfig.json` 永远不会检查 tests（今天 `files: []` 本来就是空跑，**门禁表里那一项是假绿**）；
- **IDE 会不一致**：VS Code 把根 `tsconfig.json` 当 solution，`tests/**` 不在任何被引用工程里 ⇒ 落进 inferred project，**拿不到 `baseUrl` / `paths`** ⇒ 那几个写 `from '@renderer/...'` 的测试文件在编辑器里报 TS2307 红波浪，而 `npm run typecheck` 是绿的。这正是本需求要消灭的「两套说法」，规划里一个字没提。
- 可落地折中：根 `tsconfig.json` 保持 shell 不动；另放 `tests/tsconfig.json` = `{ "extends": "../tsconfig.test.json" }`，让 TS server 就近接管，不干扰 `-p` / `-b`。

### B. 性能影响 —— ❌ 需求文档零评估

- 现状：`typecheck` = `typecheck:node && typecheck:web`（`package.json:24`），**串行**，实测 30~37 s；`ci-checks.mjs:12` 记 22.7 s + 15.2 s = 38 s（2026-10-27）。
- 追加第三个工程的**实际体量远大于「只查 117 个测试文件」**：91 个测试文件 `import '../../src/...'`，会把 `src/main/**` 和 `src/renderer/src/**` **同时**拉进来（≈ node 配置 + web 配置的并集）⇒ 总耗时大概率从 ~35 s 涨到 **55~75 s（1.6~2.1 倍）**。
- 全部 `tsc` 带 `--composite false`，**没有增量复用**，每次全量重算。
- 这条门禁挂在 **pre-push + GitHub Actions**（`ci-checks.mjs:1-5`、`dev-workflow.md:400-404`），而 `dev-workflow.md:400` 明确写过「钉 push 不钉 commit」就是为省时间 —— 这次改动会把这个刻意的取舍推倒，规划里没有一个字。
- 至少要写死一个缓解项：`--incremental --tsBuildInfoFile`（`.gitignore:22` 已忽略 `*.tsbuildinfo`）／三条 `tsc` 并行／或接受翻倍但写清新耗时。

### C. 判据可执行性 —— ⚠️ 可复现，但不「能红」

判据原文（S-296.md:157-166）：写 `const __typecheckProbe: number = 'this is a string'` → 改前 0 错、改后必须 TS2322。

1. **「改前 0 错」是平凡真**。今天 `typecheck` 根本不编译 tests，探针写在哪都是 0 错。能复现「病」，但**不构成覆盖证据**。真正的证据是 `tsc -p tsconfig.test.json --noEmit --listFiles` 里能看到探针文件。
2. **「改后必须报 TS2322」不具鉴别力**。§4.4 自己列了 **12 个既有 TS2322**，若走「挂账」路线，改前改后都有 TS2322，判据恒绿。必须断言 **`文件:行号` + 错误码**，或规定「仅在 37 个错清零后执行，期望恰好 1 条」。
3. **会多一条 TS6133**。`@electron-toolkit/tsconfig/tsconfig.json:15` 是 `noUnusedLocals: true`，探针变量未使用 ⇒ 同时报 TS6133。
4. **缺收尾绿**。§五 说「先红后绿走一遍」，但没写「删掉探针再跑一次必须回到 0」。
5. 干扰面：探针放 `tests/**` 内会被 `include` 收，这一层没问题。

### D. 范围越界：37 个错是否真只改 `tests/**` —— ❌ 「已逐个定位」这句话目前不成立

抽查 5 处：

| # | 位置 | 实测事实 | 修法 | 牵涉 `src/**` |
|---|---|---|---|---|
| 1 | `tests/browser-keepalive/program.ts:198` `plan.reason` | **字段存在**（`browser-keepalive.ts:43-44` 的 `reject` 分支有 `reason: string`）。报 TS2339 的真因是**联合类型没收窄**：同文件 `assert` 声明为 `(condition: boolean, message: string): void`，**不是 `asserts`**，`:197` 的 `assert(plan.action === 'reject', …)` 对类型系统无效 | 把 `assert` 改成 `: asserts condition`（一处改，全文件收窄），或加 `if (plan.action !== 'reject') throw` | **否**，但**文档病因写错了**（§4.4 说「类型里没这个字段」），照文档改会去动 src 加字段或删断言 |
| 2 | `tests/provider-presets/legacy-upgrade-suite.ts:56` `type: 'openai'` | `ProviderType`（`provider.ts:15-23`）= `anthropic / openai-chat / openai-responses / openai-images / seedance-video / xai-video / gemini / vertex-ai`，**无 `'openai'`**；全仓无 legacy 归一化函数 | 字面量改 `'openai-chat'`（该字段在用例里只是陪衬） | **否** ✅ |
| 3 | `gate-harness.ts:12` / `install-harness.ts:8` | 逐字自引用，S-252 拆分残留 | 删该 import 行 | **否** ✅ |
| 4 | `suites/gates.ts:21` vs `:164` | import 的 `createInstallHarness` 与本地同名函数冲突，**所有调用点都用本地那个** | 删 `:21` 的 import（删完 `install-harness.ts` 成死文件，可一并删） | **否** ✅ |
| 5 | `tests/screenshot-dir/program.ts:106` | 两侧都是字面量类型 ⇒ TS2367。**断言运行时是有意义的**（防将来常量撞车） | 正确修法：`(SCREENSHOTS_SUBDIR as string) !== CHAT_IMAGES_SUBDIR`。**错误修法：删掉断言** | **否** ✅ |

**结论**：5 处里 4 处确认只需改测试；第 1 处仍是测试内修，但**文档病因说错**，照文档改反而有越界风险。§4.4「已逐个定位」属**未证实的断言**。

**补充 1（测量口径不一致，影响「37 / 25」这个数）**：§四 记的是「临时配置 extends **`tsconfig.node.json`**、include `tests/**/*.ts{,x}`」。但 node 配置**没有 `baseUrl` / `paths`**，而多个测试文件写 `from '@renderer/...'` ⇒ 按文档所述配置必然先报 TS2307，可错误码表里**没有 TS2307**。⇒ 要么临时配置另有 `paths`（文档描述不全），要么 37 这个数不是在该配置下得出的。**方案 A 采用 web 基座，`lib` / `noImplicitAny` / `paths` 全变，这个数不能直接搬用**，必须在采用配置上重测并落盘命令与原始输出。

**补充 2（采用 web 基座会引入 `src/**` 侧的新错误，直接威胁「不改 src」）**：

- `tsconfig.web.json:11` 覆盖 `noImplicitAny: true`，而 node 侧沿用 `noImplicitAny: false`。测试 program 会拉进 `src/main/**` ⇒ **main 进程代码会被用比正式 node 门禁更严的标准检查**，只要有一处隐式 any，测试配置就报错，而这个错正式门禁里不存在 ⇒ 要么改 src（越界），要么放宽（与 web 基座冲突）。
- `include` 被覆写成 `tests/**/*` 后，`src/renderer/src/env.d.ts` **掉出 program** ⇒ `vite/client` 类型不再加载。`src/renderer/src/lib/streaming-perf.ts:45` 有 `import.meta.env?.DEV`，任何测试链路 import 到它就报 `ImportMeta.env` 不存在。修法：`include: ["tests/**/*", "src/renderer/src/env.d.ts"]`。

**补充 3（覆盖范围说法不准）**：S-296 说「119 个测试套件目录全部受影响」。实测：119 个目录里 **29 个是 C# 的 `WishfulClaw.*RegressionTests`**（tsconfig 管不着），TS 侧是 **90 条 `test:*` 脚本**，其中 `test:feedback-api` 跑 `program.mjs`（纯 JS，`allowJs` 未开，新配置收不到）⇒ 真实覆盖约 **89 个 TS 套件 / 117 个 `.ts,.tsx` 文件**。「119/119 全覆盖」在验收时会被打脸。

---

## 三、问题清单

1. **[critical] 没有可执行规划**：无 `plan-s296/`，无步骤清单、无涉及文件清单、无参考源码清单。违反 `dev-workflow.md:443-449`。**当前状态不具备进入执行态的形态。**
2. **[critical] 阻断性未决项未闭合**：`plan.md:27` / S-296「是否一刀清完待拍板」与 `plan.md:55`「无需再等拍板」直接矛盾。而「挂账」路线在「不豁免 + typecheck 必须 0 错」下**物理上不成立** —— 挂账意味着门禁长期红着。
3. **[critical] 新配置与 `references` 的关系未定义**（§A）。
4. **[critical] 性能未评估**（§B）。
5. **[critical]「37 个错全在 `tests/**`、不改 src」未证实**（§D）：至少一处病因写错；测量基座与采用基座不同，`noImplicitAny` 与 `vite/client` 两处差异会**主动制造 src 侧错误**；且全文没有 37 条错误清单可供核验。
6. **[warning] 判据不可鉴别**（§C）。
7. **[warning] 修法无清单，存在「删断言」式偷懒风险**（§D-5）。
8. **[warning] 门禁清单会漂移**：`plan.md:59`「typecheck（两配置）」、`dev-workflow.md:517` / `:579` 都是旧口径；`ci-checks.mjs:12` 耗时注释过期。
9. **[info] 覆盖范围表述不准**（§D 补充 3）。
10. **[info] `tests/` 无书面约定**：AGENTS.md / `docs/project-structure.md` 均未写 tests 目录与「tests → src 单向」约束。

---

## 四、整改建议

**S1 先补 plan，再谈执行** —— 新建 `docs/plans/iter-v3-6/plan-s296/plan.md`，骨架见 `dev-workflow.md:463-481`。

**S2 在采用配置上重测「37」这个数** —— 命令落盘、原始输出贴进 §四，替换掉「extends tsconfig.node.json」那句与方案 A 不符的描述；同时给出 37 条错误的**完整表**（文件:行号 / 码 / 修法一句话），否则「不改 src」永远只是声明。

**S3 判据改成可鉴别**：

```ts
// 探针文件：tests/_typecheck-probe/probe.ts（用完即删）
const __typecheckProbe: number = 'this is a string'
void __typecheckProbe   // 避免 noUnusedLocals 额外报 TS6133
```

三段判据：① `--listFiles` 含该文件；② 输出恰好 `tests/_typecheck-probe/probe.ts(<行>,<列>): error TS2322`；③ 删除后回到 0。

**S4 配置写法（一次堵掉 A/B/D 的坑）**：

```json
// tsconfig.test.json —— 根，不写 types（§4.6 已实测：写了会误伤 34 个假 TS7016）
{
  "extends": "./tsconfig.web.json",
  "include": ["tests/**/*", "src/renderer/src/env.d.ts"],
  "compilerOptions": { "composite": false, "noEmit": true }
}
```

```json
// tests/tsconfig.json —— 只给 IDE 就近接管，不参与 -p / -b
{ "extends": "../tsconfig.test.json" }
```

根 `tsconfig.json` 的 `references` **不动**（理由写进 plan：`tsc -b` 会就地吐 `.d.ts`；`noEmit` 与 references 互斥 TS6310）。

**S5 性能二选一，写死**：`--incremental --tsBuildInfoFile node_modules/.cache/tsconfig.test.tsbuildinfo`，或三条 `tsc` 并行；并在 plan 里记「改前 ~35 s → 改后 N s」。

**S6 修法红线，写进 plan 的「刻意不做」**：37 处**一律禁止** `@ts-ignore` / `@ts-nocheck` / `as any` / 删断言；`screenshot-dir:106` 必须用 cast 保留运行时检查；`browser-keepalive` 优先改 `assert` 为 `asserts condition`（正向改进）。

**S7 把「是否一刀清完」拍掉** —— 建议**一刀清完**：挂账在「不豁免」前提下等于让 `typecheck` 长期红，刀 0 会从「地基」变成「地雷」；25 个文件全是局部小修，风险低于长期红灯。

---

## 五、总判

**FAIL** —— 方向正确、实测扎实（`types` 坑、语法错掩盖语义错两处尤其有价值），但**形态不达规划态要求**：无步骤、无逐条判据、无文件清单、无错误清单；三个关键决策（是否一刀清完 / references / 耗时）悬空；且「37 个错全在 `tests/**`、不改 src」在测量口径与至少一处病因描述上都不成立。

**❌ 项数量：5**（检查项 1、2；额外项 A、B、D）
