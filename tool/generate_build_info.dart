// 从 pubspec.lock 生成「关于」页用的技术栈版本表。
//
// 与 Tauri 侧 scripts/build-info.ts 是同一个套路：进锁文件、查白名单、生成一个
// 常量模块，视图直接读生成的常量。这样关于页显示的版本永远不会过期，而
// 「展示哪些包、叫什么、负责什么」仍然手工维护 —— 不做这层筛选就会把六十多个
// 直接依赖和几百个传递依赖全渲染出来。
//
// 用法：
//   dart run tool/generate_build_info.dart
//   dart run tool/generate_build_info.dart --check   # 只检查是否过期，不写文件
//
// CI 会在 flutter pub get 之后跑一次 --check，任何「改了依赖却忘了重新生成」
// 都会让构建明确失败。

import 'dart:convert';
import 'dart:io';

/// 展示项。name/detail 是手写的，version 由本脚本从锁文件里取。
class _Entry {
  const _Entry(this.package, this.name, this.detail);

  /// pubspec.lock 里的包名。
  final String package;

  /// 关于页上显示的短名。
  final String name;

  /// 一句话职责说明。
  final String detail;
}

/// 展示顺序即此列表顺序。
const List<_Entry> _curated = <_Entry>[
  _Entry('flutter_riverpod', 'Riverpod', '状态管理'),
  _Entry('go_router', 'go_router', '页面路由'),
  _Entry('material_ui', 'Material UI', '组件库'),
  _Entry('just_audio', 'just_audio', '音频播放'),
  _Entry('audio_service', 'audio_service', '后台播放与媒体会话'),
  _Entry('dio', 'Dio', '网络请求'),
  _Entry('shared_preferences', 'shared_preferences', '本地配置'),
  _Entry('path_provider', 'path_provider', '文件路径'),
];

/// Flutter / Dart 不在 pubspec.lock 里（lock 只锁依赖），改从 SDK 自己问。
/// 两个 workflow 都把 Flutter 钉死在 3.47.3，所以这里的结果是可复现的。
Future<List<(String, String, String)>> _sdkEntries() async {
  final result = await Process.run(
    'flutter',
    <String>['--version', '--machine'],
    runInShell: true,
  );
  if (result.exitCode != 0) {
    throw StateError('flutter --version --machine 失败：${result.stderr}');
  }
  final json = jsonDecode(result.stdout as String) as Map<String, dynamic>;
  final framework = json['frameworkVersion'] as String?;
  final dart = json['dartSdkVersion'] as String?;
  if (framework == null || dart == null) {
    throw StateError('flutter --version --machine 的输出里缺少版本字段');
  }
  return <(String, String, String)>[
    ('Flutter', '跨平台 UI 框架', framework),
    ('Dart', '语言与运行时', dart),
  ];
}

/// 解析 pubspec.lock。结构非常规整：
///
/// ```text
/// packages:
///   <包名>:
///     dependency: ...
///     description:
///       ...
///     source: hosted
///     version: "x.y.z"
/// ```
///
/// 没必要为此拉一个 YAML 依赖进来，按行扫描即可，也便于缺包时明确报错。
Map<String, String> _readLockedVersions(String lockText) {
  final versions = <String, String>{};
  String? current;
  final nameRe = RegExp(r'^  ([a-z0-9_]+):\s*$');
  final versionRe = RegExp(r'^    version:\s*"?([^"\s]+)"?\s*$');
  for (final line in const LineSplitter().convert(lockText)) {
    final nameMatch = nameRe.firstMatch(line);
    if (nameMatch != null) {
      current = nameMatch.group(1);
      continue;
    }
    final versionMatch = versionRe.firstMatch(line);
    if (versionMatch != null && current != null) {
      versions[current] = versionMatch.group(1)!;
    }
  }
  return versions;
}

String _escape(String value) => value.replaceAll(r'\', r'\\').replaceAll("'", r"\'");

String _render(List<(String, String, String)> sdk, Map<String, String> locked) {
  final buffer = StringBuffer()
    ..writeln('// GENERATED CODE - DO NOT MODIFY BY HAND')
    ..writeln('//')
    ..writeln('// 由 tool/generate_build_info.dart 从 pubspec.lock 与 Flutter SDK 生成。')
    ..writeln('// 改动依赖后请重新运行：dart run tool/generate_build_info.dart')
    ..writeln()
    ..writeln('/// 技术栈的一行：展示名、职责说明、版本号。')
    ..writeln('class TechStackEntry {')
    ..writeln('  const TechStackEntry({')
    ..writeln('    required this.name,')
    ..writeln('    required this.detail,')
    ..writeln('    required this.version,')
    ..writeln('  });')
    ..writeln()
    ..writeln('  final String name;')
    ..writeln('  final String detail;')
    ..writeln('  final String version;')
    ..writeln('}')
    ..writeln()
    ..writeln('/// 关于页渲染的技术栈，顺序即展示顺序。')
    ..writeln('const List<TechStackEntry> kTechStack = <TechStackEntry>[');

  for (final (name, detail, version) in sdk) {
    buffer.writeln(
      "  TechStackEntry(name: '${_escape(name)}', detail: '${_escape(detail)}', "
      "version: '${_escape(version)}'),",
    );
  }
  for (final entry in _curated) {
    final version = locked[entry.package];
    if (version == null) {
      throw StateError(
        'pubspec.lock 里找不到 ${entry.package}。'
        '如果它已被移除，请同步更新 tool/generate_build_info.dart 的 _curated 列表。',
      );
    }
    buffer.writeln(
      "  TechStackEntry(name: '${_escape(entry.name)}', detail: '${_escape(entry.detail)}', "
      "version: '${_escape(version)}'),",
    );
  }

  buffer.writeln('];');
  return buffer.toString();
}

Future<void> main(List<String> args) async {
  final checkOnly = args.contains('--check');
  final root = Directory.current.path;
  final lockFile = File('$root/pubspec.lock');
  final outputFile = File('$root/lib/core/build_info.g.dart');

  if (!lockFile.existsSync()) {
    throw StateError('找不到 pubspec.lock，请在仓库根目录运行。');
  }

  final locked = _readLockedVersions(lockFile.readAsStringSync());
  final rendered = _render(await _sdkEntries(), locked);

  if (checkOnly) {
    final existing = outputFile.existsSync() ? outputFile.readAsStringSync() : '';
    if (existing != rendered) {
      stderr.writeln(
        'lib/core/build_info.g.dart 已过期。\n'
        '请运行：dart run tool/generate_build_info.dart',
      );
      exit(1);
    }
    stdout.writeln('build_info.g.dart 是最新的。');
    return;
  }

  outputFile.writeAsStringSync(rendered);
  stdout.writeln('已写入 ${outputFile.path}');
}
