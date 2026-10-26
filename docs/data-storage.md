# Wishful Claw 数据存储设计

## 设计原则

- 记忆/人格：纯文件（Markdown），人可读、可编辑、Git 友好
- 会话/消息 + 搜索索引 + 项目注册：单个 SQLite，全局唯一
- 项目级数据：纯文件，放在项目工作区目录下

## 存储结构

### 全局目录

```
~/.wishful-claw/
├── SOUL.md                         # 全局人格
├── IDENTITY.md                     # 全局身份
├── USER.md                         # 全局用户画像
├── MEMORY.md                       # 全局活跃记忆
├── images/
│   └── 2026-10/                    # 聊天图片，按月分桶（S-224）
├── memory/
│   ├── topics/                     # 主题记忆
│   ├── dormant/                    # 休眠记忆
│   └── archive/                    # 归档记忆
└── index.db                        # SQLite（全局唯一）
```

**聊天图片按日期分桶**（S-224）：`{全局目录}/images/{yyyy-MM}/{sha256 前 16 位}.{ext}`，例如
`~/.wishful-claw/images/2026-10/9f2c1a7b3e5d4c60.png`。

- 文件名取**解码后字节**的 sha256 前 16 位 + 按 mime 推的扩展名 ⇒ 同一张图重复发送天然去重，磁盘只有一份。
- 月目录按**写入时刻的本地时间**取 `yyyy-MM`；同一张图跨月各发一次会存两份，月级粒度下可接受。
- 库里只存 `filePath`：`messages.meta` 的 `content` / `segments` / `toolCalls` 三处容器在序列化时都会剥掉
  `source.data`，只留路径与 mediaType。内存里的消息仍带 base64，本轮请求不受影响。
- 显示走 `oc-media://` 自定义协议（`src/main/lib/local-media-protocol.ts`，扩展名白名单 + host 校验）；
  编辑重发时由渲染端读盘还原成 base64。
- 存量记录不迁移：老消息仍是内联 base64，两种形状渲染端都支持。

### 项目工作区

项目本身注册在 SQLite 中，记录项目名和工作区路径。项目级文件放在工作区路径下的 `.wishful-claw/`。

**目录名按运行态区分**（S-223）：打包版用 `.wishful-claw/`，开发实例用 `.wishful-claw-dev/`，开发时跑出来的计划、笔记、状态不会写进正式项目的那份目录。判定只做一次 —— 主进程按 `app.isPackaged` 定值，经环境变量 `WISHFULCLAW_PROJECT_DIR` 下发给 Worker，经 BrowserWindow `additionalArguments` 下发给渲染进程；该变量有值时优先采用。全局目录（`~/.wishful-claw/` 与 `~/.wishful-claw-dev/`）口径不变。

```
{项目工作区路径}/
├── 用户的项目代码...
└── .wishful-claw/                # 开发实例为 .wishful-claw-dev/
    ├── SOUL.md                     # 项目人格（覆盖全局）
    ├── MEMORY.md                   # 项目记忆
    ├── memory/
    │   ├── topics/
    │   ├── dormant/
    │   └── archive/
    └── tasks/                      # 任务管理（全文件驱动）
        ├── active/                 # 进行中的任务
        ├── done/                   # 已完成
        └── archive/                # 已归档
```

任务以 Markdown 文件形式存储，记录任务描述、状态、进度、执行记录。助手通过读写这些文件来发布任务和跟踪进度。

**SSH 远程项目的边界**：目录名区分只对本地工作区生效。开发实例连 SSH 项目时，远端去找的是 `.wishful-claw-dev/`（远端只有生产的 `.wishful-claw/`），因此读不到远端历史记忆；写入也落在远端 `-dev` 目录，不碰生产数据。这是有意取舍 —— 开发实例本来就只用于本地临时测试。

## SQLite 用途

全局唯一的 `index.db` 负责三件事：

| 表 | 用途 |
|----|------|
| 项目注册表 | 项目名、工作区路径、项目配置等 |
| 会话/消息历史 | 对话记录、工具调用记录，高频读写，按项目关联 |
| FTS 搜索索引 | 记忆全文搜索索引，记忆文件变更时同步更新 |

记忆内容本身不在 SQLite 里，都在 Markdown 文件中。删掉 index.db 不丢记忆，索引可重建。

## 数据关系

```
SQLite（index.db）
├── 项目注册表 ──→ 记录项目名 + 工作区路径
│       │
│       └──→ {工作区路径}/.wishful-claw/  ← 项目级记忆/人格文件（开发实例为 .wishful-claw-dev/）
│
├── 会话/消息表 ← 按项目关联，实时写入
│
└── FTS 索引表  ← 同步自记忆文件（全局 + 项目级）

记忆文件（Markdown，source of truth）
  全局: ~/.wishful-claw/MEMORY.md + memory/*
  项目: {工作区路径}/.wishful-claw/MEMORY.md + memory/*（开发实例为 .wishful-claw-dev/）
         │
         └── 同步 ──→ FTS 索引表（可重建）
```

## 数据流向

### 记忆读取

```
用户发消息
  ↓
Agent Loop 开始前
  ↓
TryInjectRecall(userMessage)
  ↓
查询 FTS 索引（全局 + 当前项目）
  ↓
命中 → 读取对应 Markdown 文件内容 → 注入对话上下文
```

### 记忆写入

```
Agent 判断需要记忆
  ↓
通过 memory_write 工具写入 Markdown 文件
  ↓
同步更新 FTS 索引
```

### 记忆巩固

```
定时触发 / Agent 主动触发
  ↓
读取 memory/sessions/ → 评估 → 写入 memory/topics/ 或降级到 dormant/
  ↓
同步更新 FTS 索引
```
