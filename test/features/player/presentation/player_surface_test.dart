import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/app/app.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/core/models/top_list.dart';
import 'package:tunefree/features/home/application/home_providers.dart';
import 'package:tunefree/features/home/data/remote_top_list_repository.dart';
import 'package:tunefree/features/player/application/just_audio_player_engine.dart';
import 'package:tunefree/features/player/application/media_session_adapter.dart';
import 'package:tunefree/features/player/application/player_controller.dart';
import 'package:tunefree/features/player/data/download_record.dart';
import 'package:tunefree/features/player/data/local_playback_resolver.dart';
import 'package:tunefree/features/player/data/player_preferences_store.dart';
import 'package:tunefree/features/player/data/song_resolution_repository.dart';

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

SongResolutionRepository _testResolutionRepository() {
  return SongResolutionRepository.test(
    resolveSongValue: (song, quality) async =>
        song.copyWith(url: 'https://example.com/${song.id}-$quality.mp3'),
  );
}

LocalPlaybackResolver _noopLocalPlaybackResolver() {
  return LocalPlaybackResolver(
    recordsForSong: (songKey) async => const <DownloadRecord>[],
    fileExists: (path) async => false,
    removeRecord: ({required songKey, required quality}) async {},
  );
}

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

void main() {
  testWidgets('demo track opens mini player and full player scaffold', (
    tester,
  ) async {
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
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          _noopLocalPlaybackResolver(),
        ),
        songResolutionRepositoryProvider.overrideWithValue(
          _testResolutionRepository(),
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

    await container
        .read(playerControllerProvider.notifier)
        .openLegacySong(
          id: 'player-surface-demo',
          source: 'netease',
          title: 'Player Skeleton',
          artist: 'Demo Source',
        );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.byKey(const Key('mini-player')), findsOneWidget);
    expect(find.text('Player Skeleton'), findsOneWidget);

    await tester.tap(find.byKey(const Key('mini-player')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.byKey(const Key('full-player')), findsOneWidget);
    expect(find.text('Demo Source'), findsWidgets);
    expect(
      find.descendant(
        of: find.byKey(const Key('full-player')),
        matching: find.text('网易云'),
      ),
      findsOneWidget,
    );
    expect(find.text('NETEASE'), findsNothing);

    await tester.tap(find.byKey(const Key('close-full-player')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.byKey(const Key('full-player')), findsNothing);
  });

  testWidgets('mini and full player play buttons show loading spinners', (
    tester,
  ) async {
    final engine = JustAudioPlayerEngine.test();
    addTearDown(engine.dispose);
    final resolutionCompleter = Completer<Song>();

    final container = ProviderContainer(
      overrides: [
        playerEngineProvider.overrideWithValue(engine),
        mediaSessionAdapterProvider.overrideWithValue(
          NoopMediaSessionAdapter(),
        ),
        remoteTopListRepositoryProvider.overrideWithValue(
          const _FakeTopListRepository(),
        ),
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          _noopLocalPlaybackResolver(),
        ),
        songResolutionRepositoryProvider.overrideWithValue(
          SongResolutionRepository.test(
            resolveSongValue: (song, quality) => resolutionCompleter.future,
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

    final pendingOpen = container
        .read(playerControllerProvider.notifier)
        .openLegacySong(
          id: 'loading-demo',
          source: 'netease',
          title: 'Loading Demo',
          artist: 'Demo Source',
        );
    await tester.pump();

    expect(
      find.byKey(const Key('mini-player-loading-indicator')),
      findsOneWidget,
    );
    expect(
      find.byKey(const Key('mini-player-loading-progress')),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const Key('mini-player')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(
      find.byKey(const Key('player-primary-loading-indicator')),
      findsOneWidget,
    );

    resolutionCompleter.complete(
      const Song(
        id: 'loading-demo',
        name: 'Loading Demo',
        artist: 'Demo Source',
        source: MusicSource.netease,
        url: 'https://example.com/loading-demo.mp3',
      ),
    );
    await pendingOpen;
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(
      find.byKey(const Key('mini-player-loading-indicator')),
      findsNothing,
    );
    expect(
      find.byKey(const Key('player-primary-loading-indicator')),
      findsNothing,
    );
  });

  testWidgets('full player overlays the shell navigation chrome', (
    tester,
  ) async {
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
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          _noopLocalPlaybackResolver(),
        ),
        songResolutionRepositoryProvider.overrideWithValue(
          _testResolutionRepository(),
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
          id: 'player-surface-demo',
          source: 'netease',
          title: 'Player Skeleton',
          artist: 'Demo Source',
        );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));
    await tester.tap(find.byKey(const Key('mini-player')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    final fullPlayerRect = tester.getRect(find.byKey(const Key('full-player')));
    final navigationBarRect = tester.getRect(
      find.byKey(const Key('shell-bottom-nav')),
    );

    expect(
      fullPlayerRect.bottom,
      greaterThanOrEqualTo(navigationBarRect.bottom),
    );
  });
}
