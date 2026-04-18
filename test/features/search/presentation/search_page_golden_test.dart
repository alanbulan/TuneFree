import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/application/media_session_adapter.dart';
import 'package:tunefree/features/player/application/player_controller.dart';
import 'package:tunefree/features/player/application/player_engine.dart';
import 'package:tunefree/features/player/data/player_preferences_store.dart';
import 'package:tunefree/features/player/data/song_resolution_repository.dart';
import 'package:tunefree/features/search/application/search_providers.dart';
import 'package:tunefree/features/search/data/remote_search_repository.dart';
import 'package:tunefree/features/search/presentation/search_page.dart';

const _artworkSong = Song(
  id: 'n1',
  name: 'GBC(日常系)日常的小曲',
  artist: 'ましんこ',
  pic: 'https://example.com/artwork.jpg',
  source: MusicSource.netease,
);

const _fallbackSong = Song(
  id: 'q1',
  name: '雑踏、僕らの街',
  artist: 'トゲナシトゲアリ',
  source: MusicSource.qq,
);

final class FakeSearchRepository implements RemoteSearchRepository {
  FakeSearchRepository({
    Future<List<Song>> Function(
      String keyword, {
      required int page,
      required bool includeExtendedSources,
    })? aggregateSearch,
    Future<List<Song>> Function(String keyword, {required String source, required int page})? singleSearch,
  }) : _aggregateSearch = aggregateSearch,
       _singleSearch = singleSearch;

  final Future<List<Song>> Function(
    String keyword, {
    required int page,
    required bool includeExtendedSources,
  })? _aggregateSearch;
  final Future<List<Song>> Function(String keyword, {required String source, required int page})? _singleSearch;

  final List<String> aggregateKeywords = <String>[];
  final List<bool> aggregateExtendedFlags = <bool>[];
  final List<int> aggregatePages = <int>[];
  final List<String> singleKeywords = <String>[];
  final List<String> singleSources = <String>[];
  final List<int> singlePages = <int>[];

  @override
  Future<List<Song>> searchAggregate(
    String keyword, {
    required int page,
    required bool includeExtendedSources,
  }) async {
    aggregateKeywords.add(keyword);
    aggregateExtendedFlags.add(includeExtendedSources);
    aggregatePages.add(page);
    if (_aggregateSearch != null) {
      return _aggregateSearch(keyword, page: page, includeExtendedSources: includeExtendedSources);
    }
    return const <Song>[_artworkSong, _fallbackSong];
  }

  @override
  Future<List<Song>> searchSingle(String keyword, {required String source, required int page}) async {
    singleKeywords.add(keyword);
    singleSources.add(source);
    singlePages.add(page);
    if (_singleSearch != null) {
      return _singleSearch(keyword, source: source, page: page);
    }
    return <Song>[
      Song(
        id: '$source-single',
        name: '$keyword 单源结果',
        artist: 'TuneFree',
        source: MusicSourceWire.fromWire(source),
      ),
    ];
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
  Future<void> saveAudioQuality(AudioQuality value) async => audioQuality = value;

  @override
  Future<void> saveCurrentSong(Song? value) async => currentSong = value;

  @override
  Future<void> savePlayMode(String value) async => playMode = value;

  @override
  Future<void> saveQueue(List<Song> value) async => queue = value;
}

final class FakePlayerEngine implements PlayerEngine {
  final _controller = StreamController<PlayerEngineSnapshot>.broadcast();
  PlayerEngineSnapshot _snapshot = const PlayerEngineSnapshot();

  @override
  Stream<PlayerEngineSnapshot> get snapshots => _controller.stream;

  @override
  PlayerEngineSnapshot get latestSnapshot => _snapshot;

  @override
  Future<void> loadSong(Song song, {required AudioQuality quality}) async {
    _snapshot = _snapshot.copyWith(
      currentSong: song,
      audioQuality: quality,
      isLoading: false,
      isPlaying: false,
      duration: const Duration(minutes: 3, seconds: 12),
      position: Duration.zero,
    );
    _controller.add(_snapshot);
  }

