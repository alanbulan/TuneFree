import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/song.dart';
import '../../../core/network/tune_free_http_client.dart';
import '../../../core/utils/lyric_document.dart';
import '../../../core/utils/yrc_parser.dart';
import 'netease_lyric_client.dart';

typedef SongResolver = Future<Song> Function(Song song, String quality);

const defaultGdStudioApiBase = 'https://music-api.gdstudio.xyz/api.php';

final songResolutionClientProvider = Provider<SongResolutionClient>((ref) {
  return GdStudioSongResolutionClient(
    httpClient: TuneFreeHttpClient(),
    lyricLoader: ref.watch(neteaseLyricLoaderProvider),
  );
});

final songResolutionRepositoryProvider = Provider<SongResolutionRepository>((
  ref,
) {
  return SongResolutionRepository(
    client: ref.watch(songResolutionClientProvider),
  );
});

abstract interface class SongResolutionClient {
  Future<Song> resolveSong(Song song, String quality);
}

final class SongResolutionRepository {
  SongResolutionRepository({required SongResolutionClient client})
    : this.test(resolveSongValue: client.resolveSong);

  SongResolutionRepository.test({required SongResolver resolveSongValue})
    : _resolveSongValue = resolveSongValue;

  final SongResolver _resolveSongValue;
  final Map<String, Future<Song>> _pendingResolutions =
      <String, Future<Song>>{};

  Future<Song> resolveSong(Song song, {required String quality}) {
    final cacheKey = _resolutionCacheKey(song, quality);
    final pendingResolution = _pendingResolutions[cacheKey];
    if (pendingResolution != null) {
      return pendingResolution;
    }

    final resolution = _resolveSongValue(song, quality).whenComplete(() {
      _pendingResolutions.remove(cacheKey);
    });
    _pendingResolutions[cacheKey] = resolution;
    return resolution;
  }
}

final class GdStudioSongResolutionClient implements SongResolutionClient {
  GdStudioSongResolutionClient({
    required TuneFreeHttpClient httpClient,
    String apiBase = defaultGdStudioApiBase,
    NeteaseLyricLoader? lyricLoader,
  }) : _dio = httpClient.dio,
       _apiBase = apiBase,
       _lyricLoader = lyricLoader;

  static const _urlCacheTtl = Duration(minutes: 5);
  static const _maxCacheEntries = 80;

  final Dio _dio;
  final String _apiBase;
  final NeteaseLyricLoader? _lyricLoader;
  final Map<String, _CachedResolution<String>> _urlCache =
      <String, _CachedResolution<String>>{};
  final Map<String, String> _lyricsCache = <String, String>{};
  final Map<String, String> _pictureCache = <String, String>{};

  void _cacheUrl(String cacheKey, String value) {
    _urlCache[cacheKey] = _CachedResolution(value, DateTime.now());
    _trimCache(_urlCache);
  }

  void _cacheString(Map<String, String> cache, String cacheKey, String value) {
    cache[cacheKey] = value;
    _trimCache(cache);
  }

  @override
  Future<Song> resolveSong(Song song, String quality) async {
    final source = song.source.wireValue;
    final urlFuture = _loadUrl(
      source: source,
      id: _requestId(song.urlId, song.id),
      quality: quality,
    );
    final lyricsFuture = _loadLyrics(
      source: source,
      id: _requestId(song.lyricId, song.id),
    );
    final pictureFuture = _loadPicture(song);

    final resolvedUrl = await urlFuture;
    if (resolvedUrl == null) {
      throw StateError('GD Studio returned no playable URL for ${song.key}.');
    }

    final resolvedLyrics = await lyricsFuture;
    final resolvedPicture = await pictureFuture;

    return song.copyWith(
      url: resolvedUrl,
      lrc: resolvedLyrics ?? song.lrc,
      pic: resolvedPicture ?? song.pic,
    );
  }

