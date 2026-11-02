# Plan: S-296 —— `tests/**` 进 typecheck 门禁（v3-iter-6 刀 0）

> 需求正文：[../../iter-v3-5/requirements/S-296.md](../../iter-v3-5/requirements/S-296.md)
> 合规审查：[../compliance_report.md](../compliance_report.md)（首轮 FAIL，❌ 5 项；本文件按 S1~S7 整改）
> 归属：v3-iter-6 **刀 0**（门禁地基，后面 7 刀都靠它把关）

## 目标

让 `tests/**` 进入类型检查，且这条门禁**能红** —— 测试里的类型错误在 `npm run typecheck` 阶段暴露，而不是等到运行时或永远不暴露。

## 拍板结论（闭合合规报告 §三.2）

**一刀清完，不挂账。** 理由：在「不豁免任何套件」前提下，「挂账」等于让 `typecheck` 长期红着，刀 0 会从「地基」变成「地雷」，后面 7 刀每刀都要面对一个红门禁。25 个文件全是局部小修，风险低于长期红灯。

## 步骤清单

- [ ] **S1 新建 `tsconfig.test.json`**
  写法（合规报告 S4，一次堵掉 references / 假 TS7016 / vite-client 三个坑）：
  ```json
  {
    "extends": "./tsconfig.web.json",
    "include": ["tests/**/*", "src/renderer/src/env.d.ts"],
    "compilerOptions": { "composite": false, "noEmit": true }
  }
  ```
  - **不写 `types`** —— 写了会屏蔽 `node_modules/@types/*` 自动加载，误伤 34 个假 `TS7016`（S-296 §4.6 已实测）。
  - **`include` 必须带 `src/renderer/src/env.d.ts`** —— 否则 `vite/client` 类型掉出 program，`import.meta.env` 会报错（合规报告 §D 补充 2）。
  - **根 `tsconfig.json` 的 `references` 不动** —— 加进去会让 `tsc -b` 就地吐 25 个 `.d.ts`（web 基座 `composite: true`）；加 `noEmit` 又触发 TS6310，两条路互斥。
  - **另建 `tests/tsconfig.json`** = `{ "extends": "../tsconfig.test.json" }`，只给 IDE 就近接管，不参与 `-p` / `-b`。

  **判据**：`npx tsc -p tsconfig.test.json --noEmit --showConfig` 的 `include` 含 `env.d.ts`、无 `types` 字段；`npx tsc -p tsconfig.test.json --noEmit --listFiles` 输出里能看到 `tests/` 下的文件。

- [ ] **S2 落盘基线清单**
  在 S1 的配置上跑一次，把**完整错误清单**（文件:行号 / 错误码 / 修法一句话）写进 S-296 §4.4 的表格下方。

  **判据**：错误总数与 §4.4 记的 37 对齐；对不上就改 §4.4，不硬套。清单必须逐条可核。

- [ ] **S3 接线**
  `package.json` 加 `"typecheck:test": "tsc --noEmit -p tsconfig.test.json --composite false"`，`typecheck` 串上它。

  **判据**：S2 的 37 个错清零后 `npm run typecheck` 退出码 0；探针文件出现在 `--listFiles` 里。

- [ ] **S4 逐文件修（按 S2 清单，25 个文件）**

  **修法红线（合规报告 S6，写进「刻意不做」）**：
  - ❌ 一律禁止 `@ts-ignore` / `@ts-nocheck` / `as any` / **删断言**
  - ✅ `tests/screenshot-dir/program.ts:106` 必须用 `(SCREENSHOTS_SUBDIR as string) !== CHAT_IMAGES_SUBDIR` 保留运行时检查
  - ✅ `tests/browser-keepalive/program.ts` 优先把 `assert` 改成 `asserts condition`（一处修全文件，正向改进）
  - ✅ `tests/provider-presets/legacy-upgrade-suite.ts:56` 的 `'openai'` → `'openai-chat'`（`ProviderType` 闭集里没有 `'openai'`）

  **判据**：每改完一个文件，错误数**严格递减**且 `npm test` 对应套件仍绿；全部改完 `npm run typecheck` = 0。

