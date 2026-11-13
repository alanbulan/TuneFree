# iOS 预览与发布

Flutter iOS 端与 Android 端共用首页、搜索、播放器、歌单和独立音源管理页；界面跟随浅色／深色模式及强调色。iOS 15.0 及以上支持，已迁移到 UIScene 生命周期，以适配 iOS 27 SDK 的启动要求。关于页显示 iOS 功能和发布记录入口，Android APK 更新器只用于 Android。

## GitHub 预览包

`iOS Preview` 工作流固定 Flutter 3.50.0 与 Xcode 27.2，构建模拟器应用，在 iPhone 模拟器执行启动、音源检测、保存恢复、搜索、原生音频播放和离线文件播放检查，然后构建未签名的真机 Release 应用。工作流上传两种 `.app.zip`、`IOS-SHA256SUMS`、构建信息和实际界面截图。

- `tunefree-ios-simulator-1.0.8-debug.app.zip`：用于 Apple Silicon Mac 的 iOS 模拟器。
- `tunefree-ios-device-1.0.8-release-unsigned.app.zip`：真机 Release 编译产物，供后续签名准备；尚不能直接安装到 iPhone。

模拟器安装：

```bash
ditto -x -k tunefree-ios-simulator-1.0.8-debug.app.zip ios-simulator
xcrun simctl install booted ios-simulator/Runner.app
xcrun simctl launch booted com.alanbulan.tunefree
```

本地构建和运行：

```bash
flutter pub get --enforce-lockfile
flutter devices
flutter run -d <iOS模拟器ID>
flutter build ios --simulator --debug
flutter build ios --release --no-codesign
```

可复现的模拟器检查（两个终端）：

```bash
python3 tool/ios_api_fixture.py
```

```bash
flutter drive --driver=test_driver/ios_smoke_driver.dart \
  --target=integration_test/ios_smoke_test.dart -d <iOS模拟器ID> \
  --dart-define=IOS_SMOKE_API_BASE=http://127.0.0.1:8765
```

首页截图来自实际平台榜单；播放验证使用本机 HTTP 固定歌曲与静音 WAV 载荷，验证请求、AVFoundation 和文件路径，线上服务可用性另行核验。Android 的原生实时频谱目前只在 Android 提供。

## iPhone／TestFlight 发布

GitHub 下载的模拟器应用和未签名真机应用不会绕过 Apple 的签名流程。iPhone 安装需要适用的 Apple 开发者证书和描述文件；TestFlight／App Store 还需要 Apple Developer Program、已注册的 Bundle ID、App Store Connect 应用以及上传权限。

本仓库尚未配置 iOS 签名或 App Store Connect Secrets。配置自己的开发团队及导出方式后，可生成可安装 IPA：

```bash
flutter build ipa --release --export-options-plist=<ExportOptions.plist>
```

TestFlight／App Store 的签名构建与上传应在上述配置就绪后运行；普通源码／预览构建不需要读取 Apple 凭据。相关步骤见 [Flutter 官方 iOS 发布文档](https://docs.flutter.dev/deployment/ios)。
