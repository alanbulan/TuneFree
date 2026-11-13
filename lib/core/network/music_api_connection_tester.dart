import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'gd_studio_api_client.dart';
import 'local_network_access.dart';
import 'music_api_providers.dart';
import 'music_api_settings.dart';
import 'source_http_client.dart';
import 'tune_free_http_client.dart';

final musicApiConnectionTesterProvider = Provider<MusicApiConnectionTester>((
  ref,
) {
  return MusicApiConnectionTester(
    httpClient: ref.watch(musicApiHttpClientProvider),
  );
});

final class MusicApiConnectionTester {
  MusicApiConnectionTester({required this._httpClient});

  final TuneFreeHttpClient _httpClient;

  Future<String> testMusic(MusicApiSettings settings) async {
    try {
      final client = GdStudioApiClient(
        httpClient: SourceHttpClient(httpClient: _httpClient),
        settingsLoader: () async => settings,
      );
      final payload = await client.request(const <String, String>{
        'types': 'search',
        'source': 'netease',
        'name': 'Lemon',
        'count': '1',
        'pages': '1',
      });
      if (payload is! List ||
          payload.isEmpty ||
          payload.any(
            (item) =>
                item is! Map || item['id'] == null || item['name'] == null,
          )) {
        return '音乐 API 返回格式不兼容，请检查地址和请求方式';
      }
      return '音乐 API 连接成功';
    } on LocalNetworkPermissionDenied {
      return _permissionError('音乐 API');
    } on DioException catch (error) {
      return _httpError('音乐 API', error);
    } catch (_) {
      return '音乐 API 检测失败，请检查地址、网络和请求方式';
    }
  }

  Future<String> testPlaylist(MusicApiSettings settings) async {
    try {
      final base = Uri.parse(settings.playlistApiBase);
      final response = await _httpClient.dio.getUri<dynamic>(
        base.replace(path: '${base.path}/v1/methods/netease/playlist'),
      );
      final payload = response.data;
      final method = payload is Map ? payload['data'] : null;
      if (method is! Map ||
          method['url'] is! String ||
          (method['url'] as String).isEmpty) {
        return '歌单 API 返回格式不兼容，请使用 TuneHub 兼容接口';
      }
      return '歌单 API 连接成功';
    } on DioException catch (error) {
      return _httpError('歌单 API', error);
    } catch (_) {
      return '歌单 API 检测失败，请检查地址和网络';
    }
  }

  String _httpError(String label, DioException error) {
    if (error.error is LocalNetworkPermissionDenied) {
      return _permissionError(label);
    }
    final status = error.response?.statusCode;
    if (status == 401 || status == 403) {
      return '$label 访问被拒绝，请检查服务商的鉴权要求';
    }
    if (status == 429) {
      return '$label 请求过于频繁，请稍后重试';
    }
    return status == null
        ? '$label 连接失败，请检查地址和网络'
        : '$label 返回 HTTP $status，请检查地址和请求方式';
  }

  String _permissionError(String label) =>
      '$label 需要本地网络权限，请允许访问后重试；也可在系统设置中开启';
}