- [ ] **S5 反向验证（能红）**
  探针文件 `tests/_typecheck-probe/probe.ts`：
  ```ts
  const __typecheckProbe: number = 'this is a string'
  void __typecheckProbe   // 避免 noUnusedLocals 额外报 TS6133
  ```
  **判据三段**：① `--listFiles` 含该文件；② `npm run typecheck` 输出**恰好** `tests/_typecheck-probe/probe.ts(<行>,<列>): error TS2322`（断言到 `文件:行号 + 错误码`，不是「有 TS2322 就行」—— 既有 12 个 TS2322 会让弱判据恒绿）；③ 删掉探针后回到 0。

- [ ] **S6 文档与门禁口径同步**
  `plan.md:59`「typecheck（两配置）」、`dev-workflow.md:517`（阶段四 Mini 验证）、`dev-workflow.md:579`（阶段六）三处改成三配置；`ci-checks.mjs:12` 的耗时注释更新。

  **判据**：全仓 `grep -r "两配置"` 命中数为 0。

- [ ] **S7 全量门禁**
  **判据**：`npm run typecheck` 0 错 ｜ `npm test` 119/119（或按新口径，见下）｜ `dotnet build` 两套 sln 各 0 警告 0 错误 ｜ `node scripts/ci-checks.mjs` 全绿；新增/大改文件 CRLF、UTF-8 无 BOM、裸 LF = 0。

## 覆盖范围口径（合规报告 §D 补充 3）

**不是**「119 个套件全覆盖」：

- `tests/` 下 119 个目录里，**29 个是 C# 的 `WishfulClaw.*RegressionTests`**，tsconfig 管不着；
- TS 侧 **90 条 `test:*` 脚本**，其中 `test:feedback-api` 跑 `program.mjs`（纯 JS，`allowJs` 未开）⇒ 新配置收不到；
- ⇒ 真实覆盖约 **89 个 TS 套件 / 117 个 `.ts,.tsx` 文件**。`.mjs` 套件本刀不覆盖，理由与后续处置写进需求正文。

## 性能口径（合规报告 §B）

- 改前：`typecheck` = node + web 串行，实测 30~37 s（`ci-checks.mjs:12` 记 38 s）。
- 第三个工程体量 ≈ node + web 的**并集**（91 个测试文件 import `../../src/`）⇒ 预计 55~75 s。
- **缓解（本刀写死）**：`--incremental --tsBuildInfoFile node_modules/.cache/tsconfig.test.tsbuildinfo`（`.gitignore:22` 已忽略 `*.tsbuildinfo`）。
- 收尾时把「改前 → 改后」实测耗时记进 `plan.md`，别让 `dev-workflow.md:400` 的 38 s 变成假数。

## 涉及文件

- `tsconfig.test.json` —— 新建（根）
- `tests/tsconfig.json` —— 新建（仅 IDE）
- `package.json` —— `scripts` 段加 `typecheck:test`，`typecheck` 串上
- `tests/**` —— 25 个文件，**以 S2 清单为准**
- `docs/plans/iter-v3-6/plan.md`、`docs/dev-workflow.md`、`scripts/ci-checks.mjs` —— 门禁口径同步
- `docs/plans/iter-v3-5/requirements/S-296.md` —— 错误清单与耗时回填

## 参考源码

- `tsconfig.json` / `tsconfig.web.json` / `tsconfig.node.json` —— 基座与 references 现状
- `src/renderer/src/lib/browser/browser-keepalive.ts:39-44` —— `reject` 分支有 `reason: string`（证明病因是收窄不是缺字段）
- `src/shared/types/provider.ts:15-23` —— `ProviderType` 闭集，无 `'openai'`
- `@electron-toolkit/tsconfig/tsconfig.json:15` —— `noUnusedLocals: true`（探针要 `void`）

## 刻意不做

- 不给任何套件 `@ts-nocheck`（不豁免）。
- 不把 `tsconfig.test.json` 加进根 `tsconfig.json` 的 `references`（见 S1 理由）。
- 不覆盖 `.mjs` 套件（`allowJs` 未开，属另一件事）。
- 不动 `src/**` 的类型定义 —— 若 S4 发现某个错必须改 src 才能修，**停下来报告**，不自行越界。
