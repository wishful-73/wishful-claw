# Plan: S-183 项目档案页 —— 内容区缺少高度约束，内容被裁且不出滚动条

> 所属迭代：iter-v2-39 ｜ 需求明细：[`../requirements/S-183.md`](../requirements/S-183.md)
> 类型：**渲染端布局缺陷**；**不涉及主进程与 C# 侧**。

---

## 一、目标

项目档案页里凡内容超过一屏的文档 / 列表，**看不到滚动条、内容被静默裁掉且滚不到**。修掉这一条高度链，让内层 `overflow-auto` 真正生效，同时**外层仍保持 `overflow-hidden`**（不引入整页滚动条）。

---

## 二、根因（已实读确认，行号为实读值）

`ProjectArchivePage.tsx:201` 的中间层是**普通块级 div**（`mx-auto w-full max-w-[1480px]`），不在 flex 高度链上，把 `flex-1 + min-h-0` 整条链掐断：

| # | 位置（实读行号） | 现状 class | 判定 |
|---|---|---|---|
| 1 | `ProjectArchivePage.tsx:200` | `relative flex flex-1 flex-col overflow-hidden bg-background px-6 pb-6 pt-4` | 页面根，正常；`overflow-hidden` 是裁切来源 |
| 2 | `ProjectArchivePage.tsx:201` | `mx-auto w-full max-w-[1480px]` | 🔴 **问题所在** —— 普通块级，高度退化为内容高度 |
| 3 | `ProjectArchivePage.tsx:300` | `flex min-h-0 flex-1 flex-col overflow-hidden pt-4` | tab 内容区；`flex-1` 因父级不是 flex 而**失效** |
| 4 | `ProjectMemoryFileTab.tsx:106` | `flex min-h-0 flex-1 flex-col overflow-hidden` | 同上，失效 |
| 5 | `ProjectMemoryFileTab.tsx:159` | `mt-3 flex-1 overflow-auto` | 滚动容器；高度 = 内容高度 ⇒ **永不溢出** |
| 6 | `ProjectMemoryFileTab.tsx:176` | Textarea `min-h-[480px]`（`rows={24}`） | 把内容进一步撑高 |
| 7 | `ProjectMemoryLibraryTab.tsx:283` / `:376` | 与 4 / 5 同构 | 同上 |

页面根 `:200` 直接坐在 `MainLayout.tsx:187`（`flex min-w-0 flex-1 flex-col overflow-hidden`）的纵向 flex 列里，`flex-1` 有效 —— **链只断在 `:201` 这一层**。

---

## 三、修复方案

**单点主改** —— `ProjectArchivePage.tsx:201`：

```
- mx-auto w-full max-w-[1480px]
+ mx-auto flex min-h-0 w-full max-w-[1480px] flex-1 flex-col
```

**连带补 `shrink-0`（三处）** —— `:201` 变成纵向 flex 后，其下有 `flex-1` 的内容区会抢走剩余空间，头部 / CodeGraph 块 / tab bar 作为纵向 flex item 默认 `flex-shrink:1`，矮视口下会被压扁（CodeGraph 是带 border + padding 的卡片，受害最明显）：

| 位置（实读行号） | 用途 | 补 |
|---|---|---|
| `ProjectArchivePage.tsx:203` | 头部（标题 + 按钮） | `shrink-0` |
| `ProjectArchivePage.tsx:275` | 包裹 `CodeGraphProjectIndexSection` 的外层 | `shrink-0` |
| `ProjectArchivePage.tsx:280` | tab bar | `shrink-0` |

**不动的**：
- `ProjectMemoryFileTab.tsx:176` 的 `min-h-[480px]` —— 缺陷描述里的「复核是否仍必要」保留到实测阶段判断（短内容被撑到 480px 是**独立小瑕疵**，本需求先不夹带，避免扩大范围）。
- persona 分支（`:319` / `:360`）：`PersonaFilePreview` 自身链路已完整，高度链修好后自然生效，除非实测发现压缩症状再补。
- 首次空态分支（`:173-195`）是另一个 return，不受影响。

---

## 四、步骤清单

- [ ] **步骤 1：改 `:201` 进 flex 高度链**
  - `src/renderer/src/components/chat/ProjectArchivePage.tsx:201` 的 className 改为 `mx-auto flex min-h-0 w-full max-w-[1480px] flex-1 flex-col`（保留 `mx-auto` + `max-w`）。
  - **验证检查点**：`npm run typecheck` 两配置零错误。
- [ ] **步骤 2：给三处补 `shrink-0`**
  - `:203` / `:275` / `:280` 各加 `shrink-0`。
  - **验证检查点**：`npm run typecheck` 零错误。
- [ ] **步骤 3：整体实测**
  - dev 实例 → 项目档案页：① **项目记忆** 打开内容长的 `MEMORY.md` ⇒ 内容区出滚动条、底部可达；② **记忆库** 条目多时列表出滚动条；③ **项目人格** 预览区受高度约束、不无限拉长；④ **矮窗口 / 窄窗口**下不出现「整页无滚动条且内容被裁」；⑤ 页面外层**不出现整页滚动条**；⑥ 头部 / CodeGraph 卡片 / tab bar 在矮窗口下**不被压扁**。
  - **验证检查点**：上述 6 条逐条亲眼确认；`npm test` 全量跑一遍（回归面）。

---

## 五、涉及文件

| 文件 | 动作 |
|---|---|
| `src/renderer/src/components/chat/ProjectArchivePage.tsx` | 改 —— `:201` 进 flex 链 + `:203` / `:275` / `:280` 补 `shrink-0` |

**不动**：`ProjectMemoryFileTab.tsx`、`ProjectMemoryLibraryTab.tsx`（它们的容器链本身正确，只是此前被掐断）；`MainLayout.tsx`；主进程与 C# 侧。

---

## 六、参考源码

- `MainLayout.tsx:187`（`ContentArea` 宿主）—— 确认页面根坐落在纵向 flex 列里（父级高度链完整）。
- `ProjectMemoryFileTab.tsx:106` / `ProjectMemoryLibraryTab.tsx:283` —— 内层容器链**已是正确写法**，是本层的「参照样板」。
- 无外部参考项目。

---

## 七、风险

1. **补 `shrink-0` 后，CodeGraph 卡片自身仍无 `overflow`** ⇒ 若它的内容本身就高于视口，仍会撑破（属另一个议题，本需求不处理）。
2. `min-h-[480px]` 的 Textarea 在短内容下依旧把内容区撑到 480px —— 已知小瑕疵，**刻意不夹带**（见 §三「不动的」）。
