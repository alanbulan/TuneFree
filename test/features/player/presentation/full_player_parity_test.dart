import 'dart:async';
import 'dart:io';

import 'package:material_ui/material_ui.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:golden_toolkit/golden_toolkit.dart';
import 'package:tunefree/app/app.dart';
import 'package:tunefree/app/router/app_router.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/playlist.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/core/models/top_list.dart';
import 'package:tunefree/features/home/application/home_providers.dart';
import 'package:tunefree/features/home/data/remote_top_list_repository.dart';
import 'package:tunefree/features/library/application/library_controller.dart';
import 'package:tunefree/features/library/data/library_storage.dart';
import 'package:tunefree/features/player/application/just_audio_player_engine.dart';
import 'package:tunefree/features/player/application/media_session_adapter.dart';
import 'package:tunefree/features/player/application/player_controller.dart';
import 'package:tunefree/features/player/data/download_library_repository.dart';
import 'package:tunefree/features/player/data/download_record.dart';
import 'package:tunefree/features/player/data/download_record_store.dart';
import 'package:tunefree/features/player/data/local_playback_resolver.dart';
import 'package:tunefree/features/player/data/player_download_manager.dart';
import 'package:tunefree/features/player/data/player_download_service.dart';
import 'package:tunefree/features/player/data/player_preferences_store.dart';
import 'package:tunefree/features/player/data/song_resolution_repository.dart';
import 'package:tunefree/features/player/domain/play_mode.dart';
import 'package:tunefree/features/search/application/search_providers.dart';
import 'package:tunefree/features/search/data/remote_search_repository.dart';
import 'package:tunefree/features/search/presentation/search_page.dart';
import 'package:tunefree/shared/theme/appearance_controller.dart';
import 'package:tunefree/shared/theme/appearance_store.dart';
import 'package:tunefree/features/player/domain/player_track.dart';
import 'package:tunefree/features/player/presentation/widgets/full_player_sheet.dart';
import 'package:tunefree/features/player/presentation/widgets/player_queue_sheet.dart';

import '../../../shared/goldens/tune_free_golden_test_app.dart';

const List<int> _transparentImageBytes = <int>[
  137,
  80,
  78,
  71,
  13,
  10,
  26,
  10,
  0,
  0,
  0,
  13,
  73,
  72,
  68,
  82,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  1,
  8,
  6,
  0,
  0,
  0,
  31,
  21,
  196,
  137,
  0,
  0,
  0,
  13,
  73,
  68,
  65,
  84,
  120,
  156,
  99,
  248,
  255,
  255,
  63,
  0,
  5,
  254,
  2,
  254,
  167,
  53,
  129,
  132,
  0,
  0,
  0,
  0,
  73,
  69,
  78,
  68,
  174,
  66,
  96,
  130,
];

IconData _playerLikeIcon(WidgetTester tester) {
  final icon = tester.widget<Icon>(
    find.descendant(
      of: find.byKey(const Key('player-like-button')),
      matching: find.byType(Icon),
    ),
  );
  return icon.icon!;
}

const JSONMethodCodec _platformCodec = JSONMethodCodec();
const MethodChannel _platformChannel = MethodChannel(
  'flutter/platform',
  _platformCodec,
);

final class _FakeTopListRepository implements RemoteTopListRepository {
  const _FakeTopListRepository();

  @override
  Future<List<TopList>> getTopLists(String source) async {
    return const <TopList>[TopList(id: '1', name: '飙升榜')];
  }

  @override
  Future<List<Song>> getTopListDetail(String source, String id) async {
    return const <Song>[
      Song(
        id: 'n1',
        name: '海与你',
        artist: '马也_Crabbit',
        source: MusicSource.netease,
      ),
    ];
  }
}

final class _TestHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    return _TestHttpClient();
  }
}

final class _TestHttpClient implements HttpClient {
  bool _autoUncompress = true;
  Duration? _connectionTimeout;

  @override
  bool get autoUncompress => _autoUncompress;

  @override
  set autoUncompress(bool value) {
    _autoUncompress = value;
  }

  @override
  Duration? get connectionTimeout => _connectionTimeout;

  @override
  set connectionTimeout(Duration? value) {
    _connectionTimeout = value;
  }