  Future<String?> _loadUrl({
    required String source,
    required String id,
    required String quality,
  }) async {
    final cacheKey = '$source:$id:$quality';
    final cachedUrl = _freshCachedValue(_urlCache[cacheKey]);
    if (cachedUrl != null) {
      return cachedUrl;
    }

    try {
      final payload = await _getGdStudioData(<String, String>{
        'types': 'url',
        'source': source,
        'id': id,
        'br': _normalizeBitrate(quality),
      });
      final resolvedUrl = _fixUrl(_readString(payload?['url']));
      if (resolvedUrl != null) {
        if (source != 'kuwo') {
          _cacheUrl(cacheKey, resolvedUrl);
        }
        return resolvedUrl;
      }
    } catch (_) {}

    if (source == 'kuwo') {
      return _loadKuwoUrl(id);
    }

    return null;
  }

  Future<String?> _loadLyrics({
    required String source,
    required String id,
  }) async {
    final cacheKey = '$source:$id';
    final cachedLyrics = _lyricsCache[cacheKey];
    if (cachedLyrics != null) {
      return cachedLyrics.isEmpty ? null : cachedLyrics;
    }

    try {
      // 网易的扩展轨要和主歌词并行取：它是第二个 HTTP 往返，串行会白白拖慢
      // 每一次歌词加载，而中文歌那边多半是空的。
      final tracksFuture = _loadNeteaseTracks(source, id);

      final payload = await _getGdStudioData(<String, String>{
        'types': 'lyric',
        'source': source,
        'id': id,
      });
      final main = _readString(payload?['lyric']);
      final translated = _readString(payload?['tlyric']);
      final tracks = await tracksFuture;

      final resolvedLyrics = _composeLyrics(
        main: main,
        translation: translated,
        tracks: tracks,
      );
      if (resolvedLyrics.isNotEmpty) {
        _cacheString(_lyricsCache, cacheKey, resolvedLyrics);
        return resolvedLyrics;
      }
    } catch (_) {}

    if (source == 'kuwo') {
      final resolvedLyrics = await _loadKuwoLyrics(id);
      if (resolvedLyrics != null && resolvedLyrics.isNotEmpty) {
        _cacheString(_lyricsCache, cacheKey, resolvedLyrics);
        return resolvedLyrics;
      }
    }

    _cacheString(_lyricsCache, cacheKey, '');
    return null;
  }

  /// 组装歌词文档。
  ///
  /// 分成两条互斥的路，判据是**有没有解析得出的逐字轨**：
  ///
  /// - 有：整份换用网易 v1 那一套（`yrc` 自带正文 + `ytlrc` 译文 +
  ///   `yromalrc` 罗马音）。主轨留空，见 [LyricDocument] 的类文档。
  /// - 没有：维持原样 —— GD Studio 的 legacy 主轨 + 译文，配上 `romalrc`
  ///   罗马音（实测它与 legacy 主轨逐行精确对齐）。
  ///
  /// 逐字轨存在但一行都解析不出来时按「没有」处理：格式变了宁可退回老路，
  /// 也不要因为主轨被留空而把整首歌的歌词变成空白。
  String _composeLyrics({
    required String? main,
    required String? translation,
    required NeteaseLyricTracks? tracks,
  }) {
    final karaoke = tracks?.karaoke;
    if (karaoke != null && !parseYrcDocument(karaoke).isEmpty) {
      return LyricDocument(
        main: '',
        translation: tracks?.karaokeTranslation ?? '',
        romanization: tracks?.karaokeRomanization ?? '',
        karaoke: karaoke,
      ).encode();
    }

    return LyricDocument(
      main: main ?? '',
      translation: translation ?? '',
      romanization: tracks?.romanization ?? '',
    ).encode();
  }

  /// 取网易扩展轨。只有网易源有这条路 —— 别的源拿的 id 是 GD Studio 自己的
  /// id 空间，发去网易只会得到一个错误响应。
  ///
  /// 没配 loader（例如测试里直接构造的客户端）就整个跳过，等于关掉这个功能。
  Future<NeteaseLyricTracks?> _loadNeteaseTracks(
    String source,
    String id,
  ) async {
    final loader = _lyricLoader;
    if (loader == null || source != 'netease') {
      return null;
    }
    try {
      return await loader(id);
    } catch (_) {
      return null;
    }
  }

