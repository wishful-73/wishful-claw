# 1.0 之后的大方向（post-1.0 Roadmap）

> 本文件登记 **1.0 之后**准备做的大方向 —— **不属于任何迭代**、**不占迭代内需求编号（`S-xxx`）**。
> **2026-10-21 发布 `v1.0.0` 起本文件转正生效**；此前（iter-v2-39 / 40 期间）是登记期，只收藏、不动工。
> 每条状态一律从「**登记**」起步；某条**转正**进某个迭代时，才按该迭代 `raw-requirements.md` 拆成 `S-xxx` 正文，本文件只留指针。
> 编号：`R-1` / `R-2` / `R-3`（`R` = Roadmap，与 `S-` 需求编号区分）；**2026-10-15 14:07 追加 `H-1`** —— `H` = **Harness 工程参考**，**性质与 R 系不同**：R 系是「**要做什么功能**」，`H-1` 是「**我们自身这套 harness 该怎么长**」（方法论，不是功能）。**`H-1` 这个编号是我拟的，老大可改或并入其他体系。**
> 来源：**老大 2026-10-14 09:46 口述登记**（每条列原话）；**2026-10-15 追加** —— 11:29 R-3 反代客户端清单增列 **WorkBuddy**，11:33 补入 **WorkBuddy 的 5 个反代参考实现**，11:34 明确**参考定位口径**（只作参考，最终落进我们软件），11:45 补入**反代参考源 `239573049/Astra-Gate`**（老大给出源码位置并指明「需要参考他们的反代实现」），**14:03 补入 Qoder 的主参考源 `zhanghaojie513/waygate-qoder`**（老大给出源码位置），**14:07 追加 `H-1` Harness 工程参考**（老大给链接，「也是大版本需要去考虑的事情」）。
> 落盘：2026-10-14（2026-10-15 追加 WorkBuddy + 5 个社区参考实现 + 定位口径 + Astra Gate + waygate-qoder + H-1）。**未勘察到底、未定案、未开工。**
> **2026-10-22 追加（R-3 转正）**：10-22 08:49 老大定「第一版本先处理反代，这是一种节约手段」，08:50 定**形态 A**（provider 层内实现，不起本地服务），09:12 定风险口径「这个可以提醒风险呀」，**09:14 定「v1.0.1 带 WorkBuddy」**；同日勘察完成 —— **WorkBuddy 拆入 `v3-iter-1`，登记为 `S-218`**，并补入唯一一份上游源码参考 **`astragate-community/astra-gate-plugins`**（见下方同名小节）。**R-1 / R-2 / H-1 仍未勘察到底、未开工；R-3 的 Qoder 部分仍登记。**
> **2026-10-27 追加（R-4 新增 / R-1 口径升级）**：13:49 老大定「能听**不属于我们这个项目**，走通用插件的形式，加载进来使用」；13:57 划分两类插件（Type A 给 agent、**Type B 带 UI 且 UI 由插件自带**）；14:00 定「**先只做 window**」「插件**不做白名单，能开放的越多越好**」「安装是用户自己点的，**要确认**」⇒ 新增 **`R-4` 插件体系**，**`R-1` 听改为 Type B 插件实现**（不在主程序内置）。见下方「R-4」与修订后的 R-1 小节。

---

## 总览

| 编号 | 方向 | 一句话 | 现成基础 | 状态 |
|---|---|---|---|---|
| **R-1** | **听** | 语音转文字：电脑做会议记录 / 纪要 | 老大仓库 **`wishful-73/QwenASR`**（Windows exe ~2.3 MB；模型 0.6B ≈ 490 MB）+ **说话人区分 `sherpa-onnx`**（本地源码 `D:\claw\sherpa-onnx`） | **登记 · 口径升级为「插件化」**（2026-10-27 定，依赖 `R-4`；不进主程序） |
| **R-2** | **说** | 渠道发消息时，用户不方便看文字就直接听语音 | **MOSS-TTS-Nano**（0.1B / 有 ONNX CPU 版）；本机朗读 **S-138 已实施** ⇒ 本方向是**升级替换**，不是从零做 | 登记 |
| **R-3** | **反代** | 客户端不好用但模型可用 ⇒ 自建反代转成 OpenAI 兼容 | **Qoder 主参考 `zhanghaojie513/waygate-qoder`**（TS / MIT，凭证解密 + COSY 协议全实现）；**架构参考 `239573049/Astra-Gate`**（**C# / MIT**，四协议 + 统一 IR 的本地网关）；**WorkBuddy 上游主参考 `astragate-community/astra-gate-plugins`**（JS / **Apache-2.0**，`packages/workbuddy` 是唯一一份「把 WorkBuddy 当上游」的公开源码）；源流备查 `EchoPing07/Qoder-2API-Go` | **部分转正**：**WorkBuddy → v3-iter-1 · S-218**（2026-10-22，形态定 A）；Qoder 仍登记 |
| **H-1** | **方法论**（非功能） | Harness 工程：**agent 的工作系统**该怎么设计才可靠 | `walkinglabs/learn-harness-engineering`（**⭐19.9k / 2.2k fork**，MIT，14 讲 + 项目 + 8 个开箱模板 + 前沿 harness 拆解） | 登记 |
| **R-4** | **插件体系** | 两类插件：**Type A 给 agent 用（tools / MCP）**、**Type B 给用户用（自带 UI · 独立窗口）**；资产（exe / 模型）按需下载 | 已有「自定义扩展」骨架（`src/shared/extension-types.ts`）+ MCP 子进程通道（`src/main/mcp/mcp-client.ts`） | **形态已定**（2026-10-27），未开工 |

---

## R-1 · 听：语音转文字（会议记录 / 纪要）

