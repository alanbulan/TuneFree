import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

const audioSpectrumBarCount = 48;

final class AudioSpectrumAnalyzer {
  const AudioSpectrumAnalyzer();

  static const _channel = EventChannel('tunefree/audio_spectrum');

  Stream<List<double>> watch(int? androidAudioSessionId) {
    // 频谱走的是 Android 原生的 EventChannel，别的端没有。
    //
    // 判平台这里以前用的是 `dart:io` 的 `Platform.isAndroid`。`dart:io` 在 web
    // 上只是个桩，`Platform` 一被读就抛 `Unsupported operation:
    // Platform._operatingSystem` —— 实测全屏播放器一打开就整屏红。
    // `defaultTargetPlatform` 各端都有；再压一道 `kIsWeb`，因为手机浏览器上
    // 它会报 android，而那条原生通道在 web 上并不存在。
    if (kIsWeb ||
        defaultTargetPlatform != TargetPlatform.android ||
        androidAudioSessionId == null ||
        androidAudioSessionId <= 0) {
      return const Stream<List<double>>.empty();
    }

    return _channel
        .receiveBroadcastStream(androidAudioSessionId)
        .where((event) => event is List)
        .map((event) => _normalizeBars(event as List<dynamic>));
  }

  List<double> _normalizeBars(List<dynamic> values) {
    final bars = List<double>.filled(audioSpectrumBarCount, 0);
    for (
      var index = 0;
      index < bars.length && index < values.length;
      index += 1
    ) {
      final value = values[index];
      final normalized = value is num ? value.toDouble() : 0.0;
      bars[index] = normalized.clamp(0.0, 1.0).toDouble();
    }
    return bars;
  }
}
