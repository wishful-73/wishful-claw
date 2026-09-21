# S-113 阶段 1 Plan 合规审查报告

- **被审对象**：`docs/plans/iter-v2-34/plan-s113/plan.md`
- **审查日期**：2026-09-21
- **审查性质**：只读规划合规审查（对照 `website.md`、`raw-requirements.md` S-113 节、`AGENTS.md`、主仓门禁配置、知识库《官网方案.md》）
- **总体结论**：**PASS**（❌ 阻断项 0 个，⚠️ 建议 6 条，可进入用户确认）

---

## 逐项判定

### A. 步骤清单完整性 — ✅

六步覆盖「骨架 → 文案 → 区块 → 下载页 → 构建 → 无回归」全链路（plan.md:26-31），每步均有可执行验证：

| 步 | 验证检查点 | 可执行性 |
|---|---|---|
| 1 | `npm install` + `npm run dev` 两页可开 | ✅ |
| 2 | 与官网方案第三节逐块对照 + 红线核对 | ✅ |
| 3 | `npx tsc --noEmit`（website 自身 tsconfig）零错误 + 逐区块目视 | ✅ |
| 4 | `/download` 本地可访问、fetch 到占位 json | ✅ |
| 5 | 产物清单 + `git status` 核 ignore 覆盖 | ✅（实测 `.gitignore:20-21` 宽泛匹配确实覆盖，见 C） |
| 6 | 根 `npm run typecheck` + `npm test` 对照基线 | ✅ |

「验证检查点汇总」（plan.md:48-52）另含 UI 目视项「未做+原因」的诚实标注，符合无截图取证环境的口径。

### B. 与 website.md 范围/排除项一致性 — ✅

- 只做阶段 1（plan.md:5 明确排除真素材/Nginx/COS），与 website.md 排除表（website.md:27-33）逐条对齐：无 COS 直链、无 `latest.yml → latest.json` 生成脚本、无 Nginx/备案号、素材为占位框（plan.md:19）。
- 阶段划分（website.md:61-66）中阶段 2/3/4 的活均未混入。占位素材做法有依据：老大口径「搭建代码可以先行」（website.md:68, 87）。

### C. 「门禁零污染」声称 — ✅（属实，且实际比声称更安全）

逐条实测：

| 链路 | 证据 | 结论 |
|---|---|---|
| `tsconfig.node.json` include | `electron.vite.config.*` / `src/main/**` / `src/preload/**` / `src/shared/**`（tsconfig.node.json:3），无 website | ✅ 不扫 |
| `tsconfig.web.json` include | `src/renderer/src/**` / `src/preload/*.d.ts` / `src/shared/**`（tsconfig.web.json:3-8），无 website | ✅ 不扫 |
| 根 `tsconfig.json` | references-only 壳（tsconfig.json:2-5），references 不含 website，其自建 tsconfig 独立 | ✅ 不串 |
| `.gitignore` | `node_modules/`、`dist/`（.gitignore:20-21）为无锚定宽匹配；**实测** `git check-ignore -v` 命中：`website/dist/index.html → .gitignore:21`、`website/node_modules/... → .gitignore:20` | ✅ 覆盖 |
| `scripts/run-tests.mjs` | TS 脚本发现只读**根** `package.json` 的 `test:*`（run-tests.mjs:27-29），C# 侧只扫 `tests/` 目录（:32-33）。website 独立 package.json 的脚本**无论如何前缀都不会被收编** | ✅ 覆盖（比声称更强） |
| `electron-builder.yml` `files` | 白名单：`out/**/*` + `package.json` + `resources/icon-256.png` + LICENSE + THIRD_PARTY_NOTICES.md（electron-builder.yml:28-33），website/ 不可能进安装包 | ✅ 不进包 |

⚠️ 唯一偏差见建议 #1（website.md 尾注本身表述不准确，plan 继承之，方向保守无害）。

### D. 依赖版本对齐声称 — ✅

plan.md:21 声称对照根 package.json 实测：

| 依赖 | plan 声称 | 根 package.json 实际 | 判定 |
|---|---|---|---|
| react / react-dom | ^19 | `react ^19.0.0`、`react-dom ^19.0.0`（package.json:136-137，注：主仓放 devDependencies） | ✅ |
| tailwindcss | ^4 | `tailwindcss ^4.3.3`（package.json:116） | ✅ |
| @vitejs/plugin-react | ^4.3 | `^4.3.0`（package.json:132） | ✅ |
| vite / typescript | 当前稳定版 | 主仓走 electron-vite ^2.3.0（:135），website 用独立 vite 合理 | ✅ |

「复用本仓现有依赖版本、不引新工具链」与 website.md 技术选型表（website.md:41）一致。

### E. 关键工程决策 vs 已拍板裁定 — ✅

| 决策 | 核对结果 |
|---|---|
| 下载按钮 → GitHub Releases | 与「下载源改造推迟、S-111 仍走 GitHub」一致（raw-requirements.md:332「目前下载源更新暂时不动手」；website.md:29-31）。官网方案第五节定位 GitHub 为备用源（官网方案.md:265, 277），阶段 1 COS 主源不存在，GitHub 是唯一可用入口——不违反裁定，但措辞见建议 #4 |
| `latest.json` 占位（`files: []`，运行时 fetch） | 未越界阶段 4：website.md 待确认 #1 明示「阶段 1~2 可先占位」（website.md:91），附录设计方向即「页面运行时读 latest.json、发版零官网构建」（website.md:108）。plan 只做**读取路径占位**，不做 yml→json 生成/上传 COS 管线（阶段 4 实体），边界正确。占位版本号 `0.2.33` 与根 package.json:3 当前版本一致 |
| MPA 双入口（`index.html` + `download.html`） | 与「单页 + 独立 /download 页」形态一致（website.md:11；官网方案.md:94-100「下载页独立、便于只改一处」）。零 router 依赖、静态托管无需 SPA 兜底，依据成立；URL 映射细节见建议 #5 |

