# S-224 阶段六 验证报告

> 2026-10-26。分支 `dev/v3-iter-1`。

## 1. 结论

**PARTIAL** —— 自动化层全部通过（命名规则、剥离逻辑、协议解析、落盘降级四块共 95 项断言），
门禁全绿；**真机链路 9 项待老大执行**（发图→落盘→重启回显 这条没有自动化替身）。

## 2. 自动化验证（已实跑）

### 2.1 新增三套单测

| 套件 | 断言数 | 覆盖 |
|---|---|---|
| `test:local-media-url` | **44** | 正常解析与编码还原（Windows 路径 / 空格 / 中文）、协议名与 host 校验、空路径与解码失败、**路径形态约束**（相对路径 / `..` 段 / 两种 UNC 前缀）、扩展名白名单（含大小写）、白名单不含可执行类型、兜底分支的 Content-Type 映射、**往返一致性直接 import 渲染端 `filePathToMediaUrl`** |
| `test:chat-image-dir` | **18** | 月目录本地时间 `yyyy-MM`（含月初不被 UTC 挤走）、同字节同名、不同内容/不同 mediaType 不同名、哈希打的是解码后字节（含「文本不同字节相同 ⇒ 同名」的非规范 base64 用例）、扩展名映射、目录拼接 |
| `test:image-payload` | **33** | 有 filePath 剥 data、**无 filePath 必须保留 data**（安全断言）、空白 filePath 不许剥、非图片结构不动、content/segments/toolCalls 三容器、纯函数不改入参、序列化产物不含 base64 头、**`attachChatImagePaths` 五条降级保证**（成功仍留 data / 抛异常降级 / 返回 error 降级 / 已有路径短路 / 畸形块不抛） |

小计 **95 项断言**。

### 2.2 门禁

| 命令 | 结果 |
|---|---|
| `npm run typecheck`（node + web 双配置） | **0 错误** |
| `npm test` | **83/83 通过**（含新增三套，无回归） |
| `dotnet build src\runtime\WishfulClaw.sln` | **0 警告 0 错误** |

### 2.3 实现过程中被测试抓出的真实缺陷

| # | 缺陷 | 修法 |
|---|---|---|
| 1 | `stripImagePayloads` 把 `filePath: '   '`（纯空白）当成有效路径，于是把 `data` 剥掉 ⇒ **不可逆丢图** | 判据改为 `filePath.trim().length > 0`；测试保留该用例 |

> 这条正是「先写测试」的价值：如果只跑真机，空白路径几乎不可能被走到，缺陷会一直躺着。

## 3. 真机验证（待执行）

| # | 验收项 | 操作 | 预期 |
|---|---|---|---|
| 1 | 发图落盘 | 聊天窗发一张 PNG | `~\.wishful-claw\images\2026-10\` 下出现 16 位哈希文件，字节一致 |
| 2 | 库里无 base64 | 查 `messages.meta` | `length(meta)` 显著变小，肉眼看无 `iVBOR` 长串 |
| 3 | 重启回显 | 重启应用 / 切走再回来 | 历史图正常显示（走 `oc-media://` 协议） |
| 4 | 去重 | 同一张图连发两次 | 目录里只有一份 |
| 5 | 工具产物 | 让 agent 截图 / 读图 | 落库后同样无 base64，卡片仍能显示 |
| 6 | 渠道收图 | QQ 发图给 bot | 落盘 + 显示 + 模型能看到 |
| 7 | 写盘失败降级 | 把 `images` 目录设为只读后发图 | 消息照发、图照显（内联 base64 兜底），日志有 warn |
| 8 | 编辑重发 | 双击历史带图消息 → 重发 | 图还在，不丢 |
| 9 | provider payload | 带图对话，看请求体 | OpenAI Chat `image_url` / Responses、Anthropic `source.data` 仍是真 base64 |

### 3.1 重点观察项

- **协议是否真能出图**：`oc-media://` 是本次新实现的注册端，Electron 43 的 `net.fetch(file:)` 用法
  在本次未有真机证据。若第 3 项失败，优先怀疑 `protocol.handle` 未在 `app ready` 后注册，
  或 `net.fetch` 对 `file:` 的处理。降级方案：改用 `fs.promises.readFile` + `new Response(buffer)`。
- **dev 与生产目录互不可见**：dev 实例的图落 `~\.wishful-claw-dev\images\`，生产落 `~\.wishful-claw\images\`，
  属预期（S-223 同口径），不是缺陷。

## 4. 未覆盖与已知限制

| 项 | 说明 |
|---|---|
| 跨月去重 | 同一张图 10 月、11 月各发一次会存两份，按写入时刻分桶，已记入需求 §8.4 |
| 历史图不进模型上下文 | `SessionRestoreTools` 不读 `meta.content`，既有行为，需另立需求 |
| 存量不迁移 | 老消息仍是内联 base64，渲染端两种形状都支持 |
| 压缩快照 | 存内存 wire conversation 仍带 base64，未瘦身 |

## 5. 阶段五审查

见 `review_report.md`。审查结论与修复记录在该文件。