> **2026-10-27 口径升级**：本方向**改为 Type B 插件实现**（见 [R-4](#r-4--插件体系type-a-能力插件--type-b-带-ui-插件2026-10-27-追加)），**不进主程序、不内置**。引擎与模型均为插件资产，由插件 `assets` 清单驱动按需下载。下方原有勘察结论（引擎能力 / Windows 缺口 / 体积）**全部继续有效**，只是归属从「主程序功能」变为「插件资产」。
> **说话人区分已定方案**：`QwenASR` 本身**无 diarization** ⇒ 加 `sherpa-onnx`（本地源码 `D:\claw\sherpa-onnx`，含 `offline-speaker-diarization` C API 示例 + `dotnet-examples`）做说话人分割，与 QwenASR `--json` 的词级时间戳按时间重叠对齐。模型体积小（segmentation ≈ 6 MB + 声纹 ≈ 28 MB，**待装前核实**）。**注意**：说话人分离 ≠ 认人，首次只能出「说话人1/2」，出真名需另做声纹注册。

**老大口径（原话）**

> 「我预计是让我们软件能听 语音转写文字，可以电脑做会议记录纪要这些功能。目前语音转文字 我们有现成的 qwen asr cli 大概几M的rust包 + 模型」

**目标场景**：软件能「听」 —— 把语音转写成文字，进而用电脑做**会议记录 / 会议纪要**。

**现成基础**

**现成基础** —— **老大自己的仓库**（2026-10-14 09:53 老大：「qwen asr cli 是我的仓库 应该在 git 上」）

- **`wishful-73/QwenASR`**（本地 `D:\claw\QwenAsr`，HEAD `bcd21420` 2026-09-23）：v0.1.2 / **MIT** / **纯 Rust、CPU-only 的 Qwen3-ASR 推理引擎**，无重型运行时依赖（只依赖 `libc`）。
- 上游关系：README 与 GitHub Releases 仍指 `huanglizhuo/QwenASR`（62★）⇒ 疑似由此衍生，**待老大确认**。
- 支持模型与体积（`CLI-STATUS.md`）：**0.6B ≈ 490 MB** / 1.7B ≈ 3.4 GB / ForcedAligner-0.6B ≈ 1.7 GB。
- 能力：离线 + **流式**（`--stream`）、**VAD**、`--live` 实时采集（**仅 macOS**）、字幕（SRT / VTT）、结构化 JSON（段级 + 词级时间戳）、强制对齐、`--stdin` 管道输入、**常驻进程复用**（第 3 个请求 7.3 s / 28 s 音频，模型加载被摊薄）。
- **Windows 已移植**：产物 `qwen-asr.exe` **~2.3 MB**（= 老大说的「几 M 的 Rust 包」）；目标 `x86_64-pc-windows-msvc`；GEMM 走 `matrixmultiply`（纯 Rust、AVX），0.6B 实测 **3.77× realtime**；内存 WS 峰值 ~3.3 GB（其中 ~2 GB 是 mmap 共享文件页，Private 1.31 GB）。
- **Windows 已知缺口**：① `--live` 实时采集**不支持**（依赖 macOS CoreAudio）⇒ Windows 侧录音得我们自己来（NAudio / WASAPI / ffmpeg）再走 `--stdin` 喂入；② **无 C ABI**（FFI 只做了移动端 / macOS）⇒ Windows **只能子进程调用**；`CLI-STATUS.md` 已附 C# `ProcessStartInfo` 调用示例。
- 模型自带下载：`qwen-asr download qwen3-asr-0.6b`（与「模型不随包」口径天然契合）。
- 本仓既有记载：`QwenASR` 最早出现在 **iter-v2-27** 的 v3 规划里（`exploration_findings.md:170` / `plan.md:431`，当时列进「不纳入」清单），**未展开**。
- **参考源（我搜到的，仅备查，非选型）**：`Longt-audio/voxminutes`（Windows 本地优先会议助手：系统音频 + 麦克风录制、实时转写、13 语翻译、**说话人分离**、桌面字幕、AI 会议纪要，离线本地模型，AGPL-3.0）—— 目标场景几乎完全重合。

- **参考源（搜索发现，仅备查，不是我们的选型）**：`Longt-audio/voxminutes`（Windows 本地优先会议助手：系统音频 + 麦克风录制、实时转写、13 语翻译、**说话人分离**、桌面字幕、AI 会议纪要，离线本地模型，AGPL-3.0）—— **目标场景几乎完全重合**，设计上可参考。
- 本仓既有记载：`QwenASR` 最早出现在 **iter-v2-27** 的 v3 规划里（`exploration_findings.md:170` / `plan.md:431`，当时列进「不纳入」清单），**未展开**。

**待勘察（开工前）**

1. ~~CLI 来源~~ **已定案**（`wishful-73/QwenASR`，Windows 产物 ~2.3 MB）。剩余：模型分发走它自带的 `download` 还是我们自己的下载器（统一进「模型目录管理」）。
2. **Windows 侧录音**（WASAPI / NAudio）与**系统内录**（会议对面的人）—— 这是仓库的 Windows 缺口，得我们补。
3. 会议场景是否要**说话人分离**（仓库当前**没有** diarization）+ **自动纪要**（纪要走我们自己的模型与既有会话 / 记忆体系）。
4. 与**渠道**的关系：渠道收到的语音消息是否也要转写。
5. 调用形态：**子进程 + `--stdin` + 常驻复用**（Windows 当前唯一可行）还是等 C ABI。
6. 要不要**流式**（边说边出字）—— `--stream` 已具备，只需定会议场景用不用。

---

## R-2 · 说：文字转语音（渠道 / 不便看文字的场景）

**老大口径（原话）**

> 「会说 比如渠道发送给用户的时候，用户不方便看文字，直接听语音。至于文字转语音 这是 MOSS-TTS-Nano 的相关地址……」

**目标场景**：渠道把消息发给用户时，用户不方便看文字 ⇒ **直接听语音**。

**现状（关键 —— 本方向不是从零做）**

- **S-138 已在 iter-v2-34 实施**（`4eb5fc05`）：本机朗读音色 —— `window.speechSynthesis.getVoices()` 过滤 `localService`、设置页音色选择器 + `rate` / `pitch`；实测本机 OneCore **3 个中文语音**（Huihui / Kangkang / Yaoyao，本地离线）。
- ⇒ 本方向要做的是两件事：① **换合成引擎**（本机 OneCore ⇒ MOSS-TTS-Nano 这类真模型）；② **扩场景**（面板朗读 ⇒ 渠道语音播报）。

**候选技术：MOSS-TTS-Nano**（以下为 2026-10-14 实测抓取：GitHub API + README，非二手转述）

| 项 | 事实 |
|---|---|
| 规模 | **0.1B 参数**（100M）多语种 TTS；**48 kHz、双声道**输出 |
| 语言 | **20 种**，含中文（zh）/ 英 / 日 / 韩 / 德 / 法 / 西 / 意 / 匈… |
| 架构 | 纯自回归 `Audio Tokenizer + LLM` |
| 性能 | **流式推理**（低首包延迟）；**CPU 友好**（4 核可跑流式）；长文本自动分块 + **声音克隆** |
| 许可 | **Apache-2.0** |
| 仓库 | `OpenMOSS/MOSS-TTS-Nano`（Python，**4,475★**，创建 2026-04-10，最近 push 2026-09-06） |
| **ONNX CPU 版** | 2026-04-17 起提供：**推理阶段去掉 PyTorch 依赖**、约 **2x** 效率、**MacBook Air M4 单核可跑**；权重 `MOSS-TTS-Nano-100M-ONNX` + `MOSS-Audio-Tokenizer-Nano-ONNX` |
| 另有形态 | `MOSS-TTS-Nano-Reader` —— **浏览器扩展里直接跑模型**（无需本地推理服务）⇒ 对 Electron 侧有直接参考价值 |
| 权重地址 | HuggingFace `OpenMOSS-Team/MOSS-TTS-Nano` ；ModelScope `openmoss/MOSS-TTS-Nano` |
| 调用方式 | CLI `moss-tts-nano generate` / `moss-tts-nano serve`；Python `infer.py` / `app.py` / `app_onnx.py`；ONNX 默认 `--execution-provider cpu`（有 NVIDIA 卡可切 `cuda`） |
| 链接 | GitHub `https://github.com/OpenMOSS/MOSS-TTS-Nano` ｜ Demo `https://openmoss.github.io/MOSS-TTS-Nano-Demo/` ｜ arxiv `2603.18090` |

**待勘察（开工前）**

1. **权重体积** —— 本机拉 HuggingFace API 未取到（**没测出来就不猜**）。打包口径**已定案：不随包、走首次下载**（见「共同口径」）⇒ 体积只影响**下载时长与提示文案**，不再是选型门槛。
2. 推理落点：**ONNX Runtime C#**（`Microsoft.ML.OnnxRuntime`，对齐我们的 .NET sidecar）还是打包 Python / CLI 子进程。
3. **渠道侧能不能出语音**：微信等渠道是否支持发语音消息、时长与格式限制。
4. 用不用**声音克隆**（个人音色 / 会议发言人音色）。
5. 与 **S-138** 的取舍：本机 OneCore 是否保留作**降级路径**（模型不可用时兜底）。

---

## R-3 · 反代：客户端不好用但模型可用

**老大口径（原话）**

> 「反代ai服务商 部分软件如qode cn 之类的不好用，但是我们用它的模型。……然后反代的话目前是 全部算法逆向自官方客户端 + 社区参考实现（EchoPing07/Qoder-2API-Go 的 auth.go）」（原文写作 `qode cn`，按 **Qoder CN** 记）

**目标场景**：某些客户端（老大点名 **Qoder CN** 这类）本身不好用，但**它的模型我们想用** ⇒ 自建反代，把它的服务转成 **OpenAI 兼容端点**，接进我们自己的 provider 体系（我们已有多 provider + fallback 机制）。

**待反代的客户端清单**

| 客户端 | 状态 | 备注 |
|---|---|---|
| **Qoder CN** | **先做**（老大 2026-10-14 09:53：「反代先做 qoder 啊」） | **主参考 `zhanghaojie513/waygate-qoder`**（TS，凭证解密 + COSY 协议全实现 + 真网关实弹验证过，老大 2026-10-15 14:03 给出）；源流备查 `EchoPing07/Qoder-2API-Go`（Go，看 `auth.go`） |
| **WorkBuddy** | **已拆入 v3-iter-1，登记为 S-218**（老大 2026-10-22 09:14：「v1.0.1 带 WorkBuddy」） | **勘察完成，形态定为 A**（2026-10-22）—— 契约、模型清单、鉴权链路、错误码全部实读源码 + 真账号实测记录，见下方「参考源 · astra-gate-plugins」。原「账号 + 成长任务积分 + 多账号池」推测已在 10-15 部分证伪，现进一步确认：那是社区「刷它自己额度」才需要的，与接入面无关 |

**WorkBuddy 反代参考实现（老大 2026-10-15 11:33 给出，仅备查、非选型）**

> 老大原话：「这些都是workbuddy 反代相关的项目，放到登记里面作为后续处理的时候的参考」
> ⚠️ 下表为**老大提供的线索**，本仓**未逐一核实**（仓库存在性、许可、活跃度、代码质量**均未验证**）—— 开工前需逐条勘察。

> **★ 定位口径（老大 2026-10-15 11:34 明确）**：「我们只是参考这些，**最终实现方案是弄到我们软件中**」
> ⇒ 这些项目**只作参考** —— 借它们的**协议格式 / 鉴权链路 / 反爬与账号池经验**；**最终形态是落进我们自己的软件**（作为内置 provider / 内置反代能力），**不是**照搬它们的 PyPI / `uv` / Docker / 独立端口那套外部部署形态。表中「部署方式」一列**仅供了解它们的实现思路，不是我们的落地方式**。

| 项目 | 技术栈 | 核心特性 | 部署方式 | 适用场景 |
|---|---|---|---|---|
| `Sliverkiss/workbuddy2api` | Python | 三协议（OpenAI / Anthropic / Responses）、敏感信息脱敏、上下文压缩、工具调用、DSML 解析、多账号隔离 | PyPI + `uv` 一行命令启动，默认 `127.0.0.1:8787` | 个人本地使用，接入 Codex CLI / Claude Code / OpenCode / Grok CLI 等编码客户端 |
| `ardeyouxipianyi/workbuddy2api-hub` | Python | 国际 + 国内双域独立路由、设备指纹防风控、Web 监控看板、每日签到 / 成长任务全自动、多 API Key 出口绑定 | Windows / macOS 双击脚本，或 Docker（GHCR 双架构镜像）+ 一键部署脚本 | 多账号、国内外都要用、想要 Web 看板的重度用户 |
| `linguo2625469/workbuddy2api-panel` | Go（基于 Sliverkiss 分支） | 多账号池轮转（最早到期优先 + 成本分层 + 加权随机）、熔断冷却、会话粘性、17/18 个成长任务一键完成、Web 面板热更新配置 | `docker compose up -d`，默认端口 `7863` | 想「躺赚积分」、需要可视化账号池运营的用户 |
| `baiyea/workbuddy2api-ui` | Docker | OpenAI + Anthropic 双兼容、多账号池与冷却、Web 控制台（账号授权、对话测试、自动任务） | Docker Compose 一条命令，镜像直拉 | 想要「零改造」接入 Cherry Studio / NextChat / LobeChat 等聊天客户端 |
| `ithtelab/workbuddy-manager` | Go + Web | workbuddy2api 的管理面板补全：扫码批量纳管、密钥分组分发、IP 与模型白名单、调用日志与用量统计、签名校验一键更新 | Docker `ghcr.io/ithtelab/workbuddy-manager:latest`，或服务器一键脚本，端口 `7864` | 给团队 / 多人分发密钥、需要精细权限与审计的场景 |

**从上表能读出的线索**（**推测，未验证**）：WorkBuddy 的鉴权走**账号 + 成长任务积分**体系（多份实现都在做「签到 / 成长任务自动化」与「多账号池轮转」）⇒ 与 Qoder 的 token 鉴权形态可能不同，勘察时需单独摸。**注意区分**：表中 `Sliverkiss` 系是**反代本体**，`ithtelab/workbuddy-manager` 是**它的管理面板**（依赖前者的 API），不是并列的独立反代。

> **⚠️ 上述推测已被部分证伪（2026-10-15 11:45，实读 Astra 的 `WorkBuddyClientAdapter.cs`）**：请看下面「参考源 · Astra Gate」一节里的 **WorkBuddy** 小节 —— **「把模型接进来」这一侧讲的是标准 OpenAI Chat Completions + apiKey，有明确的配置文件契约（`~/.workbuddy/models.json`），接入面不需要逆鉴权**。上面「账号 + 成长任务积分 + 多账号池」那套推测，更可能是**社区那批项目为了「白嫖它自己的模型额度」**才需要的，**不等于**接入面契约。开工前后者只需摸清「把它当上游时怎么授权」，不必先攻前者。

**实现路径（老大口径）**：**算法全部逆向自官方客户端** + 社区参考实现。

### ★ 参考源 · Astra Gate（源码级，2026-10-15 11:45 追加）

> 老大原话：「`https://github.com/239573049/Astra-Gate` 这是它源码位置，这个网站介绍的就是这个工具他是一个反代和网关，**我们需要参考他们的反代实现**， 这个是1.0版本后的大方向 反代的参考源之一。」
> 下表为**实读**（2026-10-15 用 `gh api` 拉仓库元数据 / 完整文件树 / README / 网关模块 codemap / `WorkBuddyClientAdapter.cs`，非二手转述）。

**元数据**

| 项 | 事实 |
|---|---|
| 仓库 / 官网 | `239573049/Astra-Gate` ｜ `https://astra-gate.si/`（= 2026-10-15 11:38 老大给的 S-206 背景动画参考站，**同一个东西**） |
| 语言 / 许可 | **C#（.NET）为主** + TypeScript（web / desktop / cli）｜ **MIT** |
| 规模 / 热度 | **1256 文件**、22.6 MB ｜ 30★ / 6 fork ｜ 创建 **2026-10-07**、最近 push **2026-10-14**（**很新、活跃**） |
| 形态 | `Astra.sln` + pnpm workspace：`desktop`（Electron）/ `web`（控制台）/ `cli` / `docs`（Next.js）/ `npm`（`@aidotnet/astra-gate`）；另带 `Dockerfile` + `compose.yaml` + `install.sh` / `install.ps1` |

**定位**：**跑在自己电脑上的本地 AI 网关**（默认 `127.0.0.1:17321`），夹在 AI 客户端（Codex / Claude Code / Gemini CLI / OpenCode…）与 AI 服务商（Anthropic / OpenAI / DeepSeek / OpenRouter / 自定义）之间，做**协议转换 · 计费 · 隐私护栏**。

**★ 为什么它比 Go / Python 那批更值得看：与我们是同栈** —— 它是 **C#**，和后端 `src/runtime` 的 .NET sidecar 同语言同生态 ⇒ **可以按代码级参考**，不必从别的语言翻译。

**七个 .NET 项目（骨架）**

| 项目 | 角色 |
|---|---|
| `Astra.Core` | 领域类型、设置、计费与价格数学、隐私检测器、系统代理 |
| `Astra.Data` | SQLite 仓储 + 迁移 |
| `Astra.Providers` | provider 模板、**订阅 token / 刷新**、额度轮询（`Quota/` 用**表达式模板** `QuotaExpression` + `quota-templates.json` 驱动） |
| `Astra.Gateway` | **反代本体**（见下） |
| `Astra.Server` | 宿主 / DI / 全部 `Map*Endpoints`（`Api/` 36 个端点文件） |
| `Astra.Clients` | **26 个客户端适配器**：代写客户端配置 + 完整还原（`PlanEnable`/`PlanDisable`/`PlanPurge`/`Inspect`） |
| `Astra.Plugins` | Jint（JS 中间件）+ 插件市场 + Bun 宿主 |

**★ 最值得抄的两处**

**① `Astra.Gateway/Protocol/` —— 四协议 codec + 统一中间表示（IR）**

`Chat`（OpenAI Chat Completions）/ `Responses`（OpenAI Responses）/ `Anthropic`（Messages）/ `Gemini` 各一套 Request/Response Encoder/Decoder，中间统一成 `Ir.cs` 的 `UnifiedRequest` / `ContentPart` / `UnifiedTool` / `ReasoningConfig` / `Extensions`，流式归一化成 `MessageStart → (BlockStart, deltas…, BlockStop)* → Usage? → MessageStop` 事件序列；`Sse.cs` 是手写的增量 WHATWG SSE 解析/序列化（含 Gemini 的 JSON-array 流式）。**⇒ 正是「客户端与服务商不必同构」这条能力在我们 provider 层该怎么落地的现成范式。**

**② `Astra.Gateway/Pipeline/` —— 一条请求的完整骨架**

`GatewayPipeline.HandleAsync` 串起：token 鉴权 → 限流（`TokenLimiter`/`TokenUsageLedger`，日/终身额度 + 滚动 RPM）→ 读体（`RequestBody`，池化 UTF-8 缓冲、还原 zstd/gzip/br/deflate，未改写就原样转发）→ 插件中间件 → **隐私护栏**（`PrivacyGuardService`：发上游前检测 API key/邮箱/内网地址，可警告/拦截/脱敏，响应回来再还原）→ 模型与端点解析（`EffectiveModelResolver`）→ 上游（`Upstream.cs` 按协议拼 URL、按代理设置复用长活 `HttpClient`）→ 流式/缓冲 → 用量落库（`UsageWriter`）。

其中与「反代靠不靠得住」直接相关的三块：
- **`UpstreamAuthResolver`** —— 上游鉴权解析：**静态 key 或订阅 token**；401 后**强制刷新一次**；`FailOverAsync` 冷却并把 provider 当前账号切走。
- **`AccountScheduler` + `StickyKeys`** —— 多账号调度：`Pick` = 最少在途 → 最近最少分配 → `SortOrder`；会话粘性靠 `StickyKeys` 取身份（Chat/Responses 用 `prompt_cache_key`、Anthropic 用 session id、否则 system + 首条 user 指纹）。**正是社区 WorkBuddy 那批「账号池轮转 + 会话粘性 + 熔断冷却」的 C# 成熟版。**
- **`ClaudeCodeDetector` / `ClaudeCodeMimicry` / `ClaudeOAuthHeaders`** —— 判断调用方是不是真 Claude CLI，不是就**伪装成它**（header / beta 策略分 relay 与 compat 两路）。**⇒ 这就是老大说的「算法逆向自官方客户端」那一步的完整落点，可直接读。**

**③ `Astra.Providers/Subscription/` —— 用订阅账号而非 API Key 调上游**

`OAuthClient` / `SubscriptionOAuth` / `SubscriptionTokenService` / `CodexAuthFile` / `XaiSsoDeviceFlow` / `LocalCopilotLogin`。**⇒ 对应我们「客户端不好用但模型可用」的核心诉求：不拿 API Key，拿订阅身份。**

**★ 直接命中 R-3 第二家：WorkBuddy（实读 `src/Astra.Clients/Adapters/WorkBuddyClientAdapter.cs`）**

> 这条**推翻了我此前的一条推测**，必须记下：11:33 我从社区那 5 个项目反推「WorkBuddy 鉴权疑走账号 + 成长任务积分」。Astra 的适配器实读显示 —— **至少「把模型接进来」这一侧讲的是标准 OpenAI Chat Completions + apiKey**，有明确的配置文件契约。**接入面不需要逆鉴权。**

| 项 | 事实 |
|---|---|
| 是什么 | **腾讯的 AI 工作 agent**（类注释原文：`Tencent's AI work agent`）；有**中国版**与**国际版**（`workbuddy.ai`，独立客户端） |
| 配置落点 | 中国版 `~/.workbuddy/models.json`；国际版 `~/.workbuddy-ai/models.json` |
| schema 来源 | **沿用 CodeBuddy 的 `models.json` 格式**（`codebuddy.cn/docs/cli/models`）—— **但目录不是 CodeBuddy 的 `~/.codebuddy`**（0.3.1 之前 Astra 写错过，留了 legacy 清理逻辑） |
| 硬约束 | **daemon 拒绝裸数组文件**；`url` 必须是**完整的 Chat Completions 路径**（`<gateway>/v1/chat/completions`）；文件**热重载** |
| 条目结构 | `{id, name, vendor, url, apiKey, supportsToolCall, maxInputTokens, maxOutputTokens, supportsImages, supportsReasoning}` |
| 隐藏坑 | 用户若设了 `availableModels` 过滤器，新加的模型**会被藏起来**，必须同时加进去 |

**⇒ 对我们 R-3 的含义**：WorkBuddy 这条**存在一条「正向接管」的捷径**（把我们的端点作为自定义模型塞进它的 `models.json` + 用我们发的本地 key），与「反向吐成 OpenAI 兼容」是两条路线，**开工前要选**。

**④ `Astra.Clients/Adapters/` —— 26 个适配器**：`ClaudeCode` / `Codex` / `GeminiCli` / `OpenCode` / `QwenCode` / `Zed` / `Crush` / `Droid` / `KimiCode` / `MiniMaxCode` / `MuseCode` / `GrokBuild` / `CopilotCli` / `VsCodeCopilot` / `ClaudeDesktop` / **`WorkBuddy`** / **`NextCoWork`** 等 —— 全是「代写客户端配置 + 随时完整还原」的成熟做法，将来若要给用户做「一键接管客户端」可直接借。

**风险与边界**

1. **许可 MIT** ⇒ 代码级参考没有法律障碍；**但仍按 11:34 口径执行**：只借**协议 / 鉴权 / 调度 / 伪装**的经验，**最终落进我们自己的软件**，**不照搬它的外部部署形态**（Docker / npm 全局包 / 独立端口 `17321`）。
2. **很新**（创建到最近 push 只有 8 天，30★）⇒ 活跃但**未经时间检验**，不宜当唯一参照。
3. **产品形态与我们重叠**（它也做客户端接管 + `SystemProxy.cs` 写系统代理）⇒ 参考它的**实现**，**别把它的产品形态当我们的目标形态**。
4. 与社区那 5 个 WorkBuddy 项目的关系：**Astra 是第 6 个参考源，且是唯一 C# 的**，只是**方向相反** —— 社区那批是「把 WorkBuddy 的模型反代出去」，Astra 是「把网关接进 WorkBuddy」。**两个方向都要看。**

### ★ 参考源 · astra-gate-plugins（WorkBuddy 上游唯一源码级实现，2026-10-22 追加）

> 来源：老大 2026-10-22 09:07 给出 `239573049/Astra-Gate`，要求判 A 形态可行性。顺着 Astra 的插件机制挖到这个子仓库 —— **Astra 主体里没有 WorkBuddy 上游 provider**，真正的实现在这里。

**元数据**

| 项 | 事实 |
|---|---|
| 仓库 | `astragate-community/astra-gate-plugins` |
| 语言 / 许可 | **JavaScript**（ESM，`.mjs`）｜ **Apache-2.0** |
| 规模 / 热度 | 1★ ｜ 最近 push **2026-10-20**（很新） |
| 目标包 | `packages/workbuddy/` —— 15 个源文件 + README + `shape.json` |
| 溯源 | README 自称 "Based on an MIT-licensed community plugin (see THIRD_PARTY_NOTICES.md)" ⇒ 再溯源自某 MIT 社区插件，移植无许可障碍 |

**★ 为什么它是本轮最有价值的一条**

它是**唯一一份「把 WorkBuddy 当上游」的公开源码**，且其 README 是 **2026-10-20 真账号实测记录**，不是推测：

- 契约写死：`POST <endpoint>/v2/chat/completions`、**只接受流式**、十余个必需请求头（缺 `User-Agent: WorkBuddy/5.5.6` 直接报 `10085`）
- 鉴权写死：`POST /v2/plugin/auth/state` → 浏览器登录 → 轮 `/v2/plugin/auth/token` → 轮 `/v2/plugin/login/account`
- **没有任何加密签名环节** —— 与 Qoder 的 DPAPI + AES-256-GCM + COSY 完全不是一个量级
- 出站方言与工具 schema 四种畸形修正全部列出（不修报 `11133`）
- 错误码语义：`11140` 账号被限制、`14018` 无套餐即拒、`unapproved channel` 内容指纹检测
- 模型清单：中国版 15 个（含 `deepseek-v4-pro` / `glm-5.3` / `kimi-k3-1` / `minimax-m3`，多数 100 万上下文）、国际版 16 个（含 `gpt-5.5` / `gpt-5.4` / `gemini-3.1-pro`）

**它推翻的两条旧推断**

| 旧登记 | 现结论 |
|---|---|
| 「`daemon` 拒绝裸数组」`models.json` | 那是**正向接管**（把我们的端点塞进它的配置）才相关；我们走**反向调用**，根本不碰 `models.json` |
| 「鉴权疑走账号 + 成长任务积分」 | 接入面走 **OAuth token**，与签到/成长任务无关；签到接口在参考实现里**自己标注未对真账号验证** |

**与其它参考源的关系**

- **`239573049/Astra-Gate`（主体）**：方向相反（把网关接进 WorkBuddy），且 30+ 个 provider 模板里**没有 WorkBuddy** ⇒ 对 R-3 的 WorkBuddy 部分**用不上**。
- **本包**：方向正确，是 A 形态的**直接蓝本**。
- **社区 5 个 `workbuddy2api` 系**：仍是「起服务反代出去」的 B 形态思路，与本包不在一个层面 —— 它们的价值在**多账号池 / 防风控经验**，不在协议实现。

**⇒ 落点**：契约细节已完整落入 `docs/plans/iter-v3-1/requirements/S-218.md`。本仓**只借协议与鉴权经验**，实现落进我们自己的 provider 层（A 形态，不起服务、不占端口、不暴露端点）。

### ★ 参考源 · waygate-qoder（Qoder 主参考，源码级，2026-10-15 14:03 追加）

> 老大原话：「`https://github.com/zhanghaojie513/waygate-qoder` 这个是qoder 的反代参考代码」
> 下表为**实读**（2026-10-15 用 `gh api` 拉仓库元数据 / 完整文件树 / `README.md` / `package.json` / `src/credential.ts` / `src/protocol/cosy.ts` / `src/protocol/translate.ts` / `src/models.ts`，非二手转述）。

**元数据**

| 项 | 事实 |
|---|---|
| 仓库 / 包 | `zhanghaojie513/waygate-qoder` ｜ npm `waygate-qoder` ｜ 命令 **`qoc`** ｜ 版本 **0.2.2** |
| 描述 | 「Qoder CN 本地反代：**读取本机客户端登录态**，提供 Anthropic / OpenAI 兼容的本地聊天端点（命令 `qoc`）」 |
| 语言 / 许可 | **TypeScript**（纯 Node，无原生依赖）｜ **MIT** ｜ 要求 **Node ≥ 20** |
| 规模 / 热度 | **46 文件**、183 KB（含 `dist/`）｜ **0★ / 0 fork** ｜ 创建 **2026-10-13**、最近 push **2026-10-14**（**只有两天大**） |
| 平台 | **仅 Windows** —— 凭证走 **DPAPI**（Windows 专有）；README 明写「暂只支持 Windows」 |
| 依赖 | **同一作者的 `waygate-core` ^0.2.4**（共用骨架）⇒ 读它要连 core 一起读 |

**它做的事（一句话）**：把本机已登录的 **Qoder CN 桌面客户端**的订阅额度，变成本机的 **Anthropic / OpenAI 双协议**端点 —— Cursor / Claude Code / Cherry Studio / 任何能改 `base_url` 的工具直接可用。

**暴露的端点**：`POST /v1/chat/completions`（OpenAI 兼容）· `POST /v1/messages`（Anthropic 兼容，对应 Claude Code 的 `ANTHROPIC_BASE_URL`）· `GET /v1/models` · `GET /healthz`；**流式 SSE 与非流式（`stream:false` 自动聚合成单个 JSON）都支持**；默认端口 **8789**。

**★★ 最有价值的两块（就是老大说的「算法逆向自官方客户端」的成品）**

**① 凭证链路 —— `src/credential.ts`，整条可抄**

客户端数据目录 `%APPDATA%\com.qodercn.app.stable`（可用 `QODER_APP_DIR` 覆写）。解密链：

```
Local State 的 os_crypt.encrypted_key（base64，去前 5 字节 "DPAPI"）
  → DPAPI Unprotect（CurrentUser）→ 32 字节 AES key
  → 解 auth.v1.dat：[3B "v10"][12B nonce][ct…][16B tag]（AES-256-GCM）
```

- 解出的身份材料：`{ token(dt-…), refreshToken(drt-…), uid, name, userType }`；落 `~/.waygate/qoc/credential.json`（**0600**）。
- 文件头注释写明「与社区实现同源、本项目生产验证过」。
- **⇒ 对我们的直接收益**：它是走 PowerShell 子进程调 `[Security.Cryptography.ProtectedData]::Unprotect` 来避原生依赖；**我们 .NET 侧有 `System.Security.Cryptography.ProtectedData`，同一套逻辑可以写得更干净（无需子进程）**。这一环我们几乎不用自己逆。

**② COSY 协议 —— `src/protocol/cosy.ts`，原语齐全**

- 自述来源：**「全部算法**逆向自官方客户端** + 社区参考实现（`EchoPing07/Qoder-2API-Go` 的 `auth.go`）」，并**于 2026-10-11 对真网关实弹验证**（`model/list` / `user/status` / `chat` 三发三中）。
- **指纹常量集中一处**（注释明说「客户端升级漂移时只改这里，单测钉住」）：`QODER_CLI_VERSION = '1.1.61'`（取自 `.qoder-cn/logs/runs/manifest.json`）、`QODER_COSY_VERSION = '0.1.43'`、`QODER_CLIENT_TYPE = '5'`（CLI 形态）、出站 UA `qodercli/<ver> node/<runtime>`、`QODER_LOGIN_VERSION = 'v2'`。**⇒ 反代最脆的一环（指纹漂移）有现成的集中管理范式。**
- **自定义 base64**（`qEncode` / `qDecode`）：字母表替换（64 字符表，字母表常量在源码里）+ **三段轮转**（`a = floor(n/3)`，重排 `std[n-a:] + std[a:n-a] + std[:a]`）+ `'=' → '$'`。
- **会话**：网关 **RSA 公钥写死在客户端里**（源码内置），用来加密临时 AES key；凭证**只进 AES 加密的 info 块**。
- **出站纪律**：所有请求头由该模块构造、**绝不透传入站头**；凭证**不落日志**。**⇒ 这条纪律我们要照抄。**
- 上游网关 `https://gateway.qoder.com.cn`；chat 端点 =
  `/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`（`Encode=1` ⇒ 请求体走上面的自定义编码）。

**③ 其余文件**：`protocol/translate.ts`（OpenAI Chat → Qoder `agent_chat_generation` 的出站翻译，含 system 并入首条 user、`role:"tool"` 序列化、`tool_calls` 不回灌、参数 verbatim 透传、`max_tokens` 缺省补 8192、`reasoning_effort → model_config.is_reasoning`）、`protocol/stream-decode.ts`（自定义 SSE 帧 → 标准 OpenAI SSE）、`models.ts`、`activity.ts`、`adapter.ts`、`errors.ts`；**4 个 `.spec.ts` 单测**（`vitest`）。

**④ 模型清单 —— 真接口，不是内置假清单**：`/algo/api/v2/model/list?Encode=1`；网关给「显示名 ↔ 内部 key」映射，**客户端请求里传的是内部 key** ⇒ **模型 id = 内部 key**、`displayName` = 显示名；`enable=false` 跳过。实测 14 个（`qmodel_38max` Qwen3.8-Max / `qfmodel` Qwen3.8-Flash / `qmodel` Qwen3.7-Plus …）。

**⑤ 另有 OpenAPI 面**：`openapi.qoder.com.cn`，只用客户端登录态里的 Bearer 令牌 —— `qoc checkin`（**每日签到领 100 Credits，不用开客户端、也不顶掉桌面登录**）、`qoc credits`（剩余积分来自 `v2/me/usage` 的 `addOnQuota` 资源包 + `userQuota` 套餐内；累计消耗 = `credits-summary.totalCredits`，近 371 天之和，**账号级口径**）。**⇒ 顺带能做「用量 / 额度」展示。**

**⑥ 其它命令**：`qoc models` / `qoc doctor`（自检：端口 / 凭证 / 模型清单 / 上游连通）/ `qoc login`（重读客户端登录态）；参数 `--port` / `--host` / `--key` / `--json` / `--verbose`。

**⚠️ 必须记住的上游已知缺陷（否则我们会当成自己的 bug 查半天）**

> **大上下文时偶发「HTTP 200 但零字节」** —— README 明写这是 **Qoder 网关的已知现象**，**实测 2.7 万 token 时会先空转近 30 秒才断流**。本工具的策略：**自动重发一次（最多 1 次）**，客户端只会感到响应稍慢，不会收到半截内容。⇒ 我们实现时**必须带上同样的重发兜底**。

**同作者另三个仓（2026-10-15 一并记下，未逐一核实）**

| 仓库 | 说明 |
|---|---|
| `zhanghaojie513/waygate-core` | 上述两个工具**共用的骨架**（npm `waygate-core`）⇒ 读 `waygate-qoder` 要先看它 |
| `zhanghaojie513/waygate-mmcode` | **同款工具，对应 MiniMax Code**（`npm i -g waygate-mmcode`）—— **这与 `Astra.Clients/Adapters/MiniMaxCodeClientAdapter.cs` 是同一个客户端**，两家参考源在此交汇 |
| `zhanghaojie513/relay-station` | **完整多提供商反代**（含控制台、用量统计）—— 比单客户端工具更接近我们想要的形态 |

**风险与边界**

1. **极新**（创建到最近 push 只有两天）＋ **0★** ＋ 单人维护 ⇒ **未经时间检验**；但代码质量**看着是认真的**（单测齐全、注释讲清不变量与口径、错误一律抛人话描述的 `CredentialError` / `UpstreamError` 而不抛栈）。
2. **仅 Windows** —— 对我们无损（主战场 Windows）。
3. 作者自声明「**仅供个人学习与研究**使用，上游接口随时变更，届时可能失效」。**⇒ 越加印证我们的「隔离与降级」要求：别把主链路绑死。**
4. **形态对照**：它是 **npm 全局 CLI + 独立端口 8789**，我们是「**落进自己软件**」⇒ **仍按 11:34 口径：只借实现，不借形态。**

**源流备注（与 `Qoder-2API-Go` 的关系）**：`cosy.ts` 与 `translate.ts` 的注释都点名参考了 `EchoPing07/Qoder-2API-Go` 的 `auth.go`，且注释写明参数策略「与社区实现一致」⇒ **两者是源流关系**：`Qoder-2API-Go`（Go，社区原始实现）**是源**，`waygate-qoder`（TS）**是经真网关生产验证的后继** ⇒ **Qoder 主参考改用 `waygate-qoder`**，`Qoder-2API-Go` 降为**源流备查**（老大 2026-10-14 09:46 点名的 `auth.go` 仍可对照读）。

**Qoder 源流参考（实测元数据，老大 2026-10-14 09:46 最初点名）**

| 项 | 事实 |
|---|---|
| 仓库 | `EchoPing07/Qoder-2API-Go` |
| 描述 | 「将 Qoder 的 AI 服务转化为兼容 Openai 格式的 API」 |
| 语言 / 许可 | Go / **MIT** |
| 热度 / 活跃度 | 58★；创建 2026-07-22，最近 push **2026-10-07**（活跃） |
| 老大点到的文件 | `auth.go`（鉴权链路） |

**待勘察（开工前）**

1. ~~先做哪家~~ **已定案：先做 Qoder**（老大 2026-10-14 09:53：「反代先做 qoder 啊」）；**第二家已知为 WorkBuddy**（老大 2026-10-15 11:29 追加登记，见上「待反代的客户端清单」）。剩余：后面还有哪些家（各家算法与鉴权各一份，维护成本是叠加的）。
   - **WorkBuddy 另有 5 个参考实现**（老大 2026-10-15 11:33 给出，见上「WorkBuddy 反代参考实现」表）—— 开工前**逐条核实**（存在性 / 许可 / 活跃度 / 代码质量 / 是否可直接复用或仅作协议参考）。
   - **★ WorkBuddy 有两条路线要选**（2026-10-15 11:45 由 Astra 源码实读发现）：**正向接管**（把我们的端点作为自定义模型写进 `~/.workbuddy/models.json` + 用我们发的本地 key）vs **反向吐出**（把 WorkBuddy 的模型转成 OpenAI 兼容给别的客户端用，= 社区那 5 个项目的做法）。**接入面契约 Astra 已给出**（见上 Astra Gate 一节的 WorkBuddy 小节），走正向的话**不需要逆鉴权**。
   - **★ Qoder 这一家的实现路径已基本不需要自研**（2026-10-15 14:03 实读 `waygate-qoder`）：**凭证解密链（DPAPI + AES-256-GCM）+ COSY 签名协议 + 自定义 base64 + 出站翻译 + SSE 流解码 + 模型清单**六块**全部现成**，且**已对真网关实弹验证过**（2026-10-11，model/list / user/status / chat 三发三中）⇒ 我们做的是**移植到 .NET 侧 + 按我们自己的 provider 形态收口**，不是从零逆。
   - **顺手记一条硬事实**：我们 .NET 侧解 Qoder 凭证**可以比它更干净** —— 它走 PowerShell 子进程调 `ProtectedData::Unprotect` 是为了避原生依赖，我们直接用 `System.Security.Cryptography.ProtectedData` 即可。
2. **形态**：独立反代进程（本地 http 服务）vs 直接在我们的 provider 层实现该服务协议。
   - **★ 已定口径（老大 2026-10-15 11:34）**：**「最终实现方案是弄到我们软件中」** ⇒ 参考项目（含 WorkBuddy 那 5 个）**只借协议与鉴权经验**，**最终落进我们自己的软件**，**不是**照搬它们的外部部署形态（PyPI / `uv` / Docker / 独立端口）。上面待定项里「独立反代进程」这一支**据此基本排除** —— 倾向**在我们的 provider 层内实现该服务协议**（待开工时最终确认）。
   - **★ 现成先例（2026-10-15 11:45）**：**Astra Gate 就是这么干的** —— 一个 .NET 服务作为反代本体内嵌在 Electron 桌面端里（装包内置服务端，命令行 / 托盘管生命周期）。⇒ 「落进我们软件」这条口径**有可直接对照的实现样本**，不是空想；它的 `Astra.Gateway` + `Astra.Server` 分层可以照抄。
3. **鉴权链路**：官方客户端 token 的获取与刷新方式、失效后的表现。
   - **★ Qoder 侧已由 `waygate-qoder` 给出答案（2026-10-15 14:03）**：token 形态 `dt-…` + 刷新令牌 `drt-…`，来源是**本机客户端登录态文件**（**不是**自己走 OAuth 登录）；失效时的表现与处置是「**在客户端重新登录 → 跑一次 `qoc login` 重读**」，`qoc doctor` 负责自检。**⇒ 也就是说它不自己维护刷新，靠客户端** —— 这一取舍我们要不要跟，是开工时要定的一个点。
   - **★ 另可先读 Astra 的四件套（2026-10-15 11:45）**：`UpstreamAuthResolver`（静态 key / 订阅 token 双路 + 401 强制刷新一次 + `FailOverAsync` 冷却切账号）、`Astra.Providers/Subscription/*`（`OAuthClient` / `SubscriptionOAuth` / `SubscriptionTokenService` / `CodexAuthFile` / `XaiSsoDeviceFlow` / `LocalCopilotLogin`）、`AccountScheduler` + `StickyKeys`（多账号调度与会话粘性）、`ClaudeCodeDetector` / `ClaudeCodeMimicry` / `ClaudeOAuthHeaders`（**伪装成真 Claude CLI** 的 header / beta 策略，分 relay 与 compat 两路）—— 这几块正是「非官方端点怎么稳住」的核心，**C# 原样可读**。**⇒ 与上面 §3 第一条正好互补：Astra 给「自己做刷新与多账号」的范式，waygate 给「寄生客户端登录态」的范式，两条路要选。**
4. **稳定性与风险**：非官方端点，官方一变就可能作废（当年否掉云端 TTS 的同类理由）⇒ 需要给出隔离与降级策略，别把主链路绑死。
   - **★ 已知上游缺陷，必须一并兜住（2026-10-15 14:03）**：Qoder 网关**大上下文时偶发「HTTP 200 但零字节」**，**实测 2.7 万 token 会先空转近 30 秒才断流**；`waygate-qoder` 的对策是**自动重发一次（最多 1 次）**。我们实现时**必须带同样的重发兜底** —— 否则线上会表现为「莫名其妙空回复」，且极易被误判成我们自己的 bug。
   - 另一条相关风险：**指纹漂移**（CLI 版本 / COSY 版本 / UA 随官方客户端升级而变）⇒ 学 `cosy.ts` 的做法，把版本字典**集中一处 + 单测钉住**。
5. 各家的差异与维护成本盘点。
   - **★ 已有两条结构不同的范式可对照**：①**寄生客户端登录态**（`waygate-qoder`：读本机文件解凭证，自己不登录）；②**网关代管账号与订阅**（`Astra`：`Astra.Providers/Subscription/*` 自己做 OAuth / token 刷新 / 多账号调度）⇒ 各家该走哪条，开工时逐家定。

---

## R-4 · 插件体系：Type A 能力插件 + Type B 带 UI 插件（2026-10-27 追加）

**老大口径（原话）**

> 「这个能听我的想法就是这个不属于我们这个项目，而是走通用插件的形式，加载进来使用」（2026-10-27 13:49）
> 「插件分几种，一种是目前的给 agent 用的插件。另一种就是带 UI 属于用户自己使用的。**这种插件的 UI 是插件自带**」（13:57）
> 「先只做 window（独立窗口），够「能听」用，也不用动主区的页面路由」（14:00）
> 「其实插件我不太想去弄白名单这些，**能开放的越多越好**。它如果能弄坏我们主程序 说明是我们的问题。**安装是用户自己点的，要确认**」（14:00）

**一句话**：把「模型类能力」（听 / 说 / 以后类似的东西）从主程序里剥出去，做成可安装、可卸载、自带 UI、资产按需下载的插件；`R-1` 听 是第一个落地品。

### ★ 范围切分：本仓只做基座，插件本身是另一个项目（老大 2026-10-27 14:06 定）

> 「所以我们要做的是基座，+ 迭代里面本身的需求，至于怎么录音 怎么转写，怎么识别 那是另一个项目的事情。」

⇒ **两个项目，边界写死：**

| 归属 | 做什么 | 不做 |
|---|---|---|
| **本仓 `wishful-claw`** | **插件基座** —— manifest 加载、导轨入口、独立窗口承载、资产下载器、生命周期、**录音采集能力**、安装与确认 | 不做转写、不做说话人识别、不做会议纪要、不写会议界面 |
| **另一个项目（独立）** | `speech-to-text` 插件本体 —— 会议 UI、QwenASR 子进程调用、sherpa-onnx 说话人分割、时间戳对齐、纪要生成 | 不碰主程序；只依赖基座暴露的 API |

**唯一跨界的例外：录音采集必须在基座。** 因为 Windows 的**系统内录**（会议对面的人）在 webview 里拿不到干净 loopback 音频，只有 Electron 主进程的 `desktopCapturer` 能做 —— 插件做不到。所以基座提供「把麦克风 / 系统音频录成流或文件」这一格能力，**至于录下来怎么转、怎么识别，全在插件**。

### 两类插件（同一条 manifest，不同贡献点）

| 类型 | 给谁用 | 贡献点 | 入口 |
|---|---|---|---|
| **Type A · 能力插件** | agent | `tools[]`（http / js）、`mcpServers{}`（stdio / SSE / streamable-http） | 会话里由模型调用 |
| **Type B · UI 插件** | 用户 | `views[]`（`mode: "window"`，插件自带 HTML） | 导轨一级入口 + 独立窗口 |

**定案：不做两套加载器/两套配置/两套存储。** 同一个 `extension.json` 两块都能有；语音插件两头都占（agent 可调 `transcribe_file`，用户可开「会议记录」窗口）。

### 现状勘察（2026-10-27 实测，非推测）

| 事实 | 位置 | 含义 |
|---|---|---|
| **已有「自定义扩展」体系** | `src/shared/extension-types.ts`（`ExtensionManifest`） | manifest 驱动、install-from-folder、update / remove、私有 KV（`extension:storage-*`）、`configSchema` 表单、聚合资源（`skills` / `agents` / `commands`） |
| **已支持挂子进程** | `ExtensionManifest.mcpServers` | `stdio` 可给 `command` / `args` / `env` / `cwd` ⇒ **「插件带一个 exe」这条路已经通了** |
| **已支持插件自带 HTML** | `ExtensionRendererDefinition` / `ExtensionComponentDefinition`（`type: 'html'`、`entry`） | 但只用于**聊天窗里的卡片**，不是独立功能页 |
| MCP 通道成熟 | `src/main/mcp/mcp-client.ts`（`StdioClientTransport`，握手超时）+ C# `AgentRuntimeMcpExecutor` | 子进程生命周期与 JSON-RPC 现成 |
| `webviewTag: true` | `src/main/index.ts:123` | 外部 UI 载体基础在 |
| **内置插件是硬编码四个** | `src/renderer/src/lib/app-plugin/types.ts:75`（image / browser / desktop-control / codegraph） | `AppPluginId` 是字面量联合、`builtin: true` 写死 ⇒ **不可外部加载** |
| **`requiresDownload` 是死字段** | 声明于 `types.ts:61`，唯一消费点 `AppPluginPanel.tsx:174` 且读的是 codegraph 的 `false` | **零下载实现**，「资产按需下载」这块是空的 |

### 三个缺口（要造的地基）

1. **资产清单 + 下载器** —— manifest 无 `assets`；需声明 `{id, kind, url, sha256, size, dest}`，主程序统一下载（断点续传 / sha256 校验 / 进度事件 / 失败重试）。**校验保留**：防残包与投毒，属数据完整性，不是权限墙。
2. **独立视图** —— `views[]` 新增，`mode: "window"` 开独立 `BrowserWindow`；导轨那一项、窗口标题、图标、分类全来自 manifest，**主程序不认识「语音」**。
3. **进程生命周期** —— 启用即起 / 关窗保持（会议中重开要快）/ 空闲回收（QwenASR 常驻内存峰值 3.3 GB，必须能收）。

### 权限与隔离定案（老大 2026-10-27 14:00 ~ 14:03）

| 项 | 定案 |
|---|---|
| 插件权限 | **全开放**，不做白名单、不做能力矩阵 —— 按 VSCode 扩展模型：插件直接拿完整 Node / 主进程能力 |
| 窗口配置 | `nodeIntegration: true` / `contextIsolation: false` / `sandbox: false`；`partition: persist:plugin-<id>` 仅为自己保留登录态与缓存 |
| 进程隔离 | **Electron 自带**（每个 BrowserWindow 独立渲染进程）—— 插件崩溃 / OOM 只死自己，不拖主程序；零额外成本 |
| `wishful` 便利 API | **降级为可选糖**：资产路径、统一下载进度、系统录音流。插件想用就用，不想用直接 `child_process` / `fetch`，不强求 |
| 安装确认 | **必须**：文件夹安装后显示一行说明（第三方插件，可访问你的文件与程序，请确认来源可信）+ 勾选确认。**确认不叫风险墙**，是让用户知道自己在装什么；装完干什么不管 |
| 资产路径 | 不给裸路径限制（插件已能任意 exec，限制无意义）；只有下载校验仍由主程序做 |

**为什么不设防（老大 2026-10-27 14:03 定，记档免得以后再争）**：

> 「我们软件就在用户电脑上，如果说能偷走数据，那也是用户自己安装了插件的。避免不了的东西，没必要去防。」

理由比这还硬一层：**我们自己的 agent 本来就有 full 文件读写 + 命令执行**（`execute_command`、任意路径读写），跑在同一个用户权限下。插件能拿的东西 agent 现在就能拿 —— 防插件等于防自己。**攻击面在软件装到用户机器上那一刻就定了，跟插件无关。**

⇒ 本方向**不做任何插件权限限制**，也不打算做。唯一保留的是「安装时让用户知道自己在装什么」。

**真正要管的不是安全，是工程质量**（写得烂的插件才天天咬人）：

| 问题 | 处置 |
|---|---|
| 内存不释放（QwenASR 常驻峰值 3.3 GB） | 空闲回收 + 显式释放接口 |
| 窗口崩了不重启 | 崩溃自愈：`render-process-gone` 后可重开同一视图 |
| 卸载留垃圾 | 卸载清理：插件目录 + `persist:plugin-<id>` 分区 + 私有 KV 一起删 |
| 占端口不放 / 子进程没退出 | 插件停用或主程序退出时按 pid 树收子进程 |
| 启动卡主程序 | 视图加载不阻塞主窗口首屏 |

### 录音：为什么必须由基座提供

- **麦克风**：webview 权限请求由 `session.setPermissionRequestHandler` 放行；因权限全开，实为自动放行。
- **系统内录（会议对面的人）**：webview 里的 `getDisplayMedia` 在 Windows **拿不到干净的 loopback 音频** ⇒ 只能主进程 `desktopCapturer` + loopback 采集，再把音频流 / 文件交给插件。

⇒ **基座只提供「采」，不提供「懂」**：采到什么、怎么切段、交给谁转写，全在插件项目。这块做成了，任何录音类插件都免费用。

### 目录形态

```
%APPDATA%/wishful-claw/extensions/<plugin-id>/
├── extension.json
├── views/meeting/{index.html, assets/*.js}
├── bin/qwen-asr.exe              ← 下载
├── bin/sherpa-onnx-*.dll         ← 下载
└── models/{qwen3-asr-0.6b, diarization}/   ← 下载
```

### 与 R-1 的关系

`R-1` 听 **不再走「内置进主程序」，也不再由本仓实施** —— 它是**另一个项目**（详见上方「范围切分」）。本仓交付的是**让这种插件能跑的基座**；`speech-to-text` 插件作为**第一个验证品**，用来证明基座够用。

说话人区分方案不变（属插件项目内部实现）：**QwenASR 转写（`--json` 词级时间戳）+ sherpa-onnx 说话人分割，按时间重叠对齐**；两样引擎与模型都属插件自己资产，由基座 `assets` 清单驱动下载。

### 基座成品清单（本仓的交付物，即「插件基座」的范围）

| # | 能力 | 说明 |
|---|---|---|
| 1 | **manifest 加载** | 扩展 `ExtensionManifest`：新增 `views[]` / `assets[]`；`schemaVersion` 处理；从文件夹安装已有，直接复用 |
| 2 | **导轨入口自动生成** | `views[].nav` 驱动，主程序不认识具体功能；`order` 控排序 |
| 3 | **独立窗口承载** | `mode: "window"` → 独立 `BrowserWindow`，权限全开（见定案表） |
| 4 | **资产下载器** | 声明式清单 → 断点续传 / sha256 校验 / 进度事件 / 失败重试 / 下载 UI |
| 5 | **录音采集** | 麦克风 + **系统 loopback**（Windows 唯一可行路径）+ 设备选择 + 分段输出（流或 wav 文件） |
| 6 | **生命周期** | 启用即起 / 关窗保持 / 空闲回收 / 崩溃自愈 / 停用与退出时按 pid 树收子进程 |
| 7 | **卸载清理** | 插件目录 + `persist:plugin-<id>` 分区 + 私有 KV 一起删 |
| 8 | **安装与确认** | 文件夹安装 + 一行说明 + 勾选确认（见定案表） |

**验收方式**：用一个**假插件**（只有一个按钮 + 一次资产下载 + 一段录音）证明八条都能跑通，再交给插件项目。

### 未决 / 待办

1. `views[].mode` 的 `panel`（主区内嵌）**本阶段不做** —— 要动 `activeNavItem` 那套陈旧路由（`FEATURE_PAGES` 已是死配置），牵连多。
2. 插件市场 / 签名 / 版本升级策略 —— **未定，本阶段不做**；先支持「从文件夹安装」。
3. `schemaVersion` 是否升到 2（新增 `views` / `assets`）—— 需与 `ExtensionManifest` 现有 v1 兼容性一起定。
4. 内合内置插件（image / browser / desktop-control / codegraph）是否改造成 manifest 驱动 —— 未定，不阻塞。

---

## H-1 · Harness 工程参考（方法论，**非功能方向**，2026-10-15 14:07 追加）

> **老大原话**：「**https://walkinglabs.github.io/learn-harness-engineering/zh/ 这个也收藏一下，也是大版本需要去考虑的事情**」。
> **性质**：**R 系三条是「要做什么功能」，`H-1` 不是功能** —— 它是「**我们这套 harness（我们自己这个 agent 应用）该怎么设计才可靠**」的理论与模板参考。**不进迭代、不占 `S-xxx`、不影响 1.0 节奏。**

### 站点与仓库元数据（已实测）

| 项 | 值 |
|---|---|
| 站点 | `https://walkinglabs.github.io/learn-harness-engineering/zh/`（VitePress；**17 种语言**：zh / en / zh-TW / ja / es / fr / de / tr / ar / vi / ko / uz / ru / pt-BR / uk …） |
| 仓库 | `walkinglabs/learn-harness-engineering` —— **⭐ 19,876 / 🍴 2,186**，**MIT**，TypeScript，30 MB |
| 时间 | 创建 **2026-03-29**、最近 push **2026-10-01**（活跃，非弃坑） |
| 描述 | "Harness engineering beginner tutorial, from 0 to 1" |
| Topics | `agent` / `ai-agents` / `harness` / `harness-engineering` / `harness-framework` / **`dsh`** / **`dsh-plugin`** |
| 同作者 | `walkinglabs/awesome-harness-engineering` —— **⭐ 4,400 / 🍴 420**，创建同一天、push 2026-08-19，"🛠️ Awesome tools & guides for harness engineering" |
| 理论源头 | OpenAI《Harness engineering: leveraging Codex in an agent-first world》＋ Anthropic《Effective harnesses for long-running agents》《Harness design for long-running application development》 |

> **`dsh` / `dsh-plugin` 两个 topic 值得留意**：`DSH` = **DeepSeek Harness**，而**我们本地就有 `D:\claw\deepseek-harness`**（= 官方 `deepseek-ai/deepseek-harness`，HEAD `4878cdab`，2026-09-28 `release(dsh): 0.2.0-rc.1`；iter-30 的源流蓝本）⇒ 这个课程与我们在看的 DSH 生态**是同一个圈子**，不是外人视角。

### 它讲什么（四板块）

1. **讲义（14 讲，主目录）** —— 见下表逐条。
2. **项目** —— 动手从零搭最小 harness，P01 = 「提示词 vs 规则驱动」（对比实验）。
3. **资料库 / 模板** —— **8 个开箱模板**（已点开索引确认存在）：`AGENTS.md`、`CLAUDE.md`、`feature_list.json`、`claude-progress.md`、`session-handoff.md`、`clean-state-checklist.md`、`evaluator-rubric.md`、`quality-document.md`；另有 `reference/` 与 `openai-advanced/`。
4. **前沿 Harness 拆解** —— 用本课程框架**逐层拆解 4 家真实 harness**：**Pi** / **Claude Code** / **Codex** / **DeepSeek Harness**。

**首页核心机制图**（它给的最小闭环）：
`AGENTS.md 初始化检查 → init.sh 运行任务 → AI Agent 运行反馈 → CLI/Logs 验证与评审 → Test & QA 清理与交接 →（回到初始，遇障碍自动修复）`

### ★ 为什么与我们强相关：14 讲逐条对上我们的现状

> **这张表是这次登记的重点** —— 它讲的每一条，我们基本都在做，或都踩过坑。**对照着读才知道我们缺哪一环。**

| 讲 | 它讲什么 | 我们对应什么 |
|---|---|---|
| L01 | 模型能力强，不等于执行可靠 | **我们整个迭代史就是这句话的注脚**（换更强模型 ≠ 少踩坑） |
| L02 | Harness 的定义 | 我们的本体：`AGENTS.md` + 三份人格文档 + 记忆 + 工具 + 子 agent |
| L03 | **让代码仓库成为唯一的事实来源** | `docs/plans/iter-*/` 计划与需求文档体系（老大纠正过的「**登记了的需求才有需求编号**」「文档进度滞后」正是这条） |
| L04 | **把指令拆分到不同文件里** | **已按此做**：`AGENTS.md` + `IDENTITY/SOUL/ONTOLOGY.md` + `docs/dev-workflow.md` + `docs/release-workflow.md` 的分工 |
| L05 | 跨会话保持上下文连续 | 记忆系统 + 会话简报 + `.wishful-claw/notes/` |
| L06 | **每次工作前先初始化** | **我们最弱的一环** —— 开工靠老大喂口径，没有 `init.sh` 式的固定开场（⇒ 最值得抄的一环） |
| L07 | 划清每次任务的边界 | 迭代分支 / 需求编号 / 「**讨论态 vs 实施态**」纪律 |
| L08 | 用功能清单约束该做什么 | `raw-requirements.md` + `plan.md` + `requirements/S-xxx.md` |
| L09 | **防止提前宣告完成** | **老大反复纠我的就是这条**（「开工个屁啊，我让你登记」「你操心的太多了」） |
| L10 | 跑通完整流程才算真正验证 | 四道门禁 + 真机复验 + 「39 验 38 → 40 验 39」的链条 |
| L11 | 让运行过程可观测 | Steps 面板 / 子 agent 卡片 / 请求明细 / 耗时统计（S-196 / S-197 / S-200 那批） |
| L12 | 每次会话结束前做好交接 | 「会话简报」+「收尾刀」+ `PROGRESS.md` |
| L13 | 从手动驱动到**自动循环**（loop engineering） | 未做（我们靠人推） |
| L14 | 从单循环到**图工程**（graph engineering） | 半做：子 agent + 队列 + 全局 PM（S-190 那批能力补充） |

### 关联点

- **`H-1` 拆解的 DeepSeek Harness** = 我们本地 `D:\claw\deepseek-harness` 那个项目（= 官方 `deepseek-ai/deepseek-harness`，iter-30 源流）⇒ 它有现成的拆解文可直接读。
- **`H-1` 拆解的 Pi** —— 同一批客户端也出现在 `Astra-Gate` 的适配器清单里（`Astra.Clients/Adapters/PiClientAdapter.cs`）⇒ **与 R-3 的参考源有重叠**，两条线读的是同一个圈子。
- **转正 `1.0.0` 之后要不要按这套方法论重构我们的 harness（尤其 L06 / L13 / L14），是这个 `H-1` 要回答的事**；**现阶段只收藏，不做任何改动。**

---

## 共同口径

- **模型一律不随包** —— 老大 2026-10-14 09:51 口径：「**这些东西都不能随包 主要是都涉及模型，模型再小都是需要一定体积的**」⇒ 凡涉及模型的（R-1 听 / R-2 说）**都不进安装包**，一律走**首次下载**；模型体积**不再是选型门槛**，只影响下载时长与提示文案。
- **模型类能力归插件、不归主程序**（2026-10-27 追加）—— 听 / 说这类「带引擎 + 带模型 + 带界面」的能力，一律做成 `R-4` 的 Type B 插件：主程序只提供**插件加载 / 资产下载 / 独立窗口 / 录音**四件地基，具体功能与 UI 全在插件里。⇒ 主程序不因新增一个模型类能力而变大、变慢、变难维护。
- 三条**都不进 iter-v2-39**（39 是沉淀迭代，只收 bug / 体验优化 / 能力补充）。
- 三条**不影响 1.0 转正节奏** —— 转正 `1.0.0` **已随 iter-v2-40 落地**（2026-10-21 发布 `v1.0.0`；验证链条：38 修 → 39 验 38 → 40 验 39）。⇒ **本文件自 `v1.0.0` 起生效**，此前为登记期。
- 都是**方向登记**，不是定案的实施计划；转正时才按当时的迭代 `raw-requirements.md` 拆成 `S-xxx` 并在本文件留指针。
- **`H-1` 单独一条口径**：它是**方法论参考、不是功能方向** ⇒ 同样**不进任何迭代、不占 `S-xxx`、不影响 1.0 节奏**；它要回答的是「**转正之后我们这套 harness 本身该怎么长**」，与 R 系的功能开发**并行不冲突**。

## 与其他文档的关系

| 文档 | 关系 |
|---|---|
| `docs/plans/iter-v2-34/requirements/S-138.md` | **R-2 的现状**：本机朗读（`window.speechSynthesis` + OneCore 3 音色 + rate/pitch）已实施 |
| `docs/plans/iter-v2-40/requirements/S-206.md` | **同一件东西的另一面**：S-206 要参考的官网背景动画，出处 `https://astra-gate.si/` **就是这个 Astra Gate 项目**（官网即它的宣传页）⇒ S-206 与 R-3 的参考源**是同一个**，别当成两个无关的东西 |
| `docs/plans/iter-v2-27/plan.md:431`、`exploration_findings.md:170` | `QwenASR` **首次出现**处（v3 规划，当时列「不纳入」，未展开） |
| `docs/project-plan.md` | 项目三种形态（桌面 / App 聊天 / 服务器版）—— R-1 / R-2 的「听 / 说」落在桌面形态上 |
