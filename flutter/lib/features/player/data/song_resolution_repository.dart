import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/song.dart';
import '../../../core/network/tune_free_http_client.dart';
import '../../../core/source_clients/tunehub_client.dart';
import '../../library/application/library_controller.dart';
import '../../library/data/playlist_import_repository.dart';

typedef SongResolver = Future<Song> Function(Song song, String quality);

final tunehubClientProvider = Provider<TunehubClient>((ref) {
  final httpClient = TuneFreeHttpClient();
  return TunehubSongResolutionClient(
    httpClient: httpClient,
    apiBaseProvider: () => ref.read(libraryControllerProvider).state.apiBase,
    apiKeyProvider: () => ref.read(libraryControllerProvider).state.apiKey,
  );
});

final songResolutionRepositoryProvider = Provider<SongResolutionRepository>((ref) {
  return SongResolutionRepository(tunehubClient: ref.watch(tunehubClientProvider));
});

final class SongResolutionRepository {
  SongResolutionRepository({required TunehubClient tunehubClient})
    : this.test(resolveSongValue: tunehubClient.resolveSong);

  SongResolutionRepository.test({required SongResolver resolveSongValue})
    : _resolveSongValue = resolveSongValue;

  final SongResolver _resolveSongValue;

  Future<Song> resolveSong(Song song, {required String quality}) {
    return _resolveSongValue(song, quality);
  }
}

final class TunehubSongResolutionClient implements TunehubClient {
  TunehubSongResolutionClient({
    required TuneFreeHttpClient httpClient,
    required String Function() apiBaseProvider,
    required String Function() apiKeyProvider,
  }) : _httpClient = httpClient,
       _apiBaseProvider = apiBaseProvider,
       _apiKeyProvider = apiKeyProvider,
       _playlistImportClient = TunehubPlaylistImportClient(
         httpClient: httpClient,
         apiBaseProvider: apiBaseProvider,
       );

  final TuneFreeHttpClient _httpClient;
  final String Function() _apiBaseProvider;
  final String Function() _apiKeyProvider;
  final TunehubPlaylistImportClient _playlistImportClient;

  @override
  Future<List<Song>> importPlaylist(String source, String id) async {
    final payload = await _playlistImportClient.importPlaylist(source, id);
    return payload?.songs ?? const <Song>[];
  }

  @override
  Future<Song> resolveSong(Song song, String quality) async {
    final apiBase = _normalizeResolutionApiBase(_apiBaseProvider());
    final apiKey = _apiKeyProvider().trim();
    final response = await _httpClient.dio.post<Map<String, dynamic>>(
      '$apiBase/v1/parse',
      data: <String, dynamic>{
        'platform': song.source.wireValue,
        'ids': song.id,
        'quality': quality,
      },
      options: Options(
        headers: <String, String>{
          if (apiKey.isNotEmpty) 'X-API-Key': apiKey,
        },
      ),
    );

    final payload = _unwrapJsonLike(response.data);
    final items = _extractList(_readMap(payload)?['data'] ?? payload);
    final resolvedItem = items.isEmpty ? null : _readMap(items.first);
    final actualItem = resolvedItem == null ? null : _readMap(resolvedItem['data']) ?? resolvedItem;
    if (actualItem == null) {
      throw StateError('TuneHub parse returned no song data for ${song.key}.');
    }

    final resolvedUrl = _readString(actualItem['url']);
    if (resolvedUrl == null || resolvedUrl.isEmpty) {
      throw StateError('TuneHub parse returned no playable URL for ${song.key}.');
    }

    final resolvedLyrics = _readString(actualItem['lyrics']) ??
        _readString(actualItem['lrc']) ??
        _readString(actualItem['lyric']);
    final resolvedPicture = _readString(actualItem['pic']) ??
        _readString(actualItem['picUrl']) ??
        _readString(_readMap(actualItem['al'])?['picUrl']) ??
        _readString(_readMap(actualItem['album'])?['picUrl']);

    return song.copyWith(
      url: resolvedUrl,
      lrc: resolvedLyrics ?? song.lrc,
      pic: resolvedPicture ?? song.pic,
    );
  }
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

  if (payloadMap['id'] != null && payloadMap['name'] != null) {
    return <dynamic>[payloadMap];
  }

  return const <dynamic>[];
}

String _normalizeResolutionApiBase(String value) {
  final trimmedValue = value.trim();
  if (trimmedValue.isEmpty || trimmedValue == 'https://api.tune-free.example') {
    return defaultTunehubApiBase;
  }
  return trimmedValue.endsWith('/')
      ? trimmedValue.substring(0, trimmedValue.length - 1)
      : trimmedValue;
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
