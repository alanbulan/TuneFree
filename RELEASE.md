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

下面这组命令与 `.github/workflows/validate.yml` 一一对应。打标签后 `Release signed desktop app`
工作流会先复用同一个 `Validate` 工作流，未通过则不会进入构建与签名步骤，所以本地跑通只是提前发现问题。

```powershell
npm ci
npm run version:check
npm run lint
npm run typecheck
npm run architecture:check
npm run test:coverage
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked
npx tauri build --no-bundle
git diff --exit-code
```

Clippy 的严格规则固化在 `src-tauri/Cargo.toml` 的 `[lints]` 段（`too_many_lines`、`dbg_macro`、
`todo`、`unsafe_code`），命令行不再重复列举；`npx tauri build --no-bundle` 已经通过
`beforeBuildCommand` 执行过 `npm run build`，不需要另外单独构建前端。

## 提交与标签

版本号与标签必须一致。例如当前版本升级为 `1.1.24` 时：

```powershell
git add -A
git commit -m "release: publish v1.1.24"
git tag -a v1.1.24 -m "TuneFree v1.1.24"
git push origin tauri
git push origin v1.1.24
```

推送 `v*` 标签后，GitHub Actions 的 `Release signed desktop app` 工作流按顺序执行：

1. `Validate` 可复用工作流（lint / typecheck / architecture / vitest / fmt / clippy / cargo test / tauri build）。
2. 校验标签与 `src-tauri/tauri.conf.json` 的版本号一致。
3. 构建、签名并创建**草稿 Release**，附带：

- `TuneFree_{version}_x64-setup.exe`
- `TuneFree_{version}_x64-setup.exe.sig`
- `latest.json`
- 自动生成的版本说明

## 手动发布闸门

工作流只创建草稿（`releaseDraft: true`），不会自动公开。

`src-tauri/tauri.conf.json` 的 updater endpoint 指向
`https://github.com/alanbulan/TuneFree_Mobile/releases/latest/download/latest.json`，
只要草稿被 Publish 为正式 Release，所有已安装客户端下一次检查更新就会立即拉到该版本。
因此必须先完成下面的"发布后核验"，确认无误后再在 GitHub Releases 页面手动点击 Publish。

草稿如需作废，直接删除草稿 Release 与对应标签即可，不会影响任何已安装客户端。

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

以下 1-6 项在草稿状态下完成，全部通过后再手动 Publish，第 7 项在 Publish 之后确认。

1. `validate` 与 `release-windows-x64` 两个 job 结论均为 success。
2. Release 标签和目标提交与本次发布一致。
3. 三个发布资产均存在且非空。
4. `latest.json.version` 与标签一致。
5. `latest.json` 的 `windows-x86_64` URL 指向本次安装包，签名字段非空。
6. 本地 `tauri` 分支与 `origin/tauri` 同步且工作区干净。
7. Publish 后用一台旧版本客户端验证自动更新链路可用。

安装包只发布到 GitHub Releases，不提交到源码目录。
