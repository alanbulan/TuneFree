import 'dart:async';
import 'dart:convert';

import 'package:alchemist/alchemist.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  TestWidgetsFlutterBinding.ensureInitialized();
  final manifest = jsonDecode(
    await rootBundle.loadString('FontManifest.json'),
  ) as List<dynamic>;
  for (final entry in manifest.cast<Map<String, dynamic>>()) {
    final family = (entry['family'] as String).replaceFirst(
      'packages/alchemist/',
      '',
    );
    final loader = FontLoader(family);
    for (final font
        in (entry['fonts'] as List<dynamic>).cast<Map<String, dynamic>>()) {
      loader.addFont(rootBundle.load(font['asset'] as String));
    }
    await loader.load();
  }
  // CI 使用跨平台稳定的文字块；macOS 另保留可读文字用于视觉检查。
  return AlchemistConfig.runWithConfig(
    config: AlchemistConfig(
      platformGoldensConfig: PlatformGoldensConfig(
        platforms: {HostPlatform.macOS},
        renderShadows: false,
        filePathResolver: (fileName, _) => 'goldens/macos/$fileName.png',
      ),
      ciGoldensConfig: CiGoldensConfig(
        filePathResolver: (fileName, _) => 'goldens/ci/$fileName.png',
      ),
    ),
    run: testMain,
  );
}
