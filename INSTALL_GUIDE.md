# TuneFree Desktop 安装与运行

## 安装正式版

当前官方发布目标为 Windows x64 和 macOS 11+（Apple Silicon / Intel 通用包）。

### Windows

1. 打开 [GitHub Releases](https://github.com/alanbulan/TuneFree/releases/latest)。
2. 下载最新的 `TuneFree_{version}_x64-setup.exe`。
3. 运行安装程序并按向导完成安装。

### macOS

1. 从 [GitHub Releases](https://github.com/alanbulan/TuneFree/releases/latest) 下载 `TuneFree_{version}_universal.dmg`。
2. 打开 DMG，将 `TuneFree.app` 拖入「应用程序」。
3. 从「应用程序」启动 TuneFree。

当前 Mac 包使用 ad-hoc 本地签名，尚未经过 Apple Developer ID 签名与公证。若系统阻止打开，请先确认安装包来自上述官方仓库，再到「系统设置 → 隐私与安全性」中找到本次拦截，选择「仍要打开」。不同 macOS 版本的界面文字可能不同。

平台账号与自定义模型 API Key 保存到系统凭据存储：Windows 使用凭据管理器，Mac 使用系统钥匙串（Keychain）。Mac 将三平台会话与模型密钥合并为一个条目，首次访问或应用签名变化时仍可能出现系统授权提示，请确认是 TuneFree 后处理。账号可在音乐库中连接或退出，模型密钥可在设置中替换或清除。

通用包包含两种 CPU 架构；CI 启动验收运行在 Apple Silicon runner 上，Intel 实机和其他 macOS 版本的验收范围见 [README](./README.md#工程质量)。

同一版本中的 `.sig`、`.app.tar.gz` 和 `latest.json` 供应用自动更新使用，普通安装无需手动下载。Linux 当前没有官方安装包。

## 开发环境

v1.1.46 的 CI 使用以下版本与平台组件：

- Node.js 26.13.0（与 CI 一致）
- npm 12.2.1
- Rust 1.99.1（由 `rust-toolchain.toml` 固定，最低 Rust 版本为 1.95）
- Git
- Windows：Visual Studio C++ Build Tools、WebView2 Runtime
- macOS：Xcode Command Line Tools（`xcode-select --install`）

优先沿用已有工具环境；Apple Silicon 本机使用 Homebrew 管理运行时，并通过项目锁文件安装依赖。`rust-toolchain.toml` 记录 CI 的 Rust 版本，不要求另外安装并行版本管理器。先用 `node --version`、`npm --version`、`rustc --version` 和 `cargo --version` 核对环境。

克隆仓库并切到桌面开发分支：

```sh
git clone --branch tauri https://github.com/alanbulan/TuneFree.git
cd TuneFree
```

在项目根目录执行：

```powershell
npm ci
npm run tauri dev
```

开发模式会启动：

- Vite：`http://127.0.0.1:3101`
- Tauri 本地服务：`http://127.0.0.1` 上的随机端口，端口和访问令牌由 `get_local_server_info` 命令下发

单独 `npm run dev` 只提供前端资源，账号、系统凭据、磁盘下载和推荐需要 Tauri 后端。结束本地开发时，在启动命令所在终端按 `Ctrl+C`。

## 本地构建

只验证桌面程序、不生成安装包：

```powershell
npx tauri build --no-bundle
```

生成 Windows NSIS 安装包：

```powershell
npm run tauri build
```

安装包输出目录：

```text
src-tauri/target/release/bundle/nsis/
```

在 Mac 上生成通用包，需要已有 Rust 工具链同时提供 `aarch64-apple-darwin` 与 `x86_64-apple-darwin` 的标准库及链接能力；仅构建本机架构无需另加 target。官方通用包由 GitHub Actions 配置双 target 构建。

```sh
npx tauri build --target universal-apple-darwin --bundles app,dmg
```

Tauri 自动合并 `src-tauri/tauri.macos.conf.json`，设置 DMG / APP 目标、最低 macOS 版本与本地签名。产物位于 `src-tauri/target/universal-apple-darwin/release/bundle/`。启用更新资产签名时，需要配置 [RELEASE.md](./RELEASE.md) 中的 Tauri 签名环境变量。

Tauri 的前置构建命令已执行 `npm run build`，不必额外重复构建前端。`node_modules/`、`out/`、`coverage/`、`test-results/` 和 `src-tauri/target/` 是本地依赖、测试结果或构建缓存，不应提交。

## 常用检查

```powershell
npm run version:check
npm run typecheck
npm run lint
npm run architecture:check
npm run test:coverage
npx playwright install chromium
npm run test:e2e
npm run audit
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked --test app_tests -- --include-ignored
```

`version:check` 是 dry-run，不修改版本。`npm run test:coverage` 生成 `coverage/lcov.info` 并检查 100% 行覆盖率阈值；快速运行单元测试可用 `npm test -- --run`。浏览器回归会启动生产前端并独占 3101 端口，先结束现有开发服务。Clippy 的严格规则写在 `src-tauri/Cargo.toml` 的 `[lints]` 段。

原生启动验收需先构建当前源码，再运行：

```sh
npx tauri build --no-bundle
npm run smoke
```

冒烟测试使用隔离 WebView、数据与下载目录，禁用模型和自动更新，验证界面挂载与本地服务健康；Mac 上会显示测试窗口，不会操作正式安装的账号。

完整发布验证以 [RELEASE.md](./RELEASE.md) 和 [共享 Validate 工作流](./.github/workflows/validate.yml) 为准。
