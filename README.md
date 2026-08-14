# DSH Desktop

> 面向 [`@deepseek-ai/dsh`](https://github.com/deepseek-ai/deepseek-harness) 的开源桌面客户端 ——
> 把 dsh 的 Web UI 装进一个原生窗口里，省去手动在浏览器里打开本地服务的麻烦。

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-二次开发-orange)
![Repo](https://img.shields.io/badge/github-MonshinYu%2Fdsh--desktop-181717?logo=github)

---

## 目录

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [关于构建产物：无需 Node / Bun 环境](#关于构建产物无需-node--bun-环境)
- [下载与安装（最终用户）](#下载与安装最终用户)
- [从源码运行（开发者）](#从源码运行开发者)
- [从源码构建打包](#从源码构建打包)
- [项目架构](#项目架构)
- [使用到的开源库与出处](#使用到的开源库与出处)
- [关于开源二创（Fork / 二次开发）声明](#关于开源二创fork--二次开发声明)
- [未来计划：Tauri 二次重构](#未来计划tauri-二次重构)
- [贡献与反馈](#贡献与反馈)
- [常见问题](#常见问题)
- [开发者信息](#开发者信息)

---

## 项目简介

**DSH Desktop** 是一个 Electron 桌面应用，封装了 DeepSeek 官方的 `dsh`（DeepSeek Harness）CLI 调用。

`dsh` 本身是一个 Node.js 命令行工具，启动后会在本地 `127.0.0.1:3080` 监听一个 Web UI（浏览器界面）。DSH Desktop 做的工作就是：

1. 在后台 `spawn` 一个 Electron 子进程，以 `ELECTRON_RUN_AS_NODE=1` 让它当作 Node 运行时，跑起 `@deepseek-ai/dsh` 的 `web` 子命令。
2. 自动扫描一段空闲端口（默认从 3080 开始）来避免端口冲突。
3. 解析子进程 stdout 中的 `dsh web: http://127.0.0.1:xxxx/` 地址，把它塞进一个 `BrowserWindow` 里的 `<iframe>`。
4. 套上原生窗口外观（macOS 的 `hiddenInset`、Windows 的 `hiddenInset` overlay）、主题色同步、启动 Splash 动画等桌面化体验。
5. `iframe` 加载完成后优雅地淡出 Splash，关窗时一并清理子进程。

适合不想每次都打开终端、敲 `dsh web` 然后手动复制链接到浏览器的用户。

---

## 核心特性

- ✅ **零依赖安装**：构建产物已自带 Node 运行时（Electron 的 Node 嵌入在二进制里），安装包里就已经把一切打好了，**用户无需安装 Node.js，无需安装 Bun**
- ✅ **三平台原生包**：macOS（DMG / ZIP）、Windows（NSIS Setup）、Linux（AppImage）原生安装包
- ✅ **原生窗口外观**：macOS hiddenInset 标题栏、Windows 透明 overlay 标题栏，跟随 dsh Web UI 的明暗主题自动切换
- ✅ **智能端口处理**：自动探测空闲端口，遇到 `EADDRINUSE` 自动换端口重试
- ✅ **完整生命周期管理**：单实例锁、退出时优雅回收子进程、Dock 图标 / 任务栏图标行为适配
- ✅ **外部链接外跳**：所有 `window.open` 自动用系统默认浏览器打开
- ✅ **启动 Splash**：冷启动时显示应用 Logo + 进度条，Web UI 加载完毕后平滑收起
- ✅ **自适应主题**：跟随系统 `prefers-color-scheme`，并尊重 dsh 自家的 `settings.yaml` 用户偏好

---

## 关于构建产物：无需 Node / Bun 环境

这是本项目最重要的设计点之一 —— **最终用户拿到的安装包是一个完全自包含的二进制**。

### 为什么不需要 Node？

打包用的是 [Electron](https://www.electronjs.org/) 43.x，而 Electron 二进制本身已经把 Node.js 嵌进去了。`electron-builder` 打包时：

1. `electron-builder.json5` 里 `files: ["dist", "dist-electron"]` 把渲染层与主进程 build 产物打进去；
2. `npmRebuild: false` —— 跳过原生模块的本地编译步骤；
3. `asarUnpack: ["node_modules/**"]` —— 把 `@deepseek-ai/dsh` 的依赖解包到 `app.asar.unpacked`（这部分运行时需要从磁盘真实读取，不能压缩进 asar）；
4. `electron/main.ts` 里通过 `process.execPath` 启动 Electron 子进程，并设置 `ELECTRON_RUN_AS_NODE=1` 让它当作 Node 跑 `dsh web`；
5. 所以**用户机器上完全不需要预装 Node.js，也不需要预装 Bun**。整个运行时都封装在安装包里。

### 实际产物大小参考

参见 `release/0.0.0/` 目录（一次完整打包的输出）：

| 平台 | 产物 | 体积 |
| --- | --- | --- |
| macOS | `DSH Desktop-Mac-0.0.0-Installer.zip` | ~163 MB |
| Windows | `DSH Desktop-Windows-0.0.0-Setup.exe` | ~144 MB |
| Linux | `DSH Desktop-Linux-0.0.0.AppImage` | ~163 MB |

体积主要是 Electron 运行时 + Node.js 嵌入 + Chromium，属于 Electron 应用的普遍水平。看到这个体积不要慌——这正是下面「未来计划」想用 Tauri 解决的问题。

### 哪些是开发时需要的？

只有 **从源码构建** 时才需要：

- Node.js ≥ 18（推荐 Bun，可同时使用）
- 操作系统对应的构建工具（macOS 需要 Xcode CLT；Windows 需要 VS Build Tools；Linux 需要 `dpkg` / `fakeroot` 等 AppImage 工具链）

也就是说： **开发需要 Node/Bun，运行不需要**。

---

## 下载与安装（最终用户）

> 前往 [Releases](https://github.com/MonshinYu/dsh-desktop/releases) 页面下载对应平台的安装包。

### macOS

1. 下载 `DSH Desktop-Mac-{version}-Installer.dmg`（或 `.zip`）。
2. 双击 `.dmg`，把 `DSH Desktop.app` 拖进 `/Applications`。
3. 首次打开若提示「未识别的开发者」，到 `系统设置 → 隐私与安全性` 点「仍要打开」。
4. 启动后会自动拉起内置的 dsh Web UI，无需任何额外配置。

### Windows

1. 下载 `DSH Desktop-Windows-{version}-Setup.exe`。
2. 运行安装包，可自定义安装路径（默认 `C:\Users\<you>\AppData\Local\Programs\DSH Desktop`）。
3. 安装完成后从开始菜单启动。
4. 首次启动 Windows Defender SmartScreen 可能会拦截，点「更多信息 → 仍要运行」。

### Linux

1. 下载 `DSH Desktop-Linux-{version}.AppImage`。
2. 赋可执行权限：`chmod +x DSH\ Desktop-Linux-*.AppImage`。
3. 双击运行，或在终端 `./DSH\ Desktop-Linux-*.AppImage` 启动。
4. 如果 fuzz 报错，先安装 `fuse`：`sudo apt install fuse libfuse2`（Ubuntu 22.04+ 需要 `libfuse2`）。

### 首次运行

- 应用启动后会出现 Splash 动画（Splash 期间后端已经在拉 dsh 进程）。
- 大约 1～3 秒后会自动打开主窗口并滑入 dsh Web UI。
- 所有数据（会话、设置、缓存）存放在 `app.getPath('userData')` 下的 `dsh/` 子目录：
  - macOS: `~/Library/Application Support/DSH Desktop/dsh/`
  - Windows: `%APPDATA%\DSH Desktop\dsh\`
  - Linux: `~/.config/DSH Desktop/dsh/`

---

## 从源码运行（开发者）

### 1. 克隆与安装

```bash
git clone https://github.com/MonshinYu/dsh-desktop.git
cd dsh-desktop

# 推荐使用 Bun（已含 bun.lock）
bun install

# 或使用 Node
npm install
```

### 2. 开发模式

```bash
bun run dev        # 等价于 npx vite，Electron 主进程 HMR + 渲染层 HMR
```

这条命令会同时：

- 启动 Vite Dev Server（渲染层，端口 5173）
- 编译并启动 Electron 主进程（通过 `vite-plugin-electron`）
- 监听 `electron/*.ts` 与 `src/*.ts` 的变更自动热重载

### 3. 预览生产构建

```bash
bun run build      # tsc 类型检查 + vite 打包 + electron-builder 打包
# 或只跑前端打包：
bun run build -- --mode production   # 注意：脚本里 -mwl 会触发跨平台构建
```

如需调试打包后的运行时，可以只跑 `vite build` 然后手启 Electron：

```bash
npx vite build
npx electron dist-electron/main.js
```

---

## 从源码构建打包

### 一次性构建当前平台

```bash
bun run build
```

脚本内部是 `tsc && vite build && electron-builder -mwl`，`-mwl` 表示 macOS / Windows / Linux 三平台都构建（实际只能产出当前机器支持的平台，其它平台产物是无效占位）。

### 分别构建单一平台

```bash
# 仅 macOS
bunx electron-builder --mac

# 仅 Windows
bunx electron-builder --win

# 仅 Linux
bunx electron-builder --linux
```

### 产物输出

所有产物统一输出到 `release/${version}/`：

```
release/0.0.0/
├── DSH Desktop-Mac-0.0.0-Installer.dmg
├── DSH Desktop-Mac-0.0.0-Installer.zip
├── DSH Desktop-Windows-0.0.0-Setup.exe
├── DSH Desktop-Linux-0.0.0.AppImage
├── mac/                         # macOS 未打包的 .app（直接可运行）
├── win-unpacked/                # Windows 未打包的目录（直接可运行）
└── linux-unpacked/              # Linux 未打包的目录
```

### 自定义构建配置

主配置在 `electron-builder.json5`：

- `appId`: `com.deepseek.dsh-desktop`（沿用了 dsh 的命名空间，二次开发请改成你自己的）
- `productName`: `DSH Desktop`
- `asar` + `asarUnpack`: 必要配置，必须解包 `node_modules` 才能跑 dsh 子进程
- `nsis.oneClick: false` / `allowToChangeInstallationDirectory: true`: Windows 给用户选安装路径的自由

---

## 项目架构

```
dsh-desktop/
├── electron/                    # Electron 主进程 + Preload
│   ├── main.ts                  # 应用入口：单实例锁 / 窗口创建 / 生命周期
│   ├── preload.ts               # contextBridge：暴露 window.api 给渲染层
│   ├── dsh-server.ts            # ★ 核心：管理 dsh 子进程（启停 / 状态 / 端口）
│   ├── titlebar.ts              # 原生标题栏定制 + 主题同步注入
│   └── splash-theme.ts          # 解析 Splash 用色（dark / light 主题）
│
├── src/                         # 渲染层（Vite + 原生 TS + CSS）
│   ├── main.ts                  # 渲染层入口：监听 dsh 状态 → 设置 iframe.src
│   └── style.css                # 样式
│
├── index.html                   # 渲染层 HTML 骨架（含 Splash SVG、iframe）
├── vite.config.ts               # Vite 配置 + vite-plugin-electron
├── electron-builder.json5       # 打包配置
├── package.json                 # 脚本入口
├── tsconfig.json                # TypeScript 配置
└── bun.lock                     # 锁文件（Bun 优先）
```

### 数据流

```
用户双击图标
    │
    ▼
Electron 主进程启动 (electron/main.ts)
    │
    ├─► 创建 BrowserWindow（隐藏），显示 Splash
    │
    ├─► dshServer.start() ──► spawn Node 子进程
    │        │
    │        ▼
    │   @deepseek-ai/dsh web --port <free>
    │        │
    │        ▼
    │   stdout 解析 "dsh web: http://127.0.0.1:xxxx/"
    │        │
    │        ▼
    │   IPC → 渲染层收到 { state: 'ready', url }
    │
    ▼
渲染层拿到 url → 写入 <iframe>.src
    │
    ▼
iframe load 事件 → 淡出 Splash → 显示主窗口
```

---

## 使用到的开源库与出处

> 本项目是开源二创，下面列出所有引用的上游项目，致敬原作者。

### 直接依赖（运行时）

| 包 | 版本 | 许可证 | 用途 | 出处 |
| --- | --- | --- | --- | --- |
| [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) | `^0.1.0-rc.6` | MIT | **核心 CLI**：本项目内置它的 `web` 子命令，所有 UI 逻辑都来自它 | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) （`apps/cli` 子目录） |

`@deepseek-ai/dsh` 本身又是基于 [Cordis](https://github.com/deepseek-ai/cordis) 插件框架构建的，由 [deepseek-ai](https://github.com/deepseek-ai) 组织维护。

### 开发依赖

| 包 | 版本 | 用途 | 出处 |
| --- | --- | --- | --- |
| `electron` | `^43.4.0` | 桌面运行时（自带 Chromium + Node.js） | [electron/electron](https://github.com/electron/electron) |
| `electron-builder` | `^24.13.3` | 跨平台打包为安装包 | [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder) |
| `vite` | `8.0.16` | 渲染层构建工具 | [vitejs/vite](https://github.com/vitejs/vite) |
| `vite-plugin-electron` | `^0.28.6` | Vite 与 Electron 主进程的集成 | [electron-vite/vite-plugin-electron](https://github.com/electron-vite/vite-plugin-electron) |
| `vite-plugin-electron-renderer` | `^0.14.5` | 渲染层直接使用 Node API | 同上 |
| `typescript` | `^5.2.2` | 类型检查 | [microsoft/TypeScript](https://github.com/microsoft/TypeScript) |

### 间接依赖（通过 dsh 引入）

dsh 把这些都装在内置的 `node_modules` 里，应用启动时直接复用：

- `cordis` (DeepSeek 维护的 IoC 插件框架)
- `@deepseek-ai/cordis-plugin-*` (HMR / 加载器 / 计时器插件)
- `@deepseek-ai/dsh-*` (cli / boot / base / web-app / headless / 工具集 / 终端 / Python / 人设 / 计划模式 / 子代理 / ... 30+ 子包)
- `commander` (CLI 参数解析)
- `js-yaml` (配置解析)

所有上游组件均以 MIT 协议开源。

---

## 关于开源二创（Fork / 二次开发）声明

本项目 **不是** DeepSeek 官方出品，也不是 `@deepseek-ai/dsh` 的官方桌面客户端。

- 本项目是由社区开发者基于 [`@deepseek-ai/dsh`](https://github.com/deepseek-ai/deepseek-harness) 的开源代码二次封装而成，遵守上游 MIT 协议。
- 应用内出现「DeepSeek」「DEEPSEEK」字样是上游 `dsh` 的 web UI 自带内容，本项目没有修改或冒充 DeepSeek 官方。
- 应用内出现 `com.deepseek.dsh-desktop` 这个 appId 是临时沿用 dsh 的命名空间，**正式发布前请改成你自己的反向域名**（例如 `com.yourname.dsh-desktop`），以避免与未来的潜在官方桌面端冲突。
- 所有运行数据（API Key、会话、配置）都由本地 dsh 进程管理，**不上传任何数据到第三方服务器**。
- 本项目不隶属于 DeepSeek 官方，亦不代表 DeepSeek 公司的意见或立场。

如上游 `dsh` 项目对命名空间、二次开发有进一步约定，请以最新上游协议为准。

---

## 未来计划：Tauri 二次重构

> 开发者正在研究通过 Tauri 二次开发这个项目。

### 为什么想换 Tauri？

当前 Electron 方案的代价是肉眼可见的 —— 安装包 150+ MB、内存占用 300+ MB、冷启动慢。开发者正在评估基于 [Tauri](https://tauri.app/) 的全新实现，核心优势：

| 维度 | 当前 Electron | 计划中的 Tauri |
| --- | --- | --- |
| 运行时 | Chromium + Node.js 嵌入 | 系统原生 WebView (WKWebView / WebView2 / WebKitGTK) |
| 安装包体积 | ~150 MB | 预计 **< 10 MB** |
| 内存占用 | 300+ MB | 预计 **< 100 MB** |
| 冷启动时间 | 2–4 秒 | 预计 **< 1 秒** |
| 后端语言 | TypeScript | **Rust** （更安全、更快） |
| 运行时自带 | Node.js（嵌入） | **Bun（内置）** |

### 关于 Bun

Tauri 内置 Bun 当作 JS/TS 运行时（无需用户安装 Node），比 Node.js 启动更快、文件 IO 更猛，而且天生的 TS / ESM 友好 —— 跟 Electron 时代把 Node 塞进二进制的思路完全一致，但体积与速度都更优。

> 一个 Rust 后端 + Bun 跑前端 + 系统 WebView 渲染 = 体积更小、速度更快、内存更少。

### 当前状态

- 🔍 调研阶段：评估 `@deepseek-ai/dsh` 在 Bun 下的兼容性、Cordis 插件体系在 Bun 下的运行表现
- 🧪 已构思架构：Rust 端通过 `Command` 启动 Bun 子进程跑 `dsh web`，再用 `tauri::WebviewWindow` 加载本地服务
- ⏳ 暂未发布 v2 仓库：等架构验证稳定后，会在另一仓库以 `dsh-desktop-tauri` 命名发起

---

## 常见问题

### Q: 启动后白屏很久？
A: 第一次启动时 `dsh` 需要初始化 `$DSH_HOME/profiles/web`（约 1–3 秒），再下载/编译少量依赖。如果卡在 Splash 超过 30 秒，查看日志：
- macOS: `~/Library/Logs/DSH Desktop/dsh-server.log`
- Windows: `%APPDATA%\DSH Desktop\logs\dsh-server.log`
- Linux: `~/.config/DSH Desktop/logs/dsh-server.log`

### Q: 端口冲突怎么办？
A: dsh-server 默认从 3080 开始扫描，遇到占用自动递增直到 3129。绝大多数情况够用。如果都不空闲，切到 `dsh:retry` 通道（Electron DevTools 里调用 `window.api.retry()`）。

### Q: 能不能离线用？
A: 因为 dsh 本身需要连接大模型 API，离线时不工作；但 DSH Desktop 本身没有任何必须联网的部分。

### Q: 与官方 `dsh web` 命令的关系？
A: 完全等价。DSH Desktop 内部跑的就是 `dsh web --port <port>`，你可以同时在终端跑 `dsh web`，两者用的 profile 目录相同。

### Q: 如何升级？
A: 重新下载安装包覆盖安装即可。`$DSH_HOME/dsh/` 下的会话数据保留。

### Q: License？
A: 本项目以 MIT 协议开源（沿用上游 dsh 的协议）。详见 [LICENSE](./LICENSE)。

---

## 贡献与反馈

- 🐛 **Bug 报告**：[新建 Issue](https://github.com/MonshinYu/dsh-desktop/issues/new?template=bug_report.yml)
- 💡 **特性提议**：[新建 Issue](https://github.com/MonshinYu/dsh-desktop/issues/new?template=feature_request.yml)
- ❓ **使用问题**：[新建 Issue](https://github.com/MonshinYu/dsh-desktop/issues/new?template=question.yml)
- 🔧 **Pull Request**：欢迎 fork 后提交 PR，参考 [PR 模板](./.github/PULL_REQUEST_TEMPLATE.md)
- 💬 **Discussions**：功能讨论、玩法分享、roadmap 同步 → [GitHub Discussions](https://github.com/MonshinYu/dsh-desktop/discussions)
- 📦 **下载 Release**：[Releases 页面](https://github.com/MonshinYu/dsh-desktop/releases)

---

## 开发者信息

- **项目名**：DSH Desktop
- **仓  库**：[github.com/MonshinYu/dsh-desktop](https://github.com/MonshinYu/dsh-desktop)
- **所有者**：MonshinYu
- **性质**：开源二创（基于 [`@deepseek-ai/dsh`](https://github.com/deepseek-ai/deepseek-harness)）
- **开发者**：正在研究 Tauri 二次重构，期望以 Rust + Bun 实现更轻量的桌面端
- **License**：MIT

> 如果你也在封装一个 AI CLI 的桌面客户端，欢迎交流 forked 经验。