  Future<String?> _loadKuwoUrl(String id) async {
    final normalizedId = id.startsWith('MUSIC_') ? id : 'MUSIC_$id';
    try {
      final response = await _dio.getUri<dynamic>(
        Uri.https('antiserver.kuwo.cn', '/anti.s', <String, String>{
          'type': 'convert_url3',
          'rid': normalizedId,
          'format': 'mp3',
          'response': 'url',
        }),
        options: Options(responseType: ResponseType.plain),
      );
      final payload = _readMap(_unwrapJsonLike(response.data));
      return _fixUrl(_readString(payload?['url']));
    } catch (_) {
      return null;
    }
  }

  Future<String?> _loadKuwoLyrics(String id) async {
    final lyrics = await _loadKuwoLyricsFrom(
      Uri.https('kuwo.cn', '/openapi/v1/www/lyric/getlyric', <String, String>{
        'musicId': id,
      }),
    );
    if (lyrics != null && lyrics.isNotEmpty) {
      return lyrics;
    }

    return _loadKuwoLyricsFrom(
      Uri.http('m.kuwo.cn', '/newh5/singles/songinfoandlrc', <String, String>{
        'musicId': id,
        'httpsStatus': '1',
      }),
    );
  }

  Future<String?> _loadKuwoLyricsFrom(Uri uri) async {
    try {
      final response = await _dio.getUri<dynamic>(
        uri,
        options: Options(responseType: ResponseType.plain),
      );
      final payload = _readMap(_unwrapJsonLike(response.data));
      final data = _readMap(payload?['data']);
      final lyricItems = _readList(data?['lrclist']);
      if (lyricItems.isEmpty) {
        return null;
      }
      final lines = lyricItems
          .map(_kuwoLyricLine)
          .whereType<String>()
          .toList(growable: false);
      return lines.isEmpty ? null : lines.join('\n');
    } catch (_) {
      return null;
    }
  }

  String? _kuwoLyricLine(dynamic value) {
    final item = _readMap(value);
    if (item == null) {
      return null;
    }
    final text = _readString(item['lineLyric']) ?? '';
    final seconds = double.tryParse(_readString(item['time']) ?? '');
    if (seconds == null) {
      return null;
    }
    final totalCentiseconds = (seconds * 100).round();
    final minutes = totalCentiseconds ~/ 6000;
    final wholeSeconds = (totalCentiseconds % 6000) ~/ 100;
    final centiseconds = totalCentiseconds % 100;
    return '[${minutes.toString().padLeft(2, '0')}:${wholeSeconds.toString().padLeft(2, '0')}.${centiseconds.toString().padLeft(2, '0')}]$text';
  }

  Future<String?> _loadPicture(Song song) async {
    final existingPicture = _fixUrl(song.pic);
    if (existingPicture != null) {
      return existingPicture;
    }

    final picId = song.picId?.trim();
    if (picId == null || picId.isEmpty) {
      return null;
    }

    final source = song.source.wireValue;
    final cacheKey = '$source:$picId:500';
    final cachedPicture = _pictureCache[cacheKey];
    if (cachedPicture != null) {
      return cachedPicture;
    }

    if (source == 'joox') {
      final jooxPicture = _fixUrl(
        'https://image.joox.com/JOOXcover/0/$picId/500',
      );
      if (jooxPicture != null) {
        _cacheString(_pictureCache, cacheKey, jooxPicture);
      }
      return jooxPicture;
    }

    try {
      final payload = await _getGdStudioData(<String, String>{
        'types': 'pic',
        'source': source,
        'id': picId,
        'size': '500',
      });
      final resolvedPicture = _fixUrl(_readString(payload?['url']));
      if (resolvedPicture != null) {
        _cacheString(_pictureCache, cacheKey, resolvedPicture);
      }
      return resolvedPicture;
    } catch (_) {
      return null;
    }
  }

  Future<Map<String, dynamic>?> _getGdStudioData(
    Map<String, String> queryParameters,
  ) async {
    final response = await _dio.getUri<dynamic>(
      _buildGdStudioUri(apiBase: _apiBase, queryParameters: queryParameters),
      options: Options(responseType: ResponseType.plain),
    );
    final rawPayload = response.data;
    if (rawPayload is String && _looksLikeRateLimitResponse(rawPayload)) {
      throw StateError('GD Studio rate limit response.');
    }
    final payload = _readMap(_unwrapJsonLike(rawPayload));
    if (_readString(payload?['error']) != null) {
      throw StateError('GD Studio returned an error response.');
    }
    return payload;
  }
}

