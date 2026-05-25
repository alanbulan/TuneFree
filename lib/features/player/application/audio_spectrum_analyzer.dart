import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';

const audioSpectrumBarCount = 48;

final class AudioSpectrumAnalyzer {
  const AudioSpectrumAnalyzer();

  static const _channel = EventChannel('tunefree/audio_spectrum');

  Stream<List<double>> watch(int? androidAudioSessionId) {
    if (!Platform.isAndroid ||
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
