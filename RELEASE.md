# TuneFree Desktop 发布流程

正式版本只从 `tauri` 分支发布。公开发布页：<https://github.com/alanbulan/TuneFree_Mobile/releases>。

## 版本升级

补丁版本：

```powershell
npm run version:bump
```

也可使用 `version:bump:minor` 或 `version:bump:major`。脚本会同步更新：

- `package.json`
- `package-lock.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`

升级后执行：

```powershell
npm run version:check
```

## 发布前验证

```powershell
npm ci
npm run version:check
npm run lint
npm run typecheck
npm run architecture:check
npm test -- --run
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings -D clippy::too_many_lines
cargo test --manifest-path src-tauri/Cargo.toml --locked
npx tauri build --no-bundle
git diff --check
```

## 提交与标签

版本号与标签必须一致。例如当前版本升级为 `1.1.24` 时：

```powershell
git add -A
git commit -m "release: publish v1.1.24"
git tag -a v1.1.24 -m "TuneFree v1.1.24"
git push origin tauri
git push origin v1.1.24
```

推送 `v*` 标签后，GitHub Actions 的 `Release signed desktop app` 工作流会构建、签名并发布：

- `TuneFree_{version}_x64-setup.exe`
- `TuneFree_{version}_x64-setup.exe.sig`
- `latest.json`
- 自动生成的版本说明

## 签名配置

Updater 公钥保存在 `src-tauri/tauri.conf.json`。私钥和密码不得提交到仓库：

- 本机私钥：`%LOCALAPPDATA%\TuneFree\signing\updater.key`
- 本机 DPAPI 密码备份：`%LOCALAPPDATA%\TuneFree\signing\updater.key.password.dpapi`
- GitHub Secret：`TAURI_SIGNING_PRIVATE_KEY`
- GitHub Secret：`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

读取当前 Windows 用户的 DPAPI 密码备份：

```powershell
$encrypted = Get-Content -Raw "$env:LOCALAPPDATA\TuneFree\signing\updater.key.password.dpapi"
$password = [System.Net.NetworkCredential]::new('', (ConvertTo-SecureString $encrypted)).Password
```

首个签名版本发布后不能替换 updater 公钥，否则已安装客户端无法验证后续更新。

## 发布后核验

1. 工作流结论为 success。
2. Release 标签和目标提交与本次发布一致。
3. 三个发布资产均存在且非空。
4. `latest.json.version` 与标签一致。
5. `latest.json` 的 `windows-x86_64` URL 指向本次安装包，签名字段非空。
6. 本地 `tauri` 分支与 `origin/tauri` 同步且工作区干净。

安装包只发布到 GitHub Releases，不提交到源码目录。
