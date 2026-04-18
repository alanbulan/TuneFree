import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:golden_toolkit/golden_toolkit.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/playlist.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/library/application/library_controller.dart';
import 'package:tunefree/features/library/data/library_storage.dart';
import 'package:tunefree/features/library/data/playlist_import_repository.dart';
import 'package:tunefree/features/library/presentation/library_page.dart';
import 'package:tunefree/features/library/presentation/widgets/library_backup_transfer.dart';
import 'package:tunefree/features/player/application/just_audio_player_engine.dart';
import 'package:tunefree/features/player/application/media_session_adapter.dart';
import 'package:tunefree/features/player/application/player_controller.dart';
import 'package:tunefree/features/player/data/player_preferences_store.dart';
import 'package:tunefree/features/player/data/song_resolution_repository.dart';
import 'package:tunefree/features/player/presentation/widgets/mini_player_bar.dart';

import '../../../shared/goldens/tune_free_golden_test_app.dart';

final class TestLibraryStorage implements LibraryStorage {
  TestLibraryStorage({List<Song>? favorites, List<Playlist>? playlists})
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

final class TestPlayerPreferencesStore implements PlayerPreferencesStore {
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

final class TestLibraryBackupTransfer extends LibraryBackupTransfer {
  TestLibraryBackupTransfer({this.importBytes});

  Uint8List? importBytes;
  String? exportedFileName;
  String? exportedMimeType;
  String? exportedContent;
  int exportCallCount = 0;
  int importCallCount = 0;

  @override
  Future<void> downloadJsonFile({
    required String fileName,
    required String content,
    String mimeType = 'application/json',
  }) async {
    exportCallCount += 1;
    exportedFileName = fileName;
    exportedMimeType = mimeType;
    exportedContent = content;
  }

  @override
  Future<Uint8List?> pickJsonFileBytes() async {
    importCallCount += 1;
    return importBytes;
  }
}

final class TestAboutLinkLauncher implements AboutLinkLauncher {
  final List<Uri> launchedUris = <Uri>[];

  @override
  Future<bool> launch(Uri uri) async {
    launchedUris.add(uri);
    return true;
  }
}

final class TestPlaylistImportClient implements PlaylistImportClient {
  TestPlaylistImportClient({required this.onImportPlaylist});

  final Future<PlaylistImportPayload?> Function(String source, String id)
  onImportPlaylist;
  final List<String> calls = <String>[];

  @override
  Future<PlaylistImportPayload?> importPlaylist(
    String source,
    String id,
  ) async {
    calls.add('$source:$id');
    return onImportPlaylist(source, id);
  }
}

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

void main() {
  setUpAll(() {
    HttpOverrides.global = _TestHttpOverrides();
  });

  tearDownAll(() {
    HttpOverrides.global = null;
  });
  const favoriteSong = Song(
    id: 'fav-1',
    name: '海与你',
    artist: '马也_Crabbit',
    source: MusicSource.netease,
  );
  const favoriteSongWithArtwork = Song(
    id: 'fav-1-artwork',
    name: '海与你',
    artist: '马也_Crabbit',
    pic: 'https://example.com/library-artwork.jpg',
    source: MusicSource.netease,
  );
  const queuedSong = Song(
    id: 'fav-2',
    name: '晴天',
    artist: '周杰伦',
    source: MusicSource.qq,
  );
  const importedSong = Song(
    id: 'import-song-1',
    name: '导入收藏曲',
    artist: '备份歌手',
    source: MusicSource.kuwo,
  );

  testWidgets(
    'library page keeps the legacy tab labels and song tap opens playback queue',
    (tester) async {
      final storage = TestLibraryStorage(
        favorites: const <Song>[favoriteSong, queuedSong],
        playlists: const <Playlist>[
          Playlist(
            id: 'playlist-1',
            name: '收藏歌单',
            createTime: 1713200000000,
            songs: <Song>[favoriteSong],
          ),
        ],
      );
      final engine = JustAudioPlayerEngine.test();
      addTearDown(engine.dispose);

      final container = ProviderContainer(
        overrides: [
          libraryStorageProvider.overrideWithValue(storage),
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(NoopMediaSessionAdapter()),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
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
          child: const MaterialApp(home: LibraryPage()),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('我的资料库'), findsOneWidget);
      expect(find.text('收藏'), findsOneWidget);
      expect(find.text('歌单'), findsOneWidget);
      expect(find.text('管理'), findsOneWidget);
      expect(find.text('关于'), findsOneWidget);

      await tester.tap(find.text('海与你'));
      await tester.pumpAndSettle();

      final playerState = container.read(playerControllerProvider);
      expect(playerState.currentSong?.name, '海与你');
      expect(playerState.queue.map((song) => song.name).toList(), [
        '海与你',
        '晴天',
      ]);
    },
  );

  testWidgets(
    'library page shows legacy about links and artwork fallbacks across library/player surfaces',
    (tester) async {
      final storage = TestLibraryStorage(
        favorites: const <Song>[favoriteSongWithArtwork, queuedSong],
      );
      final linkLauncher = TestAboutLinkLauncher();
      final engine = JustAudioPlayerEngine.test();
      addTearDown(engine.dispose);

      final container = ProviderContainer(
        overrides: [
          libraryStorageProvider.overrideWithValue(storage),
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(NoopMediaSessionAdapter()),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            SongResolutionRepository.test(
              resolveSongValue: (song, quality) async => song.copyWith(
                url: 'https://example.com/${song.id}-$quality.mp3',
              ),
            ),
          ),
          aboutLinkLauncherProvider.overrideWithValue(linkLauncher),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: LibraryPage()),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(const Key('library-song-artwork-netease:fav-1-artwork')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('library-song-placeholder-qq:fav-2')),
        findsOneWidget,
      );

      await tester.tap(find.text('海与你'));
      await tester.pumpAndSettle();

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(
            home: Scaffold(
              body: MiniPlayerBar(useBottomSafeArea: false, bottomPadding: 0),
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));

      expect(find.byKey(const Key('mini-player-artwork')), findsOneWidget);
      expect(find.byKey(const Key('mini-player-placeholder')), findsNothing);

      await container
          .read(playerControllerProvider.notifier)
          .openLegacySong(
            id: queuedSong.id,
            source: queuedSong.source.wireValue,
            title: queuedSong.name,
            artist: queuedSong.artist,
            queue: const [],
          );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('mini-player-placeholder')), findsOneWidget);
      expect(find.byKey(const Key('mini-player-artwork')), findsNothing);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: LibraryPage()),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('关于'));
      await tester.pumpAndSettle();

