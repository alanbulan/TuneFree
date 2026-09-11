import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/tune_free_http_client.dart';

/// 直连网易云取罗马音轨。
///
/// **为什么绕开 GD Studio**：它的 `types=lyric` 只返回 `lyric` + `tlyric`。
/// 已实测 netease / joox / kuwo 三个源都是这两个键，拿不到罗马音；QQ 源更是
/// 直接不支持歌词接口。网易自己的 `api/song/lyric/v1` 才有 `romalrc`
/// （已实测：日文歌能返回三千多字符的真罗马音，中文歌通常为空）。
///
/// **只取 `romalrc`**：主轨照样用 GD Studio 的 —— 网易这个接口的 `lrc` 字段
/// 是它自家的富文本 JSON（`{"t":0,"c":[{"tx":"..."}]}`）而不是 LRC，
/// 没必要为它写一个解析器。
///
/// 必须带浏览器 UA 与 Referer：不带的话返回的字段会少一大半（实测直接少掉
/// `romalrc` / `klyric` / `tlyric`）。
typedef RomanizationLoader = Future<String?> Function(String neteaseId);

const String defaultNeteaseLyricApiBase =
    'https://music.163.com/api/song/lyric/v1';

final neteaseRomanizationLoaderProvider = Provider<RomanizationLoader>((ref) {
  final client = NeteaseLyricClient(dio: TuneFreeHttpClient().dio);
  return client.loadRomanization;
});

final class NeteaseLyricClient {
  NeteaseLyricClient({
    required Dio dio,
    String apiBase = defaultNeteaseLyricApiBase,
  }) : _dio = dio,
       _apiBase = apiBase;

  final Dio _dio;
  final String _apiBase;

  /// 取罗马音轨。拿不到就返回 null —— 罗马音只是加分项，不该影响歌词本身。
  Future<String?> loadRomanization(String neteaseId) async {
    // 纯数字才是网易的歌曲 id。GD Studio 给别的源发的是它自己的 id 空间，
    // 拿去查网易只会得到一个错误响应。
    final id = neteaseId.trim();
    if (id.isEmpty || int.tryParse(id) == null) {
      return null;
    }

    try {
      final response = await _dio.getUri<dynamic>(
        Uri.parse(_apiBase).replace(
          queryParameters: <String, String>{
            'id': id,
            // rv=1 要罗马音轨；其余轨道要么用不上，要么是富文本 JSON。
            'rv': '1',
            'lv': '0',
            'tv': '0',
            'kv': '0',
          },
        ),
        options: Options(
          headers: const <String, String>{
            'User-Agent':
                'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 '
                '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            'Referer': 'https://music.163.com',
          },
        ),
      );

      final payload = response.data;
      if (payload is! Map) {
        return null;
      }
      final romalrc = payload['romalrc'];
      if (romalrc is! Map) {
        return null;
      }
      final lyric = romalrc['lyric'];
      if (lyric is! String || lyric.trim().isEmpty) {
        return null;
      }
      return lyric;
    } catch (_) {
      // 网络、限流、接口改版都走这里：静默退化成「没有罗马音」。
      return null;
    }
  }
}
