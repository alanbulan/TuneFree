import 'dart:convert';

import 'package:dio/dio.dart';

import '../../../core/models/music_source.dart';
import '../../../core/models/song.dart';
import '../../../core/network/tune_free_http_client.dart';
import '../../../core/source_clients/tunehub_client.dart';

typedef PlaylistImportPayload = ({String name, List<Song> songs});
typedef PlaylistImportLoader = Future<List<Song>> Function(String source, String id);
typedef PlaylistImportPayloadLoader = Future<PlaylistImportPayload?> Function(
  String source,
  String id,
);

const defaultTunehubApiBase = 'https://tunehub.sayqz.com/api';
const _placeholderTuneFreeApiBase = 'https://api.tune-free.example';
const Set<String> _forbiddenRequestHeaders = <String>{
  'user-agent',
  'referer',
  'host',
  'origin',
  'cookie',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'connection',
  'content-length',
};

abstract class PlaylistImportClient {
  Future<PlaylistImportPayload?> importPlaylist(String source, String id);
}

final class TunehubPlaylistImportClient implements PlaylistImportClient {
  TunehubPlaylistImportClient({
    required TuneFreeHttpClient httpClient,
    required String Function() apiBaseProvider,
  }) : _httpClient = httpClient,
       _apiBaseProvider = apiBaseProvider;

  final TuneFreeHttpClient _httpClient;
  final String Function() _apiBaseProvider;

  @override
  Future<PlaylistImportPayload?> importPlaylist(String source, String id) async {
    final apiBase = _normalizeApiBase(_apiBaseProvider());
    final methodResponse = await _httpClient.dio.get<Map<String, dynamic>>(
      '$apiBase/v1/methods/$source/playlist',
    );
    final methodData = _readMap(methodResponse.data?['data']);
    if (methodData == null) {
      return null;
    }

    final variables = <String, String>{'id': id};
    final requestUrl = _buildRequestUri(
      rawUrl: methodData['url'] as String? ?? '',
      rawParams: _readMap(methodData['params']),
      variables: variables,
    );
    final requestMethod = (methodData['method'] as String? ?? 'GET').toUpperCase();
    final requestBody = _resolveTemplateValue(methodData['body'], variables);
    final requestHeaders = _buildHeaders(
      rawHeaders: _readMap(methodData['headers']),
      variables: variables,
      includeJsonContentType: requestMethod != 'GET' && requestBody != null,
    );

    final response = await _httpClient.dio.requestUri<dynamic>(
      requestUrl,
      data: requestMethod == 'GET' ? null : requestBody,
      options: Options(method: requestMethod, headers: requestHeaders),
    );

    final payload = _unwrapJsonLike(response.data);
    final songs = List<Song>.unmodifiable(_normalizeSongs(_extractList(payload), source));
    if (songs.isEmpty) {
      return null;
    }

    return (
      name: _extractPlaylistName(payload) ?? id,
      songs: songs,
    );
  }
}

final class PlaylistImportRepository {
  PlaylistImportRepository({required PlaylistImportClient client})
    : this.payloadLoader(importPlaylist: client.importPlaylist);

  PlaylistImportRepository.fromTunehub({required TunehubClient tunehubClient})
    : this.payloadLoader(
        importPlaylist: (source, id) async {
          final songs = await tunehubClient.importPlaylist(source, id);
          if (songs.isEmpty) {
            return null;
          }
          return (name: id, songs: List<Song>.unmodifiable(songs));
        },
      );

  PlaylistImportRepository.loader({required PlaylistImportLoader importPlaylistSongs})
    : this.payloadLoader(
        importPlaylist: (source, id) async {
          final songs = await importPlaylistSongs(source, id);
          return (name: id, songs: List<Song>.unmodifiable(songs));
        },
      );

  PlaylistImportRepository.payloadLoader({required PlaylistImportPayloadLoader importPlaylist})
    : _importPlaylist = importPlaylist;

  PlaylistImportRepository.test({
    PlaylistImportPayloadLoader? importPlaylist,
    PlaylistImportLoader? importPlaylistSongs,
  }) : this.payloadLoader(
         importPlaylist: importPlaylist ??
             (source, id) async {
               if (importPlaylistSongs == null) {
                 return null;
               }
               final songs = await importPlaylistSongs(source, id);
               return (name: id, songs: List<Song>.unmodifiable(songs));
             },
       );

  final PlaylistImportPayloadLoader _importPlaylist;

  Future<(String name, List<Song> songs)?> importPlaylist({
    required String source,
    required String id,
  }) async {
    final payload = await _importPlaylist(source, id);
    if (payload == null) {
      return null;
    }
    return (payload.name, payload.songs);
  }
}

String _normalizeApiBase(String value) {
  final trimmedValue = value.trim();
  if (trimmedValue.isEmpty || trimmedValue == _placeholderTuneFreeApiBase) {
    return defaultTunehubApiBase;
  }
  return trimmedValue.endsWith('/')
      ? trimmedValue.substring(0, trimmedValue.length - 1)
      : trimmedValue;
}

