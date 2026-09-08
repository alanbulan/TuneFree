# TuneFree Desktop 安装与运行

## 安装正式版

当前官方发布目标为 Windows x64 和 macOS 11+（Apple Silicon / Intel 通用包）。

### Windows

1. 打开 [GitHub Releases](https://github.com/alanbulan/TuneFree_Mobile/releases)。
2. 下载最新的 `TuneFree_{version}_x64-setup.exe`。
3. 运行安装程序并按向导完成安装。

### macOS

1. 从 [GitHub Releases](https://github.com/alanbulan/TuneFree/releases) 下载 `TuneFree_{version}_universal.dmg`。
2. 打开 DMG，将 `TuneFree.app` 拖入「应用程序」。
3. 从「应用程序」启动 TuneFree。

当前 Mac 包使用 ad-hoc 本地签名，尚未经过 Apple Developer ID 签名与公证。若系统阻止打开，请先确认安装包来自上述官方仓库，再到「系统设置 → 隐私与安全性」中找到本次拦截，选择「仍要打开」。不同 macOS 版本的界面文字可能不同。

Mac 支持保存自定义 AI 模型 API Key，密钥存入系统钥匙串（Keychain），可在应用设置中替换或清除。首次访问时如出现系统授权提示，请确认是 TuneFree 后允许访问。通用包包含两种 CPU 架构，但 CI 启动验收运行在 Apple Silicon runner 上，不等同于 Intel 实机或所有 macOS 版本的完整验收。

Mac 冒烟测试会显示主窗口以验证首帧，使用非持久化 WebView 和隔离数据目录。

同一版本中的 `.sig`、`.app.tar.gz` 和 `latest.json` 供应用自动更新使用，普通安装无需手动下载。Linux 当前没有官方安装包。

## 开发环境

需要安装：

- Node.js 24.15+
- npm 12.0.2
- Rust 1.98.1（由 `rust-toolchain.toml` 固定）
- Git
- Windows：Visual Studio C++ Build Tools、WebView2 Runtime
- macOS：Xcode Command Line Tools（`xcode-select --install`）

在 `tauri` 项目根目录执行：

```powershell
npm ci
npm run tauri dev
```

开发模式会启动：

- Vite：`http://127.0.0.1:3101`
- Tauri 本地服务：`http://127.0.0.1` 上的随机端口，端口和访问令牌由 `get_local_server_info` 命令下发

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

在 Mac 上生成通用包：

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npx tauri build --target universal-apple-darwin --bundles app,dmg
```

Tauri 自动合并 `src-tauri/tauri.macos.conf.json`，启用透明歌词窗口所需的 macOS API，并设置 DMG / APP 目标。产物位于 `src-tauri/target/universal-apple-darwin/release/bundle/`。启用更新资产签名时，需要配置 [RELEASE.md](./RELEASE.md) 中的 Tauri 签名环境变量。

`node_modules/`、`out/`、`coverage/` 和 `src-tauri/target/` 是本地依赖、测试覆盖率或构建缓存，不应提交。

## 常用检查

```powershell
npm run version:check
npm run typecheck
npm run lint
npm run architecture:check
npm test -- --run
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

`npm run test:coverage` 会额外生成 `coverage/lcov.info`。Clippy 的严格规则写在
`src-tauri/Cargo.toml` 的 `[lints]` 段，本地和 CI 的结论一致。

完整发布验证以 [RELEASE.md](./RELEASE.md) 和 `.github/workflows/validate.yml` 为准。
