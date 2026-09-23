# iter-v2-36 迭代计划（总览）

> 承接 iter-35 未完成项。分支 **`dev/v2-iter-36`**（base `43a616e6` = `v0.2.35` 发布点，2026-09-23 14:43 切出）。
> 本文件 = 迭代总览（目标 / 需求索引 / 刀序 / 门禁基线）；需求正文见 `requirements/`，裁定流水见 `changelog.md`。

**当前状态：实施中** —— 老大 2026-09-23 14:43「当前已经是 35 版本了，切出 36 迭代，我们准备继续搞」；14:45 定 S-129 顺序「先把官网的本身调整对，然后把 35 迭代的放上去」。**本迭代首个开工项 = S-129**（官网侧已落地）。承接项正文见 iter-35 的 `requirements/`（立项时按惯例在本目录另立一份，不清空原档）。

---

## 一、目标

1. **S-129**：官网成为完整更新源 —— 下载目录补齐三件（exe + blockmap + latest.yml）、前端改读 `latest.yml`（清单单一真源，发版零手改），app 内更新随后切 `generic` 指向官网。
2. **S-143**：官网去掉更新日志页，入口一律跳 GitHub Releases（站点内容收口，为重新部署做准备）。

---

## 二、需求索引（承接 iter-35 未完成）

| 编号 | 标题 | 状态 | 正文 |
|---|---|---|---|
| S-129 | 更新源全面切换到官网：官网成为完整 electron-updater 源（发布目录 + 清单单一真源） | 🔄 实施中（官网侧已落地；`publish` 切换 + 服务器上传待前序条件） | [S-129.md](requirements/S-129.md)（承接 [iter-35](../iter-v2-35/requirements/S-129.md)） |
| S-140 | 0.2.33 → 0.2.34 更新走了全量下载（108 MB），未走差分 | ⏸ 挂起（观察点：0.2.35 → 0.2.36 是否再见全量） | [iter-v2-35/S-140.md](../iter-v2-35/requirements/S-140.md) |
| S-143 | 官网上线 + 公安备案（ICP 蜀ICP备2026057067号已通过；**本轮去掉更新日志页**） | 🔄 进行中（更新日志页已下架；备案号本地已改；公安备案待办） | [S-143.md](requirements/S-143.md)（承接 [iter-35](../iter-v2-35/requirements/S-143.md)） |
| S-144 | 沙箱模式下 Write 写特定路径被拦（中文 / 下划线 / 深层子目录，触发项未定位） | 📝 已登记，待勘测 | [iter-v2-35/S-144.md](../iter-v2-35/requirements/S-144.md) |
| S-145 | Read 工具支持读取本地图片（含 Anthropic `tool_result` 丢图修复） | ✅ 已完成 | [iter-v2-35/S-145.md](../iter-v2-35/requirements/S-145.md) |
| S-146 | 下载类报错未包装：界面上出现原始报错报文 | ✅ 已实施（app 内更新链） | [S-146.md](requirements/S-146.md) |

### 承接 iter-34 挂账（仍未做）

| 来源 | 事项 | 备注 |
|---|---|---|
| S-131 | 左栏渲染漏按视口收窄（**路径二**：缩窗无 resize 监听） | ✅ 已修（`resolveViewportYield` + `MainLayout` resize 监听；路径一在 `24311a9e`） |
| S-134 | 切会话 / 结束会话但 tab 还开着 ⇒ 进程是否仍在 | ⏸ 待老大一句话（需真机确认） |
| S-108 | 模型窗口 384K 未生效（后端按 200K 兜底） | ✅ 复勘结案成立（DB 实证 200000 = 会话 cap；三个遗留隐患待裁） |
| — | `will-navigate` 同源隐患 10 处未拦 | ✅ 已收口（主进程兜底 + `SAFE_LINK_COMPONENTS` 覆盖 10 处） |
| — | `memory-output.tsx:115` 的 `hit.priority` 裸英文 | ✅ 已修（走 `chat` 的 `memory.*` 键，zh/en 对齐） |
| — | `electron-updater`：`disableWebInstaller` 未设 | ✅ 已设 `true` |
| — | 官网 `latest.json` 与发版联动 | 已并入 S-129（清单单一真源），不再单列 |

---

## 三、刀序

1. S-129 官网侧 + `deploy.mjs`：下载目录三件驱动（前端改读 `latest.yml` + 废 `latest.json` + 解析回归测试 + 发布脚本补齐 + 发布文档）（1 刀，已落地未提交）
2. S-143：官网去掉更新日志页，入口跳 GitHub（1 刀，已落地未提交）
3. 上线：跑 `deploy.mjs installer`（三件上服务器 + 站点重发）
4. S-129 app 侧：`electron-builder.yml` 的 `publish:` 切 `generic`（**待官网 `downloads/latest.yml` 验通后才做**）
5. （待定）S-145 / S-144 / S-140 / 公安备案
6. 迭代收尾：审查与验证修复调整（1 刀）

---

## 四、门禁基线

| 项 | 基线 |
|---|---|
| `npm run typecheck` | 0 错误 |
| `npm test` | 50 / 50（TS 37 套件 + C# 13 套件） |
| base commit | `43a616e6`（= tag `v0.2.35`） |
