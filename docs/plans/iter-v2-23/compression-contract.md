# v2-iter-23 上下文压缩数据契约

> 状态：步骤 2 定案稿
>
> 日期：2026-08-27
>
> 适用范围：自动压缩、手动压缩、聊天窗上下文摘要、压缩快照、历史会话恢复
>
> 本契约只定义语义和字段边界；具体 SQLite schema、MessagePack 字段追加和 UI 实现分别在后续步骤执行。

## 一、核心原则

上下文压缩只产生一份逻辑结果，三个消费者不得各自重新解释或重新生成摘要：

```text
一次压缩
  ├─ Agent 内存：压缩后的 wire conversation
  ├─ 聊天窗：上下文摘要消息 + 压缩状态卡
  └─ SQLite：可恢复的压缩快照
```

三者必须来自同一份压缩结果：

- 后端恢复以压缩后的完整 wire conversation 为权威；
- 聊天窗以摘要消息显示摘要正文，以状态卡显示压缩生命周期；
- SQLite 保存恢复所需的快照和必要元数据；
- Activity 面板可以复制状态，但不作为聊天摘要或恢复数据源；
- UI 加载历史不会改变压缩快照或 Worker `SessionConversation`。

## 二、压缩结果的逻辑结构

当前 `ContextCompression.CompactAsync` 的结果逻辑结构为：

```text
[pinned prefix]
+ [fold 区域中保留的 user turns]
+ [compaction summary message]
+ [recent tail]
```

因此“摘要正文”不是完整恢复上下文。恢复快照必须能还原上述完整顺序；只保存 `summary` 字符串不足以恢复 Agent。

## 三、压缩触发信息

每次压缩都带有以下逻辑属性：

| 字段 | 类型 | 说明 |
|---|---|---|
| `trigger` | `auto \| manual` | 自动阈值触发，或用户主动触发 |
| `preTokens` | `number` | 触发压缩前的估算/usage token 数；未知时为 0 |
| `originalCount` | `number` | 压缩前 wire message 数 |
| `newCount` | `number` | 压缩后 wire message 数 |
| `messagesSummarized` | `number` | 被摘要/折叠的消息数 |
| `summarizerFailed` | `boolean` | 是否使用机械降级摘要；正常 LLM 摘要为 false |
| `error` | `string?` | 压缩失败或降级说明；不得包含密钥和完整敏感请求 |

`newCount >= originalCount` 时视为没有产生有效压缩；自动链路可继续使用机械截断兜底，手动链路返回未压缩结果并显示 skipped/failed 语义，具体状态映射在 Plan 23-3 实现时收口。

## 四、三类消息产物

### 4.1 压缩边界消息

用于在聊天历史中标记模型上下文从完整历史切换到压缩视图的位置。

```json
{
  "id": "compact-boundary-...",
  "role": "system",
  "content": "",
  "createdAt": 0,
  "meta": {
    "compactBoundary": {
      "trigger": "auto | manual",
      "preTokens": 0,
      "messagesSummarized": 0,
      "preservedSegment": {
        "headId": "...",
        "anchorId": "...",
        "tailId": "..."
      }
    }
  }
}
```

边界消息是 UI/请求视图标记，不代替快照本体。

### 4.2 上下文摘要消息

用于向用户展示实际摘要正文，也作为压缩 wire conversation 中模型可识别的 summary message。

```json
{
  "id": "compact-summary-...",
  "role": "user",
  "content": "<compaction-summary>...摘要正文...</compaction-summary>",
  "createdAt": 0,
  "meta": {
    "compactSummary": {
      "messagesSummarized": 0,
      "recentMessagesPreserved": true,
      "displayAnchor": {
        "assistantMessageId": "...",
        "afterContentBlockCount": 0,
        "afterToolUseId": "..."
      }
    }
  }
}
```

规则：

- 摘要正文只能由压缩核心生成一次；聊天窗不自行重写摘要；
- UI 使用 `ContextCompressionMessage` 展示，可展开查看完整正文；
- 摘要正文必须保留路径、标识符、版本号、错误和下一步等关键事实；
- 摘要消息 ID 应稳定地进入快照，避免恢复后重复插入；
- 旧版只有 `<compaction-summary>` 文本、没有 `meta.compactSummary` 的消息继续兼容识别。

### 4.3 压缩状态消息

用于显示压缩生命周期，不承载完整摘要正文。

```json
{
  "id": "compression-status-...",
  "role": "system",
  "content": "",
  "createdAt": 0,
  "meta": {
    "compressionStatus": {
      "state": "compressing | compressed",
      "startedAt": 0,
      "completedAt": 0,
      "keptMessageCount": 0,
      "preTokens": 0,
      "newCount": 0
    }
  }
}
```

状态消息和摘要消息职责分离：

- 状态消息：正在压缩、完成、数量、触发 token；
- 摘要消息：可阅读的上下文摘要正文；
- 失败/取消/跳过状态需要在后续协议扩展中明确，不得伪装成 compressed。

## 五、流式事件契约

### 5.1 开始事件