  @override
  Future<void> pause() async {
    _snapshot = _snapshot.copyWith(isPlaying: false);
    _controller.add(_snapshot);
  }

  @override
  Future<void> play() async {
    _snapshot = _snapshot.copyWith(isPlaying: true);
    _controller.add(_snapshot);
  }

  @override
  Future<void> seek(Duration position) async {
    _snapshot = _snapshot.copyWith(position: position);
    _controller.add(_snapshot);
  }

  @override
  Future<void> stop() async {
    _snapshot = _snapshot.copyWith(
      currentSong: null,
      isPlaying: false,
      isLoading: false,
      position: Duration.zero,
      duration: Duration.zero,
      processingState: PlayerEngineProcessingState.idle,
    );
    _controller.add(_snapshot);
  }

  @override
  Future<void> clearMediaSession() async {}

  @override
  Future<void> setAudioQuality(AudioQuality quality) async {
    _snapshot = _snapshot.copyWith(audioQuality: quality);
    _controller.add(_snapshot);
  }

  @override
  Future<void> dispose() async {
    await _controller.close();
  }
}

SongResolutionRepository _testResolutionRepository() {
  return SongResolutionRepository.test(
    resolveSongValue: (song, quality) async => song.copyWith(
      url: 'https://example.com/${song.id}-$quality.mp3',
    ),
  );
}

void main() {
  testWidgets('search page keeps the legacy sticky header, hides history while typing, and re-queries on filter changes', (
    tester,
  ) async {
    final repository = FakeSearchRepository();
    final engine = FakePlayerEngine();
    final container = ProviderContainer(
      overrides: [
        remoteSearchRepositoryProvider.overrideWithValue(repository),
        playerEngineProvider.overrideWithValue(engine),
        mediaSessionAdapterProvider.overrideWithValue(NoopMediaSessionAdapter()),
        playerPreferencesStoreProvider.overrideWithValue(TestPlayerPreferencesStore()),
        songResolutionRepositoryProvider.overrideWithValue(
          _testResolutionRepository(),
        ),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await engine.dispose();
    });

    final controller = container.read(searchControllerProvider);
    controller.updateQuery('gbc');
    await controller.submitSearch();
    controller.updateQuery('');

    await _pumpSearchPage(tester, container);

    expect(find.byType(ListView), findsOneWidget);
    expect(find.byKey(const Key('search-header-surface')), findsOneWidget);
    expect(find.text('搜索'), findsOneWidget);
    expect(find.text('聚合搜索'), findsOneWidget);
    expect(find.text('指定源'), findsOneWidget);
    expect(find.text('搜索历史'), findsOneWidget);
    expect(find.text('gbc'), findsOneWidget);

    await tester.drag(find.byType(ListView), const Offset(0, -400));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('search-header-surface')), findsOneWidget);
    expect(find.text('搜索'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'new query');
    await tester.pump();

    expect(find.text('搜索历史'), findsNothing);

    repository.aggregateKeywords.clear();
    repository.aggregateExtendedFlags.clear();
    repository.aggregatePages.clear();

    await tester.pump(const Duration(milliseconds: 850));
    await tester.pumpAndSettle();

    expect(repository.aggregateKeywords, <String>['new query']);
    expect(repository.aggregatePages, <int>[1]);

    await tester.tap(find.text('指定源'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('search-source-selector')), findsOneWidget);
    expect(find.text('搜索 网易云 资源...'), findsOneWidget);
    expect(repository.singleKeywords, <String>['new query']);
    expect(repository.singleSources, <String>['netease']);
    expect(repository.singlePages, <int>[1]);

    await tester.tap(find.byKey(const Key('search-source-selector')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('QQ音乐').last);
    await tester.pumpAndSettle();

    expect(controller.state.selectedSource, 'qq');
    expect(find.text('搜索 QQ音乐 资源...'), findsOneWidget);
    expect(repository.singleKeywords, <String>['new query', 'new query']);
    expect(repository.singleSources, <String>['netease', 'qq']);
    expect(repository.singlePages, <int>[1, 1]);
  });

  testWidgets('search page shows the loading skeleton while a search is pending', (tester) async {
    final pending = Completer<List<Song>>();
    final repository = FakeSearchRepository(
      aggregateSearch: (
        String keyword, {
        required int page,
        required bool includeExtendedSources,
      }) => pending.future,
    );
    final engine = FakePlayerEngine();
    final container = ProviderContainer(
      overrides: [
        remoteSearchRepositoryProvider.overrideWithValue(repository),
        playerEngineProvider.overrideWithValue(engine),
        mediaSessionAdapterProvider.overrideWithValue(NoopMediaSessionAdapter()),
        playerPreferencesStoreProvider.overrideWithValue(TestPlayerPreferencesStore()),
        songResolutionRepositoryProvider.overrideWithValue(
          _testResolutionRepository(),
        ),
      ],
    );
    addTearDown(() async {
      if (!pending.isCompleted) {
        pending.complete(const <Song>[]);
      }
      container.dispose();
      await engine.dispose();
    });

    final controller = container.read(searchControllerProvider);
    controller.updateQuery('loading');
    unawaited(controller.submitSearch());

    await _pumpSearchPage(tester, container);
    await tester.pump();

    expect(find.byKey(const Key('search-loading-skeleton')), findsOneWidget);
  });

  testWidgets('search page only shows the empty state after a real search attempt and keeps content below the measured sticky header', (
    tester,
  ) async {
    final emptyRepository = FakeSearchRepository(
      aggregateSearch: (
        String keyword, {
        required int page,
        required bool includeExtendedSources,
      }) async => const <Song>[],
    );
    final emptyEngine = FakePlayerEngine();
    final emptyContainer = ProviderContainer(
      overrides: [
        remoteSearchRepositoryProvider.overrideWithValue(emptyRepository),
        playerEngineProvider.overrideWithValue(emptyEngine),
      ],
    );
    addTearDown(() async {
      emptyContainer.dispose();
      await emptyEngine.dispose();
    });

    final emptyController = emptyContainer.read(searchControllerProvider);
    emptyController.updateQuery('missing');

    await _pumpSearchPage(tester, emptyContainer);

    expect(find.text('未找到相关歌曲，请尝试简化关键词'), findsNothing);

    await emptyController.submitSearch();

    emptyController.updateQuery('history');
    await emptyController.submitSearch();
    emptyController.updateQuery('');
    await tester.pump();

    final historyText = find.text('搜索历史');
    final contentTopWithoutBanner = tester.getTopLeft(historyText).dy;
    final headerBottomWithoutBanner = tester.getBottomLeft(
      find.byKey(const Key('search-header-surface')),
    ).dy;
    expect(contentTopWithoutBanner, greaterThanOrEqualTo(headerBottomWithoutBanner));

    emptyController.toggleExtendedSources();
    await tester.pump();

    final contentTopWithBanner = tester.getTopLeft(historyText).dy;
    final headerBottomWithBanner = tester.getBottomLeft(
      find.byKey(const Key('search-header-surface')),
    ).dy;
    expect(contentTopWithBanner, greaterThanOrEqualTo(headerBottomWithBanner));
    expect(headerBottomWithBanner, greaterThan(headerBottomWithoutBanner));

    emptyController.updateQuery('missing');
    await emptyController.submitSearch();
    await tester.pump();

    expect(find.text('未找到相关歌曲，请尝试简化关键词'), findsOneWidget);

    final errorRepository = FakeSearchRepository(
      aggregateSearch: (
        String keyword, {
        required int page,
        required bool includeExtendedSources,
      }) async {
        throw StateError('boom');
      },
    );
    final errorEngine = FakePlayerEngine();
    final errorContainer = ProviderContainer(
      overrides: [
        remoteSearchRepositoryProvider.overrideWithValue(errorRepository),
        playerEngineProvider.overrideWithValue(errorEngine),
      ],
    );
    addTearDown(() async {
      errorContainer.dispose();
      await errorEngine.dispose();
    });

    final errorController = errorContainer.read(searchControllerProvider);
    errorController.updateQuery('error');
    await errorController.submitSearch();

    await _pumpSearchPage(tester, errorContainer);
    expect(find.text('搜索失败，请稍后重试。'), findsOneWidget);
  });

  testWidgets('search page shows the legacy advisory banners for extended aggregate and GD-only single-source states', (
    tester,
  ) async {
    final repository = FakeSearchRepository(
      singleSearch: (String keyword, {required String source, required int page}) async {
        throw StateError('gd-only failure');
      },
    );
    final engine = FakePlayerEngine();
    final container = ProviderContainer(
      overrides: [
        remoteSearchRepositoryProvider.overrideWithValue(repository),
        playerEngineProvider.overrideWithValue(engine),
        mediaSessionAdapterProvider.overrideWithValue(NoopMediaSessionAdapter()),
        playerPreferencesStoreProvider.overrideWithValue(TestPlayerPreferencesStore()),
        songResolutionRepositoryProvider.overrideWithValue(
          _testResolutionRepository(),
        ),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await engine.dispose();
    });

    final controller = container.read(searchControllerProvider);
    controller.toggleExtendedSources();

    await _pumpSearchPage(tester, container);
    final extendedChip = tester.widget<Container>(
      find.descendant(
        of: find.byKey(const Key('search-extended-sources-chip')),
        matching: find.byType(Container),
      ).first,
    );
    final extendedDecoration = extendedChip.decoration! as BoxDecoration;
    final extendedBorder = extendedDecoration.border! as Border;

    expect(extendedDecoration.color, const Color(0x1AE94B5B));
    expect(extendedBorder.top.color, const Color(0x33E94B5B));
    expect(
      find.text('已启用扩展聚合：JOOX / Bilibili。速度可能稍慢，并会占用 GD音乐台 (music.gdstudio.xyz) 的公开接口频次。'),
      findsOneWidget,
    );

    controller.setSearchMode('single');
    controller.setSelectedSource('joox');
    await tester.pump();

    expect(
      find.text('JOOX 使用 GD音乐台 (music.gdstudio.xyz) 公开接口，建议控制频率：5 分钟内不超过 50 次请求。'),
      findsOneWidget,
    );

    controller.updateQuery('gd');
    await controller.submitSearch();
    await tester.pump();

    expect(
      find.text('JOOX 当前不可用，或可能触发了公开接口频控（5 分钟内不超过 50 次请求）。'),
      findsOneWidget,
    );
  });

  testWidgets('search page confirms before clearing history', (tester) async {
    final repository = FakeSearchRepository();
    final engine = FakePlayerEngine();
    final container = ProviderContainer(
      overrides: [
        remoteSearchRepositoryProvider.overrideWithValue(repository),
        playerEngineProvider.overrideWithValue(engine),
        mediaSessionAdapterProvider.overrideWithValue(NoopMediaSessionAdapter()),
        playerPreferencesStoreProvider.overrideWithValue(TestPlayerPreferencesStore()),
        songResolutionRepositoryProvider.overrideWithValue(
          _testResolutionRepository(),
        ),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await engine.dispose();
    });

    final controller = container.read(searchControllerProvider);
    controller.updateQuery('gbc');
    await controller.submitSearch();
    controller.updateQuery('');

    await _pumpSearchPage(tester, container);

    await tester.tap(find.byIcon(Icons.delete_outline_rounded));
    await tester.pumpAndSettle();

    expect(find.text('确定要清空搜索历史吗？'), findsOneWidget);
    expect(find.text('gbc'), findsOneWidget);

    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(find.text('搜索历史'), findsOneWidget);
    expect(find.text('gbc'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.delete_outline_rounded));
    await tester.pumpAndSettle();
    await tester.tap(find.text('清空'));
    await tester.pumpAndSettle();

    expect(find.text('搜索历史'), findsNothing);
    expect(find.text('gbc'), findsNothing);
  });

  testWidgets('search results support load more and reset to history-only when the query is cleared', (
    tester,
  ) async {
    final repository = FakeSearchRepository(
      aggregateSearch: (
        String keyword, {
        required int page,
        required bool includeExtendedSources,
      }) async {
        return <Song>[
          Song(
            id: 'page-$page',
            name: '$keyword 第$page页',
            artist: 'Artist $page',
            source: MusicSource.netease,
          ),
        ];
      },
    );
    final engine = FakePlayerEngine();
    final container = ProviderContainer(
      overrides: [
        remoteSearchRepositoryProvider.overrideWithValue(repository),
        playerEngineProvider.overrideWithValue(engine),
        mediaSessionAdapterProvider.overrideWithValue(NoopMediaSessionAdapter()),
        playerPreferencesStoreProvider.overrideWithValue(TestPlayerPreferencesStore()),
        songResolutionRepositoryProvider.overrideWithValue(
          _testResolutionRepository(),
        ),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await engine.dispose();
    });

    final controller = container.read(searchControllerProvider);
    controller.updateQuery('gbc');
    await controller.submitSearch();

    await _pumpSearchPage(tester, container);

    expect(find.text('gbc 第1页'), findsOneWidget);
    expect(find.text('查看更多结果'), findsOneWidget);

    await tester.tap(find.text('查看更多结果'));
    await tester.pump();
    await tester.pump();

    expect(repository.aggregatePages, <int>[1, 2]);
    expect(find.text('gbc 第2页'), findsOneWidget);

    await tester.enterText(find.byType(TextField), '');
    await tester.pump();

    expect(find.text('搜索历史'), findsOneWidget);
    expect(find.text('gbc'), findsOneWidget);
    expect(find.text('gbc 第1页'), findsNothing);
    expect(find.text('gbc 第2页'), findsNothing);
    expect(find.text('查看更多结果'), findsNothing);
  });

  testWidgets('search results show artwork, source badges, current playing state, and the load-more action', (
    tester,
  ) async {
    final repository = FakeSearchRepository();
    final engine = FakePlayerEngine();
    final container = ProviderContainer(
      overrides: [
        remoteSearchRepositoryProvider.overrideWithValue(repository),
        playerEngineProvider.overrideWithValue(engine),
        mediaSessionAdapterProvider.overrideWithValue(NoopMediaSessionAdapter()),
        playerPreferencesStoreProvider.overrideWithValue(TestPlayerPreferencesStore()),
        songResolutionRepositoryProvider.overrideWithValue(
          _testResolutionRepository(),
        ),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await engine.dispose();
    });

    final searchController = container.read(searchControllerProvider);
    searchController.updateQuery('gbc');
    await searchController.submitSearch();

    final playerController = container.read(playerControllerProvider.notifier);
    await playerController.openLegacySong(
      id: _artworkSong.id,
      source: _artworkSong.source.wireValue,
      title: _artworkSong.name,
      artist: _artworkSong.artist,
      artworkUrl: _artworkSong.pic,
    );
    await playerController.togglePlayback();

    await _pumpSearchPage(tester, container);
    await tester.pump();

    expect(find.byKey(Key('search-result-artwork-${_artworkSong.key}')), findsOneWidget);
    expect(find.byKey(Key('search-result-fallback-${_fallbackSong.key}')), findsOneWidget);
    expect(find.text('网易云'), findsOneWidget);
    expect(find.text('QQ'), findsOneWidget);
    expect(find.byKey(Key('search-result-current-${_artworkSong.key}')), findsOneWidget);
    expect(find.byKey(Key('search-result-playing-indicator-${_artworkSong.key}')), findsOneWidget);
    expect(find.text('查看更多结果'), findsOneWidget);
  });
}

Future<void> _pumpSearchPage(WidgetTester tester, ProviderContainer container) {
  return tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(home: SearchPage()),
    ),
  );
}
