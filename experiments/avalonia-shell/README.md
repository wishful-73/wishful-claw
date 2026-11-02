# Avalonia 壳内存原型（S-295）

> 目的只有一个：**量出 Avalonia 壳的常驻内存**，回答「Astra Gate 从 Electron 迁到 Avalonia 内存 350 MB → 50 MB，我们该不该也走这条路」。
>
> 这个工程**不进任何现有构建**：不在 `src/runtime/WishfulClaw.sln`、不在 `tests/WishfulClaw.Tests.sln`、不被 `tsconfig*` / `electron-vite` / `ci-checks` 扫到。它只有一个窗口，没有业务逻辑，不连 worker。

## 一、结论先给

**Astra Gate 那个 50 MB 能复现，但不是我们能用到的数。**

| 口径 | 空窗口 | 说明 |
|---|---|---|
| 工作集 + GPU 加速（默认） | **187.4 MB** | 真实用户机器上的样子 |
| 工作集 + NativeAOT | **156.2 MB** | 最省的发布形态 |
| 工作集 + 软件渲染 | **96.9 MB** | 不建 GLES/ANGLE 上下文 |
| **私有字节 + 软件渲染** | **43.7 MB** | ≈ Astra Gate 报的 50 MB |

也就是说，50 MB 是「**软件渲染 + 私有字节口径**」下的空窗口。拿它去对比我们带 GPU 加速、工作集口径的 1.3 GB，是拿两把不同的尺子量两样不同的东西。

**推论：换壳省不掉内存。**

1. Avalonia 自己就要 156~187 MB（**空窗口**，不含任何业务界面）。
2. 我们 Electron 生产构建的 renderer 稳态高水位是 **150~200 MB**（S-247 实测锯齿 115↔203、跑完能还 311 MB），**跟 Avalonia 空壳同量级**。
3. 把 874 个渲染层文件重写成 XAML 之后，内存最乐观是持平，绝不可能更低 —— 因为壳的基线就已经抵掉了现在的全部。

**§六 那条中间路线（Avalonia 壳 + WebView2 跑现有 React）同样不划算**：WebView2 内核就是 Chromium，内存与 Electron renderer 同量级；换掉 Electron 只省掉 Node 主进程那一小块，却要多维护一套 IPC 与浏览器控制层（CDP / 截图 / 元素树 / partition 隔离全要重写）。

**结论：不建议迁移。** 内存问题已经在 S-247 收口（不是泄漏，是每帧重做），不需要靠换壳解决。

## 二、实测数据（2026-11-02，本机）

环境：Windows / .NET SDK 10.0.302 / Avalonia 11.3.2 / 1440×900 窗口 / 每个阶段跑 12 秒，取**最后三分之一采样的中位数**（开头几秒在 JIT 与布局，取全平均会偏低）。

### 2.1 工作集（Working Set，MB）

| 配置 | empty | text（流式追加） | image（2520×1680） |
|---|---|---|---|
| Debug，框架依赖，GPU | 197.7 | 215.4 | 229.5 |
| Release，框架依赖，GPU | 187.4 | 219.7 | 200.9 |
| Release，NativeAOT，GPU | 156.2 | 175.3 | 173.4 |
| Release，框架依赖，软件渲染 | **96.9** | 125.0 | 114.6 |

### 2.2 私有字节（Private Bytes，MB）

| 配置 | empty | text | image |
|---|---|---|---|
| Debug，框架依赖，GPU | 132.6 | 150.0 | 166.2 |
| Release，框架依赖，GPU | 128.7 | 154.5 | 137.8 |
| Release，NativeAOT，GPU | 122.6 | 139.6 | 139.9 |
| Release，框架依赖，软件渲染 | **43.7** | 65.6 | 60.9 |

### 2.3 峰值工作集（MB）

| 配置 | empty | text | image |
|---|---|---|---|
| Debug，GPU | 207.2 | 223.1 | 254.1 |
| Release，GPU | 196.1 | 222.8 | 238.8 |
| Release，AOT，GPU | 156.2 | 175.5 | 193.2 |
| Release，软件渲染 | 105.8 | 126.7 | 123.8 |

### 2.4 线程与句柄

| 配置 | 线程 | 句柄 |
|---|---|---|
| Release，GPU | 50 | 687~697 |
| Release，AOT，GPU | 43 | 584~591 |
| Release，软件渲染 | 28 | 525~527 |

## 三、怎么读这张表

**GPU 上下文本身要 90 MB 左右**（187.4 − 96.9）。这是 Skia + ANGLE/GLES 的固定成本，不是泄漏，也不随内容增长 —— 换成 Avalonia 一样要付。

**AOT 省 31 MB**（187.4 → 156.2），主要是省掉 JIT 与反射元数据。但 AOT 对 Avalonia 意味着 XAML 反射路径要全走编译绑定，874 个文件的 React 重写成 XAML 之后再上 AOT，成本远超这 31 MB 的价值。

**流式文本只多 32 MB**（187.4 → 219.7），400 行上限、每 40 ms 追加一行。这说明「一直出新内容」在 Avalonia 里也不是零成本，但量级可控。

**一张 2520×1680 的图约 14 MB**（187.4 → 200.9 的稳态差，理论位图 16.9 MB，实测更接近解码后的真实占用）。与我们截图工具产出的尺寸一致。

## 四、复现步骤

```powershell
cd experiments/avalonia-shell

# 三态基线（Release，GPU）
dotnet build -c Release
foreach ($s in @("empty","text","image")) {
  .\bin\Release\net10.0\WishfulClaw.AvaloniaProbe.exe --stage $s --seconds 12 --report ".probe\$s.json"
}

# 软件渲染
.\bin\Release\net10.0\WishfulClaw.AvaloniaProbe.exe --stage empty --software --seconds 12

# NativeAOT（需要 MSVC 工具链）
dotnet publish -c Release -r win-x64 --self-contained -p:PublishAot=true -p:StripSymbols=true -o publish-aot
```

程序跑满 `--seconds` 后自己退出，打一行 JSON 到控制台，给了 `--report` 就同时落盘。

**注意**：`WinExe` 在部分终端下拿不到控制台输出，以 `--report` 落盘的文件为准。

## 五、这个原型不回答的问题

- **WebView2 在 Avalonia 里的 CDP / 截图 / 元素树能力** —— 要另做一个原型，且结论基本可以预判（能力集不同、要重写控制层）。
- **874 个渲染层文件重写成 XAML 的人日** —— 这是评估报告里的另一块，与本原型无关。
- **发布链迁移成本**（MSIX / Velopack / 增量更新 / 签名）—— 同上。

这三块都不影响「不建议迁」的结论：**光是壳的基线就已经把收益吃光了。**
