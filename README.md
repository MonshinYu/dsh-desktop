# DeepSeek Harness Desktop (dsh-desktop)

DeepSeek Harness 的桌面客户端。为 [@deepseek-ai/dsh](https://www.npmjs.com/package/@deepseek-ai/dsh) 提供原生桌面外壳:内置 Bun 打包的 dsh 运行时、系统托盘、开机启动 dsh 本地服务,并以 iframe 承载其 Web 界面。

## 特性

- **零依赖运行时** — dsh 运行时由 Bun 编译为单个可执行文件 (`runtime/dsh`),随应用一起分发,无需用户安装 Node.js
- **兼容层** — 通过影子化 `node_modules` 与 Node 子进程重定向,让 dsh 在 Bun 下以与 Node 完全一致的方式启动
- **嵌入式 zstd archive** — `node_modules` 与兼容层以自定义 `DSHA` 格式(zstd 单 frame)内嵌进二进制,首次启动解压到 `~/.cache/dsh/<hash>/`,内容不变缓存永久有效
- **系统托盘** — 显示/隐藏窗口、使用默认浏览器打开、开发者控制台、退出;关闭窗口最小化到托盘
- **自动端口管理** — 启动时自动选择可用端口,运行中若端口变化(dsh 重启)前端自动跟随跳转
- **启动动画** — 加载态 splash(品牌 logo 绘制动画),dsh 服务就绪后淡出并载入 iframe

## 架构

```
┌─────────────────────────── dsh-desktop ───────────────────────────┐
│                                                                   │
│  ┌─────────────────────────────┐        ┌──────────────────────┐  │
│  │  Tauri shell (Rust)         │        │  Frontend (TS/Vite)  │  │
│  │  · 启动/守护 runtime/dsh     │  IPC   │  · splash 加载动画     │  │
│  │  · 系统托盘                  │◄─────►│  · 轮询 check_page     │  │
│  │  · 端口分配与监控             │  port  │  · iframe 承载 Web UI  │  │
│  └──────────────┬──────────────┘        └──────────┬───────────┘  │
│                 │ spawn                             │ http://     │
│                 ▼                                   ▼             │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  runtime/dsh  (Bun 编译的独立可执行文件)                      │  │
│  │  ┌───────────────────────────────────────────────────────┐  │  │
│  │  │  main.ts 启动器                                        │  │  │
│  │  │   · dev: 直接用源码树,不碰 archive                     │  │  │
│  │  │   · bin: 解压 .dsh-archive.bin → ~/.cache/dsh/<hash>/ │  │  │
│  │  │   · spawn bun --preload lib/.dsh-preload.js dsh/bin  │  │  │
│  │  └───────────────────────────────────────────────────────┘  │  │
│  │  lib/preload.js  影子 node_modules + Node API 重定向        │  │
│  │  node_modules    @deepseek-ai/dsh 及其依赖                   │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

### 运行时启动流程

1. Tauri shell 在 setup 阶段获取可用端口,spawn `runtime/dsh`
2. dsh 启动器对内嵌 archive 做 sha256,定位 `~/.cache/dsh/<hash>/`
   - 命中 marker → 直接复用缓存,**热启动 ≈ 400ms**
   - 未命中 → 单次 zstd 解压(33k 个文件),**冷启动 ≈ 5–6s**
3. 前端轮询 `check_page`(每 1s),dsh 的 HTTP 服务就绪后把 iframe 指向 `http://127.0.0.1:<port>`
4. 运行期间每 3s 检测端口 generation,端口变化(进程重启)时自动重新加载 iframe

## 目录结构

```
dsh-desktop/
├── src/                        # 前端:启动 splash + iframe 宿主
│   ├── main.ts                 #   轮询/加载/端口变更跟随
│   └── assets/                 #   logo 与图标
├── src-tauri/                  # Tauri 壳 (Rust)
│   ├── src/main.rs             #   启动 runtime、托盘、窗口事件
│   └── src/core/               #   端口分配、状态存储、托盘
├── plugins/dsh-bun-pkg/        # Bun 打包插件(独立仓库 clone 而来)
│   ├── main.ts                 #   启动器
│   ├── lib/                    #   Node 兼容垫片
│   ├── scripts/embed.ts        #   DSHA archive 构建
│   └── target/dsh              #   `bun build --compile` 产物
├── runtime/                    # 构建产物,被 src-tauri bundle 为资源
│   └── dsh                     #   最终随应用分发的可执行文件
├── scripts/
│   ├── clone_runtime_build_lib.ts   # git clone dsh-bun-pkg
│   └── build_runtime.ts             # bun install → build → runtime/
└── index.html                  # 宿主页面(splash + iframe)
```

## 环境要求

- [Bun](https://bun.sh/) ≥ 1.x(构建与运行脚本依赖)
- [Rust](https://www.rust-lang.org/) stable + Tauri 2 的[系统依赖](https://tauri.app/start/prerequisites/)(macOS: Xcode CLT;Windows: WebView2 + MSVC;Linux: webkit2gtk 等)
- Node.js(仅运行时兼容层重定向 worker_threads 时使用,不是用户要求)

## 开发

```bash
bun install            # 安装前端依赖

# 方式一:先构建运行时再跑 Tauri dev
bun run clone:runtime:lib
bun run build:runtime
bun run tauri dev
```

## 构建与打包

```bash
bun run tauri:build
# = bun run clone:runtime:lib   # clone 最新 dsh-bun-pkg
# + bun run build:runtime       # bun install + build → runtime/dsh
# + bun tauri build             # 产出安装包(dmg/msi/AppImage 等)
```

`runtime/` 与 `src/assets/` 作为资源打包进应用(runtime/dsh 约 110 MB)。

## 常见问题

**想强制重新解压运行时缓存?**
删除 `~/.cache/dsh/` 即可,下次启动会重新解压。

**自定义 dsh-bun-pkg?**
`scripts/clone_runtime_build_lib.ts` 中的 `REPO_URL` 指向你的 fork 后重新执行 `bun run tauri:build`。

**开发控制台/浏览器打开?**
通过托盘菜单:右键托盘图标 → 「链接」→「打开开发者控制台」或「使用默认浏览器打开」。

## License

MIT © [MonshinYu](https://github.com/MonshinYu)
