import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:golden_toolkit/golden_toolkit.dart';
import 'package:tunefree/app/app.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/playlist.dart';
import 'package:tunefree/core/models/song.dart';
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
import 'package:tunefree/features/player/domain/player_track.dart';
import 'package:tunefree/features/player/presentation/widgets/full_player_sheet.dart';

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

Future<void> _setClipboardMockHandler({
  required Future<void> Function(String text) onCopy,
}) async {
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(_platformChannel, (methodCall) async {
        if (methodCall.method != 'Clipboard.setData') {
          return null;
        }
        final arguments = methodCall.arguments;
        final text = arguments is Map<Object?, Object?>
            ? arguments['text'] as String?
            : null;
        if (text != null) {
          await onCopy(text);
        }
        return null;
      });
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
  Future<String> loadApiBase() async => 'https://api.tune-free.example';

  @override
  Future<String> loadApiKey() async => '';

  @override
  Future<String> loadCorsProxy() async => '';

  @override
  Future<List<Song>> loadFavorites() async => _favorites;

  @override
  Future<List<Playlist>> loadPlaylists() async => _playlists;

  @override
  Future<void> saveApiBase(String value) async {}

  @override
  Future<void> saveApiKey(String value) async {}

  @override
  Future<void> saveCorsProxy(String value) async {}

  @override
  Future<LibraryBackupData> loadBackupData() async {
    return LibraryBackupData(
      favorites: _favorites,
      playlists: _playlists,
      apiKey: '',
      corsProxy: '',
      apiBase: 'https://api.tune-free.example',
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
      String? copiedShareText;
      await _setClipboardMockHandler(
        onCopy: (text) async {
          copiedShareText = text;
        },
      );
      addTearDown(() async {
        await _setClipboardMockHandler(onCopy: (_) async {});
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
        find.descendant(of: queueSheet, matching: find.text('列表循环')),
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

      await tester.tap(find.byKey(const Key('player-queue-clear-button')));
      await tester.pumpAndSettle();

      expect(container.read(playerControllerProvider).queue, isEmpty);
      expect(container.read(playerControllerProvider).currentTrack, isNull);
      expect(find.byKey(const Key('player-queue-sheet')), findsNothing);

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
      expect(copiedShareText, '第一首 - 歌手甲');
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
      expect(activeLine.style?.fontSize, 24);
      expect(activeLine.style?.color, const Color(0xFF111111));
      expect(inactiveLine.style?.fontSize, 20);
      expect(inactiveLine.style?.color, const Color(0xFF8B8B95));

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
  });

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
}
