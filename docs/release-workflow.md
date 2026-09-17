# 迭代收尾与发布（SOP）

> 「老大确认迭代完结」→「GitHub Release 上线」的完整流程。
> **本文件是收尾流程的唯一权威**；`AGENTS.md` 只保留触发条件与指向，不再维护副本。
> 迭代内的开发流程（六阶段、提交节奏、分支策略）见 `docs/dev-workflow.md`。

---

## 一、触发条件

**迭代是否完结由用户确认，且由用户手动发起**（原话口径："进行 xxx 迭代收尾"）。

- Agent **不得自行判定**迭代完成，也**不得提前催**收尾
- 收尾时把本迭代各需求 / 各 Plan 的 VERDICT 汇总给用户，由他裁定
- **收尾完成后当前会话结束**：下个会话直接从 main 拉最新代码开新迭代，不需要关心旧分支

## 二、版本规则

`v2-iter-{N}` 只是 MVP v2 阶段的**迭代编号**，不是产品主版本号。

正式版发布前，产品版本统一为 `0.2.{N}`，Git tag 为 `v0.2.{N}`。应用 UI 从 `package.json` 读版本号，README 徽章同步。

**收尾第一步就是把版本号升到 `0.2.{N}`，共 4 处**：

| 文件 | 位置 |
|------|------|
| `package.json` | 顶层 `"version"` |
| `package-lock.json` | 顶层 `"version"` **和** `packages[""].version`（两处，容易漏） |
| `README.md` | 版本徽章 |
| `docs/PROGRESS.md` | 总览表格新增一行（见第五节） |

扫旧版本号找遗漏的口径：

```
全仓搜 0.2.NN，排除 node_modules / out / release / dist / .git
```

逐条判断是**真版本引用**还是**历史文档 / 测试样本**——后者不要动。已知两处「看着像但不是」：

- `src/shared/browser-plugin.ts` 的 UA 注释
- `tests/browser-user-agent/program.ts` 里的 UA 样本

## 三、收尾步骤（git）

```bash
# 0. 更新产品版本（见上节）+ 写好进度文档（见第五节）

# 1. 合并到 main（--no-ff 保留迭代合并点）
git checkout main
git merge dev/v2-iter-{N} --no-ff -m "merge: v2-iter-{N} - {迭代名称}"

# 2. 打 tag（annotated；message 格式见 4.1「tag message 口径」）
git tag -a v0.2.{N} -m "v2-iter-{N}: {亮点1 + 亮点2 + 亮点3} - 验证通过"

# 3. 推送远程
git push origin main
git push origin v0.2.{N}

# 4. 删除本地迭代分支
git branch -d dev/v2-iter-{N}

# 5. 删除远程迭代分支（如果之前 push 过）
git push origin --delete dev/v2-iter-{N}
```

**推送：优先直连，失败再走代理**

```bash
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main
```

代理是 Clash Verge（`C:\Program Files\Clash Verge\clash-verge.exe`，端口 `7897`），**平时关着**，直连完全不通时可以自行启动。

- ⚠️ **端口在监听 ≠ 代理可用**。启动后先实测：`curl.exe -x http://127.0.0.1:7897 -s -o NUL -w "%{http_code}" -m 15 https://github.com/` → `200` 才算就绪
- ⚠️ **`fetch` / `ls-remote` 类命令也必须带代理**：`push` 直连失败会快速返回（`Recv failure: Connection was reset`），`fetch` 会**硬等 300s 超时**
- ⚠️ PowerShell 里 git 写 stderr 的正常进度会渲染成红字 `NativeCommandError`，**判断成败只看 `$LASTEXITCODE`**，别信红字

**验证收尾结果**：

```bash
git log --oneline -3        # main 顶部应是 merge commit
git rev-list -n 1 v0.2.{N}  # tag 应指向那个 merge commit
git remote -v               # 确认 remote 是 wishful-73/wishful-claw
```

> `git rev-parse v0.2.{N}^{commit}` 在 PowerShell 里会炸（`^` 是转义符），用 `git rev-list -n 1`。

## 四、发布到 GitHub Release

仓库：<https://github.com/wishful-73/wishful-claw>
（旧地址 `731471991/wishful-claw` 已迁移；remote 还指旧地址就先 `git remote set-url origin` 更新）

### 4.1 创建 Release

gh CLI 在固定路径 `D:\claw\tools\gh\bin\gh.exe`（**不在 PATH，必须绝对路径**调用）。

```bash
# 先把 notes 写到固定路径：.wishful-claw/notes/release-notes-v0.2.{N}.md（按下面模板写）
/d/claw/tools/gh/bin/gh.exe release create v0.2.{N} \
  --repo wishful-73/wishful-claw \
  --title "v0.2.{N}" \
  --notes-file ".wishful-claw/notes/release-notes-v0.2.{N}.md"
```

- 直连失败加代理前缀：`HTTPS_PROXY=http://127.0.0.1:7897 /d/claw/tools/gh/bin/gh.exe ...`
- gh 不可用时用浏览器手建：Releases → Draft a new release → 选 tag → 填 notes → Publish

