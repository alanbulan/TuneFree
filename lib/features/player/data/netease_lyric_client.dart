import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/tune_free_http_client.dart';

/// 直连网易云取**扩展歌词轨**：罗马音，以及带字级时间的逐字轨。
///
/// **为什么绕开 GD Studio**：它的 `types=lyric` 只返回 `lyric` + `tlyric`。
/// 已实测 netease / joox / kuwo 三个源都是这两个键，逐字和罗马音都拿不到；
/// QQ 源更是直接不支持歌词接口。网易自己的 `api/song/lyric/v1` 才有。
///
/// **这个接口里有三套时间轴，别混用**（实测 id 1466598056）：
/// - `romalrc` 走的是 legacy 时间轴（0.85 / 6.65 / 12.34s），与 GD Studio
///   给的 `lyric` / `tlyric` **逐行完全一致**；罗马音因此能精确贴到主轨上。
/// - `yrc` / `ytlrc` / `yromalrc` 是 v1 那一套（0.83 / 6.37 / 11.78s），
///   三条互相逐行一致，但与 legacy 逐行差 20–570ms。
/// 所以逐字轨不能贴到 GD 的主轨上，有它就整份换用 v1（见
/// `player_lyrics_controller.dart`）。
///
/// 必须带浏览器 UA 与 Referer：不带的话返回的字段会少一大半（实测直接少掉
/// `romalrc` / `klyric` / `tlyric`）。
typedef NeteaseLyricLoader =
    Future<NeteaseLyricTracks?> Function(String neteaseId);

const String defaultNeteaseLyricApiBase =
    'https://music.163.com/api/song/lyric/v1';

final neteaseLyricLoaderProvider = Provider<NeteaseLyricLoader>((ref) {
  final client = NeteaseLyricClient(dio: TuneFreeHttpClient().dio);
  return client.loadTracks;
});

/// 一次请求取回的扩展轨。取不到的都是 null。
///
/// 不装成一个 `LyricDocument`：这些轨道要用哪几条取决于有没有 [karaoke]
/// —— 有 yrc 时三条都得用 v1 的，没有时只有 [romanization] 能用。判断留在
/// 调用方，这里只负责把响应拆开。
final class NeteaseLyricTracks {
  const NeteaseLyricTracks({
    this.romanization,
    this.karaoke,
    this.karaokeTranslation,
    this.karaokeRomanization,
  });

  /// `romalrc`，与 legacy 主轨（GD Studio 的 `lyric`）对齐。
  final String? romanization;

  /// `yrc`，正文 + 字级时间，v1 时间轴。
  final String? karaoke;

  /// `ytlrc`，v1 时间轴的译文。只在有 [karaoke] 时可用。
  final String? karaokeTranslation;

  /// `yromalrc`，v1 时间轴的罗马音。
  final String? karaokeRomanization;

  bool get hasKaraoke => karaoke != null && karaoke!.trim().isNotEmpty;

  bool get isEmpty =>
      romanization == null &&
      karaoke == null &&
      karaokeTranslation == null &&
      karaokeRomanization == null;
}

final class NeteaseLyricClient {
  NeteaseLyricClient({
    required Dio dio,
    String apiBase = defaultNeteaseLyricApiBase,
  }) : _dio = dio,
       _apiBase = apiBase;

  final Dio _dio;
  final String _apiBase;

  /// 取扩展轨。整条链路任何一步失败都返回 null —— 这些轨都是加分项，
  /// 不该影响歌词本身。快歌没有逐字轨是常态（实测三首里只有一首有）。
  Future<NeteaseLyricTracks?> loadTracks(String neteaseId) async {
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
            // rv=1 要罗马音；yv/ytv 取 -1 而不是 1 —— 实测 `1` 只给 legacy
            // 那套，`-1` 才会把 yrc / ytlrc / yromalrc 一起带出来。
            // 不请求 lv/tv/kv：那边的 `lrc` / `tlyric` 是 legacy 时间轴，
            // 主轨和译文已经从 GD Studio 拿了同样的内容，没必要多传一份。
            'rv': '1',
            'yv': '-1',
            'ytv': '-1',
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

      final tracks = NeteaseLyricTracks(
        romanization: _readTrack(payload, 'romalrc'),
        karaoke: _readTrack(payload, 'yrc'),
        karaokeTranslation: _readTrack(payload, 'ytlrc'),
        karaokeRomanization: _readTrack(payload, 'yromalrc'),
      );
      return tracks.isEmpty ? null : tracks;
    } catch (_) {
      // 网络、限流、接口改版都走这里：静默退化成「没有扩展轨」。
      return null;
    }
  }

  String? _readTrack(Map<dynamic, dynamic> payload, String key) {
    final track = payload[key];
    if (track is! Map) {
      return null;
    }
    final lyric = track['lyric'];
    if (lyric is! String || lyric.trim().isEmpty) {
      return null;
    }
    return lyric;
  }
}
