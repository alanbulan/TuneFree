import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/core/models/top_list.dart';
import 'package:tunefree/features/home/application/home_providers.dart';
import 'package:tunefree/features/home/data/remote_top_list_repository.dart';
import 'package:tunefree/features/home/presentation/home_page.dart';
import 'package:tunefree/features/player/application/just_audio_player_engine.dart';
import 'package:tunefree/features/player/application/media_session_adapter.dart';
import 'package:tunefree/features/player/application/player_controller.dart';
import 'package:tunefree/features/library/application/library_controller.dart';
import 'package:tunefree/features/library/data/library_storage.dart';
import 'package:tunefree/features/player/data/download_library_repository.dart';
import 'package:tunefree/features/player/data/download_record.dart';
import 'package:tunefree/features/player/data/download_record_store.dart';
import 'package:tunefree/features/player/data/local_playback_resolver.dart';
import 'package:tunefree/features/player/data/song_resolution_repository.dart';

final class _FakeTopListRepository implements RemoteTopListRepository {
  const _FakeTopListRepository();

  @override
  Future<List<TopList>> getTopLists(String source) async {
    return const <TopList>[
      TopList(id: '1', name: '飙升榜', updateFrequency: '每日更新'),
      TopList(id: '2', name: '新歌榜', updateFrequency: '每日更新'),
    ];
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

/// 统计卡用不到下载内容，给个空的实现把 path_provider 挡在测试之外。
const DownloadLibraryRepository _emptyDownloadRepository =
    DownloadLibraryRepository(
      recordStore: _EmptyDownloadRecordStore(),
      fileExists: _neverExists,
      deleteFile: _noopDelete,
    );

Future<bool> _neverExists(String path) async => false;
Future<void> _noopDelete(String path) async {}

final class _EmptyDownloadRecordStore implements DownloadRecordStore {
  const _EmptyDownloadRecordStore();

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
  testWidgets('home page keeps the legacy greeting and ranking hierarchy', (
    tester,
  ) async {
    final engine = JustAudioPlayerEngine.test();
    addTearDown(engine.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          remoteTopListRepositoryProvider.overrideWithValue(
            const _FakeTopListRepository(),
          ),
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
        ],
        child: const MaterialApp(home: HomePage()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('排行榜'), findsOneWidget);
    expect(find.text('飙升榜 · 热歌'), findsOneWidget);
    expect(find.text('网易云'), findsAtLeastNWidgets(1));
  });

  testWidgets('home stats card counts the local library, not the network', (
    tester,
  ) async {
    final engine = JustAudioPlayerEngine.test();
    addTearDown(engine.dispose);

    final container = ProviderContainer(
      overrides: [
        remoteTopListRepositoryProvider.overrideWithValue(
          const _FakeTopListRepository(),
        ),
        playerEngineProvider.overrideWithValue(engine),
        mediaSessionAdapterProvider.overrideWithValue(
          NoopMediaSessionAdapter(),
        ),
        // LegacyLibraryStorage 是仓库现成的内存实现：2 首收藏、1 个歌单。
        libraryStorageProvider.overrideWithValue(LegacyLibraryStorage()),
        downloadLibraryRepositoryProvider.overrideWithValue(
          _emptyDownloadRepository,
        ),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(home: HomePage()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('home-stats-card')), findsOneWidget);
    expect(_statValue(tester, '收藏歌曲'), '2');
    expect(_statValue(tester, '我的歌单'), '1');
    expect(_statValue(tester, '离线缓存'), '0');
  });

  testWidgets('play-all button hands the whole ranking to the player', (
    tester,
  ) async {
    final engine = JustAudioPlayerEngine.test();
    addTearDown(engine.dispose);

    final container = ProviderContainer(
      overrides: [
        remoteTopListRepositoryProvider.overrideWithValue(
          const _FakeTopListRepository(),
        ),
        playerEngineProvider.overrideWithValue(engine),
        mediaSessionAdapterProvider.overrideWithValue(
          NoopMediaSessionAdapter(),
        ),
        libraryStorageProvider.overrideWithValue(LegacyLibraryStorage()),
        downloadLibraryRepositoryProvider.overrideWithValue(
          _emptyDownloadRepository,
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
        songResolutionRepositoryProvider.overrideWithValue(
          SongResolutionRepository.test(
            resolveSongValue: (song, quality) async =>
                song.copyWith(url: 'https://example.com/${song.id}.mp3'),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(home: HomePage()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('播放「飙升榜」'), findsOneWidget);
    await tester.tap(find.byKey(const Key('home-play-selection-button')));
    await tester.pumpAndSettle();

    final playerState = container.read(playerControllerProvider);
    expect(playerState.currentSong?.name, '海与你');
    expect(playerState.queue.map((song) => song.id), <String>['n1']);
  });
}

/// 从统计卡里取某一项的数值。
String _statValue(WidgetTester tester, String label) {
  final texts = tester.widgetList<Text>(
    find.descendant(
      of: find.byKey(Key('home-stat-$label')),
      matching: find.byType(Text),
    ),
  );
  // Column 里顺序是「数值、标签」，取第一个。
  return texts.first.data!;
}