### F. 涉及文件清单自洽性 — ✅

- plan.md:35 声称不改主仓源文件：步骤 1-5 产出全部落在 `website/**`；`resources/icon-512.png` 实测存在（`resources/icon-512.png`）且只拷贝不改原件（plan.md:36）；`raw-requirements.md`/`PROGRESS.md` 是文档更新且已明列（plan.md:37-38），不属于「源文件」口径偷换。
- typecheck 不受干扰：根 `typecheck:node` / `typecheck:web` 均带 `-p` 指向固定 include 列表（package.json:19-21），website/ 新目录、新 tsconfig 均不在扫描范围——与 C 的实测一致。
- 无任何隐藏主仓改动步骤。

### G. 文案口径 vs 官网方案.md — ✅

| 核对点 | plan | 官网方案.md | 判定 |
|---|---|---|---|
| 区块顺序「10+1」 | 步骤 3 文件序：hero → pain-table → advantages → value-ladder → cost-compare → features → download-cta → quick-start → changelog → faq + footer（plan.md:28） | 区块表序 1/2/3/3.5/4/5/6/7/8/9/10（官网方案.md:104-116），含三层价值阶梯插位与「成本对比可后置」 | ✅ 完全一致（website.md:77 同序） |
| 命名口径 | 主标题「心相龙虾」、角标 WishfulClaw（plan.md:9, 51） | 官网主标题「心相龙虾」，副标题/角标带 WishfulClaw（官网方案.md:18）；并区分「心相平台」（website.md:76） | ✅ |
| 口径红线三条 | 不吹功能稀缺 / 不写成程序员工具 / 明示非正式版（plan.md:9） | 同三条（官网方案.md:84-88，第三条原文「不承诺稳定性」含明示非正式版） | ✅ |
| 素材编号 | 占位框标注 #1~#8，Logo 用 #9（官网方案.md:249「#9 Logo 已有」），`icon-512.png` 即软件图标 | ✅ 对得上；#10 遗漏见建议 #3 | ✅ |
| changelog 区块「链 GitHub Releases、失败隐藏」 | 官网方案.md:114, 287「更新日志直接链 GitHub Releases，不用自己维护」 | ✅ |
| 非正式版明示 | plan.md:51 检查点 4 明确含此项 | 官网方案.md:88 | ✅ |

### H. git 提交计划 — ✅

plan.md:56：全部步骤测通后单刀 `feat(website): S-113 阶段1 官网骨架与单页内容`，含 website/** + 计划文档 + raw-requirements/PROGRESS；迭代内不 push。符合 AGENTS.md「一需求一 commit」「步骤不提交」「迭代内一律不 push」三条。

---

## ❌ 必须修正（阻断项）

**无。**

## ⚠️ 建议（不阻断）

1. **website.md 尾注表述不准，plan 照抄了依据**：run-tests.mjs 只读**根** package.json 的脚本（run-tests.mjs:27-28），website 独立 package.json 加 `test:*` 前缀**也不会**被收编；「想纳入主门禁」实际需要动根脚本或改 run-tests.mjs。plan 的预防措施（不用 test: 前缀）保守无害，但建议在实施记录里更正这条口径，避免未来收编时误判。
2. **成本对比区块的阶段 1 呈现未写明**：该区块依赖真实账单数据（素材 #4「⚠️ 需现做」，官网方案.md:244），且有「数据来自真实使用记录，非估算」红线（官网方案.md:181）。plan 步骤 2 文案清单也未列 cost-compare。建议步骤 3 明确：该区块阶段 1 以占位/「数据准备中」呈现，**严禁编造对比数字**。
3. **素材 #10 未进占位标注范围**：定时任务配置页截图（官网方案.md:250，标注「✅ 直接截」）属功能展示区块素材，plan.md:19 的占位框只覆盖 #1~#8。建议标注扩至 #1~#8 + #10，或注明 #10 阶段 2 一并补。
4. **「GitHub Releases latest（备用源），页面上明示」措辞需斟酌**：阶段 1 没有 COS 主源，页面上自称「备用」会让用户找不到「主用」。建议阶段 1 页面文案写成「当前下载入口」，「备用」定位留到阶段 4 COS 上线后再启用。
5. **`/download` 无扩展名 URL 的实际生效在阶段 3**：`download.html` 在本地 preview 访问路径是 `/download.html`，`/download` 需 Nginx 配置（阶段 3）。建议步骤 4/5 验证口径注明，避免验收时对不上。
6. **website 依赖清单建议补 `@tailwindcss/vite`**：主仓 Tailwind 4 走该 Vite 插件（package.json:68），plan.md:21 依赖对齐行未点名；步骤 1 的 `index.css` `@import` 生效依赖它。

---

## 结论

Plan 六步齐全、门禁零污染声称经实测属实（且实际保护强于声称）、依赖版本对齐有据、三处关键决策均落在已拍板边界内、区块顺序/命名/红线/素材编号与知识库权威源逐项对得上、提交计划符合协作纪律。**总体判定 PASS，0 阻断，可进入用户确认**；6 条建议在实施时顺手吸收（其中 #2 数据红线最值得在步骤 3 落一行字）。