```json
{
  "type": "context_compression_start",
  "trigger": "auto | manual",
  "preTokens": 0,
  "attempt": 1,
  "maxAttempts": 1
}
```

当前协议中的旧客户端只认识 `type`，新增字段使用可选 MessagePack map key，保持兼容。

### 5.2 摘要增量事件

参考 OpenCowork 的 `context_compression_delta`：

```json
{
  "type": "context_compression_delta",
  "text": "摘要正文增量"
}
```

该事件只用于压缩进行中的可选实时反馈；最终聊天展示和恢复不能依赖增量事件，必须依赖完成事件中的完整摘要产物或随后持久化的摘要消息。

### 5.3 完成事件

```json
{
  "type": "context_compressed",
  "trigger": "auto | manual",
  "originalCount": 20,
  "newCount": 8,
  "keptMessageCount": 7,
  "preTokens": 160000,
  "summarizerFailed": false,
  "compactArtifacts": [
    "compact boundary message",
    "compact summary message"
  ],
  "messages": [
    "compressed wire conversation"
  ]
}
```

字段职责：

- `compactArtifacts`：聊天窗需要插入/展示的边界和摘要消息；
- `messages`：压缩后的模型上下文，供请求视图/恢复链使用；
- `originalCount/newCount/keptMessageCount/preTokens`：状态卡和日志摘要；
- `summarizerFailed/error`：降级或失败反馈；
- 事件不得要求前端自行从旧消息猜测摘要正文。

### 5.4 失败、跳过和取消

后续实现应将状态统一映射为：

```text
compressed  — 产生有效缩减和摘要
skipped     — 没有足够可折叠内容，不改变上下文
failed      — 压缩请求失败且未产生可用替代结果
blocked     — 当前运行状态/策略禁止压缩
cancelled   — 用户或请求取消
```

自动压缩的 mechanical fold 是否算 `compressed`，需在 Plan 23-3 根据实际结果和 UI 语义最终实现；但必须保留 `summarizerFailed=true` 或等价标识，不能让用户误以为是 LLM 摘要。

## 六、压缩快照契约

压缩快照的最小逻辑字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `sessionId` | `string` | 会话 ID |
| `version` | `number` | 快照格式版本 |
| `trigger` | `string` | auto/manual |
| `wireConversation` | `JSON` | 完整压缩后的 wire conversation |
| `summaryMessage` | `JSON` | 可展示的上下文摘要消息 |
| `compactArtifacts` | `JSON[]` | boundary + summary 等展示产物 |
| `throughSortOrder` | `number` | 快照覆盖到的持久化消息游标 |
| `createdAt` | `number` | 快照生成时间 |
| `summarizerFailed` | `boolean` | 是否降级 |

恢复时：

```text
有效快照
  = 反序列化 wireConversation
  + 读取 throughSortOrder 之后的新 messages
  + 初始化 SessionConversation

无快照/损坏快照/未知版本
  = 沿用当前 messages 全量恢复
```

快照不是 UI 首屏分页缓存。前端最近 5 轮和点击加载更早历史不参与快照游标。

## 七、单一事实源与职责边界

```text
ContextCompression result
  ├─ wireConversation       → Agent 恢复/模型请求权威
  ├─ compactArtifacts      → 聊天窗摘要/边界展示
  ├─ summaryMessage        → 摘要正文和模型上下文中的可识别消息
  ├─ status metadata        → 压缩状态卡/Activity 辅助显示
  └─ snapshot metadata     → SQLite 恢复、版本和游标
```

禁止：

- 前端根据 `originalCount/newCount` 自己生成摘要正文；
- Activity 面板成为摘要唯一存储位置；
- 只保存摘要正文却丢失 pinned prefix/kept user turns/recent tail；
- UI 点击加载更多历史自动改写 Worker 上下文；
- 普通对话结束后额外调用模型生成会话摘要。

## 八、后续实现约束

1. 所有新增协议字段使用可选 map key，兼容旧客户端。
2. 所有新增快照 DTO 使用具名类型并注册 AOT `JsonSerializerContext`。
3. 摘要内容不得记录 API key、secret、完整授权头或不必要的敏感参数。
4. 压缩快照写入失败不能静默覆盖旧的有效快照。
5. 恢复失败必须记录可诊断日志，并安全回退全量 messages 恢复。
6. 自动压缩、手动压缩、前台、Cron、渠道共享同一语义，不复制多套摘要格式。

## 九、步骤 2 验证结论

- 自动/手动压缩均使用同一逻辑结果结构：wire conversation + compact artifacts + status metadata。
- 完成事件可关联摘要正文、压缩范围、保留信息和降级状态。
- `AgentRuntimeStreamEvent` / MessagePack 已预留 `Messages`、`CompactArtifacts` 可选字段，可在后续实现中扩展。
- Renderer 已有 `compactBoundary`、`compactSummary`、`compressionStatus` 类型和组件，可复用现有 UI 结构。
- AOT 边界明确：快照 DTO 和响应 DTO 必须使用具名 record，并注册到对应 JsonContext。
- 摘要正文与快照中的 `summaryMessage` 使用同一内容，不允许前端二次生成。
