import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';

import 'local_network_access.dart';
import 'music_api_settings.dart';
import 'source_http_client.dart';

typedef MusicApiSettingsLoader = Future<MusicApiSettings> Function();

final class GdStudioApiClient {
  GdStudioApiClient({
    required this._httpClient,
    required this._settingsLoader,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final SourceHttpClient _httpClient;
  final MusicApiSettingsLoader _settingsLoader;
  final DateTime Function() _clock;
  final Map<String, Future<Duration>> _timeOffsets = {};

  Future<MusicApiSettings> loadSettings() => _settingsLoader();

  Future<dynamic> request(
    Map<String, String> parameters, {
    MusicApiSettings? settings,
  }) async {
    final config = settings ?? await loadSettings();
    final uri = Uri.parse(config.musicApiBase);
    final dynamic payload;
    if (config.requestMode == MusicApiRequestMode.compatibleGet) {
      payload = await _httpClient.getJson(
        uri.replace(
          queryParameters: <String, dynamic>{
            ...uri.queryParametersAll,
            ...parameters,
          },
        ),
        includeProxyFallback: !config.usesCustomMusicApi,
      );
    } else {
      final offset = await (_timeOffsets[config.musicApiBase] ??= _syncTime(
        config,
      ));
      final timestamp = _clock().add(offset).millisecondsSinceEpoch;
      final form = buildGdStudioForm(parameters, timestamp);
      payload = await _httpClient.postFormJson(uri, data: form);
    }
    if (payload is Map &&
        (payload['error'] != null || payload['detail'] != null)) {
      throw StateError('Music API returned an error response');
    }
    return payload;
  }

  Future<Duration> _syncTime(MusicApiSettings settings) async {
    final uri = Uri.parse(settings.musicApiBase);
    final slash = uri.path.lastIndexOf('/');
    final timeUri = uri.replace(
      path: '${uri.path.substring(0, slash + 1)}time',
    );
    final started = _clock();
    try {
      final text = await _httpClient.getText(
        timeUri,
        includeProxyFallback: !settings.usesCustomMusicApi,
      );
      final seconds = double.tryParse(text.trim());
      if (seconds == null || !seconds.isFinite || seconds <= 0) {
        throw const FormatException('Invalid server time');
      }
      final midpoint =
          started.millisecondsSinceEpoch +
          _clock().difference(started).inMilliseconds ~/ 2;
      return Duration(milliseconds: (seconds * 1000).round() - midpoint);
    } catch (error) {
      _timeOffsets.remove(settings.musicApiBase);
      if (error is LocalNetworkPermissionDenied ||
          (error is DioException &&
              error.error is LocalNetworkPermissionDenied)) {
        rethrow;
      }
      // 与桌面内置音源一致：时间服务不可用时使用本机时间。
      return Duration.zero;
    }
  }
}

Map<String, String> buildGdStudioForm(
  Map<String, String> parameters,
  int timestampMs,
) {
  final subject = Uri.encodeComponent(
    parameters['name'] ?? parameters['id'] ?? parameters['types'] ?? '',
  ).replaceAll("'", '%27').replaceAll('(', '%28').replaceAll(')', '%29');
  final prefix = timestampMs.toString().substring(0, 9);
  final hash = md5.convert(
    utf8.encode('$prefix|music.gdstudio.org|20260616|$subject'),
  );
  return <String, String>{
    ...parameters,
    if (parameters['source'] == 'qq') 'source': 'tencent',
    's': parameters['s'] ?? hash.toString().substring(24).toUpperCase(),
  };
}
