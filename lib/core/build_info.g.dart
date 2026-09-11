// GENERATED CODE - DO NOT MODIFY BY HAND
//
// 由 tool/generate_build_info.dart 从 pubspec.lock 与 Flutter SDK 生成。
// 改动依赖后请重新运行：dart run tool/generate_build_info.dart

/// 技术栈的一行：展示名、职责说明、版本号。
class TechStackEntry {
  const TechStackEntry({
    required this.name,
    required this.detail,
    required this.version,
  });

  final String name;
  final String detail;
  final String version;
}

/// 关于页渲染的技术栈，顺序即展示顺序。
const List<TechStackEntry> kTechStack = <TechStackEntry>[
  TechStackEntry(name: 'Flutter', detail: '跨平台 UI 框架', version: '3.47.3'),
  TechStackEntry(name: 'Dart', detail: '语言与运行时', version: '3.13.3'),
  TechStackEntry(name: 'Riverpod', detail: '状态管理', version: '3.4.3'),
  TechStackEntry(name: 'go_router', detail: '页面路由', version: '18.0.1'),
  TechStackEntry(name: 'Material UI', detail: '组件库', version: '1.2.0'),
  TechStackEntry(name: 'just_audio', detail: '音频播放', version: '0.10.6'),
  TechStackEntry(name: 'audio_service', detail: '后台播放与媒体会话', version: '0.18.19'),
  TechStackEntry(name: 'Dio', detail: '网络请求', version: '5.11.1'),
  TechStackEntry(name: 'shared_preferences', detail: '本地配置', version: '2.5.5'),
  TechStackEntry(name: 'path_provider', detail: '文件路径', version: '2.1.6'),
];
