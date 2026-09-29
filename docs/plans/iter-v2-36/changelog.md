# iter-v2-36 裁定与口径变更流水

> 按日期追加，跨整个迭代。需求正文见 `requirements/S-{NNN}.md`。
> 立项与口径变更的流水，按日期追加。正文小节按编号排列，本节日志跨整个迭代。
> **2026-09-23 ~ 2026-09-25 的流水已归档 -> [`changelog-archive.md`](changelog-archive.md)**（本文件只留 2026-09-28 起的近期段）。

- 2026-09-28：**S-153 登记：沙箱放行「生成图片目录」** —— 老大 10:13「截图输出目录不在允许的列表，这个放入36迭代的需求」。正文见 [S-153.md](requirements/S-153.md)。
  - **起于本会话实测**（老大要求「试下用内置浏览器看看你自己画的 logo」）：连做三次 `BrowserScreenshot`，输出尾部都带 `filePath` = `C:\Users\龚翼\wishful-claw\image\<13位时间戳>-<uuid>.png`；随即 `Read` 该路径**被沙箱拒** —— 原文「Sandbox: … is outside the allowed working directories (**D:\claw\wishful-claw, C:\Users\龚翼\.wishful-claw-dev**)」。⇒ **agent 能截图、拿得到路径，但读不回来**，而报错文案还在劝它「把目录加进项目工作目录」（那目录不是项目目录）。
  - **落点唯一**：`src/main/lib/image-persist.ts:15-25` 的 `getGeneratedImagesDir()` = `join(homedir(), 'wishful-claw', 'image')`；`persistImageBuffer()` 在**没有 `targetPath`** 时无条件落这里（`:72-75`）。`BrowserScreenshot` 恰恰**不传 `targetPath`**（`browser-native-ui.ts:211-214` 只传 `data` + `mediaType`）⇒ 每次都落兜底目录。同目录另一写入方 `CaptureAppWindow`（`window-capture-handler.ts:73-80`）**只在给 `targetPath` 时才写盘** ⇒ 不受影响。全仓硬编码目录名 `'wishful-claw'` 的**只有 `image-persist.ts` 一处**（grep 实证）。
  - **根因（两层，第二层是意外收获）**：① 沙箱根集合 = 项目 `workingFolder` + 本实例**数据根**（`PathBoundary.WithDataRoot` → `WishfulClawDataDir.Root`），而 `~\wishful-claw\image` 与数据根**不是同一个目录** ⇒ 「数据根已在集合里」覆盖不到它。② 数据根是 `~\.wishful-claw[-dev]`（**带点、dev 与 prod 分家**），截图目录是 `~\wishful-claw\image`（**不带点、两类实例共用一份**）⇒ 截图目录恰好**破坏**了 `PathBoundary.cs:21-23` 明写的「开发只看开发、生产只看生产」。
  - **改法三选一，建议 B**：**B** = 生成图片目录迁到数据根下（`<数据根>/image`）—— 一次修两件事（自动进沙箱集合、且零跨语言常量；dev/prod 顺带分家），代价是落盘路径变更；**A** = 在 `PathBoundary` 里加一条「系统根」，落盘行为零变更，代价是目录名要在 TS 与 C# 各写一份（漂移隐患）；**C** = 截图时传 `targetPath` 指向项目工作目录 —— **不建议**，截图是应用级产出物，很多场景没有项目/工作目录。**待老大裁定。**
  - **范围划清**：本条**只解决目录归属**。「**大截图输出溢出**」是**另一条独立现象**（同会话实测：141 KB / 44.5 KB 两次截图输出被截断落盘、图不可用，压到 ~15 KB 才 inline 返回），成因是工具输出长度上限，**不在本条范围**，是否立项另说。
  - **顺带确证的能力事实**：Read 不认 `.svg` 只是「手写 SVG 无法自检」的表层原因，真缺口是**产出物回读链路**；而 **浏览器截图 → Read 这条路已经通**（小图实测通过）。老大 10:08「你说看不见是不太对」成立。
  - **只登记、不动代码。**

