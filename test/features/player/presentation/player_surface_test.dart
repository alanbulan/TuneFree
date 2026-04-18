import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/app/app.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/application/just_audio_player_engine.dart';
import 'package:tunefree/features/player/application/media_session_adapter.dart';
import 'package:tunefree/features/player/application/player_controller.dart';
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
  Future<void> saveAudioQuality(AudioQuality value) async => audioQuality = value;

  @override
  Future<void> saveCurrentSong(Song? value) async => currentSong = value;

  @override
  Future<void> savePlayMode(String value) async => playMode = value;

  @override
  Future<void> saveQueue(List<Song> value) async => queue = value;
}

SongResolutionRepository _testResolutionRepository() {
  return SongResolutionRepository.test(
    resolveSongValue: (song, quality) async => song.copyWith(
      url: 'https://example.com/${song.id}-$quality.mp3',
    ),
  );
}

void main() {
  testWidgets('demo track opens mini player and full player scaffold', (tester) async {
    final engine = JustAudioPlayerEngine.test();
    addTearDown(engine.dispose);

    final container = ProviderContainer(
      overrides: [
        playerEngineProvider.overrideWithValue(engine),
        mediaSessionAdapterProvider.overrideWithValue(NoopMediaSessionAdapter()),
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        songResolutionRepositoryProvider.overrideWithValue(
          _testResolutionRepository(),
        ),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(container: container, child: const TuneFreeApp()),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('mini-player')), findsOneWidget);
    expect(find.text('TuneFree 音乐'), findsOneWidget);

    await container.read(playerControllerProvider.notifier).openLegacySong(
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

    await tester.tap(find.byKey(const Key('close-full-player')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.byKey(const Key('full-player')), findsNothing);
  });

  testWidgets('full player overlays the shell navigation chrome', (tester) async {
    final engine = JustAudioPlayerEngine.test();
    addTearDown(engine.dispose);

    final container = ProviderContainer(
      overrides: [
        playerEngineProvider.overrideWithValue(engine),
        mediaSessionAdapterProvider.overrideWithValue(NoopMediaSessionAdapter()),
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        songResolutionRepositoryProvider.overrideWithValue(
          _testResolutionRepository(),
        ),
      ],
    );
    addTearDown(container.dispose);

    await tester.pumpWidget(
      UncontrolledProviderScope(container: container, child: const TuneFreeApp()),
    );
    await tester.pumpAndSettle();

    await container.read(playerControllerProvider.notifier).openLegacySong(
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
    final navigationBarRect = tester.getRect(find.byType(NavigationBar));

    expect(fullPlayerRect.bottom, greaterThanOrEqualTo(navigationBarRect.bottom));
  });
}
