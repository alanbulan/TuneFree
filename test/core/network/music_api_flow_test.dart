import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/core/network/gd_studio_api_client.dart';
import 'package:tunefree/core/network/music_api_connection_tester.dart';
import 'package:tunefree/core/network/music_api_controller.dart';
import 'package:tunefree/core/network/music_api_providers.dart';
import 'package:tunefree/core/network/music_api_settings.dart';
import 'package:tunefree/core/network/source_http_client.dart';
import 'package:tunefree/core/network/tune_free_http_client.dart';
import 'package:tunefree/features/library/presentation/library_page.dart';
import 'package:tunefree/features/player/application/just_audio_player_engine.dart';
import 'package:tunefree/features/player/application/player_controller.dart';
import 'package:tunefree/features/player/data/netease_lyric_client.dart';
import 'package:tunefree/features/player/data/player_preferences_store.dart';
import 'package:tunefree/features/player/data/song_resolution_repository.dart';
import 'package:tunefree/features/search/application/search_providers.dart';

final class _Request {
  const _Request(this.options, this.parameters);
  final RequestOptions options;
  final Map<String, String> parameters;
}

final class _ApiAdapter implements HttpClientAdapter {
  final requests = <_Request>[];
  int status = 200;
  bool badResponse = false;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final body = <int>[];
    if (requestStream != null) {
      await for (final chunk in requestStream) {
        body.addAll(chunk);
      }
    }
    final parameters = body.isEmpty
        ? options.uri.queryParameters
        : Uri.splitQueryString(utf8.decode(body));
    requests.add(_Request(options, parameters));
    if (status != 200) {
      return ResponseBody.fromString('unavailable', status);
    }
    if (options.uri.path.endsWith('/time')) {
      return ResponseBody.fromString('1783745000', 200);
    }
    Object? payload;
    if (badResponse) {
      payload = {'unexpected': true};
    } else if (options.uri.path.contains('/v1/methods/')) {
      payload = {
        'data': {
          'url': 'https://${options.uri.host}/playlist',
          'method': 'GET',
        },
      };
    } else if (options.uri.path == '/playlist') {
      payload = {
        'name': '自定义歌单',
        'songs': [
          {'id': 'playlist-song', 'name': '歌单歌曲', 'artist': '歌手'},
        ],
      };
    } else if (options.uri.host == 'music.163.com') {
      payload = {
        'playlist': {'tracks': []},
      };
    } else {
      payload = switch (parameters['types']) {
        'search' => [
          {
            'id': 'test-song',
            'name': '自定义歌曲',
            'artist': ['测试歌手'],
            'album': '测试专辑',
            'pic_id': 'picture',
            'url_id': 'stream',
            'lyric_id': 'lyrics',
          },
        ],
        'url' => {'url': 'https://${options.uri.host}/song.mp3'},
        'lyric' => {'lyric': '[00:00.00]${options.uri.host}'},
        'pic' => {'url': 'https://${options.uri.host}/cover.png'},
        _ => [],
      };
    }
    return ResponseBody.fromString(
      jsonEncode(payload),
      200,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'signed POST matches desktop signature and synchronizes time once',
    () async {
      final adapter = _ApiAdapter();
      final dio = Dio()..httpClientAdapter = adapter;
      final client = GdStudioApiClient(
        httpClient: SourceHttpClient(httpClient: TuneFreeHttpClient(dio: dio)),
        settingsLoader: () async => const MusicApiSettings(),
        clock: () => DateTime.fromMillisecondsSinceEpoch(1_783_745_000_000),
      );
      await Future.wait([
        client.request({'types': 'search', 'source': 'qq', 'name': '林俊杰'}),
        client.request({'types': 'url', 'source': 'netease', 'id': '123'}),
      ]);
      expect(
        adapter.requests.where(
          (request) => request.options.uri.path == '/time',
        ),
        hasLength(1),
      );
      final post = adapter.requests.firstWhere(
        (request) => request.parameters['types'] == 'search',
      );
      expect(post.options.method, 'POST');
      expect(post.parameters['source'], 'tencent');
      expect(post.parameters['name'], '林俊杰');
      expect(post.parameters['s'], 'E007CA1F');
      expect(post.options.contentType, Headers.formUrlEncodedContentType);
    },
  );

