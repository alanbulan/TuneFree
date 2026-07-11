# TuneFree 发布流程

公开发布页：<https://github.com/alanbulan/TuneFree_Mobile/releases>

1. 执行 `npm run version:bump`，或使用 `version:bump:minor`、`version:bump:major`。
2. 执行 `npm run version:check`，确认 package、Tauri、Cargo 和锁文件版本一致。
3. 提交版本变更并推送与版本一致的标签，例如 `v1.1.20`。
4. GitHub Actions 的 `Release signed desktop app` 工作流会构建 NSIS 安装包、更新签名和 `latest.json`。

Updater 公钥已提交到 `src-tauri/tauri.conf.json`。私钥没有进入仓库：

- 本机备份：`%LOCALAPPDATA%\TuneFree\signing\updater.key`
- 本机密码备份：`%LOCALAPPDATA%\TuneFree\signing\updater.key.password.dpapi`
- GitHub Secrets：`TAURI_SIGNING_PRIVATE_KEY`
- GitHub Secrets：`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

密码备份由当前 Windows 用户的 DPAPI 加密，只能在当前用户上下文中解密。恢复时执行：

```powershell
$encrypted = Get-Content -Raw "$env:LOCALAPPDATA\TuneFree\signing\updater.key.password.dpapi"
$password = [System.Net.NetworkCredential]::new('', (ConvertTo-SecureString $encrypted)).Password
```

私钥和密码必须同时备份到安全位置。丢失后无法为已安装客户端发布可验证的后续更新；首个签名版本发布后不得重新生成并覆盖现有公钥。

发布后应确认 Release 中同时存在以下公开产物：

- Windows x64 NSIS 安装包 `TuneFree_{version}_x64-setup.exe`。
- 与安装包配套的 `.sig` 签名文件。
- 自动更新清单 `latest.json`。
- 由提交记录生成的版本说明。

同时检查 `latest.json` 的 `windows-x86_64` URL、版本号与签名均指向本次产物。安装包应作为 GitHub Release Asset 发布，不再提交到源码目录。
