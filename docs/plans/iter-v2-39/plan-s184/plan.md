# Plan: S-184 项目档案页 · 项目人格 —— 无法点击切换查看、无法删除

> 所属迭代：iter-v2-39 ｜ 需求明细：[`../requirements/S-184.md`](../requirements/S-184.md)
> 类型：**渲染端交互缺陷**；**不涉及主进程与 C# 侧**。
> 范围：**仅 B（无法切换查看）+ C（无法删除）**；A（项目目录里躺着 6 份内置副本）已由老大 2026-10-10 09:43 裁定为**非 bug、出局**。

---

## 一、目标

项目档案页 →「项目人格」tab：点列表里的人格的按钮，**预览区跟着切换**；并且**能删掉项目层的人格**（只影响本项目，全局库与内置 preset 不受影响），删完列表即时刷新。

---

## 二、根因（已实读确认，行号为实读值）

| # | 位置（实读行号） | 现状 | 判定 |
|---|---|---|---|
| B | `ProjectArchivePage.tsx:353` | `onClick={() => setActiveTab('persona')}` —— 用户此刻就在 `persona` tab ⇒ **点了等于没点** | 🔴 无选中态 |
| B | `ProjectArchivePage.tsx:363` | 预览区硬编码 `persona={personas[0]}` | 🔴 永远显示列表第一个 |
| B | `ProjectArchivePage.tsx:58-59` | state 只有 `personas` / `personasLoading`，**没有 `selectedPersonaId`** | 🔴 缺选中态 |
| C | `ProjectArchivePage.tsx:318-370` | 人格 tab 内**没有任何删除入口**（只有列表 + 预览） | 🔴 无删除路径 |

**删除能力在主进程侧已存在**：`persona/delete`（`PersonaModule.cs:123-143` → `PersonaStore.DeletePersona`，`PersonaStore.cs:297-310`），对内置 preset 的保护**只在全局作用域生效**（`:299-302`），项目层可删。

---

## 三、实现口径

### 3.1 选中态（B）

- 新增 `selectedPersonaId: string | null`，默认 `null`；
- 预览目标 = `personas.find((p) => p.id === selectedPersonaId) ?? personas[0]`（`useMemo`）—— 默认仍显示第一个，与现状一致；
- 列表按钮：`onClick={() => setSelectedPersonaId(p.id)}`，选中项 `variant="default"` 高亮、未选中 `variant="outline"`；
- 列表刷新（切换 tab / 点 Refresh）后若选中项已不在列表里，自动回落 `null`（由上面的 `?? personas[0]` 兜住，不需要额外 effect）。

### 3.2 删除入口（C）

- 入口放**预览区上方的一行 header**：左侧显示当前人格名，右侧一个 `Trash2` + 「删除」的 `destructive` 按钮 —— 删的就是**当前选中的人格**；
- 点击先走 `confirm()`（`@renderer/components/ui/confirm-dialog`，`variant: 'destructive'`），与设置页 `PersonaPanel` 的确认方式保持一致；
- 确认后执行删除，成功则清 `selectedPersonaId` + 重新 `loadPersonas()`；失败给出错误提示（本页不引入 toast 依赖，落在一个局部 error 行内显示）。

### 3.3 删除走哪条通道 —— **助手自行拍定，非老大裁定**

**走渲染端已有的 `IPC.FS_DELETE`（本地 fs 通道），不走 `persona/delete`。** 理由：

| 项目类型 | 项目人格目录实际位置（`ProjectArchivePage.tsx:70-87`） | `persona/delete(workingFolder)` 会拼出的路径 |
|---|---|---|
| 本地项目 | `{workingFolder}/.wishful-claw/personas/` | `{workingFolder}/.wishful-claw/personas/` ✅ 一致 |
| **SSH 项目** | `~/.wishful-claw/projects/{projectId}/personas/`（**本地存储，不在远端**） | `{workingFolder}/.wishful-claw/personas/` ❌ 不一致 |

⇒ `persona/delete` 对 SSH 项目**路径对不上**；而本页读列表本来就走 FS 通道直读该目录（`listDir` / `readTextFile`），删除用同一条通道才自洽。删除路径由 `joinFsPath(personasDir, p.id)` 派生，`personasDir` 来自 `memoryRoot`、`p.id` 来自 `listDir` 的真实目录名 ⇒ 不会越界。

