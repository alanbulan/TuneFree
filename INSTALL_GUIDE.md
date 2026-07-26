# TuneFree Desktop 安装与运行

## 安装正式版

当前官方发布目标为 Windows x64。

1. 打开 [GitHub Releases](https://github.com/alanbulan/TuneFree_Mobile/releases)。
2. 下载最新的 `TuneFree_{version}_x64-setup.exe`。
3. 运行安装程序并按向导完成安装。

同一版本中的 `.sig` 和 `latest.json` 供应用自动更新使用，普通安装无需手动下载。macOS 和 Linux 当前没有官方安装包。

## 开发环境

需要安装：

- Node.js 20.19+、22.12+ 或 24
- npm
- Rust stable 工具链
- Git
- Windows：Visual Studio C++ Build Tools、WebView2 Runtime

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