  test('custom GET retains query parameters and never falls back to a public proxy', () async {
    final adapter = _ApiAdapter();
    final dio = Dio()..httpClientAdapter = adapter;
    final client = GdStudioApiClient(
      httpClient: SourceHttpClient(httpClient: TuneFreeHttpClient(dio: dio)),
      settingsLoader: () async => const MusicApiSettings(
        musicApiBase:
            'http://192.168.1.10:8080/v2/api.php?tag=a&tag=b&key=demo',
        requestMode: MusicApiRequestMode.compatibleGet,
      ),
    );
    await client.request({'types': 'search', 'source': 'qq', 'name': '林俊杰'});
    final request = adapter.requests.single;
    expect(request.options.uri.queryParametersAll['tag'], ['a', 'b']);
    expect(request.parameters['key'], 'demo');
    expect(request.parameters['source'], 'qq');
    expect(request.options.method, 'GET');
    adapter.status = 503;
    await expectLater(
      client.request({'types': 'search'}),
      throwsA(isA<DioException>()),
    );
    expect(adapter.requests, hasLength(2));
    expect(
      adapter.requests.every(
        (request) => request.options.uri.host == '192.168.1.10',
      ),
      isTrue,
    );
  });

  test('saved settings drive provider search, playback, lyrics, covers and playlist fallback without resetting search', () async {
    SharedPreferences.setMockInitialValues({});
    final adapter = _ApiAdapter();
    final dio = Dio()..httpClientAdapter = adapter;
    final container = ProviderContainer(
      overrides: [
        musicApiHttpClientProvider.overrideWithValue(
          TuneFreeHttpClient(dio: dio),
        ),
        neteaseLyricLoaderProvider.overrideWithValue((_) async => null),
      ],
    );
    addTearDown(container.dispose);
    final settings = container.read(musicApiControllerProvider.notifier);
    final search = container.read(remoteSearchRepositoryProvider);
    final searchController = container.read(searchControllerProvider);
    final resolution = container.read(songResolutionRepositoryProvider);
    final playlist = container.read(playlistImportRepositoryProvider);
    const firstApi = MusicApiSettings(
      musicApiBase: 'https://first.example/api.php?key=demo',
      playlistApiBase: 'https://playlists.example/api?key=playlist-demo',
      requestMode: MusicApiRequestMode.compatibleGet,
    );
    await settings.save(firstApi);
    final songs = await search.searchSingle('测试', source: 'netease', page: 1);
    expect(songs.single.name, '自定义歌曲');
    final song = songs.single;
    final first = await resolution.resolveSong(song, quality: '320k');
    expect(first.url, 'https://first.example/song.mp3');
    expect(first.lrc, '[00:00.00]first.example');
    expect(first.pic, 'https://first.example/cover.png');
    final imported = await playlist.importPlaylist(
      source: 'netease',
      id: '99999999999',
    );
    expect(imported.$1, '自定义歌单');
    final descriptor = adapter.requests.firstWhere(
      (request) => request.options.uri.path.contains('/v1/methods/'),
    );
    expect(descriptor.options.uri.host, 'playlists.example');
    expect(descriptor.parameters['key'], 'playlist-demo');

    await settings.save(
      const MusicApiSettings(
        musicApiBase: 'https://second.example/api.php',
        requestMode: MusicApiRequestMode.compatibleGet,
      ),
    );
    final second = await resolution.resolveSong(song, quality: '320k');
    expect(second.url, 'https://second.example/song.mp3');
    expect(second.lrc, '[00:00.00]second.example');
    expect(second.pic, 'https://second.example/cover.png');
    // 已解析过的歌曲也必须重新获取封面，避免把上一个服务的封面带过去。
    final refreshed = await resolution.resolveSong(first, quality: '320k');
    expect(refreshed.pic, 'https://second.example/cover.png');
    final joox = await search.searchSingle('测试', source: 'joox', page: 1);
    expect(joox.single.pic, isNull);
    final jooxResolved = await resolution.resolveSong(
      joox.single,
      quality: '320k',
    );
    expect(jooxResolved.pic, 'https://second.example/cover.png');
    expect(container.read(searchControllerProvider), same(searchController));
    expect(container.read(songResolutionRepositoryProvider), same(resolution));
    await settings.save(const MusicApiSettings());
    expect(container.read(remoteSearchRepositoryProvider), same(search));
  });

