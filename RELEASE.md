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
npm run audit
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked --test app_tests -- --include-ignored
npx tauri build --no-bundle
npm run smoke
git diff --exit-code
```

Clippy 的严格规则固化在 `src-tauri/Cargo.toml` 的 `[lints]` 段（`too_many_lines`、`dbg_macro`、
`todo`、`unsafe_code`），命令行不再重复列举；`npx tauri build --no-bundle` 已经通过
`beforeBuildCommand` 执行过 `npm run build`，不需要另外单独构建前端。

## 提交与标签

版本号与标签必须一致。例如当前版本升级为 `1.1.30` 时：

```powershell
git add -A
git commit -m "release: prepare v1.1.30"
git tag -a v1.1.30 -m "TuneFree v1.1.30"
git push origin tauri
git push origin v1.1.30
```

推送 `v*` 标签后，GitHub Actions 的 `Release signed desktop app` 工作流按顺序执行：

1. `Validate` 可复用工作流（lint / typecheck / architecture / vitest / audit / fmt / clippy / cargo test / tauri build / smoke）。
2. 校验标签与 `src-tauri/tauri.conf.json` 的版本号一致。
3. 构建、签名并上传到草稿 Release（`releaseDraft: true`），确认资产齐全后保留草稿，附带：

- `TuneFree_{version}_x64-setup.exe`
- `TuneFree_{version}_x64-setup.exe.sig`
- `latest.json`
- 自动生成的版本说明

## 草稿构建与手动发布

推送 `v*` 标签后，工作流自动完成验证、构建、签名和资产检查，最终停在草稿 Release。
维护者完成下方的发布前核验后，在 GitHub 草稿页面点击 **Publish release**。只有高于已有正式版本的新版本才设为 `latest`。
不同标签共用发布互斥组；草稿尚未公开时，现有客户端继续使用已发布版本的更新信息。

`scripts/publish-release.mjs` 默认只检查草稿资产。仅显式传入 `--publish` 才会公开并按版本顺序决定是否更新 `latest`；自动构建工作流不传此参数。

闸门由 `validate` job 承担——它是 `release-windows-x64` 的 `needs` 前置，未通过则构建与签名步骤
根本不会执行，因此未经验证的提交不可能产出发布资产。这是本流程唯一的质量保障，不要移除该依赖。

`src-tauri/tauri.conf.json` 的 updater endpoint 指向
`https://github.com/alanbulan/TuneFree_Mobile/releases/latest/download/latest.json`，
新版本 Release 公开并设为 `latest` 后，已安装客户端下一次检查更新会获取该版本。

打标签前完成本地发布前验证，工作流成功后再检查草稿资产并手动公开。

发布后若发现问题，需要立刻删除该 Release 与对应标签（客户端会回落到上一个 `latest`），
再修复并发布新的补丁版本。

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

## 草稿发布前核验

Release 应保持草稿。以下核验完成后再公开；构建或检查失败时先修复，不公开不完整的更新包。

1. `validate` 与 `release-windows-x64` 两个 job 结论均为 success。
2. Release 标签和目标提交与本次发布一致。
3. 三个发布资产均存在且非空。
4. `latest.json.version` 与标签一致。
5. `latest.json` 的 `windows-x86_64` URL 指向本次安装包，签名字段非空。
6. 本地 `tauri` 分支与 `origin/tauri` 同步且工作区干净。
7. 确认草稿说明后点击 **Publish release**，新版本设为 `latest`；公开后用一台旧版本客户端验证自动更新链路可用。

安装包只发布到 GitHub Releases，不提交到源码目录。

冒烟测试默认只验收当前 release 产物；代码比产物新时会拒绝执行。测试使用临时 WebView、数据库、配置和下载目录，并禁用云端模型与自动更新；主界面挂载且本地 HTTP 服务健康检查通过才会成功。
