<div align="center">
  <img src="android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png" alt="TuneFree" width="96" height="96">

  <h1>TuneFree Flutter</h1>

  <p align="center">
    <strong>面向 Android / iOS / Web 的 TuneFree Flutter 原生移动端项目</strong>
  </p>

  <p>
    <a href="https://flutter.dev/">
      <img src="https://img.shields.io/badge/Flutter-3.50-02569B?style=for-the-badge&logo=flutter&logoColor=white" alt="Flutter 3.50">
    </a>
    <a href="https://dart.dev/">
      <img src="https://img.shields.io/badge/Dart-3.14-0175C2?style=for-the-badge&logo=dart&logoColor=white" alt="Dart 3.14">
    </a>
    <a href="https://riverpod.dev/">
      <img src="https://img.shields.io/badge/Riverpod-3-42A5F5?style=for-the-badge" alt="Riverpod">
    </a>
    <a href="https://pub.dev/packages/go_router">
      <img src="https://img.shields.io/badge/go_router-18-0175C2?style=for-the-badge&logo=dart&logoColor=white" alt="go_router">
    </a>
    <a href="https://pub.dev/packages/just_audio">
      <img src="https://img.shields.io/badge/just_audio-0.10-FFCA28?style=for-the-badge&logo=audacity&logoColor=black" alt="just_audio">
    </a>
    <a href="https://pub.dev/packages/dio">
      <img src="https://img.shields.io/badge/Dio-5.11-6A5ACD?style=for-the-badge" alt="Dio">
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

