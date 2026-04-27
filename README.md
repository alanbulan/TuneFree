<div align="center">
  <h1>TuneFree Flutter</h1>

  <p align="center">
    <strong>面向 Android / iOS / Web 的 TuneFree Flutter 原生移动端项目</strong>
  </p>

  <p>
    <a href="https://flutter.dev/">
      <img src="https://img.shields.io/badge/Flutter-3-02569B?style=for-the-badge&logo=flutter&logoColor=white" alt="Flutter 3">
    </a>
    <a href="https://dart.dev/">
      <img src="https://img.shields.io/badge/Dart-3.10-0175C2?style=for-the-badge&logo=dart&logoColor=white" alt="Dart 3.10">
    </a>
    <a href="https://riverpod.dev/">
      <img src="https://img.shields.io/badge/Riverpod-2.6-42A5F5?style=for-the-badge" alt="Riverpod">
    </a>
    <a href="https://pub.dev/packages/go_router">
      <img src="https://img.shields.io/badge/go_router-16-0175C2?style=for-the-badge&logo=dart&logoColor=white" alt="go_router">
    </a>
    <a href="https://pub.dev/packages/just_audio">
      <img src="https://img.shields.io/badge/just_audio-0.10-FFCA28?style=for-the-badge&logo=audacity&logoColor=black" alt="just_audio">
    </a>
    <a href="https://pub.dev/packages/dio">
      <img src="https://img.shields.io/badge/Dio-5.9-6A5ACD?style=for-the-badge" alt="Dio">
    </a>
  </p>

  <p>
    <a href="#-项目定位">项目定位</a> •
    <a href="#-当前能力">当前能力</a> •
    <a href="#-技术栈">技术栈</a> •
    <a href="#-本地开发">本地开发</a> •
    <a href="#-打包">打包</a>
  </p>
</div>

<br/>

## 📖 项目定位

这个目录是独立的 Flutter 项目根目录，对应远程分支 `flutter`。

- Flutter：`flutter/` → `origin/flutter`
- iOS/PWA React：`ios-pwa-react/` → `origin/main`
- Desktop Web：`desktop-next/` → `origin/desktop`

本分支是 TuneFree 的 Flutter / 原生移动端实现，目标是在 Android、iOS 和 Flutter Web 上复刻核心音乐体验，并逐步补齐原 React 移动端能力。

## ✨ 当前能力

### 📱 移动端主流程

- **首页 / 搜索 / 资料库 / 播放器**：覆盖音乐播放器的主要使用路径。
- **播放队列**：支持当前播放队列展示与切歌。
- **播放模式**：支持顺序、单曲、随机等播放器控制。
- **歌词展示**：支持播放页歌词、封面和进度联动。
- **分享与交互**：保留移动端常用播放器操作入口。

### 🎵 播放与下载

- **媒体会话整合**：接入 `audio_service`、`audio_session` 和 `just_audio`。
- **后台播放基础**：对系统媒体会话和音频焦点进行整合。
- **单曲真实下载**：支持歌曲下载落盘。
- **下载记录管理**：支持下载记录存储与清理。
- **本地优先播放**：有有效本地下载时优先播放本地文件，本地失效时回退远程解析。

### 🎨 品牌与平台

- **TuneFree 图标**：Android / iOS / Web 图标替换为 TuneFree 源项目风格。
- **多平台工程**：保留 Android、iOS、Web、Windows、macOS、Linux 工程目录。

## 🛠 技术栈

- **Flutter 3**：跨平台 UI 与应用工程。
- **Dart 3.10+**：业务逻辑与类型系统。
- **flutter_riverpod**：状态管理。
- **go_router**：页面路由。
- **just_audio**：音频播放。
- **audio_service / audio_session**：后台播放、媒体会话与音频焦点。
- **shared_preferences**：轻量本地配置与记录。
- **path_provider**：下载文件路径与本地存储位置。
- **dio**：网络请求与下载。

## 🧰 环境要求

建议使用：

- Flutter Stable
- Dart 3.10+
- JDK 17
- Android SDK
- Xcode（构建 iOS 时需要）

## 🚀 本地开发

以下命令都应在当前目录执行。

```bash
flutter pub get
flutter run -d android
```

查看设备：

```bash
flutter devices
```

## ✅ 测试与检查

```bash
flutter test
flutter analyze
```

## 📦 打包

### Android Debug APK

```bash
flutter build apk --debug
```

输出路径：

```text
build/app/outputs/flutter-apk/app-debug.apk
```

### Web 构建

```bash
flutter build web
```

输出路径：

```text
build/web/
```

## 📁 目录结构

```text
lib/       Dart 应用源码
android/   Android 原生工程
ios/       iOS 原生工程
web/       Flutter Web 工程
linux/     Linux 桌面工程
macos/     macOS 桌面工程
windows/   Windows 桌面工程
test/      测试与 golden 资源
docs/      项目设计与实现记录
```

## ⚠️ 声明

本项目仅供学习 Flutter、跨平台播放器和移动端工程实践使用。

- 音乐资源来源于第三方 API，本项目不存储任何音频文件。
- 请支持正版音乐，下载功能仅用于个人技术研究，请勿用于商业用途。
- API 接口归属权解释权归原作者所有。