Uri _buildRequestUri({
  required String rawUrl,
  required Map<String, dynamic>? rawParams,
  required Map<String, String> variables,
}) {
  final resolvedUrl = _replaceTemplates(rawUrl, variables);
  final baseUri = Uri.parse(resolvedUrl);
  if (rawParams == null || rawParams.isEmpty) {
    return baseUri;
  }

  final queryParameters = <String, String>{
    ...baseUri.queryParameters,
    for (final entry in rawParams.entries)
      if (_resolveTemplateValue(entry.value, variables) case final value?) entry.key: value.toString(),
  };
  return baseUri.replace(queryParameters: queryParameters);
}

Map<String, String> _buildHeaders({
  required Map<String, dynamic>? rawHeaders,
  required Map<String, String> variables,
  required bool includeJsonContentType,
}) {
  final headers = <String, String>{};
  if (rawHeaders != null) {
    for (final entry in rawHeaders.entries) {
      if (_forbiddenRequestHeaders.contains(entry.key.toLowerCase())) {
        continue;
      }
      headers[entry.key] = _replaceTemplates(entry.value.toString(), variables);
    }
  }

  final hasContentType = headers.keys.any((key) => key.toLowerCase() == 'content-type');
  if (includeJsonContentType && !hasContentType) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

dynamic _resolveTemplateValue(dynamic value, Map<String, String> variables) {
  if (value is String) {
    if (value.startsWith('{{') && value.endsWith('}}')) {
      final expression = value.substring(2, value.length - 2);
      return _evaluateTemplateExpression(expression, variables);
    }
    return _replaceTemplates(value, variables);
  }
  if (value is List) {
    return value.map((item) => _resolveTemplateValue(item, variables)).toList(growable: false);
  }
  if (value is Map) {
    return value.map(
      (key, entryValue) => MapEntry(key, _resolveTemplateValue(entryValue, variables)),
    );
  }
  return value;
}

String _replaceTemplates(String template, Map<String, String> variables) {
  return template.replaceAllMapped(RegExp(r'\{\{(.*?)\}\}'), (match) {
    final replacement = _evaluateTemplateExpression(match.group(1)!, variables);
    return replacement?.toString() ?? '';
  });
}

dynamic _evaluateTemplateExpression(String expression, Map<String, String> variables) {
  final trimmedExpression = expression.trim();

  if (trimmedExpression.startsWith('parseInt(') && trimmedExpression.endsWith(')')) {
    final key = trimmedExpression.substring('parseInt('.length, trimmedExpression.length - 1).trim();
    return int.tryParse(variables[key] ?? '') ?? 0;
  }

  if (trimmedExpression.contains('||')) {
    final segments = trimmedExpression.split('||').map((segment) => segment.trim());
    for (final segment in segments) {
      final variableValue = variables[segment];
      if (variableValue != null && variableValue.isNotEmpty) {
        return variableValue;
      }
      final numericValue = int.tryParse(segment);
      if (numericValue != null) {
        return numericValue;
      }
      if ((segment.startsWith("'") && segment.endsWith("'")) ||
          (segment.startsWith('"') && segment.endsWith('"'))) {
        return segment.substring(1, segment.length - 1);
      }
    }
    return '';
  }

  if ((trimmedExpression.startsWith("'") && trimmedExpression.endsWith("'")) ||
      (trimmedExpression.startsWith('"') && trimmedExpression.endsWith('"'))) {
    return trimmedExpression.substring(1, trimmedExpression.length - 1);
  }

  return variables[trimmedExpression] ?? '';
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
    final match = RegExp(r'^\s*[\w.]+\s*\((.*)\)\s*;?\s*$', dotAll: true).firstMatch(trimmedValue);
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

String? _extractPlaylistName(dynamic payload) {
  final payloadMap = _readMap(payload);
  if (payloadMap == null) {
    return null;
  }

  return _readString(payloadMap['name']) ??
      _readString(_readMap(payloadMap['info'])?['name']) ??
      _readString(_readMap(payloadMap['playlist'])?['name']) ??
      _readString(_readMap(payloadMap['data'])?['name']) ??
      _readString(_readMap(payloadMap['result'])?['name']);
}

List<dynamic> _extractList(dynamic payload) {
  if (payload is List<dynamic>) {
    return payload;
  }

  final payloadMap = _readMap(payload);
  if (payloadMap == null) {
    return const <dynamic>[];
  }

  final directMatches = <dynamic>[
    payloadMap['tracks'],
    payloadMap['songs'],
    payloadMap['list'],
    payloadMap['songlist'],
    _readMap(payloadMap['playlist'])?['tracks'],
    _readMap(payloadMap['result'])?['tracks'],
    _readMap(payloadMap['result'])?['songs'],
    _readMap(payloadMap['data'])?['songlist'],
    _readMap(_readMap(payloadMap['data'])?['song'])?['list'],
    _readMap(_readMap(payloadMap['toplist'])?['data'])?['songInfoList'],
    payloadMap['musiclist'],
    payloadMap['abslist'],
  ];

  for (final match in directMatches) {
    if (match is List<dynamic>) {
      return match;
    }
  }

  if (payloadMap['data'] case final List<dynamic> dataList) {
    return dataList;
  }
  return const <dynamic>[];
}

List<Song> _normalizeSongs(List<dynamic> items, String source) {
  final songs = <Song>[];
  for (var index = 0; index < items.length; index += 1) {
    final song = _normalizeSong(items[index], source, index);
    if (song != null) {
      songs.add(song);
    }
  }
  return songs;
}

Song? _normalizeSong(dynamic rawItem, String source, int index) {
  final item = _readMap(rawItem);
  if (item == null) {
    return null;
  }

  final actualItem = _readMap(item['data']) ?? item;
  final songId = _findSongId(actualItem, source) ?? 'temp-$source-${index + 1}';
  final songName = _readString(actualItem['name']) ??
      _readString(actualItem['title']) ??
      _readString(actualItem['songname']) ??
      'Unknown Song';
  final artistName = _extractArtistName(actualItem) ?? 'Unknown Artist';
  final albumName = _extractAlbumName(actualItem) ?? '';
  final pictureUrl = _normalizePictureUrl(_findImage(actualItem));

  return Song(
    id: songId,
    name: songName,
    artist: artistName,
    album: albumName,
    pic: pictureUrl.isEmpty ? null : pictureUrl,
    source: MusicSource(source),
  );
}

String? _findSongId(Map<String, dynamic> item, String source) {
  if (source == 'qq') {
    return _readString(item['songmid']) ??
        _readString(item['mid']) ??
        _readString(_readMap(item['file'])?['media_mid']) ??
        _readString(item['topId']) ??
        _readString(item['id']);
  }

  if (source == 'kuwo') {
    return _readString(item['rid']) ?? _readString(item['musicrid']) ?? _readString(item['id']);
  }

  return _readString(item['id']) ?? _readString(item['ID']);
}

String? _extractArtistName(Map<String, dynamic> item) {
  final artist = _readString(item['artist']);
  if (artist != null && artist.isNotEmpty) {
    return artist;
  }

  return _joinNamedEntries(item['ar']) ??
      _joinNamedEntries(item['artists']) ??
      _joinNamedEntries(item['singer']) ??
      _joinNamedEntries(item['singerList']) ??
      _readString(item['artist_name']);
}

String? _extractAlbumName(Map<String, dynamic> item) {
  final album = item['album'];
  if (album is String && album.isNotEmpty) {
    return album;
  }
  if (album is Map) {
    final name = _readString(album['name']);
    if (name != null && name.isNotEmpty) {
      return name;
    }
  }

  return _readString(item['album_name']) ??
      _readString(item['albumname']) ??
      _readString(item['albumName']);
}

String _findImage(Map<String, dynamic> item) {
  for (final key in const <String>[
    'picUrl',
    'coverImgUrl',
    'pic',
    'pic_v12',
    'frontPicUrl',
    'headPicUrl',
    'img',
    'cover',
    'imgUrl',
    'album_pic',
    'albumpic',
  ]) {
    final value = _readString(item[key]);
    if (value != null && value.isNotEmpty) {
      return value;
    }
  }

  final nestedImage = _readString(_readMap(item['al'])?['picUrl']) ??
      _readString(_readMap(item['album'])?['picUrl']) ??
      _readString(_readMap(item['mac_detail'])?['pic_v12']);
  if (nestedImage != null && nestedImage.isNotEmpty) {
    return nestedImage;
  }

  final albumMid = _readString(item['albummid']) ??
      _readString(_readMap(item['album'])?['mid']) ??
      _readString(item['album_mid']);
  if (albumMid != null && albumMid.isNotEmpty) {
    return 'https://y.gtimg.cn/music/photo_new/T002R300x300M000$albumMid.jpg';
  }

  return '';
}

String _normalizePictureUrl(String value) {
  if (value.isEmpty) {
    return value;
  }

  var normalizedValue = value.replaceAll('&amp;', '&').trim();
  if (normalizedValue.startsWith('//')) {
    normalizedValue = 'https:$normalizedValue';
  }
  if (normalizedValue.startsWith('http://') &&
      (normalizedValue.contains('music.126.net') ||
          normalizedValue.contains('y.gtimg.cn') ||
          normalizedValue.contains('qpic.cn'))) {
    normalizedValue = normalizedValue.replaceFirst('http://', 'https://');
  }
  if (normalizedValue.contains('300x300')) {
    normalizedValue = normalizedValue.replaceAll('300x300', '500x500');
  }
  return normalizedValue;
}

String? _joinNamedEntries(dynamic rawEntries) {
  if (rawEntries is! List) {
    return null;
  }

  final names = rawEntries
      .map((entry) => _readString(_readMap(entry)?['name']))
      .whereType<String>()
      .where((value) => value.isNotEmpty)
      .toList(growable: false);
  if (names.isEmpty) {
    return null;
  }
  return names.join('/');
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