**连带**：删完再调一次 `usePersonaStore.getState().listPersonas(workingFolder)`（本地项目传 `workingFolder`，SSH 项目传 `undefined`），让设置页的人格列表与本次删除保持同步。

### 3.4 预览组件重置

`PersonaFilePreview` 内部持有 `selectedFile` / `fileContent`（`PersonaFilePreview.tsx:19-21`）。切换人格时若沿用旧 state，会残留上一个人格的文件内容 ⇒ 给它加 `key={selectedPersona.id}`，靠重挂载重置。

---

## 四、步骤清单

- [x] **步骤 1：补选中态（B）**
  - 加 `selectedPersonaId` state + `selectedPersona` `useMemo`；
  - 列表按钮 `onClick` 改为设置选中 + 选中态高亮；
  - 预览改用 `selectedPersona`，并加 `key`。
  - **验证检查点**：`npm run typecheck` 两配置零错误。
- [x] **步骤 2：接删除入口（C）**
  - 预览区 header 加 `Trash2` 删除按钮 + `confirm()`；
  - 删除走 `IPC.FS_DELETE`，成功后清选中 + `loadPersonas()` + 同步 `persona-store`。
  - **验证检查点**：`npm run typecheck` 零错误。
- [x] **步骤 3：补 i18n key**
  - `locales/zh/chat.json` / `locales/en/chat.json` 的 `projectArchive.persona` 段加 `delete` / `deleteConfirmTitle` / `deleteConfirmDesc` / `deleteConfirmLabel` / `deleteFailed`。
  - **验证检查点**：`npm run typecheck` 零错误；key 在两侧 json 结构对称。
- [x] **步骤 4：实测**
  - dev 实例 → 项目档案页 → 项目人格 tab：① 点第 2、第 3 个人格 ⇒ 预览区切换到对应人格（文件列表与内容都跟着变）；② 删掉一个人格 ⇒ 确认框弹出、确认后该人格从列表消失、**项目目录里对应文件夹确实没了**；③ 设置页里**全局 preset 仍在**；④ 删掉当前选中项后预览回落到第一个。
  - **验证检查点**：上述 4 条逐条亲眼确认；`npm test` 全量跑一遍（回归面）。
  - **实测结论（2026-10-10）**：四条全部通过 —— 切换后预览标题与文件列表同步更新；删除 `zz-s184-test` 弹出确认框、确认后列表即时刷新、`.wishful-claw/personas/zz-s184-test` 目录确实被删、其余 6 个人格完好；选中态回落到 `aming`。回归 `npm test` 68/68。

---

## 五、涉及文件

| 文件 | 动作 |
|---|---|
| `src/renderer/src/components/chat/ProjectArchivePage.tsx` | 改 —— 选中态 + 按钮 onClick + 预览 header/删除入口 + 删除逻辑 |
| `src/renderer/src/locales/zh/chat.json` | 改 —— `projectArchive.persona` 段加 5 个 key |
| `src/renderer/src/locales/en/chat.json` | 改 —— 同上 |

**不动**：`PersonaPanel.tsx`（设置页语义不变，A 已出局）；`PersonaFilePreview.tsx`（只由调用方加 `key`，组件自身不改）；主进程与 **C# 侧**（本迭代唯一 C# 改动留给 S-187）。

---

## 六、参考源码

- `PersonaStore.cs:297-310` —— `DeletePersona` 的作用域规则（项目层可删内置同名副本）。
- `PersonaPanel.tsx:114-119` / `PersonaList.tsx` —— 设置页既有的删除交互，作为交互口径样板。
- `project-archive-helpers.ts:120-133` —— 本页读目录的既有 FS 通道用法（删除沿用同风格）。
- 无外部参考项目。

---

## 七、风险

1. **FS_DELETE 无路径白名单**（`fs-handlers.ts:133-144` 直接 `rm -r`）—— 本页传入的路径全部由 `personasDir` + 真实目录名派生，不接受用户输入；风险面与本页既有的 `listDir` / `readTextFile` 相同。
2. **SSH 项目人格的删除只清本地缓存目录** —— 与「主进程对 SSH 项目人格目录的认知」不一致是**既有问题**，本需求不处理，只在 §3.3 记明。
3. **列表刷新后选中项消失**（比如在设置页删掉同一个人格）—— 由 `?? personas[0]` 兜底，不额外报错。
