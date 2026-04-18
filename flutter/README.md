# TuneFree Mobile (Flutter / Android)

> 这是当前仓库中的 **Flutter / Android 主线项目**。  
> 如果你要看旧版 React / Vite / PWA 实现，请去 `../react`。

## 项目定位

这个子项目承载 TuneFree Mobile 的 Flutter 客户端，重点面向：

- Android 原生安装与 APK 打包
- 原生播放器交互与系统媒体控制
- 本地下载管理与离线优先播放
- 后续移动端真机体验打磨

对应旧版 Web / PWA 参考实现：

- 目录：`../react`
- 文档：`../react/README.md`

## 和 React 项目的区别

### `flutter/` 是什么

- Flutter + Dart 的移动端客户端
- 主要使用 `flutter run` / `flutter build apk`
- 核心目录在 `lib/`、`test/`、`android/`、`ios/`
- 面向原生移动端体验，而不是 Cloudflare Pages 上的 Web 部署

### `../react` 是什么

- 原始 React 19 + Vite + Tailwind CSS 的 PWA 项目
- 主要使用 `npm install` / `npm run dev` / `npm run build`
- 作为视觉、交互、功能迁移的参考实现保留

### 一句话区分

- **`flutter/`**：当前 Android / 原生客户端主线
- **`react/`**：旧版 React / PWA 参考实现

## 当前 Flutter 版本已覆盖的能力

当前 Flutter 项目已经完成并验证过的核心能力包括：

- 首页 / 搜索 / 资料库 / 播放器主流程
- 播放队列、播放模式、歌词、封面、分享等播放器交互
- 媒体会话与播放器运行时整合
- 单曲真实下载落盘
- 下载记录存储与清理
- 资料库中的下载管理 UI
- **本地优先播放**：有有效本地下载时优先走本地；本地失效时回退远程解析
- Android / iOS / Web 图标替换为 TuneFree 源项目风格
- Android debug APK 构建验证

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

以下命令都应在 **`flutter/` 目录内** 执行。

### 1. 获取依赖

```bash
flutter pub get
```

### 2. 运行 Android 版本

```bash
flutter run -d android
```

如果你本机有多个设备，也可以先查看设备：

```bash
flutter devices
```

### 3. 运行测试

```bash
flutter test
```

### 4. 静态检查

```bash
flutter analyze
```

## 打包 APK

### Debug APK

```bash
flutter build apk --debug
```

输出路径：

```text
build/app/outputs/flutter-apk/app-debug.apk
```

### Release APK

如需正式分发，再根据签名配置补充 release 打包流程。

## 目录说明

```text
lib/      Flutter 应用源码
test/     Flutter 测试
android/  Android 工程
ios/      iOS 工程
web/      Flutter Web 资源（仅保留兼容所需）
docs/     Flutter 重构与实现文档
```

## 开发约定

- Flutter 项目优先服务于移动端，尤其是 Android 体验
- React 项目只作为参考，不再是当前 Android 主线
- 需要对照旧版交互/视觉时，去 `../react` 查原实现
- 修改播放器、下载、本地播放逻辑时，优先补对应测试

## 如果你想运行旧版 React 项目

请进入：

```bash
cd ../react
npm install
npm run dev
```

并阅读它的 README：

- `../react/README.md`

## 声明

本项目仅用于学习与技术研究。

- 音乐资源来自第三方接口
- 本项目不提供正版内容分发服务
- 请支持正版音乐

## License

MIT
