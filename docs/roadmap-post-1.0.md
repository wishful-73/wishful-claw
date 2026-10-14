# 1.0 之后的大方向（post-1.0 Roadmap）

> 本文件登记 **1.0 转正之后**准备做的大方向 —— **不属于任何迭代**、**不占迭代内需求编号（`S-xxx`）**，与 iter-v2-39 无关。
> 每条状态一律从「**登记**」起步；某条**转正**进某个迭代时，才按该迭代 `raw-requirements.md` 拆成 `S-xxx` 正文，本文件只留指针。
> 编号：`R-1` / `R-2` / `R-3`（`R` = Roadmap，与 `S-` 需求编号区分）。
> 来源：**老大 2026-10-14 09:46 口述登记**（每条列原话）。
> 落盘：2026-10-14。**未勘察到底、未定案、未开工。**

---

## 总览

| 编号 | 方向 | 一句话 | 现成基础 | 状态 |
|---|---|---|---|---|
| **R-1** | **听** | 语音转文字：电脑做会议记录 / 纪要 | 老大仓库 **`wishful-73/QwenASR`**（Windows exe ~2.3 MB；模型 0.6B ≈ 490 MB） | 登记 |
| **R-2** | **说** | 渠道发消息时，用户不方便看文字就直接听语音 | **MOSS-TTS-Nano**（0.1B / 有 ONNX CPU 版）；本机朗读 **S-138 已实施** ⇒ 本方向是**升级替换**，不是从零做 | 登记 |
| **R-3** | **反代** | 客户端不好用但模型可用 ⇒ 自建反代转成 OpenAI 兼容 | 参考 `EchoPing07/Qoder-2API-Go`；**先做 Qoder** | 登记 |

---

## R-1 · 听：语音转文字（会议记录 / 纪要）

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

**实现路径（老大口径）**：**算法全部逆向自官方客户端** + 社区参考实现。

**参考实现（实测元数据）**

| 项 | 事实 |
|---|---|
| 仓库 | `EchoPing07/Qoder-2API-Go` |
| 描述 | 「将 Qoder 的 AI 服务转化为兼容 Openai 格式的 API」 |
| 语言 / 许可 | Go / **MIT** |
| 热度 / 活跃度 | 58★；创建 2026-07-22，最近 push **2026-10-07**（活跃） |
| 老大点到的文件 | `auth.go`（鉴权链路） |

**待勘察（开工前）**

1. ~~先做哪家~~ **已定案：先做 Qoder**（老大 2026-10-14 09:53：「反代先做 qoder 啊」）。剩余：后面还有哪些家（各家算法与鉴权各一份，维护成本是叠加的）。
2. **形态**：独立反代进程（本地 http 服务）vs 直接在我们的 provider 层实现该服务协议。
3. **鉴权链路**：官方客户端 token 的获取与刷新方式、失效后的表现。
4. **稳定性与风险**：非官方端点，官方一变就可能作废（当年否掉云端 TTS 的同类理由）⇒ 需要给出隔离与降级策略，别把主链路绑死。
5. 各家的差异与维护成本盘点。

---

## 共同口径

- **模型一律不随包** —— 老大 2026-10-14 09:51 口径：「**这些东西都不能随包 主要是都涉及模型，模型再小都是需要一定体积的**」⇒ 凡涉及模型的（R-1 听 / R-2 说）**都不进安装包**，一律走**首次下载**；模型体积**不再是选型门槛**，只影响下载时长与提示文案。
- 三条**都不进 iter-v2-39**（39 是沉淀迭代，只收 bug / 体验优化 / 能力补充）。
- 三条**不影响 1.0 转正节奏** —— 转正 `1.0.0` **最早 40 迭代**（验证链条：38 修 → 39 验 38 → 40 验 39）。
- 都是**方向登记**，不是定案的实施计划；转正时才按当时的迭代 `raw-requirements.md` 拆成 `S-xxx` 并在本文件留指针。

## 与其他文档的关系

| 文档 | 关系 |
|---|---|
| `docs/plans/iter-v2-34/requirements/S-138.md` | **R-2 的现状**：本机朗读（`window.speechSynthesis` + OneCore 3 音色 + rate/pitch）已实施 |
| `docs/plans/iter-v2-27/plan.md:431`、`exploration_findings.md:170` | `QwenASR` **首次出现**处（v3 规划，当时列「不纳入」，未展开） |
| `docs/project-plan.md` | 项目三种形态（桌面 / App 聊天 / 服务器版）—— R-1 / R-2 的「听 / 说」落在桌面形态上 |