      expect(find.text('TuneHub 原帖'), findsOneWidget);
      expect(find.text('GD音乐台'), findsWidgets);

      await tester.ensureVisible(
        find.byKey(const Key('about-inline-link-TuneHub 原帖')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('about-inline-link-TuneHub 原帖')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(const Key('about-link-在线演示')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('about-link-在线演示')));
      await tester.pumpAndSettle();

      expect(linkLauncher.launchedUris, <Uri>[
        Uri.parse('https://linux.do/t/topic/1326425'),
        Uri.parse('https://xilan.ccwu.cc/'),
      ]);
    },
  );

  testWidgets(
    'library page wires playlist create/import/rename/edit/delete flows',
    (tester) async {
      final storage = TestLibraryStorage();
      final importClient = TestPlaylistImportClient(
        onImportPlaylist: (source, id) async {
          return const (
            name: '真实远程歌单',
            songs: <Song>[
              Song(
                id: 'import-song-1',
                name: '导入歌曲',
                artist: '远程歌手',
                source: MusicSource.qq,
              ),
            ],
          );
        },
      );
      final engine = JustAudioPlayerEngine.test();
      addTearDown(engine.dispose);

      final container = ProviderContainer(
        overrides: [
          libraryStorageProvider.overrideWithValue(storage),
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(NoopMediaSessionAdapter()),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            SongResolutionRepository.test(
              resolveSongValue: (song, quality) async => song.copyWith(
                url: 'https://example.com/${song.id}-$quality.mp3',
              ),
            ),
          ),
          playlistImportClientProvider.overrideWithValue(importClient),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: LibraryPage()),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('歌单'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('create-playlist-action')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('create-playlist-name-field')),
        '跑步歌单',
      );
      await tester.tap(find.byKey(const Key('confirm-create-playlist-button')));
      await tester.pumpAndSettle();

      expect(find.text('跑步歌单'), findsOneWidget);

      await tester.tap(find.byKey(const Key('import-playlist-action')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('import-playlist-id-field')),
        'remote-42',
      );
      await tester.tap(find.byKey(const Key('confirm-import-playlist-button')));
      await tester.pumpAndSettle();

      expect(importClient.calls, <String>['netease:remote-42']);
      expect(find.text('真实远程歌单'), findsOneWidget);

      await tester.ensureVisible(find.text('真实远程歌单'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('真实远程歌单'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('playlist-edit-mode-button')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('playlist-rename-button')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('rename-playlist-name-field')),
        '远程歌单已改名',
      );
      await tester.tap(find.byKey(const Key('confirm-rename-playlist-button')));
      await tester.pumpAndSettle();

      expect(find.text('远程歌单已改名'), findsOneWidget);

      await tester.tap(
        find.byKey(const Key('playlist-remove-song-qq:import-song-1')),
      );
      await tester.pumpAndSettle();
      expect(find.text('暂无歌曲'), findsOneWidget);

      await tester.tap(find.byKey(const Key('playlist-delete-button')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('confirm-delete-playlist-button')));
      await tester.pumpAndSettle();

      expect(find.text('远程歌单已改名'), findsNothing);
      expect(
        container
            .read(libraryControllerProvider)
            .state
            .playlists
            .map((playlist) => playlist.name),
        ['跑步歌单'],
      );
    },
  );

  testGoldens('library page rendered favorites state matches golden', (
    tester,
  ) async {
    final storage = TestLibraryStorage(
      favorites: const <Song>[favoriteSong, queuedSong],
      playlists: const <Playlist>[
        Playlist(
          id: 'playlist-1',
          name: '收藏歌单',
          createTime: 1713200000000,
          songs: <Song>[favoriteSong],
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
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidgetBuilder(
      TuneFreeGoldenTestApp(
        child: UncontrolledProviderScope(
          container: container,
          child: const LibraryPage(),
        ),
      ),
      surfaceSize: const Size(430, 932),
    );
    await tester.pumpAndSettle();

    await screenMatchesGolden(tester, 'library_page_favorites');
  });

  testWidgets(
    'library manage tab exports to a file and imports from a picked backup file',
    (tester) async {
      final storage = TestLibraryStorage(
        favorites: const <Song>[favoriteSong],
        playlists: const <Playlist>[
          Playlist(
            id: 'playlist-1',
            name: '收藏歌单',
            createTime: 1713200000000,
            songs: <Song>[favoriteSong],
          ),
        ],
      );
      final importJson = jsonEncode({
        'favorites': [
          {
            'id': 'import-song-1',
            'name': '导入收藏曲',
            'artist': '备份歌手',
            'source': 'kuwo',
          },
        ],
        'playlists': [
          {
            'id': 'backup-1',
            'name': '导入备份歌单',
            'createTime': 1713200001000,
            'songs': [
              {
                'id': 'import-song-1',
                'name': '导入收藏曲',
                'artist': '备份歌手',
                'source': 'kuwo',
              },
            ],
          },
        ],
        'apiKey': 'backup-key',
        'corsProxy': 'https://proxy.example',
        'apiBase': 'https://backup-api.example',
      });
      final transfer = TestLibraryBackupTransfer(
        importBytes: Uint8List.fromList(utf8.encode(importJson)),
      );
      final engine = JustAudioPlayerEngine.test();
      addTearDown(engine.dispose);

      final container = ProviderContainer(
        overrides: [
          libraryStorageProvider.overrideWithValue(storage),
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(NoopMediaSessionAdapter()),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            SongResolutionRepository.test(
              resolveSongValue: (song, quality) async => song.copyWith(
                url: 'https://example.com/${song.id}-$quality.mp3',
              ),
            ),
          ),
          libraryBackupTransferProvider.overrideWithValue(transfer),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MaterialApp(home: LibraryPage()),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('管理'));
      await tester.pumpAndSettle();

      await tester.ensureVisible(
        find.byKey(const Key('library-export-json-button')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('library-export-json-button')));
      await tester.pumpAndSettle();

      expect(transfer.exportCallCount, 1);
      expect(
        transfer.exportedFileName,
        matches(RegExp(r'^tunefree_backup_\d{4}-\d{2}-\d{2}\.json$')),
      );
      expect(transfer.exportedMimeType, 'application/json');
      expect(transfer.exportedContent, contains('"favorites"'));
      expect(find.text('最近导出'), findsOneWidget);
      expect(find.textContaining('海与你'), findsWidgets);
      expect(find.textContaining('收藏歌单'), findsWidgets);
      expect(find.text('备份文件已下载'), findsOneWidget);

      await tester.ensureVisible(
        find.byKey(const Key('library-import-data-button')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('library-import-data-button')));
      await tester.pumpAndSettle();

      expect(transfer.importCallCount, 1);
      expect(find.byKey(const Key('library-import-json-field')), findsNothing);
      expect(utf8.decode(transfer.importBytes!), importJson);
      expect(
        container.read(libraryControllerProvider).state.favorites,
        const <Song>[importedSong],
      );
      expect(
        container
            .read(libraryControllerProvider)
            .state
            .playlists
            .map((playlist) => playlist.name),
        ['导入备份歌单'],
      );
      expect(
        container.read(libraryControllerProvider).state.apiKey,
        'backup-key',
      );
      expect(find.text('已导入 1 首收藏和 1 个歌单'), findsOneWidget);
      expect(find.textContaining('导入收藏曲'), findsWidgets);
    },
  );
}
