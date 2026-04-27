# TuneFree Flutter

TuneFree Flutter 是 TuneFree 的 Flutter / 原生移动端项目。

## 项目定位

这个目录是独立的 Flutter 项目根目录，对应远程分支 `flutter`。

- Flutter：`flutter/` → `origin/flutter`
- iOS/PWA React：`ios-pwa-react/` → `origin/main`
- Desktop Web：`desktop-next/` → `origin/desktop`

## 当前能力

- 首页 / 搜索 / 资料库 / 播放器主流程
- 播放队列、播放模式、歌词、封面、分享等播放器交互
- 媒体会话与播放器运行时整合
- 单曲真实下载落盘
- 下载记录存储与清理
- 本地优先播放：有有效本地下载时优先走本地；本地失效时回退远程解析
- Android / iOS / Web 图标替换为 TuneFree 源项目风格

## 技术栈

- Flutter 3
- Dart 3
- flutter_riverpod
- go_router
- just_audio
- audio_service
- audio_session
- shared_preferences
- path_provider
- dio

## 环境要求

建议使用：

- Flutter Stable
- Dart 3.10+
- JDK 17
- Android SDK

## 本地开发

以下命令都应在当前目录执行。

```bash
flutter pub get
flutter run -d android
```

查看设备：

```bash
flutter devices
```

## 测试与检查

```bash
flutter test
flutter analyze
```

## 打包 APK

```bash
flutter build apk --debug
```

输出路径：

```text
build/app/outputs/flutter-apk/app-debug.apk
```

## 目录结构

```text
lib/       Dart 应用源码
android/   Android 原生工程
ios/       iOS 原生工程
test/      测试与 golden 资源
docs/      项目设计与实现记录
```
