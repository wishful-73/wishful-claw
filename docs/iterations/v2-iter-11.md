# v2-iter-11：Native AOT 打包（SqlSugar → Dapper 迁移）


**目标**：真正实现 Native AOT 打包，让安装包尽量小。当前使用 SqlSugar 强类型链式 API，其表达式树 + 反射在 AOT 下必须保留全量元数据，导致 AOT 裁剪失效、包压不小。迁移到 Dapper.AOT（源生成器）+ Microsoft.Data.Sqlite（官方原生驱动，AOT 友好），实现零反射的 AOT 裁剪。

**背景 / 选型结论**：
- SqlSugar 在 Native AOT 下无法细粒度裁剪（Queryable 表达式树 / 实体映射 / 动态代理必须保留反射元数据），`rd.xml` 的 `Dynamic="Required All"` 是必然需求而非可优化项，故 AOT 无法真正减小体积
- EF Core 过重（用户不倾向）；Dapper 是轻量 ADO 封装，符合项目偏好的同时支持官方 `Dapper.AOT` 源生成器实现 AOT 零反射
- `MemoryFtsService` 已是手写 SQL，Dapper 迁移最顺

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | 引入依赖 — `Dapper` + `Dapper.AOT` + `Microsoft.Data.Sqlite`，移除 `SqlSugar` | `WishfulClaw.Infrastructure.csproj` |
| 2 | 重写 `DbClient` — 建表（CodeFirst → 手写 CREATE TABLE）、PRAGMA 配置、列迁移逻辑 | `Infrastructure/Db/DbClient.cs` |
| 3 | 迁移 8 个 Db*Tools — `Queryable/Insertable/Updateable/Deleteable` 强类型链式 → 手写 SQL + Dapper 参数化 | `DbMessageTools/DbSessionTools/DbGoalTools/DbSubAgentTools/DbPlugin*/DbMessageCompactTools` 等 |
| 4 | Entity 列映射 — 核对属性名与列名一致性，配置 Dapper 别名 | `Infrastructure/Db/Entities/*.cs` |
| 5 | `MemoryFtsService` 适配 — 手写 SQL 改用 `Microsoft.Data.Sqlite` + Dapper（FTS5 trigram 保留） | `Workspace/Memory/MemoryFtsService.cs` |
| 6 | 移除 AOT 逃避配置 — 删 `rd.xml` 粗粒度保留、关 `JsonSerializerIsReflectionEnabledByDefault`，JSON 改源生成器 `[JsonSerializable]` | `Worker/rd.xml`、`Worker/*.csproj` |
| 7 | AOT 打包验证 — `dotnet publish -p:PublishAot=true -r win-x64` 成功 + 包体积对比 | `WishfulClaw.Worker` |
| 8 | 功能回归 — 项目/会话/消息/记忆/SSH 全链路 DB 读写不回归 | 全链路 |

**验证标准**：`dotnet publish -p:PublishAot=true -r win-x64` 打包成功，安装包体积较当前显著减小；启动后 DB 读写（项目、会话、消息、记忆、SSH、Goal、SubAgent）全链路正常；FTS5 记忆全文搜索正常。

**分支**：`dev/v2-iter-11`　**Tag**：`v2.11.0`