  @override
  Future<HttpClientRequest> getUrl(Uri url) async =>
      _TestHttpClientRequest(url);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final class _TestHttpClientRequest implements HttpClientRequest {
  _TestHttpClientRequest(this.url);

  final Uri url;

  @override
  Future<HttpClientResponse> close() async => _TestHttpClientResponse();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final class _TestHttpClientResponse extends Stream<List<int>>
    implements HttpClientResponse {
  @override
  X509Certificate? get certificate => null;

  @override
  HttpClientResponseCompressionState get compressionState =>
      HttpClientResponseCompressionState.notCompressed;

  @override
  HttpConnectionInfo? get connectionInfo => null;

  @override
  int get contentLength => _transparentImageBytes.length;

  @override
  List<Cookie> get cookies => const <Cookie>[];

  @override
  Future<Socket> detachSocket() {
    throw UnsupportedError('detachSocket is not supported in tests');
  }

  @override
  HttpHeaders get headers => _TestHttpHeaders();

  @override
  bool get isRedirect => false;

  @override
  bool get persistentConnection => false;

  @override
  String get reasonPhrase => 'OK';

  @override
  List<RedirectInfo> get redirects => const <RedirectInfo>[];

  @override
  int get statusCode => HttpStatus.ok;

  @override
  StreamSubscription<List<int>> listen(
    void Function(List<int> event)? onData, {
    Function? onError,
    void Function()? onDone,
    bool? cancelOnError,
  }) {
    return Stream<List<int>>.fromIterable(<List<int>>[
      _transparentImageBytes,
    ]).listen(
      onData,
      onError: onError,
      onDone: onDone,
      cancelOnError: cancelOnError,
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final class _TestHttpHeaders implements HttpHeaders {
  @override
  List<String>? operator [](String name) {
    if (name.toLowerCase() == HttpHeaders.contentTypeHeader) {
      return <String>['image/png'];
    }
    return null;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final class TestPlayerLibraryStorage implements LibraryStorage {
  TestPlayerLibraryStorage({List<Song>? favorites, List<Playlist>? playlists})
    : _favorites = List<Song>.unmodifiable(favorites ?? const <Song>[]),
      _playlists = List<Playlist>.unmodifiable(playlists ?? const <Playlist>[]);

  List<Song> _favorites;
  List<Playlist> _playlists;

  @override
  Future<String> loadCorsProxy() async => '';

  @override
  Future<List<Song>> loadFavorites() async => _favorites;

  @override
  Future<List<Playlist>> loadPlaylists() async => _playlists;

  @override
  Future<void> saveCorsProxy(String value) async {}

  @override
  Future<LibraryBackupData> loadBackupData() async {
    return LibraryBackupData(
      favorites: _favorites,
      playlists: _playlists,
      corsProxy: '',
    );
  }

  @override
  Future<void> saveBackupData(LibraryBackupData value) async {
    _favorites = List<Song>.unmodifiable(value.favorites);
    _playlists = List<Playlist>.unmodifiable(value.playlists);
  }

  @override
  Future<void> saveFavorites(List<Song> values) async {
    _favorites = List<Song>.unmodifiable(values);
  }

  @override
  Future<void> savePlaylists(List<Playlist> values) async {
    _playlists = List<Playlist>.unmodifiable(values);
  }
}

class TestPlayerPreferencesStore implements PlayerPreferencesStore {
  Song? currentSong;
  List<Song> queue = const <Song>[];
  String playMode = 'sequence';
  AudioQuality audioQuality = AudioQuality.k320;

  @override
  Future<AudioQuality> loadAudioQuality() async => audioQuality;

  @override
  Future<Song?> loadCurrentSong() async => currentSong;

  @override
  Future<String> loadPlayMode() async => playMode;

  @override
  Future<List<Song>> loadQueue() async => queue;

  @override
  Future<void> saveAudioQuality(AudioQuality value) async =>
      audioQuality = value;

  @override
  Future<void> saveCurrentSong(Song? value) async => currentSong = value;

  @override
  Future<void> savePlayMode(String value) async => playMode = value;

  @override
  Future<void> saveQueue(List<Song> value) async => queue = value;
}

LocalPlaybackResolver _noopLocalPlaybackResolver() {
  return LocalPlaybackResolver(
    recordsForSong: (songKey) async => const <DownloadRecord>[],
    fileExists: (path) async => false,
    removeRecord: ({required songKey, required quality}) async {},
  );
}

DownloadLibraryRepository _noopDownloadLibraryRepository() {
  return const DownloadLibraryRepository(
    recordStore: _NoopDownloadRecordStore(),
    fileExists: _noopFileExists,
    deleteFile: _noopDeleteFile,
  );
}

Future<bool> _noopFileExists(String path) async => false;
Future<void> _noopDeleteFile(String path) async {}

final class _NoopDownloadRecordStore implements DownloadRecordStore {
  const _NoopDownloadRecordStore();

  @override
  Future<DownloadRecord?> load({
    required String songKey,
    required String quality,
  }) async => null;

  @override
  Future<List<DownloadRecord>> listAll() async => const <DownloadRecord>[];

  @override
  Future<List<DownloadRecord>> listBySongKey(String songKey) async =>
      const <DownloadRecord>[];

  @override
  Future<void> remove({
    required String songKey,
    required String quality,
  }) async {}

  @override
  Future<void> save(DownloadRecord record) async {}
}

void main() {
  setUpAll(() {
    HttpOverrides.global = _TestHttpOverrides();
  });

  tearDownAll(() {
    HttpOverrides.global = null;
  });

  testWidgets('queue sheet shows artwork metadata and plays selected row', (
    tester,
  ) async {
    Song? selectedSong;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              PlayerQueueSheet(
                isOpen: true,
                queue: const <Song>[
                  Song(
                    id: 'kuwo-1',
                    name: '完整队列歌曲',
                    artist: '酷我歌手',
                    album: '酷我专辑',
                    pic: 'https://example.com/kuwo-cover.png',
                    source: MusicSource.kuwo,
                  ),
                ],
                currentSong: null,
                playMode: 'sequence',
                onClose: () {},
                onPlaySong: (song) => selectedSong = song,
                onClearQueue: () {},
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.byKey(const Key('player-queue-sheet')), findsOneWidget);
    expect(find.text('完整队列歌曲'), findsOneWidget);
    expect(find.text('酷我歌手'), findsOneWidget);
    expect(find.text('专辑：酷我专辑'), findsOneWidget);
    expect(find.text('酷我'), findsOneWidget);
    expect(
      find.byKey(const Key('player-queue-artwork-kuwo:kuwo-1')),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const Key('player-queue-track-kuwo:kuwo-1')));

    expect(selectedSong?.id, 'kuwo-1');
  });

  testWidgets(
    'full player favorite button reacts immediately to library changes',
    (tester) async {
      final storage = TestPlayerLibraryStorage();
      final engine = JustAudioPlayerEngine.test();
      addTearDown(engine.dispose);

      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          remoteTopListRepositoryProvider.overrideWithValue(
            const _FakeTopListRepository(),
          ),
          libraryStorageProvider.overrideWithValue(storage),
          downloadLibraryRepositoryProvider.overrideWithValue(
            _noopDownloadLibraryRepository(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            _noopLocalPlaybackResolver(),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            SongResolutionRepository.test(
              resolveSongValue: (song, quality) async => song.copyWith(
                url: 'https://example.com/${song.id}-$quality.mp3',
              ),
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const TuneFreeApp(),
        ),
      );
      await tester.pumpAndSettle();

      await container
          .read(playerControllerProvider.notifier)
          .openLegacySong(
            id: 'parity-track',
            source: 'netease',
            title: '海与你',
            artist: '马也_Crabbit',
          );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('mini-player')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('full-player')), findsOneWidget);
      expect(_playerLikeIcon(tester), Icons.favorite_border_rounded);

      await tester.tap(find.byKey(const Key('player-like-button')));
      await tester.pumpAndSettle();

      expect(_playerLikeIcon(tester), Icons.favorite_rounded);
      expect(
        container
            .read(libraryControllerProvider)
            .state
            .favorites
            .map((song) => song.key),
        ['netease:parity-track'],
      );

      await tester.tap(find.byKey(const Key('player-like-button')));
      await tester.pumpAndSettle();

      expect(_playerLikeIcon(tester), Icons.favorite_border_rounded);
      expect(
        container.read(libraryControllerProvider).state.favorites,
        isEmpty,
      );
    },
  );

  testWidgets(
    'full player queue download and more sheets show visible parity content',
    (tester) async {
      addTearDown(() async {
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(_platformChannel, null);
      });

      final storage = TestPlayerLibraryStorage(
        playlists: const <Playlist>[
          Playlist(
            id: 'playlist-1',
            name: '收藏歌单',
            createTime: 1713200000000,
            songs: <Song>[],
          ),
        ],
      );
      final engine = JustAudioPlayerEngine.test();
      addTearDown(engine.dispose);

      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          remoteTopListRepositoryProvider.overrideWithValue(
            const _FakeTopListRepository(),
          ),
          libraryStorageProvider.overrideWithValue(storage),
          downloadLibraryRepositoryProvider.overrideWithValue(
            _noopDownloadLibraryRepository(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            _noopLocalPlaybackResolver(),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            SongResolutionRepository.test(
              resolveSongValue: (song, quality) async => song.copyWith(
                url: 'https://example.com/${song.id}-$quality.mp3',
              ),
            ),
          ),
          playerDownloadServiceProvider.overrideWithValue(
            PlayerDownloadService.test(
              download: (song, quality) async => DownloadResult(
                song: song,
                quality: quality,
                fileName: '歌手甲 - 第一首 [netease-track-1].flac',
                filePath: '/downloads/track-1.flac',
                alreadyExisted: false,
              ),
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const TuneFreeApp(),
        ),
      );
      await tester.pumpAndSettle();

      final controller = container.read(playerControllerProvider.notifier);
      const firstTrack = PlayerTrack(
        id: 'track-1',
        source: 'netease',
        title: '第一首',
        artist: '歌手甲',
        artworkUrl: 'https://example.com/track-1.png',
      );
      const secondTrack = PlayerTrack(
        id: 'track-2',
        source: 'qq',
        title: '第二首',
        artist: '歌手乙',
        artworkUrl: 'https://example.com/track-2.png',
      );
      await controller.openTrack(
        firstTrack,
        queue: const <PlayerTrack>[firstTrack, secondTrack],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('mini-player')));
      await tester.pumpAndSettle();

      await tester.ensureVisible(find.byKey(const Key('player-queue-button')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('player-queue-button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('player-queue-sheet')), findsOneWidget);
      final queueSheet = find.byKey(const Key('player-queue-sheet'));
      expect(
        find.descendant(of: queueSheet, matching: find.text('播放队列')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: queueSheet, matching: find.text('2 首 · 列表循环')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: queueSheet, matching: find.text('第一首')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: queueSheet, matching: find.text('第二首')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: queueSheet, matching: find.text('歌手乙')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: queueSheet, matching: find.text('网易云')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: queueSheet, matching: find.text('QQ')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: queueSheet,
          matching: find.byKey(
            const Key('player-queue-artwork-netease:track-1'),
          ),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(of: queueSheet, matching: find.text('NETEASE')),
        findsNothing,
      );

      await tester.tap(find.byKey(const Key('player-queue-track-qq:track-2')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));

      expect(
        container.read(playerControllerProvider).currentTrack?.id,
        'track-2',
      );
      expect(find.byKey(const Key('player-queue-sheet')), findsNothing);

      await tester.ensureVisible(find.byKey(const Key('player-queue-button')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('player-queue-button')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));

      await tester.tap(find.byKey(const Key('player-queue-clear-button')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));

      expect(container.read(playerControllerProvider).queue, isEmpty);
      expect(container.read(playerControllerProvider).currentTrack, isNull);
      expect(find.byKey(const Key('player-queue-sheet')), findsNothing);

      // 清空队列现在会弹一条带撤销的提示条。ScaffoldMessenger 是**排队**的，
      // 不主动清掉，下面下载完成的提示要等它 5 秒才轮得到。
      expect(find.text('已清空播放队列'), findsOneWidget);
      expect(find.text('撤销'), findsOneWidget);
      tester
          .state<ScaffoldMessengerState>(find.byType(ScaffoldMessenger))
          .clearSnackBars();
      await tester.pumpAndSettle();

      await controller.openTrack(
        firstTrack,
        queue: const <PlayerTrack>[firstTrack, secondTrack],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('player-download-button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('player-download-sheet')), findsOneWidget);
      final downloadSheet = find.byKey(const Key('player-download-sheet'));
      expect(
        find.descendant(of: downloadSheet, matching: find.text('选择下载音质')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: downloadSheet, matching: find.text('标准音质')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: downloadSheet, matching: find.text('高品质')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: downloadSheet, matching: find.text('无损音质')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: downloadSheet, matching: find.text('Hi-Res')),
        findsOneWidget,
      );

      await tester.tap(
        find.byKey(const Key('player-download-option-flac24bit')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));

      expect(
        container.read(playerControllerProvider).downloadQuality,
        AudioQuality.flac24bit,
      );
      expect(
        find.text('已下载到本地：歌手甲 - 第一首 [netease-track-1].flac'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('player-download-sheet')), findsNothing);

      await tester.tap(find.byKey(const Key('player-download-button')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('player-download-close-button')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('player-more-button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('player-more-sheet')), findsOneWidget);
      final moreSheet = find.byKey(const Key('player-more-sheet'));
      expect(
        find.descendant(of: moreSheet, matching: find.text('添加到歌单')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: moreSheet, matching: find.text('新建歌单')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: moreSheet, matching: find.text('收藏歌单')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: moreSheet, matching: find.text('第一首')),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const Key('player-quality-chip-flac')));
      await tester.pump();
      expect(
        container.read(playerControllerProvider).audioQuality,
        AudioQuality.flac,
      );

      final previousPlaylistCount = container
          .read(libraryControllerProvider)
          .state
          .playlists
          .length;
      await tester.tap(find.byKey(const Key('player-create-playlist-action')));
      await tester.pumpAndSettle();
      expect(
        container.read(libraryControllerProvider).state.playlists.length,
        previousPlaylistCount + 1,
      );
      expect(
        container
            .read(libraryControllerProvider)
            .state
            .playlists
            .first
            .songs
            .map((song) => song.key),
        ['netease:track-1'],
      );

      await tester.tap(find.byKey(const Key('player-share-song-action')));
      await tester.pumpAndSettle();
    },
  );

  testWidgets(
    'full player shows an already-downloaded message when the local file already exists',
    (tester) async {
      final downloadService = PlayerDownloadService.test(
        download: (song, quality) async => DownloadResult(
          song: song,
          quality: quality,
          fileName: '歌手甲 - 第一首 [netease-track-1].flac',
          filePath: '/downloads/track-1.flac',
          alreadyExisted: true,
        ),
      );

      final engine = JustAudioPlayerEngine.test();
      addTearDown(engine.dispose);

      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          remoteTopListRepositoryProvider.overrideWithValue(
            const _FakeTopListRepository(),
          ),
          libraryStorageProvider.overrideWithValue(TestPlayerLibraryStorage()),
          downloadLibraryRepositoryProvider.overrideWithValue(
            _noopDownloadLibraryRepository(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            _noopLocalPlaybackResolver(),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            SongResolutionRepository.test(
              resolveSongValue: (song, quality) async => song.copyWith(
                url: 'https://example.com/${song.id}-$quality.mp3',
              ),
            ),
          ),
          playerDownloadServiceProvider.overrideWithValue(downloadService),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const TuneFreeApp(),
        ),
      );
      await tester.pumpAndSettle();

      final controller = container.read(playerControllerProvider.notifier);
      const firstTrack = PlayerTrack(
        id: 'track-1',
        source: 'netease',
        title: '第一首',
        artist: '歌手甲',
      );
      await controller.openTrack(
        firstTrack,
        queue: const <PlayerTrack>[firstTrack],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('mini-player')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('player-download-button')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('player-download-option-flac')));
      await tester.pumpAndSettle();

      expect(find.text('该音质已下载'), findsOneWidget);
    },
  );

  testWidgets(
    'download sheet ignores repeated taps while a single download is in flight',
    (tester) async {
      final completer = Completer<DownloadResult>();
      var downloadCalls = 0;
      final downloadService = PlayerDownloadService.test(
        download: (song, quality) {
          downloadCalls += 1;
          return completer.future;
        },
      );

      final engine = JustAudioPlayerEngine.test();
      addTearDown(engine.dispose);

      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          remoteTopListRepositoryProvider.overrideWithValue(
            const _FakeTopListRepository(),
          ),
          libraryStorageProvider.overrideWithValue(TestPlayerLibraryStorage()),
          downloadLibraryRepositoryProvider.overrideWithValue(
            _noopDownloadLibraryRepository(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            _noopLocalPlaybackResolver(),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            SongResolutionRepository.test(
              resolveSongValue: (song, quality) async => song.copyWith(
                url: 'https://example.com/${song.id}-$quality.mp3',
              ),
            ),
          ),
          playerDownloadServiceProvider.overrideWithValue(downloadService),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const TuneFreeApp(),
        ),
      );
      await tester.pumpAndSettle();

      final controller = container.read(playerControllerProvider.notifier);
      const firstTrack = PlayerTrack(
        id: 'track-1',
        source: 'netease',
        title: '第一首',
        artist: '歌手甲',
      );
      await controller.openTrack(
        firstTrack,
        queue: const <PlayerTrack>[firstTrack],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('mini-player')));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('player-download-button')));
      await tester.pumpAndSettle();

      final option = find.byKey(const Key('player-download-option-flac'));
      await tester.tap(option);
      await tester.tap(option);
      await tester.pump();

      expect(downloadCalls, 1);

      completer.complete(
        DownloadResult(
          song: const Song(
            id: 'track-1',
            name: '第一首',
            artist: '歌手甲',
            source: MusicSource.netease,
          ),
          quality: AudioQuality.flac,
          fileName: '歌手甲 - 第一首 [netease-track-1].flac',
          filePath: '/downloads/track-1.flac',
          alreadyExisted: false,
        ),
      );
      await tester.pumpAndSettle();
    },
  );

  testWidgets('full player shows an error snackbar when download fails', (
    tester,
  ) async {
    final engine = JustAudioPlayerEngine.test();
    addTearDown(engine.dispose);

    final container = ProviderContainer(
      overrides: [
        playerEngineProvider.overrideWithValue(engine),
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          _noopLocalPlaybackResolver(),
        ),
        songResolutionRepositoryProvider.overrideWithValue(
          SongResolutionRepository.test(
            resolveSongValue: (song, quality) async => song.copyWith(
              url: 'https://example.com/${song.id}-$quality.mp3',
            ),
          ),
        ),
        playerDownloadServiceProvider.overrideWithValue(
          PlayerDownloadService.test(
            download: (song, quality) async =>
                throw StateError('download failed'),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const TuneFreeApp(),
      ),
    );
    await tester.pumpAndSettle();

    final controller = container.read(playerControllerProvider.notifier);
    const firstTrack = PlayerTrack(
      id: 'track-1',
      source: 'netease',
      title: '第一首',
      artist: '歌手甲',
    );
    await controller.openTrack(
      firstTrack,
      queue: const <PlayerTrack>[firstTrack],
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('mini-player')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('player-download-button')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('player-download-option-flac')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.text('下载失败，请稍后重试'), findsOneWidget);
    expect(find.byKey(const Key('player-download-sheet')), findsOneWidget);
  });

  testWidgets(
    'full player shows parsed lyrics with active line styling when lyrics view is open',
    (tester) async {
      final storage = TestPlayerLibraryStorage(
        favorites: const <Song>[
          Song(
            id: 'lyrics-track',
            name: '歌词曲目',
            artist: '歌词歌手',
            lrc:
                '[00:05.00]第一句\n'
                '[00:05.20]First line\n'
                '[00:10.00]第二句\n'
                '[00:10.20]Second line',
            source: MusicSource.netease,
          ),
        ],
      );
      final engine = JustAudioPlayerEngine.test();
      addTearDown(engine.dispose);

      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          remoteTopListRepositoryProvider.overrideWithValue(
            const _FakeTopListRepository(),
          ),
          libraryStorageProvider.overrideWithValue(storage),
          downloadLibraryRepositoryProvider.overrideWithValue(
            _noopDownloadLibraryRepository(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            _noopLocalPlaybackResolver(),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            SongResolutionRepository.test(
              resolveSongValue: (song, quality) async => song.copyWith(
                url: 'https://example.com/${song.id}-$quality.mp3',
              ),
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const TuneFreeApp(),
        ),
      );
      await tester.pumpAndSettle();

      await container
          .read(playerControllerProvider.notifier)
          .openLegacySong(
            id: 'lyrics-track',
            source: 'netease',
            title: '歌词曲目',
            artist: '歌词歌手',
            lyrics:
                '[00:05.00]第一句\n'
                '[00:05.20]First line\n'
                '[00:10.00]第二句\n'
                '[00:10.20]Second line',
            queue: const <PlayerTrack>[
              PlayerTrack(
                id: 'lyrics-track',
                source: 'netease',
                title: '歌词曲目',
                artist: '歌词歌手',
              ),
            ],
          );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('mini-player')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('player-lyrics-toggle-area')));
      await tester.pumpAndSettle();

      expect(find.text('第一句'), findsOneWidget);
      expect(find.text('First line'), findsOneWidget);
      expect(find.text('第二句'), findsOneWidget);
      expect(find.text('Second line'), findsOneWidget);
      expect(find.text('暂无歌词'), findsNothing);

      final activeLine = tester.widget<Text>(
        find.byKey(const Key('player-lyrics-line-active-0')),
      );
      final inactiveLine = tester.widget<Text>(
        find.byKey(const Key('player-lyrics-line-inactive-1')),
      );
      expect(activeLine.style?.fontSize, 22);
      expect(activeLine.style?.color, const Color(0xFF111111));
      expect(inactiveLine.style?.fontSize, 18);
      expect(inactiveLine.style?.color, const Color(0xFF8E8E93));

      await container
          .read(playerControllerProvider.notifier)
          .seek(const Duration(seconds: 11));
      await tester.pumpAndSettle();

      final nextActiveLine = tester.widget<Text>(
        find.byKey(const Key('player-lyrics-line-active-1')),
      );
      expect(nextActiveLine.data, '第二句');
    },
  );

  testWidgets(
    'active lyric line fills as it is sung and turns the accent colour once done',
    (tester) async {
      const rawLyrics =
          '[00:05.00]第一句\n'
          '[00:05.20]First line\n'
          '[00:10.00]第二句\n'
          '[00:10.20]Second line';
      final storage = TestPlayerLibraryStorage(
        favorites: const <Song>[
          Song(
            id: 'lyrics-track',
            name: '歌词曲目',
            artist: '歌词歌手',
            lrc: rawLyrics,
            source: MusicSource.netease,
          ),
        ],
      );
      final engine = JustAudioPlayerEngine.test();
      addTearDown(engine.dispose);

      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          remoteTopListRepositoryProvider.overrideWithValue(
            const _FakeTopListRepository(),
          ),
          libraryStorageProvider.overrideWithValue(storage),
          downloadLibraryRepositoryProvider.overrideWithValue(
            _noopDownloadLibraryRepository(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            _noopLocalPlaybackResolver(),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            SongResolutionRepository.test(
              resolveSongValue: (song, quality) async => song.copyWith(
                url: 'https://example.com/${song.id}-$quality.mp3',
              ),
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const TuneFreeApp(),
        ),
      );
      await tester.pumpAndSettle();

      final controller = container.read(playerControllerProvider.notifier);
      await controller.openLegacySong(
        id: 'lyrics-track',
        source: 'netease',
        title: '歌词曲目',
        artist: '歌词歌手',
        lyrics: rawLyrics,
        queue: const <PlayerTrack>[
          PlayerTrack(
            id: 'lyrics-track',
            source: 'netease',
            title: '歌词曲目',
            artist: '歌词歌手',
          ),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('mini-player')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('player-lyrics-toggle-area')));
      await tester.pumpAndSettle();

      // 行首之前：还没开唱，就是普通文本，没有填充层。
      expect(
        find.descendant(
          of: find.byKey(const Key('player-lyric-fill-0')),
          matching: find.byType(ShaderMask),
        ),
        findsNothing,
      );

      // 唱到第一行中间：填充层出现，字本身仍是「未唱」色。
      // 这里只能 pump 不能 pumpAndSettle —— Ticker 会把位置外推到行尾。
      await controller.seek(const Duration(seconds: 6));
      await tester.pump();
      await tester.pump();

      final filling = find.byKey(const Key('player-lyric-fill-0'));
      expect(filling, findsOneWidget);
      expect(
        find.descendant(of: filling, matching: find.byType(ShaderMask)),
        findsOneWidget,
      );
      expect(
        tester
            .widget<Text>(find.byKey(const Key('player-lyrics-line-active-0')))
            .style
            ?.color,
        const Color(0xFF111111),
      );

      // 第二行唱完之后：整行换成强调色，填充层收起（不再需要合成层）。
      await controller.seek(const Duration(seconds: 12));
      await tester.pump();
      await tester.pump();

      final finished = find.byKey(const Key('player-lyric-fill-1'));
      expect(finished, findsOneWidget);
      expect(
        find.descendant(of: finished, matching: find.byType(ShaderMask)),
        findsNothing,
      );
      expect(
        tester
            .widget<Text>(find.byKey(const Key('player-lyrics-line-active-1')))
            .style
            ?.color,
        const Color(0xFFFA233B),
      );
    },
  );

  testWidgets(
    'lyric offset shifts which line is active and compensates the seek',
    (tester) async {
      const rawLyrics =
          '[00:05.00]第一句\n[00:05.20]First line\n[00:10.00]第二句';
      final storage = TestPlayerLibraryStorage(
        favorites: const <Song>[
          Song(
            id: 'lyrics-track',
            name: '歌词曲目',
            artist: '歌词歌手',
            lrc: rawLyrics,
            source: MusicSource.netease,
          ),
        ],
      );
      final engine = JustAudioPlayerEngine.test();
      addTearDown(engine.dispose);

      final container = ProviderContainer(
        overrides: [
          // 外观偏好走内存实现：真实的 SharedPreferences 在 widget 测试里
          // 拿不到平台实现，await 落盘会一直等不到结果。
          appearanceStoreProvider.overrideWithValue(InMemoryAppearanceStore()),
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          remoteTopListRepositoryProvider.overrideWithValue(
            const _FakeTopListRepository(),
          ),
          libraryStorageProvider.overrideWithValue(storage),
          downloadLibraryRepositoryProvider.overrideWithValue(
            _noopDownloadLibraryRepository(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            _noopLocalPlaybackResolver(),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            SongResolutionRepository.test(
              resolveSongValue: (song, quality) async => song.copyWith(
                url: 'https://example.com/${song.id}-$quality.mp3',
              ),
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const TuneFreeApp(),
        ),
      );
      await tester.pumpAndSettle();

      final controller = container.read(playerControllerProvider.notifier);
      await controller.openLegacySong(
        id: 'lyrics-track',
        source: 'netease',
        title: '歌词曲目',
        artist: '歌词歌手',
        lyrics: rawLyrics,
        queue: const <PlayerTrack>[
          PlayerTrack(
            id: 'lyrics-track',
            source: 'netease',
            title: '歌词曲目',
            artist: '歌词歌手',
          ),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('mini-player')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('player-lyrics-toggle-area')));
      await tester.pumpAndSettle();

      // 9 秒：不偏移时还停在第一句（10 秒才开始）。
      await controller.seek(const Duration(seconds: 9));
      await tester.pump();
      expect(
        find.byKey(const Key('player-lyrics-line-active-0')),
        findsOneWidget,
      );

      // 歌词推迟 2 秒 → 等效时间 11 秒，已经进到第二句。
      final appearance = container.read(appearanceControllerProvider.notifier);
      await appearance.setLyricOffsetMs(2000);
      // 必须 settle：pump() 不推进时钟，行上的 AnimatedScale 还停在起始帧，
      // 这时候 tap 会落在空处（报 "would not hit test"）。
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('player-lyrics-line-active-1')),
        findsOneWidget,
      );

      // 点第二句要 seek 到 10 - 2 = 8 秒，而不是原始行时间 10 秒。
      await tester.tap(find.byKey(const Key('player-lyrics-line-active-1')));
      await tester.pumpAndSettle();
      expect(
        container.read(playerControllerProvider).position,
        const Duration(seconds: 8),
      );

      // 点第一句要 seek 到 5 - 2 = 3 秒。
      await tester.tap(find.byKey(const Key('player-lyrics-line-inactive-0')));
      await tester.pumpAndSettle();
      expect(
        container.read(playerControllerProvider).position,
        const Duration(seconds: 3),
      );

      // 提前 4 秒则相反：等效时间 3 + 2 - 4 = 1 秒，回到第一句。
      await appearance.setLyricOffsetMs(-4000);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const Key('player-lyrics-line-active-0')),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'full player cover prefers artwork and only falls back when artwork is missing',
    (tester) async {
      final storage = TestPlayerLibraryStorage();
      final engine = JustAudioPlayerEngine.test();
      addTearDown(engine.dispose);

      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          remoteTopListRepositoryProvider.overrideWithValue(
            const _FakeTopListRepository(),
          ),
          libraryStorageProvider.overrideWithValue(storage),
          downloadLibraryRepositoryProvider.overrideWithValue(
            _noopDownloadLibraryRepository(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            _noopLocalPlaybackResolver(),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            SongResolutionRepository.test(
              resolveSongValue: (song, quality) async => song.copyWith(
                url: 'https://example.com/${song.id}-$quality.mp3',
              ),
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const TuneFreeApp(),
        ),
      );
      await tester.pumpAndSettle();

      await container
          .read(playerControllerProvider.notifier)
          .openTrack(
            const PlayerTrack(
              id: 'artwork-track',
              source: 'netease',
              title: '封面曲目',
              artist: '封面歌手',
              artworkUrl: 'https://example.com/full-player-artwork.jpg',
            ),
            queue: const <PlayerTrack>[
              PlayerTrack(
                id: 'artwork-track',
                source: 'netease',
                title: '封面曲目',
                artist: '封面歌手',
                artworkUrl: 'https://example.com/full-player-artwork.jpg',
              ),
            ],
          );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('mini-player')));
      await tester.pumpAndSettle();

      expect(
        find.byKey(const Key('full-player-cover-artwork')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('full-player-cover-placeholder')),
        findsNothing,
      );

      await container
          .read(playerControllerProvider.notifier)
          .openTrack(
            const PlayerTrack(
              id: 'placeholder-track',
              source: 'qq',
              title: '无封面曲目',
              artist: '默认歌手',
            ),
            queue: const <PlayerTrack>[
              PlayerTrack(
                id: 'placeholder-track',
                source: 'qq',
                title: '无封面曲目',
                artist: '默认歌手',
              ),
            ],
          );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('full-player-cover-artwork')), findsNothing);
      expect(
        find.byKey(const Key('full-player-cover-placeholder')),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'mini player keeps the legacy idle state visible and rotates while playing',
    (tester) async {
      final storage = TestPlayerLibraryStorage();
      final engine = JustAudioPlayerEngine.test();
      addTearDown(engine.dispose);

      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          remoteTopListRepositoryProvider.overrideWithValue(
            const _FakeTopListRepository(),
          ),
          libraryStorageProvider.overrideWithValue(storage),
          downloadLibraryRepositoryProvider.overrideWithValue(
            _noopDownloadLibraryRepository(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            _noopLocalPlaybackResolver(),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            SongResolutionRepository.test(
              resolveSongValue: (song, quality) async => song.copyWith(
                url: 'https://example.com/${song.id}-$quality.mp3',
              ),
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const TuneFreeApp(),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('mini-player')), findsOneWidget);
      expect(find.text('TuneFree 音乐'), findsOneWidget);
      expect(find.text('听见世界的声音'), findsOneWidget);
      expect(find.byKey(const Key('mini-player-placeholder')), findsOneWidget);

      await container
          .read(playerControllerProvider.notifier)
          .openTrack(
            const PlayerTrack(
              id: 'rotating-track',
              source: 'netease',
              title: '旋转封面曲目',
              artist: '旋转歌手',
              artworkUrl:
                  'https://example.com/mini-player-rotating-artwork.jpg',
            ),
            queue: const <PlayerTrack>[
              PlayerTrack(
                id: 'rotating-track',
                source: 'netease',
                title: '旋转封面曲目',
                artist: '旋转歌手',
                artworkUrl:
                    'https://example.com/mini-player-rotating-artwork.jpg',
              ),
            ],
          );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('mini-player-play-toggle')));
      await tester.pump();

      final initialRotation = tester.widget<RotationTransition>(
        find.byKey(const Key('mini-player-rotation')),
      );
      final initialTurns = initialRotation.turns.value;

      await tester.pump(const Duration(seconds: 1));

      final progressedRotation = tester.widget<RotationTransition>(
        find.byKey(const Key('mini-player-rotation')),
      );
      expect(progressedRotation.turns.value, greaterThan(initialTurns));
    },
  );

  testGoldens('full player parity state matches golden with more sheet open', (
    tester,
  ) async {
    final storage = TestPlayerLibraryStorage(
      favorites: const <Song>[
        Song(
          id: 'track-1',
          name: '第一首',
          artist: '歌手甲',
          source: MusicSource.netease,
        ),
      ],
      playlists: const <Playlist>[
        Playlist(
          id: 'playlist-1',
          name: '收藏歌单',
          createTime: 1713200000000,
          songs: <Song>[],
        ),
      ],
    );
    final engine = JustAudioPlayerEngine.test();
    addTearDown(engine.dispose);

    final container = ProviderContainer(
      overrides: [
        libraryStorageProvider.overrideWithValue(storage),
        playerEngineProvider.overrideWithValue(engine),
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          _noopLocalPlaybackResolver(),
        ),
        songResolutionRepositoryProvider.overrideWithValue(
          SongResolutionRepository.test(
            resolveSongValue: (song, quality) async => song.copyWith(
              url: 'https://example.com/${song.id}-$quality.mp3',
            ),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const TuneFreeApp(),
      ),
    );
    await tester.pumpAndSettle();

    final controller = container.read(playerControllerProvider.notifier);
    const firstTrack = PlayerTrack(
      id: 'track-1',
      source: 'netease',
      title: '第一首',
      artist: '歌手甲',
    );
    const secondTrack = PlayerTrack(
      id: 'track-2',
      source: 'qq',
      title: '第二首',
      artist: '歌手乙',
    );
    await controller.openTrack(
      firstTrack,
      queue: const <PlayerTrack>[firstTrack, secondTrack],
    );
    await tester.pumpAndSettle();

    controller.expand();
    controller.setPlaybackQuality(AudioQuality.flac);
    controller.setDownloadQuality(AudioQuality.flac24bit);
    controller.setShowMore(true);
    await tester.pumpAndSettle();

    await tester.pumpWidgetBuilder(
      TuneFreeGoldenTestApp(
        child: SizedBox.expand(
          child: UncontrolledProviderScope(
            container: container,
            child: const Stack(children: [FullPlayerSheet()]),
          ),
        ),
      ),
      surfaceSize: const Size(430, 932),
    );
    await tester.pumpAndSettle();

    await screenMatchesGolden(tester, 'full_player_parity_more_sheet');
  }, tags: 'golden');

  testWidgets(
    'mini and full player controls advance queue, toggle mode, and favorite tracks',
    (tester) async {
      final storage = TestPlayerLibraryStorage();
      final engine = JustAudioPlayerEngine.test();
      addTearDown(engine.dispose);

      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          remoteTopListRepositoryProvider.overrideWithValue(
            const _FakeTopListRepository(),
          ),
          libraryStorageProvider.overrideWithValue(storage),
          downloadLibraryRepositoryProvider.overrideWithValue(
            _noopDownloadLibraryRepository(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            _noopLocalPlaybackResolver(),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            SongResolutionRepository.test(
              resolveSongValue: (song, quality) async => song.copyWith(
                url: 'https://example.com/${song.id}-$quality.mp3',
              ),
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const TuneFreeApp(),
        ),
      );
      await tester.pumpAndSettle();

      final controller = container.read(playerControllerProvider.notifier);
      const firstTrack = PlayerTrack(
        id: 'track-1',
        source: 'netease',
        title: '第一首',
        artist: '歌手甲',
      );
      const secondTrack = PlayerTrack(
        id: 'track-2',
        source: 'qq',
        title: '第二首',
        artist: '歌手乙',
      );
      await controller.openTrack(
        firstTrack,
        queue: const <PlayerTrack>[firstTrack, secondTrack],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('mini-player-next-button')));
      await tester.pump();
      expect(container.read(playerControllerProvider).currentSong?.name, '第二首');

      await tester.tap(find.byKey(const Key('mini-player')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(
        container.read(playerControllerProvider).playModeEnum,
        PlayMode.sequence,
      );
      await tester.ensureVisible(
        find.byKey(const Key('player-play-mode-button')),
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('player-play-mode-button')));
      await tester.pump();
      expect(
        container.read(playerControllerProvider).playModeEnum,
        PlayMode.loop,
      );

      await tester.ensureVisible(find.byKey(const Key('player-prev-button')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('player-prev-button')));
      await tester.pump();
      expect(container.read(playerControllerProvider).currentSong?.name, '第一首');

      await tester.ensureVisible(find.byKey(const Key('player-next-button')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('player-next-button')));
      await tester.pump();
      expect(container.read(playerControllerProvider).currentSong?.name, '第二首');

      expect(
        container.read(libraryControllerProvider).state.favorites,
        isEmpty,
      );
      await tester.tap(find.byKey(const Key('player-like-button')));
      await tester.pump();

      final favorites = container
          .read(libraryControllerProvider)
          .state
          .favorites;
      expect(favorites.map((song) => song.key).toList(), ['qq:track-2']);
    },
  );

  testWidgets(
    'more sheet hands the artist over to search and closes the player',
    (tester) async {
      // 路由是全局单例，测完要还回去，否则后面的用例会从 /search 开始。
      addTearDown(() => appRouter.go('/'));

      final storage = TestPlayerLibraryStorage();
      final engine = JustAudioPlayerEngine.test();
      addTearDown(engine.dispose);

      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          remoteTopListRepositoryProvider.overrideWithValue(
            const _FakeTopListRepository(),
          ),
          // 用仓库里现成的假搜索，避免真发请求留下悬挂的 timer。
          remoteSearchRepositoryProvider.overrideWithValue(
            const LegacySearchRepository(),
          ),
          libraryStorageProvider.overrideWithValue(storage),
          downloadLibraryRepositoryProvider.overrideWithValue(
            _noopDownloadLibraryRepository(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            _noopLocalPlaybackResolver(),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            SongResolutionRepository.test(
              resolveSongValue: (song, quality) async => song.copyWith(
                url: 'https://example.com/${song.id}-$quality.mp3',
              ),
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const TuneFreeApp(),
        ),
      );
      await tester.pumpAndSettle();

      await container
          .read(playerControllerProvider.notifier)
          .openLegacySong(
            id: 'search-track',
            source: 'netease',
            title: '被搜索的歌',
            artist: '目标歌手',
            queue: const <PlayerTrack>[
              PlayerTrack(
                id: 'search-track',
                source: 'netease',
                title: '被搜索的歌',
                artist: '目标歌手',
              ),
            ],
          );
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('mini-player')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('player-more-button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('player-more-sheet')), findsOneWidget);
      await tester.tap(find.byKey(const Key('player-search-artist-action')));
      // 不能 pumpAndSettle：搜索页此刻正在转菊花，settle 不下来。
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));

      // 关键词交出去了，而且真的发起了搜索。
      final searchState = container.read(searchControllerProvider).state;
      expect(searchState.query, '目标歌手');
      expect(
        searchState.results.map((song) => song.name),
        contains('目标歌手 日常的小曲'),
      );

      // 全屏播放器必须收起来 —— 它是盖在 shell 上的一层，
      // 不收掉的话搜索页根本看不见（Tauri 那边就留着这个毛病）。
      expect(container.read(playerControllerProvider).isExpanded, isFalse);
      expect(find.byKey(const Key('full-player')), findsNothing);
      expect(find.byType(SearchPage), findsOneWidget);
    },
  );
}