#### Release notes 模板（固定）

**基准 = v0.2.29 的写法，后续版本一律照此，不要每版换格式。**

写 notes 前先用 `git log v0.2.{N-1}..v0.2.{N} --oneline` 拉一遍本迭代的提交（提交粒度已是一个需求一刀，提交标题可直接当素材）。

```markdown
## 迭代 {N}

{一句话范围概括，本迭代的几块内容用「+」连接}。

### 新增能力

- **{功能名}（{编号}）** — {用户视角说明：解决什么问题、怎么用}

### 修复

- {问题现象}（{可选：修复要点}）

### 校验

- TypeScript 三配置 0 错误；{M} 套前端回归全过
- C# 0 警告 0 错误；10 个回归工程全过
- Native AOT 编译无 IL2026 / IL3050 / IL3051
```

**硬规则**：

- 标题固定 `## 迭代 {N}` —— **不写** `v0.2.{N}` 前缀，**不加** `— v2-iter-{N}` 之类的后缀
- 正文第一段是**范围概括**，不是标题的重复
- 小节名固定这三个：`### 新增能力` / `### 修复` / `### 校验`。不要写「新增」「优化」「其它修复」「验证」这类同义变体
- 条目固定 `- **{名字}（{编号}）** — {说明}`：**编号在括号内跟在名字后面**，不要写成 `- **S-26 名字** —`
- 条目一律写**用户视角**：说清「解决什么问题 / 怎么用」。**不写 commit hash、不写文件路径、不写实现细节**（那些在 `docs/progress/` 里）
- 确实需要用户知晓的限制或不兼容，在 `### 校验` **之后**加 `### 已知限制` —— 这是**唯一**允许的可选小节

#### tag message 口径

tag message 与 Release notes 分工：**前者一行亮点摘要，后者完整清单**。

```bash
git tag -a v0.2.{N} -m "v2-iter-{N}: {亮点1 + 亮点2 + 亮点3} - 验证通过"
```

亮点用 ` + ` 连接，取本迭代最值得说的几件事（3~5 个为宜），不写编号、不写「N 项需求」这种计数。

### 4.2 打包安装包

```bash
npm run pack:installer:full   # AOT Worker → 前端打包 → electron-builder NSIS
```

典型产物：

```
release/wishful-claw-0.2.{N}-setup.exe
release/latest.yml
release/wishful-claw-0.2.{N}-setup.exe.blockmap
```

- ⚠️ 打包前确认无残留 WishfulClaw / electron 进程（`tasklist` 检查），否则旧 `release/win-unpacked/` 被锁报 `EBUSY`
- ⚠️ 若 `win-unpacked/app.asar` 被锁（杀软 / 索引句柄）且杀进程无效，换输出目录绕开：
  `npx electron-builder --win -c.directories.output=release/v0.2.{N}`

### 4.3 上传资产

```bash
# setup.exe + latest.yml 必须一起传
/d/claw/tools/gh/bin/gh.exe release upload v0.2.{N} \
  --repo wishful-73/wishful-claw \
  "release/wishful-claw-0.2.{N}-setup.exe" \
  "release/latest.yml" \
  --clobber

# .blockmap 若生成，也必须传到同一个 Release
/d/claw/tools/gh/bin/gh.exe release upload v0.2.{N} \
  --repo wishful-73/wishful-claw \
  "release/wishful-claw-0.2.{N}-setup.exe.blockmap" \
  --clobber
```

**`latest.yml` 是 electron-updater 检查更新的必需元数据，不能只传 setup.exe。**

## 五、进度文档

收尾时两步：

1. `docs/PROGRESS.md` — 总览表格新增一行（迭代号 + Tag + 日期 + 简述），链接到明细
2. `docs/progress/v2-iter-{N}.md` — 新建明细

明细格式见 `docs/dev-workflow.md`「进度文档结构」。

## 六、发布后核验

- GitHub 上 **main 分支 / tag / Release** 三者均到位
- Release 资产齐全且 `state=uploaded`：`setup.exe` + `latest.yml` + `.blockmap`（若有）
- `latest.yml` 与实际 setup.exe **逐项对上**：`version`、`path`、`files[].url`、`sha512`、`size`
- `latest.yml` 的 `sha512` 与 setup.exe 的**实际 sha512 一致**
- `.blockmap` 的下载地址不返回 404
- Release 状态：`draft=false`、`prerelease=false`、**是 Latest**（`isLatest=true`）
- 端到端：用低于当前 Release 的本地版本实际调用 `electron-updater.checkForUpdates()`，确认进入 `update-available`，再测下载确认与安装确认流程

> 核验 gh 输出时注意：`gh release view --json` 直接接 `ConvertFrom-Json` 会被流混入搞坏，**先重定向到临时文件再解析**。

## 七、收尾之后

当前会话结束。下个会话从 main 拉最新代码开新迭代：

```bash
git checkout main
git pull origin main
git checkout -b dev/v2-iter-{N+1}
```

> 新分支**必须从最新 main 拆出**，禁止从旧迭代分支拆 —— 否则会缺前序迭代的变更，导致编译错误或功能缺失。
