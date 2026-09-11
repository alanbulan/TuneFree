import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/features/player/application/audio_spectrum_analyzer.dart';

void main() {
  const analyzer = AudioSpectrumAnalyzer();

  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
  });

  test('非 Android 平台不订阅频谱通道', () async {
    // 回归护栏：这里以前用 `dart:io` 的 `Platform.isAndroid` 判平台。`dart:io`
    // 在 web 上是个只会抛的桩，一读 `Platform` 就 `Unsupported operation:
    // Platform._operatingSystem` —— 全屏播放器一打开整屏红。
    for (final platform in <TargetPlatform>[
      TargetPlatform.iOS,
      TargetPlatform.macOS,
      TargetPlatform.windows,
      TargetPlatform.linux,
      TargetPlatform.fuchsia,
    ]) {
      debugDefaultTargetPlatformOverride = platform;
      expect(
        await analyzer.watch(1).toList(),
        isEmpty,
        reason: '$platform 上不该订阅 Android 原生的频谱通道',
      );
    }
  });

  test('没有音频会话 id 时同样不订阅', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    expect(await analyzer.watch(null).toList(), isEmpty);
    expect(await analyzer.watch(0).toList(), isEmpty);
  });
}