- 2026-09-28：**S-151 口径收口为「Windows 接管式」** —— 老大 13:53 两句定案，正文 §0 改写，**第 3 轮那套「自建结果面板」方案整段作废**。
  - 老大原话：①「**先只做 Windows 就行**」；②「我们判断 Everything 装了没，是否存在，如果不存在引导用户去下载，如果存在，我们把搜索的值发给 Everything 并且启动它。剩下的就跟我们没关系了，**带参数启动**」。
  - **形态落定**：launcher 切「文件」模式 → 输入关键词 → 回车 → **Everything 自己的窗口弹出来显示结果**；我们的面板**不列结果**、不做高亮、不做图标。
  - **官方核查（抓 voidtools 官网 200，非记忆）**：`-search <text>`（*Set the search to the specified text*，**1.4 起**，官方示例 `Everything.exe -s "invoice"`）＝**本需求唯一用到的参数**；**用长名 `-search` 不用 `-s`**（`es.exe` 里 `-s` 是「按路径排序」，将来读码易串）；`-search*` 系列**要 1.5**，不用。`multiple_instances` 页原文 *「If an existing instance is found the command line options are sent and processed by the existing instance」* ⇒ **实例复用由 Everything 自己做**，我们一行不加（不加 `-new-window` / `-config` / `-instance`）。**该参数表里没有任何一项能打开 `Tools → Options`**（所以无法用命令行替用户开 HTTP server —— 这是第 3 轮方案的一个死结）。
  - **随之作废**（正文 §0.2 列全）：HTTP server 通道、端口探测、三态就绪判定、`FileSearchProvider` 三平台统一抽象、**结果规整层**（切分 / 派生 name·dir / 过滤噪音 / 打分 / 截断 50 / 图标缓存键用扩展名）、内容搜索（`content:` / `si:` / Recoll / tracker3 / baloosearch6）、mac（`mdfind`）与 Linux（`plocate`）实现。
  - **保留**：§二 现状（`fs:search-files` 那条实时递归链**不接**）、§三 官方参数核查、§四 探测优先级、§六 性能约束。
  - **探测只探 exe 路径**（不探进程、不探端口），五档：① 设置页**手动指定**（便携版是主流，注册表探不到，**必须有**）→ ② 注册表 Uninstall 项 `DisplayIcon`（剥尾巴 `,0`）/ `InstallLocation` → ③ 常见安装位（含 `Everything 1.5a\Everything64.exe`）→ ④ `where Everything.exe` → ⑤ 全不中 = 未装，出引导。
  - **本轮新结论：不自动探测第三方私有内置副本**（uTools `%APPDATA%\uTools\plugins\…\preload\everything\`，1.4.1.1009，ini `run_as_admin=1`/`allow_multiple_instances=0`，自带 `Everything.db` 97 MB；WPS `%LOCALAPPDATA%\Kingsoft\WPS Office\…\everythingsearch\everythingbinary`，1.4.1.1032，ini 里 **`exclude_files=…*.exe`、`exclude_folders=…%appdata%…`** ⇒ 接上去用户搜 exe 一个都搜不出）。理由是它们是宿主私有副本、行为不可控、索引被裁剪会造「假故障」，而老大的口径指的是**用户自己的** Everything。
  - **本机实测**：注册表三处 Uninstall 项无 Everything、`HKCU\Software\voidtools` 不存在、常见路径全 False、`where` 空、无进程 ⇒ **本机未装**（uTools / WPS 那两份不计入）。
  - **未解决风险（未实测）**：Everything 常以管理员运行（uTools 那份 ini 就是 `run_as_admin=1`），非提权进程 `spawn -search` 投给管理员实例可能被 Windows UIPI 拦掉；官方只说「发给现有实例」，未说跨权限级。**实测需先得老大许可**（副作用：弹 Everything 窗口、首次可能 UAC）。正文 §七 第 4 条。
  - **待裁定 4 条**：mac / Linux 是否另立需求（mac 无对等「结果窗口」，与接管式不兼容）、未装时文件模式置灰还是可切入、设置页落点（建议主设置页「快捷启动」节）、上面的 UIPI 实测。

- 2026-09-28：**S-154 登记：终端「常驻」会话结束后自动关闭对应选项卡** —— 老大 13:53（与 S-151 定案同一条消息）「我们不是有终端常驻的工具了么，目前关掉的时候没有顺便关掉选项卡，导致用户看到的是一堆已经无效的选项卡，这个需要**顺便把选项卡一起关掉**」。正文见 [S-154.md](requirements/S-154.md)。
  - **机制实证**：agent 的 Terminal 工具 `stop` → `pty.kill()` → 主进程 `pty.onExit` 发 `terminal:exit`（`terminal-handlers.ts:450-462`）→ 渲染端 `_onExit` **只把 `status` 改成 `exited` / `error`，tab 不删**（`terminal-store.ts:281-296`）← **就是这条**。「终端常驻」= Terminal 工具的 PTY 跨多次调用复用，PTY 一死那个 tab 就没存在意义了。
  - **三种 tab 来源**（`TerminalTabKind`）：`local`（用户自开）/ `local-agent`（agent 起）/ `ssh-agent`（SSH 观察窗）。**只收 `local-agent`**，另两类可能是用户要留着看输出的。走 `closeTab()` 是唯一发 `terminal:kill` 的入口（S-134 裁定），本条**不碰**那条规矩 —— 退出事件是结果，不是我们去杀。
  - **陷阱（实证）**：`BottomTerminalDock.tsx:118-133` —— `dockOpen && sessionTabs.length === 0` 时会 `handleAutoCreateTerminal()` **自动新建一个本地终端**。⇒ 只删 tab 不收停靠栏，用户会看到「死 tab 消失 → 冒出一个全新空白终端」，反而更糟。**所以删最后一个 tab 时要把该会话的停靠栏一并收起。**
  - **改法**：抽零依赖纯函数模块 `src/renderer/src/stores/terminal-tab-lifecycle.ts`（`AUTO_CLOSE_ON_EXIT_KINDS` / `shouldCloseTabOnExit` / `removeTabAndPickActive` / `countTabsForSession`）—— 沿用 `scroll-collapse-gate` 的做法，renderer 与回归套件跑同一份代码；`closeTab` 内联的「filter + 重挑 activeTabId」改调同一份实现。
  - **明确不做**：延迟关闭（老大要的是「顺便一起关掉」；引入计时器 + 新状态不值，输出在工具结果里本来就有）；不给用户自开的 `local` tab 加同样行为（要加只改 `AUTO_CLOSE_ON_EXIT_KINDS` 一处）。
  - **只登记、不动代码。**

- 2026-09-28：**S-154 实施落地（`c59d4ba9`，1 刀）** —— 新增零依赖纯函数模块 `src/renderer/src/stores/terminal-tab-lifecycle.ts`（`shouldCloseTabOnExit` / `removeTabAndPickActive` / `countTabsForSession`）；`_onExit` 在 `exited && shouldCloseTabOnExit(kind)` 时删 tab，某会话 tab 归零**连停靠栏一起收** —— 不这么做会冒出全新空白终端（见上条陷阱）；`closeTab` 内联的「filter + 重挑 active」改调同一份实现。套件 `test:terminal-tab-lifecycle` 25 断言。

- 2026-09-28：**S-151 实施落地（`6670849d`，1 刀）** —— 「Windows 接管式」照 §四 落地：新增 `src/main/lib/everything-search.ts`（纯逻辑：命名判定 / `DisplayIcon` 剥 `,0` 与引号 / 卸载项切块 / 候选生成 / 优先级挑选 / `-search` 参数拼接，50 断言）、`quick-launcher.ts`（探测 + `spawn -search` + 6 个 IPC）、launcher 渲染端（「应用 / 文件」切换 + `FileSearchPanel` 三档 + 设置页「文件搜索」节）。
  - **两条待裁定落地**：① 未装时**能切进去、进去就是引导页** —— 原建议「置灰 + 旁挂引导入口」被否：launcher 面板里**没有**那个旁挂入口的落点，置灰等于把引导藏进设置页，与老大「**如果不存在引导用户去下载**」相悖；代价是文件模式多一个未就绪状态，已在 `FileSearchPanel` 按 `supported / ready / 未探到` 三档分开渲染。② 设置页落点 = **launcher 窗口自己的「快速搜索设置」页** —— 自定义启动项早就只活在那里（主设置页那个 launcher 节只有开关 + 快捷键 + 说明），放主设置页会把同类配置拆成两处。
  - **实施细节**：不加 `-new-window` / `-config` / `-instance`（实例复用由 Everything 自己做，§3.2）；`Tab` 切模式、模式落 `launcher-config.json`；成功判据是「投出去了」（听 `error` / `exit`，超时 1000ms 按成功算），**失败不收起面板** —— 面板一关用户连报错都看不到；探测 30s 缓存、不做常驻轮询（§六 第 2 条）；手动指定只认 `Everything.exe` / `Everything64.exe`，选错就地报错不静默。
  - **门禁**：typecheck EXIT=0，npm test **60/60**（新增 `test:everything-search`）。`test:ipc-msgpack-routing` 强制要求新通道归类，6 个通道已进 `PRELOAD_BINARY_ONLY`。
  - **仍未做**：mac / Linux（§七 第 1 条）；UIPI 实测（§七 第 4 条，等老大许可 —— Everything 常以管理员运行，非提权 `spawn` 投给管理员实例可能被拦）。

- 2026-09-28：**S-155 登记：文件搜索「取数 + 自渲染」（接入 `es.exe`）** —— 老大 16:55 ~ 17:26 四句定案，**推翻 S-151「我们把词投给 Everything、结果由它自己的窗口显示」**。正文见 [S-155.md](requirements/S-155.md)。
  - **老大原话链**：① 16:55「Everything 我刚刚去下载了便携版，他们界面真丑，搜索是真的快。所以我在想能不能下载还是现在这样引导用户下载，不要编译到我们自己软件里面，但是**查询可以用我们自己来呈现结果**，主要是原生 everything 丑」；② 16:59「啊 那 utools 他们是怎么处理的，感觉他们的呈现跟原始的不太一样呢」；③ 17:21「它们的 everything 这么小么 我一直不想要的原因就是怕他们太大了」；④ 17:26「**走 A 吧**」。
  - **三条路对照（§0.2）**：**A = `es.exe` 取数 ✅ 选中**（ES 单文件 zip **117 KB**，纯 Node，不碰用户设置、不占端口）；B = Everything 的 HTTP server（**要用户手工勾 `Enable HTTP server`**、默认占 **80** 端口）**明确不可接受**；C = 自编 native addon 直连 SDK/IPC（uTools 做法，**每个 Electron 版本要重编**）。
  - **体积顾虑实测拆解**（老大 17:21 那个梗）：Everything 本体 exe **1.7 ~ 2.22 MB**、官方便携版整套 **3.2 MB**；真成本在**运行时索引** —— uTools 自建 `Everything.db` **97 MB**、跑着的 Everything 进程 WorkingSet **228 MB** / Private **197 MB**。⇒ A 路**复用用户自己的 Everything 与索引，零额外磁盘开销**，比 uTools 还省。
  - **`es.exe -help` 全表已抓**（ES `1.1.0.38`，官方原文，非记忆）。取数配方定为 `-export-json <out.json> -utf8-bom -no-digit-grouping -size -date-modified -extension -date-format 1 -n <N> <query>`。两条本轮新发现：**`-date-format 1` = ISO-8601**（不必解 FILETIME）、**`-no-result-error`** 可区分「空结果」与「出错」；另：**`-s` 在 es.exe 里是 *Sort by full path***（**不是** S-151 那个 `-search` 的简写 —— 两个 exe 两套参数表，别串，S-151 已把这条记为坑）。
  - **本机实测（ES × Everything `1.4.1.1032`，样本 `D:\tools\Everything-1.4.1.1032.x64\`）**：① **stdout 走控制台代码页 GBK** —— 原始字节 `b9 a8 d2 ed` 按 GBK 解码 = 「龚翼」，当 UTF-8 读**中文全变 `????`** ⇒ **一律走 `-export-json` + `-utf8-bom` 落文件再读，读回剥 `\uFEFF`**；② 字段真名 = `filename`（**完整路径**，非裸名）/ `size`（**字节**）/ `date_modified`（**FILETIME ticks**）/ `extension`，且 **`-name -path-column` 实测并不拆出 `name`·`path`** ⇒ 名称与目录在 JS 里切；③ 空结果 = `\uFEFF[]`（3 字节）且 **exit code 仍为 0**；④ 单次 **平均 142.6 ms**（PowerShell `&` 调用含 PS 自身开销，Node `spawn` 应更低，**实施时用 Node 复测**）⇒ **必须防抖**；⑤ 目录项路径**自带尾部反斜杠**（`…\.wishful-claw\`），规整时要认。
  - **一个硬约束**：全参数表**没有任何一项能启动 Everything 本体**（也没有 S-151 想找的那个「打开 Options」项）⇒ **`es.exe` 依赖 Everything 已在运行**（三路取数皆然 —— 索引在它内存里）。
  - **内容搜索本期落不了地**：Everything 的内容索引 **1.5 才引入**，老大装的是 **1.4.1.1032** ⇒ 只做文件名模式；实施时用 `-get-everything-version` 判版本，≥1.5 再另立需求。（**版本边界判断，未实测 `content:` 语法。**）
  - **降级矩阵（§5.5）**：Everything ✅ + es ✅ → **我们自渲染结果列表**（本期主体）；Everything ✅ + es ❌ → **投递式降级**（S-151 现成能力，零新成本）；Everything ❌ → 保持 S-151 的引导页。
  - **文案病根已定（§六）**：不是措辞软，是**通篇解释「我们做了什么 / 没做什么」，而不是讲「用户能拿到什么」** —— 「结果会显示在 Everything 窗口中」「我们不做自己的文件索引」「不需要你去找路径」。⇒ 随结果自渲染一并改写（「心虚感」与「结果跳出去」是同一个病）；设置页那句从辩解（「由 Everything 完成搜索，我们不建自己的索引」）变卖点（「**走 Everything 索引，不额外占磁盘**」）。
  - **4 条待裁定（正文 §七）**：① `es.exe` 获取方式 —— 引导用户下载（贴老大 16:55 原口径，**推荐**）vs 我们运行时拉取到数据根（用户无感，但与该口径字面冲突）；② 投递式降级留不留（**推荐留**）；③ mac / Linux 不做（沿用 S-151 §七.1）；④ `-inc-run-count`（常用排前）本期不接。
  - **只登记与规划，未动代码**；顺带订正 `plan.md` 索引表里 S-152 / S-154 两处过期状态（均已实施却写「待实施」）。
  - **17:37 老大拍定 §七 四条**：① es.exe = **引导用户自己下载**（原话「es.exe 怎么来？ —（a）引导用户自己下载」）；② 投递式降级**留**；③ mac / Linux **不做**；④ `-inc-run-count` **本期不接**。
  - **17:37 体积口径补充（销案）**：老大「就算成本是索引，索引也是用户安装后启动**自己创建**出来的，这个不会跟着我们的安装包走」⇒ A 路**连那 97 MB 索引都不多占**（是用户自己的 Everything 建的），比 uTools「自带独立 Everything + 独立索引」再省一层。**「体积」这条顾虑正式销案。**
  - 下一步：§八 实施计划已细化到 6 步 + 5 项手测，**待老大确认后开工**（六阶段：探索 ✅ → 规划 ✅ → **确认计划 ⏳** → 写代码）。

- 2026-09-29：**S-155 实施落地（1 刀）+ 实施中口径二次变更** —— 老大二次拍板四处调整，正文见 [S-155.md](requirements/S-155.md) §十。
  - **调整①：推翻 §七.1「es.exe 怎么来」** —— 原口径「引导用户自己下载」改为 **es.exe 内置进安装包**：`resources/es/es.exe`（262 312 字节，`-version` → `1.1.0.38`）入库；`.gitignore` 第 5 行 `*.exe` 会拦它 ⇒ 加 `!resources/es/` + `!resources/es/**` 例外；`electron-builder.yml` extraResources 加 `resources/es → es`；`ES_SOURCE_PRIORITY` 加 `'builtin'` 排第二（`manual` → `builtin` → `alongside` → `program-files` → `path` → `scan`），新增 `getEsBuiltinPath`，删 `ES_DOWNLOAD_URL`。**取消「获取 ES」与「本机检测」两条引导通道** ⇒ 手动指定成为**唯一覆盖入口**（用户拿新版 es.exe 顶掉内置）。体积口径（§七 附）不变：es.exe 只 256 KB，Everything 本体与其索引都不进包。
  - **调整②：Everything 没在跑时自动拉起** —— es.exe 参数表里**没有**「启动本体」的开关（§四 硬约束），原方案报「Everything 没有在运行，先启动它再搜」把活推给用户 ⇒ 改成探测到本体路径就 spawn 并轮询等就绪（上限 3 s，`EVERYTHING_AUTOSTART_WAIT_MS` / `EVERYTHING_AUTOSTART_POLL_MS`）+ 重试本次搜索，带冷却窗口；`spawn-failed` 则 `invalidateEsProbe()`，防死路径一直被当有效档报错。
  - **调整③：设置页与文案** —— es 未就绪文案改「自动拉起」口径；`spawn-failed` 那句从「设置里可以重新检测」改成「可以手动指定一份 es.exe 顶掉它」（「重新检测」通道已删，原话指不通）；「清除」按钮 `title` 去掉 `detected ? '清除本机检测到的路径' :` 分支。
  - **实施中抓到的漏点（值得记）**：渲染端 `EsExeSource` 是**自己一份类型**（不从主进程 import），加 `'builtin'` 后 **typecheck 不报错**，只会让 `ES_SOURCE_LABEL['builtin']` 变 `undefined` ⇒ 设置页来源标签**静默消失**。已补 `'builtin'` + `ES_SOURCE_LABEL.builtin = '应用内置'`。⇒ **跨进程的类型对子靠手工同步，编译器管不到。**
  - **调整④ 门禁（2026-09-29 实跑）**：`npm run typecheck` → **exit 0**；`npm test` → **61/61 全绿**。套件同步：`tests/es-search/program.ts` 删 `ES_DOWNLOAD_URL` 断言、`ES_SOURCE_PRIORITY` 期望值补 `'builtin'`、新增 `getEsBuiltinPath` 5 条（正常 / 空 / 纯空白 / `null` / `undefined`）+ `pickEsCandidate` 内置档 2 条（压过 `alongside`、缺失时回落 `path`）；`tests/ipc-msgpack-routing/program.ts` 删 `launcher:detect-es`、`launcher:open-es-download` 两行已废通道。
  - **待手测（4 项）**：① Everything 未跑时首次搜索能否自动拉起并出结果（那 3 s 窗口）；② 连打关键词的防抖 / 串行队列 / 有无乱序回填（§8.7 第 5 项）；③ UI 侧图标 / 大小 / 时间显示、`Enter` 打开、`Ctrl+Enter` 定位（§9.4）；④ 来源标签对内置档显示「应用内置」。

- 2026-09-29（晚）：**S-155 调整⑤：文件搜索另开独立窗，原窗回归「只搜应用」** —— 老大三次拍板，正文见 [S-155.md](requirements/S-155.md) §十一。
  - 原话：「去掉应用和文件的切换，下面内置一个搜索文件应用，放到最近打开的软件图标前，点击搜索文件 会开新的窗体。而不是在原有的窗体中，以前的就保持搜索应用启动就行」。
  - **七条口径**（依次拍定）：① 分类 7 项拼进查询词（不做本地过滤）；② `-viewport-offset` / `-viewport-count` 真分页（每页 100，不用 `-n 50` 截断）；③ 不预览，打开所在位置或用默认程序打开；④ 配置项留在原窗设置页；⑤ 原窗收起 + 已输入文字带过去；⑥ 回车 / 单击 = 定位、双击 = 打开文件；⑦ 全局热键不加、「开启文件预览」开关砍掉。
  - **落点**：新窗三件（`file-search.html` / `file-search-shared.ts` / `file-search/main.tsx`）+ `electron.vite.config.ts` 第 4 个渲染入口；`quick-launcher.ts` 新增 6 个通道（`launcher:open-file-search`、`file-search:query|count|icons|close|set-pin`）与 `createFileSearchWindow`（960×640，非 `frame:false`、默认不置顶）；原窗删模式切换、`FileSearchPanel` 整块与文件取数 effect，空态「最近使用」前加「搜索文件」入口，`Tab` 复用为「带文字去文件搜索」。
  - **顺手清掉的死代码（本轮改动带来的，不是扩大范围）**：`launcher:search-files`、`launcher:open-in-everything`、`launcher:refresh-everything-status`、`launcher:refresh-es-status` 四条通道 + `spawnEverythingSearch` + `EVERYTHING_SPAWN_CONFIRM_MS` + 配置字段 `searchMode` 与类型 `LauncherSearchMode`（模式切换没了，留个恒为 `'app'` 的字段是半吊子）。
  - **门禁（实跑）**：`npm run typecheck` → **exit 0**；`npm test` → **61/61 全绿**。`test:ipc-msgpack-routing` 又逮住一次漏登记 —— 新通道不加进清单就报「registered but nothing routes to it」，六条新通道已登记，147 断言 / 290 通道。
  - **遗留**：`lib/everything-search.ts` 的 `buildEverythingSearchArgs` 生产侧已无调用者（投递式降级删了），但它是带套件覆盖的公共纯函数，本次留着，要不要清由老大定。

- 2026-09-29（更晚）：**S-155 调整⑥ + 分类搜索 0 条根因修复** —— 老大实测报两条，正文见 [S-155.md](requirements/S-155.md) §十二。
  - 原话：①「不选分类搜索能搜索到，明确是 word pptx的 选了文档分类一样不见了，还有搜索文件在快捷搜索启动页不要单独一行，而是它就是一个应用，默认加到搜索里面去」。
  - **根因是空格，不是分类**：老大本机的 Everything 把空格解释成「整文件名精确匹配」（官方文档说 AND，属本机设置偏离）。实测对照 —— `package ext:json` = **0** vs `<package><ext:json>` = **11920**；`we chat` = 0 vs `<we><chat>` = 360；`WeChat /ad` = 0 vs `<WeChat><folder:>` = 47；`数据库设计说明书 ext:doc;docx` = 0 vs `<数据库设计说明书><ext:doc;docx>` = 2。这就是「选了分类反而 0 条」全部原因。
  - **修法**：`buildEsQuery` 改成**拆词 + 逐词 `<>` 分组 + 全程无空格拼接**，AND 语义交给 Everything 自己算；`folder` 由 `/ad` 改 `<folder:>`（`/ad` 与 `ext:` 互斥那条老口径保留）。新增纯函数 `groupEsTerm` —— 自带尖括号的词（`size:>10mb`）原样放行，其余一律包 `<…>`（实测 `<package>ext:json` 与 `<package><ext:json>` 同为 11920，等价；选分组图一致）。头注补 ⑪，把「本机空格语义」和六组对照数据钉进去。
  - **调整⑥**：启动页的「搜索文件」从一个占满整行的入口改成**与最近使用同排同形态的应用砖**（区块标题改「快捷入口」，图标 `FileSearch` 主色），并新增哨兵 `FILE_SEARCH_APP_PATH` / `FILE_SEARCH_ENTRY` —— `handleLaunch` 认哨兵改开文件搜索窗；`doSearch` 里它**恒在结果列表里** —— 有结果排**末尾**（不抢聚焦）、一条都没搜到时占**首位**。
  - **两次纠正（老大 11:05 / 11:10）**：① 初版理解成「一律排首位」是错的 ⇒ 改成末尾，只有搜不到时才是首位；② 初版只在关键词命中「搜索文件」三个字时才注入，且砖里图标用了灰线稿 `FileText` ⇒ 改成**恒注入**（搜不到东西时用户要的正是这个出口，不能只甩「无搜索结果」）＋ 搜索结果行与砖都用主色 `FileSearch`。
  - **门禁（实跑）**：`npm run typecheck` → **exit 0**；`npm run test:es-search` → **145 断言**；`npm test` → **61/61 全绿**。套件里按旧拼法写死的四处断言（recipe 尾参 `龚翼`/`a`、计数 `报告`/`/ad`）一并同步。
  - **附带修复（老大 11:14 报）**：原窗输入「周报」→ 选「搜索文件」→ 新窗输入框还是空的。根因不是没传参，是**推的时机太早** —— 主进程在 `did-finish-load` 里推 `file-search:init`，而渲染端 `window.api.on` 只是 `ipcRenderer.on` 的封装、注册时机在 React 的 `useEffect`（晚于 `did-finish-load`），消息必丢；窗已经开着时反而正常（第二次点），这也解释了 §11.3 手测那轮为什么没暴露。修法：主进程加槽 `fileSearchInitialKeyword`，创建新窗时存词，渲染端挂载后主动 `invoke` 取（取完清空）；**新窗不再走 did-finish-load 推送**，已有窗仍走推送。新增通道 `file-search:take-initial-keyword`（`test:ipc-msgpack-routing` 白名单已登记）。
  - **待手测**：文件搜索窗「关键词 + 分类」、多词关键词；启动页搜索文件砖的形态与点击、输入「文件」能否在结果里看到它；**首次**从原窗带词进文件搜索窗（这条是刚修的，上一轮手测没覆盖到）。

- 2026-09-29 13:37：**S-155 收口** —— 老大「以上这些都是测过了」⇒ 6 项手测全过（分类+多词关键词 / 应用砖形态与排序 / 首次开窗带词 / 目录图标 / 视频分类无 `.ts` / Problem-④ 来源标签），S-155 定稿 **2 刀**：`bdf8a533`（取数层 + 原窗自渲染）+ `d3cebecb`（文件搜索独立窗 + 分类查询 0 条根因 + 开窗带词 race + 摘自绘置顶关闭 + 目录图标 + 视频白名单剔 `ts`）。门禁 `typecheck` EXIT=0、`npm test` **61/61**。**未 push**（迭代内不 push）。

- 2026-09-29 13:41：**S-140 观察反馈 + `plan.md` 索引纠偏** ——
  - **S-140**：老大「140 是增量下载」⇒ 0.2.33 → 0.2.34 那次的全量（108 MB）**目前未复现**，维持 ⏸ 挂起；观察点保留到 **`0.2.35 → 0.2.36` 发布那次**（那是我方自测的最后一跑，届时专门量一次 `download-progress` 是否走差分）。
  - **顺带订正 `plan.md` 索引表四处过期状态**（都是文档落后于代码，不是新工作）：
    - **S-129** 原写「`publish` 切换 + 服务器上传待前序条件」→ 实际 `electron-builder.yml:10-12` **已切** `provider: generic` / `url: https://wishful-claw.work/downloads/`；欠的只是**动作**（跑 `deploy.mjs installer` 上传三件 + 站点重发）。
    - **S-143** 原写「公安备案待办」→ 实际公安备案号 `川公网安备51080202020186号` 已进 `website/src/content/site.ts:219-221`；欠的同样只是**站点重发**。
    - **S-144** 原写「📝 已登记，待勘测」→ 实际 **✅ 已实施**（`21a35657`，正文自述「勘测结论 + 两处实修 + 14 断言回归」）；36 目录下早有正文 `requirements/S-144.md`（随 `21a35657` 入库），引用从 35 目录改指 36。
    - **S-155** 状态行由「3 刀」改「2 刀 `bdf8a533` + `d3cebecb`」，并把目录图标 / 视频白名单两项调整补进摘要。
  - **本轮 iter-36 真实欠账收敛为 3 条**：① S-129 / S-143 的**发布动作**（跑脚本 + 站点重发，等老大发话）；② **S-145 §六 视频端到端实测**（老大 13:40 去跑）；③ **S-140 观察**（依赖 0.2.36 发布）。其余 13 个需求全部已实施。
- 2026-09-29：**S-155 手测全过 + S-145 §六 断链修复后实测通过 —— iter-36 需求台账全清** —— 老大 13:37「以上这些都是测过了」（S-155），14:00「视频读取也成功了」（S-145 §六）。
  - **S-155**：手测全过（分类 + 多词关键词、应用砖形态与排序、首次开窗带词、目录图标、视频分类无 `.ts`）⇒ 无需追加改动，2 刀即收口。
  - **S-145 §六 实测首次即断链**：`Read` 认得 `.mp4`，但 worker 发的反向请求 `vision/extract-video-frames` 没人接。**两处根因**：① `native-agent-runtime.ts` 的 `rendererMethods` 白名单漏登记该通道 ⇒ 请求落进主进程 handler 表（`dispatchReverseRequest`）当场回错、**压根没往渲染端转发**（渲染端 `renderer-tool-bridge.ts` 的实现因此是死代码）；② 主进程侧默认超时 30s < 渲染端自留 120s ⇒ 白名单补对后稍大的视频会被主进程抢先掐断，把带真实原因的失败吃成一句干巴巴的 timeout。
  - **修法**（`b71e9c56` 一刀）：白名单补登记该通道；新增 `RENDERER_LONG_TASK_TIMEOUT_MS = 150_000` + `LONG_RUNNING_RENDERER_METHODS`；超时判定改三级（用户交互 30min → 长任务 150s → 默认 30s）。150s **故意**长于渲染端 120s，让渲染端先到期、带回真实原因（哪个容器解不了 / 哪个 `MediaError`），主进程只兜底。顺带核过分发链 `desktopMethods → isMainProcessMethod → rendererMethods`，`isMainProcessMethod` 不含 `vision/*`，新方法不会被中间那层截走。
  - **门禁**：`npm run typecheck` EXIT=0；`npm test` **61/61**（`ReadVideo` 76 断言照过）。实测通过 ⇒ **iter-36 需求台账全清**（S-129 / S-143 欠的只是发布动作，S-140 是 0.2.36 发布后的观察）。
  - **教训（值得记）**：跨语言「方法名」是**三份手工同步**的常量（C# `AgentRuntimeVideoFrameExtraction.Method` / 渲染端 `renderer-tool-bridge.ts` 的 if 分支 / 主进程 `rendererMethods`），改一处忘一处没有任何测试拦得住 —— 76 个契约断言全绿，端到端照样断链。已向老大提议加一条文本级守护断言（断言 C# 的 `Method` 常量字符串出现在主进程白名单文件里），待裁。
- 2026-09-29：**iter-36 收尾（发布 `v0.2.36`）** —— 老大 14:14「已经测试通过了，可以进行迭代收尾了。不过这次发布有点不一样的是，需要上传到官网」。
  - **台账**：14 个需求编号（S-144 ~ S-155，其中 S-151 被 S-155 取代）全部落地并验证通过，`43a616e6..HEAD` 共 **22 刀**。S-129 / S-143 的欠账只是**发布动作**（跑 `deploy.mjs installer` 上传下载目录三件 + 站点重发）；S-140 是 0.2.36 发布后的观察点。
  - **文档整理**：`changelog.md` 242 行 / 80 KB 超「单 md ≤ 60 KB」硬规则 ⇒ 按行分卷 —— 本文件留 2026-09-28 起的近期段，2026-09-23 ~ 09-25 段移入新建的 `changelog-archive.md`；`plan.md` / `raw-requirements.md` 状态行统一订正为收尾态。
  - **补漏**：iter-35 收尾时漏了第五节的进度文档两步 —— 本轮补建 `docs/progress/v2-iter-35.md` + `PROGRESS.md` 表格行（iter-35 只落 S-141 / S-142 两项，6 刀）。
  - **门禁**：`npm run typecheck`（`tsconfig.node` + `tsconfig.web`）**0 错误**；`npm test` **61 / 61 全绿**。
  - **版本**：`0.2.35` → `0.2.36`（`package.json` / `package-lock.json` 两处 / README 徽章 / `PROGRESS.md`）。
  - **本次发布差异**：多一道「上传官网下载目录」（`release-workflow.md` §4.2）—— 官网是 `provider: generic` 指向的**唯一更新源**，漏传 = 所有已装客户端收不到更新。