  test(
    'replaying a resolved queue song uses the newly saved music API',
    () async {
      SharedPreferences.setMockInitialValues({});
      final adapter = _ApiAdapter();
      final container = ProviderContainer(
        overrides: [
          musicApiHttpClientProvider.overrideWithValue(
            TuneFreeHttpClient(dio: Dio()..httpClientAdapter = adapter),
          ),
          neteaseLyricLoaderProvider.overrideWithValue((_) async => null),
        ],
      );
      addTearDown(container.dispose);
      final settings = container.read(musicApiControllerProvider.notifier);
      await settings.save(
        const MusicApiSettings(
          musicApiBase: 'https://first.example/api.php',
          requestMode: MusicApiRequestMode.compatibleGet,
        ),
      );
      final controller = PlayerController.runtime(
        engine: JustAudioPlayerEngine.test(),
        preferencesStore: SharedPreferencesPlayerPreferencesStore(),
        songResolutionRepository: container.read(
          songResolutionRepositoryProvider,
        ),
      );
      addTearDown(controller.disposeController);
      final search = container.read(remoteSearchRepositoryProvider);
      final songs = await search.searchSingle('测试', source: 'netease', page: 1);
      await controller.playSong(songs.single);
      final previouslyResolved = controller.state.queue.single;
      expect(previouslyResolved.url, 'https://first.example/song.mp3');

      await settings.save(
        const MusicApiSettings(
          musicApiBase: 'https://second.example/api.php',
          requestMode: MusicApiRequestMode.compatibleGet,
        ),
      );
      await controller.playSong(previouslyResolved);

      expect(
        controller.state.currentSong?.url,
        'https://second.example/song.mp3',
      );
      expect(controller.state.currentSong?.lrc, '[00:00.00]second.example');
      expect(
        controller.state.currentSong?.pic,
        'https://second.example/cover.png',
      );
      await Future<void>.delayed(Duration.zero);
      expect(controller.state.isPlaying, isTrue);
    },
  );

  test(
    'custom API failure does not resolve Kuwo through another service',
    () async {
      final adapter = _ApiAdapter()..status = 503;
      final httpClient = TuneFreeHttpClient(
        dio: Dio()..httpClientAdapter = adapter,
      );
      final client = GdStudioSongResolutionClient(
        httpClient: httpClient,
        apiClient: GdStudioApiClient(
          httpClient: SourceHttpClient(httpClient: httpClient),
          settingsLoader: () async => const MusicApiSettings(
            musicApiBase: 'https://custom.example/api.php',
            requestMode: MusicApiRequestMode.compatibleGet,
          ),
        ),
      );
      await expectLater(
        client.resolveSong(
          const Song(
            id: '1',
            name: '自建歌曲',
            artist: '歌手',
            source: MusicSource.kuwo,
          ),
          '320k',
        ),
        throwsStateError,
      );
      expect(
        adapter.requests.every(
          (request) => request.options.uri.host == 'custom.example',
        ),
        isTrue,
      );
    },
  );

  test(
    'different API configurations do not share pending resolutions',
    () async {
      var configuration = 'first';
      final pending = <Completer<Song>>[];
      final repository = SongResolutionRepository.test(
        configurationKey: () => configuration,
        resolveSongValue: (song, _) {
          final completer = Completer<Song>();
          pending.add(completer);
          return completer.future;
        },
      );
      const song = Song(
        id: '1',
        name: '歌曲',
        artist: '歌手',
        source: MusicSource.netease,
      );
      final first = repository.resolveSong(song, quality: '320k');
      configuration = 'second';
      final second = repository.resolveSong(song, quality: '320k');
      expect(pending, hasLength(2));
      for (final completer in pending) {
        completer.complete(song);
      }
      await Future.wait([first, second]);
    },
  );

  test(
    'connection tests reject incompatible responses and report HTTP status',
    () async {
      final adapter = _ApiAdapter();
      final tester = MusicApiConnectionTester(
        httpClient: TuneFreeHttpClient(dio: Dio()..httpClientAdapter = adapter),
      );
      const settings = MusicApiSettings(
        musicApiBase: 'https://music.example/api.php',
        requestMode: MusicApiRequestMode.compatibleGet,
      );
      expect(await tester.testMusic(settings), '音乐 API 连接成功');
      expect(await tester.testPlaylist(settings), '歌单 API 连接成功');
      adapter.badResponse = true;
      expect(await tester.testMusic(settings), contains('格式不兼容'));
      expect(await tester.testPlaylist(settings), contains('格式不兼容'));
      adapter.status = 401;
      expect(await tester.testMusic(settings), contains('访问被拒绝'));
      adapter.status = 429;
      expect(await tester.testPlaylist(settings), contains('请求过于频繁'));
    },
  );
}
