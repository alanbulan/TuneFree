import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/core/network/tune_free_http_client.dart';
import 'package:tunefree/features/player/data/song_resolution_repository.dart';

final class _FakeGdStudioAdapter implements HttpClientAdapter {
  final List<Uri> requestedUris = <Uri>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requestedUris.add(options.uri);
    if (options.uri.host == 'antiserver.kuwo.cn') {
      return _jsonResponse(<String, dynamic>{
        'url': 'http://antiserver.kuwo.cn/kuwo-song.mp3',
      });
    }
    if (options.uri.host == 'kuwo.cn') {
      return _jsonResponse(<String, dynamic>{
        'data': <String, dynamic>{
          'lrclist': <Map<String, String>>[
            <String, String>{'time': '1.23', 'lineLyric': '酷我歌词'},
          ],
        },
      });
    }

    final type = options.uri.queryParameters['types'];
    final source = options.uri.queryParameters['source'];
    final body = switch ((source, type)) {
      ('kuwo', 'url') => <String, dynamic>{'url': ''},
      ('kuwo', 'lyric') => <String, dynamic>{},
      (_, 'url') => <String, dynamic>{
        'url': 'http://music.126.net/song-320.mp3',
      },
      (_, 'lyric') => <String, dynamic>{
        'lyric': '[00:00.00]第一句',
        'tlyric': '[00:00.00]First line',
      },
      (_, 'pic') => <String, dynamic>{
        'url': '//p3.music.126.net/cover-300x300.jpg',
      },
      _ => <String, dynamic>{'error': 'unknown type'},
    };
    return _jsonResponse(body);
  }

  @override
  void close({bool force = false}) {}

  ResponseBody _jsonResponse(Object body) {
    return ResponseBody.fromString(
      jsonEncode(body),
      200,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }
}

void main() {
  test('GD Studio resolver uses the React api.php parse source only', () async {
    final dio = Dio();
    final adapter = _FakeGdStudioAdapter();
    dio.httpClientAdapter = adapter;
    final client = GdStudioSongResolutionClient(
      httpClient: TuneFreeHttpClient(dio: dio),
    );

    const song = Song(
      id: 'song-id',
      name: '海与你',
      artist: '马也_Crabbit',
      source: MusicSource.netease,
      picId: 'pic-id',
      urlId: 'url-id',
      lyricId: 'lyric-id',
    );

    final resolvedSong = await client.resolveSong(song, 'flac');

    expect(resolvedSong.url, 'https://music.126.net/song-320.mp3');
    expect(resolvedSong.lrc, '[00:00.00]第一句\n[00:00.00]First line');
    expect(resolvedSong.pic, 'https://p3.music.126.net/cover-500x500.jpg');
    expect(adapter.requestedUris, hasLength(3));
    expect(
      adapter.requestedUris.every(
        (uri) => uri.toString().startsWith(defaultGdStudioApiBase),
      ),
      isTrue,
    );
    expect(
      adapter.requestedUris.any((uri) => uri.path.contains('/api/url')),
      isFalse,
    );
    expect(
      adapter.requestedUris.any((uri) => uri.path.contains('/v1/parse')),
      isFalse,
    );
    expect(adapter.requestedUris.first.queryParameters, <String, String>{
      'types': 'url',
      'source': 'netease',
      'id': 'url-id',
      'br': '740',
    });
  });

  test(
    'GD Studio resolver builds JOOX cover URL from pic id directly',
    () async {
      final dio = Dio();
      final adapter = _FakeGdStudioAdapter();
      dio.httpClientAdapter = adapter;
      final client = GdStudioSongResolutionClient(
        httpClient: TuneFreeHttpClient(dio: dio),
      );

      const song = Song(
        id: 'joox-song',
        name: 'JOOX Song',
        artist: 'TuneFree',
        source: MusicSource.joox,
        picId: 'joox-pic',
      );

      final resolvedSong = await client.resolveSong(song, '320k');

      expect(
        resolvedSong.pic,
        'https://image.joox.com/JOOXcover/0/joox-pic/500',
      );
      expect(
        adapter.requestedUris.map((uri) => uri.queryParameters['types']),
        isNot(contains('pic')),
      );
      expect(adapter.requestedUris.first.queryParameters['br'], '320');
    },
  );

  test('repository deduplicates matching in-flight resolutions', () async {
    final completer = Completer<Song>();
    var resolveCalls = 0;
    final repository = SongResolutionRepository.test(
      resolveSongValue: (song, quality) {
        resolveCalls += 1;
        return completer.future;
      },
    );

    const song = Song(
      id: 'dedupe-song',
      name: 'Dedupe Song',
      artist: 'TuneFree',
      source: MusicSource.netease,
    );

    final firstResolution = repository.resolveSong(song, quality: '320k');
    final secondResolution = repository.resolveSong(song, quality: '320k');

    expect(resolveCalls, 1);

    final resolvedSong = song.copyWith(url: 'https://example.com/dedupe.mp3');
    completer.complete(resolvedSong);

    await expectLater(firstResolution, completion(resolvedSong));
    await expectLater(secondResolution, completion(resolvedSong));
  });

  test(
    'Kuwo resolver falls back to official URL and lyric endpoints',
    () async {
      final dio = Dio();
      final adapter = _FakeGdStudioAdapter();
      dio.httpClientAdapter = adapter;
      final client = GdStudioSongResolutionClient(
        httpClient: TuneFreeHttpClient(dio: dio),
      );

      const song = Song(
        id: '789',
        name: '酷我歌曲',
        artist: '酷我歌手',
        source: MusicSource.kuwo,
      );

      final resolvedSong = await client.resolveSong(song, '320k');

      expect(resolvedSong.url, 'http://antiserver.kuwo.cn/kuwo-song.mp3');
      expect(resolvedSong.lrc, '[00:01.23]酷我歌词');
      expect(
        adapter.requestedUris.any((uri) => uri.host == 'antiserver.kuwo.cn'),
        isTrue,
      );
      expect(
        adapter.requestedUris.any(
          (uri) =>
              uri.host == 'kuwo.cn' && uri.path.contains('/lyric/getlyric'),
        ),
        isTrue,
      );
    },
  );
}