String _resolutionCacheKey(Song song, String quality) {
  return '${song.source.wireValue}:${song.id}:${song.urlId ?? ''}:${song.lyricId ?? ''}:${song.picId ?? ''}:$quality';
}

Uri _buildGdStudioUri({
  required String apiBase,
  required Map<String, String> queryParameters,
}) {
  final baseUri = Uri.parse(_normalizeApiBase(apiBase));
  return baseUri.replace(
    queryParameters: <String, String>{
      ...baseUri.queryParameters,
      ...queryParameters,
    },
  );
}

String _normalizeApiBase(String value) {
  final trimmedValue = value.trim();
  return trimmedValue.isEmpty ? defaultGdStudioApiBase : trimmedValue;
}

String _requestId(String? preferredId, String fallbackId) {
  final trimmedId = preferredId?.trim();
  if (trimmedId != null && trimmedId.isNotEmpty) {
    return trimmedId;
  }
  return fallbackId;
}

void _trimCache<K, V>(Map<K, V> cache) {
  while (cache.length > GdStudioSongResolutionClient._maxCacheEntries) {
    cache.remove(cache.keys.first);
  }
}

T? _freshCachedValue<T>(_CachedResolution<T>? cachedValue) {
  if (cachedValue == null) {
    return null;
  }
  if (DateTime.now().difference(cachedValue.storedAt) >
      GdStudioSongResolutionClient._urlCacheTtl) {
    return null;
  }
  return cachedValue.value;
}

bool _looksLikeRateLimitResponse(String value) {
  final normalized = value.toLowerCase();
  return normalized.contains('rate limit') ||
      normalized.contains('too many requests') ||
      normalized.contains('频率') ||
      normalized.contains('cloudflare');
}

String _normalizeBitrate(String quality) {
  return switch (quality) {
    '128k' => '128',
    '320k' => '320',
    'flac' => '740',
    'flac24bit' => '999',
    _ => '320',
  };
}

String? _fixUrl(String? value) {
  if (value == null) {
    return null;
  }

  var fixedValue = value.trim().replaceAll('&amp;', '&');
  if (fixedValue.isEmpty) {
    return null;
  }
  if (fixedValue.startsWith('//')) {
    fixedValue = 'https:$fixedValue';
  }
  if (fixedValue.startsWith('http://') &&
      (fixedValue.contains('music.126.net') ||
          fixedValue.contains('y.gtimg.cn') ||
          fixedValue.contains('qpic.cn'))) {
    fixedValue = fixedValue.replaceFirst('http://', 'https://');
  }
  if (fixedValue.contains('300x300')) {
    fixedValue = fixedValue.replaceAll('300x300', '500x500');
  }
  return fixedValue;
}

dynamic _unwrapJsonLike(dynamic value) {
  if (value is! String) {
    return value;
  }

  final trimmedValue = value.trim();
  if (trimmedValue.isEmpty) {
    return value;
  }

  try {
    return jsonDecode(trimmedValue);
  } catch (_) {
    final match = RegExp(
      r'^\s*[\w.]+\s*\((.*)\)\s*;?\s*$',
      dotAll: true,
    ).firstMatch(trimmedValue);
    if (match == null) {
      return value;
    }
    try {
      return jsonDecode(match.group(1)!);
    } catch (_) {
      return value;
    }
  }
}

Map<String, dynamic>? _readMap(dynamic value) {
  if (value is Map<String, dynamic>) {
    return value;
  }
  if (value is Map) {
    return Map<String, dynamic>.from(value);
  }
  return null;
}

List<dynamic> _readList(dynamic value) {
  if (value is List) {
    return value;
  }
  return const <dynamic>[];
}

String? _readString(dynamic value) {
  if (value == null) {
    return null;
  }
  if (value is String) {
    final trimmedValue = value.trim();
    return trimmedValue.isEmpty ? null : trimmedValue;
  }
  return value.toString();
}

final class _CachedResolution<T> {
  const _CachedResolution(this.value, this.storedAt);

  final T value;
  final DateTime storedAt;
}