这个目录是独立的 Flutter 项目根目录，对应 [alanbulan/TuneFree 的 flutter 分支](https://github.com/alanbulan/TuneFree/tree/flutter)。原 `TuneFree_Mobile` 地址会跳转到同一仓库。

- Flutter：`flutter/` → `origin/flutter`
- React PWA：`pwa/` → `origin/main`
- Tauri 桌面端：`desktop/` → `origin/tauri`

本分支是 TuneFree 的 Flutter / 原生移动端实现，目标是在 Android、iOS 和 Flutter Web 上复刻核心音乐体验，并逐步补齐原 React 移动端能力。

## ✨ 当前能力

### 📱 移动端主流程

- **首页 / 搜索 / 资料库 / 播放器**：覆盖音乐播放器的主要使用路径。
- **首页统计卡**：收藏歌曲 / 我的歌单 / 离线缓存计数，外加一键播放当前榜单。
- **播放队列**：支持当前播放队列展示与切歌。
- **播放模式**：支持顺序、单曲、随机等播放器控制。
- **相似歌曲电台**：以当前歌曲的歌手为种子凑 20 首换台。**不是** Tauri 那套本地
  推荐器（Rust + SQLite，没有 HTTP 接口），是「同歌手」语义。
- **从播放器跳搜索**：一键用当前歌曲的歌手 / 专辑去搜索页找。
- **歌词展示**：支持播放页歌词、封面和进度联动。
- **多轨歌词**：主轨 + 译文 + 罗马音三条轨道，渲染顺序与 Tauri 一致。
  罗马音只有网易源能拿到（直连 `api/song/lyric/v1` 的 `romalrc`），其余音源为空。
- **歌词时间轴偏移**：±10 秒、100ms 一档，可归零 —— Tauri 那边只有状态，没有 UI。
- **逐字歌词填充**：当前行随播放进度染色。**网易源的歌用的是真·逐字时间**
  —— 直连 `api/song/lyric/v1` 取 `yrc`（词格式是 `(词起,词时长)` 前缀，
  实测一行 16 个字就是 16 个词）；其余音源只有整行时间轴，字级时间**按行内
  版面权重估算**（网易的 `klyric` 实测为空，拿不到）。
  - 取到逐字轨时，主轨 / 译文 / 罗马音**三条一起**换成 v1 那一套。实测
    GD Studio 的主轨是网易 legacy 时间轴（850 / 6650 / 12340ms），而 v1 是
    830 / 6370 / 11780ms，逐行差 20–570ms —— 混着用会把字压到隔壁行上。
  - 解析不出逐字轨内容时整份退回老路：宁可没有逐字，也不要空白歌词。
- **分享与交互**：保留移动端常用播放器操作入口。

### ↩️ 撤销与反馈

统一的提示条，停留 5 秒（长于 Flutter 默认的 4 秒）。可撤销的操作：

- 收藏 / 取消收藏、清空播放队列、删除歌单、从歌单移除歌曲、导入备份。
- **删除下载**：文件先挪进回收站（`downloads/trash`）而不是真删，撤销时挪回
  原位并把下载记录写回去；回收站里超过 7 天的条目在下次打开下载页时清掉。
- **清空搜索历史**：历史只活在内存里，撤销就是原样放回去。
- **添加到歌单**：撤销走 `removeFromPlaylist`。已经在歌单里的会在加之前就被
  拦下并提示 —— 否则「撤销」会把一首本来就有的歌移出去。

### 🎵 播放与下载

- **媒体会话整合**：接入 `audio_service`、`audio_session` 和 `just_audio`，保留插件动态引用的通知控制图标以兼容 Release 资源压缩。
- **后台播放基础**：对系统媒体会话和音频焦点进行整合。
- **单曲真实下载**：支持歌曲下载落盘。
- **下载记录管理**：支持下载记录存储与清理。
- **本地优先播放**：有有效本地下载时优先播放本地文件，本地失效时回退远程解析。

### ☁️ 自定义音源

「我的」→「音源」提供独立的音乐接口和歌单接口设置，卡片、连接方式胶囊与检测反馈跟随浅色／深色主题和强调色。

- **音乐接口**：支持 GD / `api.php` 兼容协议，用于搜索、播放解析、歌词、封面和下载。默认地址为 `https://music-api.gdstudio.xyz/api.php`。
- **连接方式**：GD 服务选择「GD 签名 POST」，首次连接会通过同目录 `/time` 校准时间；兼容服务可选择「兼容 GET」。服务商提供的路径和查询参数会保留。
- **歌单接口**：支持 TuneHub 方法描述符协议，默认地址为 `https://tunehub.sayqz.com/api`。平台直连导入失败时自动尝试此接口。
- **检测与保存**：检测当前草稿，显示各接口的成功或错误信息；保存成功后即刻生效并在重启后保留。留空或「恢复默认」可回到内置音源。
- **切换行为**：自定义音乐接口统一处理搜索和解析，缓存按地址与连接方式区分；队列／收藏中的歌曲重播和新下载会按当前音源、所选音质重新解析，已有离线文件仍可优先播放。首页榜单继续使用平台接口。

Android / iOS 支持局域网 HTTP 地址。Android 17 首次连接局域网服务时会申请「本地网络」权限；拒绝后可重新检测或在系统设置中开启。Flutter Web 的自定义服务需允许浏览器跨域请求；自定义地址不会经过公共 CORS 代理。接口需要兼容上述协议，目前不执行桌面端的 JavaScript 音源脚本。

### 🎨 品牌与平台

- **TuneFree 图标**：Android / iOS / Web 图标替换为 TuneFree 源项目风格。
- **外观自定义**：浅色 / 深色 / 跟随系统，12 组预设强调色，歌词字号与字体。
- **多平台工程**：保留 Android、iOS、Web、Windows、macOS、Linux 工程目录。

## 🛠 技术栈

- **Flutter 3.50.0**：跨平台 UI 与应用工程。
- **Dart 3.14.0**：业务逻辑与类型系统。
- **flutter_riverpod 3**：状态管理。
- **material_ui**：Material 组件（Flutter 3.44 起从框架拆分为独立包）。
- **go_router 18**：页面路由。
- **just_audio**：音频播放。
- **audio_service / audio_session**：后台播放、媒体会话与音频焦点。
- **shared_preferences**：轻量本地配置与记录。
- **path_provider**：下载文件路径与本地存储位置。
- **dio**：网络请求与下载。

## 🧰 环境要求

建议使用：

- Flutter 3.50.0（stable，含 Dart 3.14.0）
- JDK 25 LTS（运行 Gradle；Java / Kotlin 字节码目标保持 17）
- Android Gradle Plugin 9.5.1、Gradle 9.9.1、内置 Kotlin 2.4.21
- Android SDK 37.2、Build Tools 37.0.0、NDK 30.0.16248370（targetSdk 37，minSdk 24）
- Xcode（构建 iOS 时需要）
- CocoaPods（当前 `open_filex` 仍依赖 CocoaPods；iOS 最低 15.0）

本机通过 Homebrew 管理 Flutter 与 JDK，Android SDK 组件通过 Google SDK 管理工具安装；CI 固定同一套 Flutter / JDK / Android 工具版本。所有直接 Dart 依赖已更新到 2026-11-13 的最新稳定版本，锁文件保留依赖之间及 Flutter SDK 自身要求的兼容版本，不使用强制覆盖。

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
dart run tool/generate_build_info.dart --check
```

截图测试使用 Alchemist 0.14.1，替换停止维护的 golden_toolkit。CI 基线使用跨平台文字块，macOS 基线另保留文字；可用 `flutter test --tags golden` 单独检查。更新基线后应检查 PNG 画面再提交。

代码生成使用：

```bash
dart run build_runner build
dart run tool/generate_build_info.dart
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

### Android Release APK

```bash
flutter build apk --release
```

输出 `build/app/outputs/flutter-apk/app-release.apk`。CI 从仓库 Secrets 读取发布签名；本地未提供签名变量时沿用调试签名，用于安装验证。

### GitHub 正式发布

1. 在 `pubspec.yaml` 更新版本与递增构建号，例如 `1.0.8+9`，并维护对应的 `docs/releases/mobile-v1.0.8.md`。
2. 检查通过后将变更合入 `flutter` 分支，为该提交推送 `mobile-v1.0.8` 标签。
3. `Android Release` 工作流执行依赖安装、检查、测试与正式签名构建，验证版本和签名后上传 APK、SHA256SUMS，再公开 GitHub Release。

工作流只发布与源码版本一致的既有标签，构建过程中不自动改版本或创建标签。正式发布缺少签名配置时明确失败。也可在 `flutter` 分支手动运行工作流，填写已存在的 `release_tag` 重试尚未公开的版本。

移动端采用 `mobile-v*` 标签，与桌面端 `v*` 标签并存；仓库的 Latest 保留给桌面更新器，Android 客户端从公开发布列表中筛选带 APK 的稳定版本。最新 Android 发布说明见 [v1.0.8](docs/releases/mobile-v1.0.8.md)。

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
