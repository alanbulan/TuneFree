import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/application/media_session_adapter.dart';
import 'package:tunefree/features/player/application/player_controller.dart';
import 'package:tunefree/features/player/application/player_engine.dart';
import 'package:tunefree/features/player/data/download_record.dart';
import 'package:tunefree/features/player/data/local_playback_resolver.dart';
import 'package:tunefree/features/player/data/player_preferences_store.dart';
import 'package:tunefree/features/player/data/song_resolution_repository.dart';
import 'package:tunefree/features/player/domain/player_track.dart';
import 'package:tunefree/features/search/application/search_providers.dart';
import 'package:tunefree/features/search/data/remote_search_repository.dart';

class FakePlayerEngine implements PlayerEngine {
  FakePlayerEngine({Completer<void>? loadCompleter, int? delayedLoadCall})
    : _loadCompleter = loadCompleter,
      _delayedLoadCall = delayedLoadCall;

  final _controller = StreamController<PlayerEngineSnapshot>.broadcast();
  final Completer<void>? _loadCompleter;
  final int? _delayedLoadCall;
  PlayerEngineSnapshot _snapshot = const PlayerEngineSnapshot();
  Object? setAudioQualityError;
  Object? clearMediaSessionError;
  int playCalls = 0;
  int pauseCalls = 0;
  int clearCalls = 0;
  int loadCalls = 0;
  int stopCalls = 0;
  Duration? lastSeek;
  Object? stopFail;
  Object? loadSongError;
  final List<Object> loadSongErrors = <Object>[];

  @override
  Stream<PlayerEngineSnapshot> get snapshots => _controller.stream;

  @override
  Stream<int?> get androidAudioSessionIdStream => const Stream<int?>.empty();

  @override
  PlayerEngineSnapshot get latestSnapshot => _snapshot;

  @override
  int? get androidAudioSessionId => null;

  @override
  Future<void> loadSong(Song song, {required AudioQuality quality}) async {
    loadCalls += 1;

    if (loadSongErrors.isNotEmpty) {
      throw loadSongErrors.removeAt(0);
    }

    if (loadSongError case final Object error) {
      throw error;
    }

    if (_loadCompleter != null && _delayedLoadCall == loadCalls) {
      await _loadCompleter.future;
    }

    _snapshot = _snapshot.copyWith(
      currentSong: song,
      audioQuality: quality,
      isLoading: false,
      isPlaying: false,
      duration: const Duration(minutes: 3, seconds: 12),
      position: Duration.zero,
      processingState: PlayerEngineProcessingState.ready,
    );
    _controller.add(_snapshot);
  }

  @override
  Future<void> stop() async {
    stopCalls += 1;
    if (stopFail case final Object error) {
      throw error;
    }
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
  Future<void> pause() async {
    pauseCalls += 1;
    _snapshot = _snapshot.copyWith(isPlaying: false);
    _controller.add(_snapshot);
  }

  @override
  Future<void> play() async {
    playCalls += 1;
    _snapshot = _snapshot.copyWith(isPlaying: true);
    _controller.add(_snapshot);
  }

  @override
  Future<void> seek(Duration position) async {
    lastSeek = position;
    _snapshot = _snapshot.copyWith(position: position);
    _controller.add(_snapshot);
  }

  @override
  Future<void> setAudioQuality(AudioQuality quality) async {
    if (setAudioQualityError case final Object error) {
      throw error;
    }

    _snapshot = _snapshot.copyWith(audioQuality: quality);
    _controller.add(_snapshot);
  }

  @override
  Future<void> clearMediaSession() async {
    clearCalls += 1;
    if (clearMediaSessionError case final Object error) {
      throw error;
    }
  }

  @override
  Future<void> dispose() async {
    await _controller.close();
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

final class FakeRemoteSearchRepository implements RemoteSearchRepository {
  FakeRemoteSearchRepository({required this.singleResultsBySource});

  final Map<String, List<Song>> singleResultsBySource;
  final searchedSources = <String>[];

  @override
  Future<List<Song>> searchAggregate(
    String keyword, {
    required int page,
  }) async {
    return const <Song>[];
  }

  @override
  Future<List<Song>> searchSingle(
    String keyword, {
    required String source,
    required int page,
  }) async {
    searchedSources.add(source);
    return singleResultsBySource[source] ?? const <Song>[];
  }
}

void main() {
  test('openTrack populates state and toggles playback', () async {
    final fakeEngine = FakePlayerEngine();
    final container = ProviderContainer(
      overrides: [
        playerEngineProvider.overrideWithValue(fakeEngine),
        mediaSessionAdapterProvider.overrideWithValue(
          NoopMediaSessionAdapter(),
        ),
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    const track = PlayerTrack(
      id: 'skeleton-track',
      source: 'demo',
      title: 'Player Skeleton',
      artist: 'TuneFree',
    );

    final controller = container.read(playerControllerProvider.notifier);

    await controller.openTrack(track, queue: const [track]);
    await Future<void>.delayed(Duration.zero);

    expect(container.read(playerControllerProvider).currentTrack, track);
    expect(container.read(playerControllerProvider).queueTracks, const [track]);
    expect(
      container.read(playerControllerProvider).duration,
      const Duration(minutes: 3, seconds: 12),
    );
    expect(fakeEngine.playCalls, 0);
    expect(container.read(playerControllerProvider).isPlaying, isFalse);

    await controller.togglePlayback();
    await Future<void>.delayed(Duration.zero);
    expect(fakeEngine.playCalls, 1);
    expect(container.read(playerControllerProvider).isPlaying, isTrue);

    await controller.seek(const Duration(seconds: 42));
    await Future<void>.delayed(Duration.zero);
    expect(fakeEngine.lastSeek, const Duration(seconds: 42));
    expect(
      container.read(playerControllerProvider).position,
      const Duration(seconds: 42),
    );
  });

  test(
    'playSong prefers exact-quality local files before resolving remotely',
    () async {
      final fakeEngine = FakePlayerEngine();
      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(fakeEngine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            LocalPlaybackResolver(
              recordsForSong: (songKey) async => const <DownloadRecord>[],
              fileExists: (path) async => false,
              removeRecord: ({required songKey, required quality}) async {},
            ),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            LocalPlaybackResolver(
              recordsForSong: (songKey) async => const <DownloadRecord>[],
              fileExists: (path) async => false,
              removeRecord: ({required songKey, required quality}) async {},
            ),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            LocalPlaybackResolver(
              recordsForSong: (songKey) async => <DownloadRecord>[
                const DownloadRecord(
                  songKey: 'netease:current-track',
                  songId: 'current-track',
                  songName: 'Current Track',
                  artist: 'TuneFree',
                  quality: '320k',
                  filePath: '/downloads/current-track.flac',
                  fileName: 'current-track.flac',
                  downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
                ),
              ],
              fileExists: (path) async => true,
              removeRecord: ({required songKey, required quality}) async {},
            ),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            SongResolutionRepository.test(
              resolveSongValue: (song, quality) async {
                throw StateError('remote resolve should not run');
              },
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      const track = PlayerTrack(
        id: 'current-track',
        source: 'netease',
        title: 'Current Track',
        artist: 'TuneFree',
      );

      final controller = container.read(playerControllerProvider.notifier);

      await controller.openTrack(track, queue: const [track]);
      await Future<void>.delayed(Duration.zero);

      expect(
        fakeEngine.latestSnapshot.currentSong?.url,
        'file:///downloads/current-track.flac',
      );
    },
  );

  test(
    'playSong falls back to remote playback when local load fails',
    () async {
      final fakeEngine = FakePlayerEngine();
      fakeEngine.loadSongErrors.add(StateError('local load failed'));
      final removed = <String>[];
      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(fakeEngine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            LocalPlaybackResolver(
              recordsForSong: (songKey) async => <DownloadRecord>[
                const DownloadRecord(
                  songKey: 'netease:current-track',
                  songId: 'current-track',
                  songName: 'Current Track',
                  artist: 'TuneFree',
                  quality: '320k',
                  filePath: '/downloads/current-track.flac',
                  fileName: 'current-track.flac',
                  downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
                ),
              ],
              fileExists: (path) async => true,
              removeRecord: ({required songKey, required quality}) async {
                removed.add('$songKey::$quality');
              },
            ),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            SongResolutionRepository.test(
              resolveSongValue: (song, quality) async {
                return song.copyWith(
                  url: 'https://resolved.example/${song.id}-$quality.mp3',
                );
              },
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      const track = PlayerTrack(
        id: 'current-track',
        source: 'netease',
        title: 'Current Track',
        artist: 'TuneFree',
      );

      final controller = container.read(playerControllerProvider.notifier);

      await controller.openTrack(track, queue: const [track]);
      await Future<void>.delayed(Duration.zero);

      expect(removed, <String>['netease:current-track::320k']);
      expect(
        fakeEngine.latestSnapshot.currentSong?.url,
        'https://resolved.example/current-track-320k.mp3',
      );
      expect(fakeEngine.loadCalls, 2);
    },
  );

  test('openTrack stores an immutable defensive queue copy', () async {
    final fakeEngine = FakePlayerEngine();
    final container = ProviderContainer(
      overrides: [
        playerEngineProvider.overrideWithValue(fakeEngine),
        mediaSessionAdapterProvider.overrideWithValue(
          NoopMediaSessionAdapter(),
        ),
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    const track = PlayerTrack(
      id: 'queue-track',
      source: 'demo',
      title: 'Queue Copy',
      artist: 'TuneFree',
    );
    const secondTrack = PlayerTrack(
      id: 'queue-track-2',
      source: 'demo',
      title: 'Queue Copy 2',
      artist: 'TuneFree',
    );
    final queue = <PlayerTrack>[track];

    final controller = container.read(playerControllerProvider.notifier);

    await controller.openTrack(track, queue: queue);
    await Future<void>.delayed(Duration.zero);

    final storedQueue = container.read(playerControllerProvider).queueTracks;

    expect(storedQueue, [track]);
    expect(identical(storedQueue, queue), isFalse);

    queue.add(secondTrack);

    expect(container.read(playerControllerProvider).queueTracks, [track]);
    expect(() => storedQueue.add(secondTrack), throwsUnsupportedError);
  });

  test('stop does not mutate state if stopping fails', () async {
    final fakeEngine = FakePlayerEngine();
    fakeEngine.stopFail = StateError('stop failed');
    final container = ProviderContainer(
      overrides: [
        playerEngineProvider.overrideWithValue(fakeEngine),
        mediaSessionAdapterProvider.overrideWithValue(
          NoopMediaSessionAdapter(),
        ),
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    const track = PlayerTrack(
      id: 'error-stop',
      source: 'demo',
      title: 'Error Stop Track',
      artist: 'TuneFree',
      streamUrl: 'https://example.com/song.mp3',
    );

    final controller = container.read(playerControllerProvider.notifier);

    await controller.openTrack(track);
    await Future<void>.delayed(Duration.zero);

    expect(controller.state.currentSong?.key, 'demo:error-stop');
    expect(controller.state.isPlaying, isFalse);
    expect(controller.state.position, Duration.zero);
    expect(controller.state.duration, const Duration(minutes: 3, seconds: 12));
    expect(container.read(playerControllerProvider).queueTracks, [track]);

    await expectLater(controller.stop(), throwsA(isA<StateError>()));

    expect(controller.state.currentSong?.key, 'demo:error-stop');
    expect(controller.state.isPlaying, isFalse);
    expect(controller.state.isLoading, isFalse);
    expect(controller.state.position, Duration.zero);
    expect(controller.state.duration, const Duration(minutes: 3, seconds: 12));
    expect(container.read(playerControllerProvider).queueTracks, [track]);
    expect(fakeEngine.stopCalls, 1);
  });

  test(
    'stop keeps the local stopped state when media session clearing fails',
    () async {
      final fakeEngine = FakePlayerEngine()
        ..clearMediaSessionError = StateError('publish failed');
      final store = TestPlayerPreferencesStore();
      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(fakeEngine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(store),
          localPlaybackResolverProvider.overrideWithValue(
            LocalPlaybackResolver(
              recordsForSong: (songKey) async => const <DownloadRecord>[],
              fileExists: (path) async => false,
              removeRecord: ({required songKey, required quality}) async {},
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      const track = PlayerTrack(
        id: 'clear-failure-stop',
        source: 'demo',
        title: 'Clear Failure Stop',
        artist: 'TuneFree',
        streamUrl: 'https://example.com/song.mp3',
      );

      final controller = container.read(playerControllerProvider.notifier);

      await controller.openTrack(track, queue: const [track]);
      await Future<void>.delayed(Duration.zero);

      await expectLater(controller.stop(), throwsA(isA<StateError>()));

      expect(fakeEngine.stopCalls, 1);
      expect(fakeEngine.clearCalls, 1);
      expect(controller.state.currentSong, isNull);
      expect(controller.state.isPlaying, isFalse);
      expect(controller.state.isLoading, isFalse);
      expect(controller.state.position, Duration.zero);
      expect(controller.state.duration, Duration.zero);
      expect(container.read(playerControllerProvider).queueTracks, const [
        track,
      ]);
      expect(store.currentSong, isNull);
      expect(store.queue.map((song) => song.key), <String>[
        'demo:clear-failure-stop',
      ]);
    },
  );

  test('playSong resolves missing URLs before loading playback', () async {
    final fakeEngine = FakePlayerEngine();
    const resolvedSong = Song(
      id: 'current-track',
      name: 'Current Track',
      artist: 'TuneFree',
      source: MusicSource.netease,
      url: 'https://resolved.example/current-track.mp3',
    );
    final resolutionRepository = SongResolutionRepository.test(
      resolveSongValue: (song, quality) async {
        expect(song.url, isNull);
        expect(quality, '320k');
        return resolvedSong;
      },
    );
    final container = ProviderContainer(
      overrides: [
        playerEngineProvider.overrideWithValue(fakeEngine),
        mediaSessionAdapterProvider.overrideWithValue(
          NoopMediaSessionAdapter(),
        ),
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
        songResolutionRepositoryProvider.overrideWithValue(
          resolutionRepository,
        ),
      ],
    );
    addTearDown(container.dispose);

    const track = PlayerTrack(
      id: 'current-track',
      source: 'netease',
      title: 'Current Track',
      artist: 'TuneFree',
    );

    final controller = container.read(playerControllerProvider.notifier);

    await controller.openTrack(track, queue: const [track]);
    await Future<void>.delayed(Duration.zero);

    final state = container.read(playerControllerProvider);
    expect(
      state.currentTrack?.streamUrl,
      'https://resolved.example/current-track.mp3',
    );
    expect(
      state.queue.single.url,
      'https://resolved.example/current-track.mp3',
    );
    expect(
      fakeEngine.latestSnapshot.currentSong?.url,
      'https://resolved.example/current-track.mp3',
    );
  });

  test(
    'playSong falls back to peer sources before reporting failure',
    () async {
      final fakeEngine = FakePlayerEngine();
      final resolvedAttempts = <String>[];
      final resolutionRepository = SongResolutionRepository.test(
        resolveSongValue: (song, quality) async {
          resolvedAttempts.add('${song.source.wireValue}:${song.id}:$quality');
          if (song.source == MusicSource.kuwo) {
            return song.copyWith(
              url: 'https://resolved.example/${song.id}.mp3',
            );
          }
          throw StateError('source unavailable');
        },
      );
      final searchRepository = FakeRemoteSearchRepository(
        singleResultsBySource: const <String, List<Song>>{
          'qq': <Song>[
            Song(
              id: 'qq-fallback',
              name: 'Fallback Song',
              artist: 'TuneFree',
              source: MusicSource.qq,
            ),
          ],
          'kuwo': <Song>[
            Song(
              id: 'kuwo-fallback',
              name: 'Fallback Song',
              artist: 'TuneFree',
              source: MusicSource.kuwo,
            ),
          ],
        },
      );
      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(fakeEngine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            LocalPlaybackResolver(
              recordsForSong: (songKey) async => const <DownloadRecord>[],
              fileExists: (path) async => false,
              removeRecord: ({required songKey, required quality}) async {},
            ),
          ),
          songResolutionRepositoryProvider.overrideWithValue(
            resolutionRepository,
          ),
          remoteSearchRepositoryProvider.overrideWithValue(searchRepository),
        ],
      );
      addTearDown(container.dispose);

      const song = Song(
        id: 'netease-original',
        name: 'Fallback Song',
        artist: 'TuneFree',
        source: MusicSource.netease,
      );

      await container.read(playerControllerProvider.notifier).playSong(song);
      await Future<void>.delayed(Duration.zero);

      final state = container.read(playerControllerProvider);
      expect(state.currentSong?.source, MusicSource.kuwo);
      expect(
        state.currentSong?.url,
        'https://resolved.example/kuwo-fallback.mp3',
      );
      expect(state.queue.single.key, 'kuwo:kuwo-fallback');
      expect(state.playbackNotice, '当前音源不可用，已切换 酷我音乐');
      expect(
        searchRepository.searchedSources,
        containsAllInOrder(['qq', 'kuwo']),
      );
      expect(resolvedAttempts, <String>[
        'netease:netease-original:320k',
        'qq:qq-fallback:320k',
        'kuwo:kuwo-fallback:320k',
      ]);
      expect(fakeEngine.loadCalls, 1);
    },
  );

  test('playSong preloads the next resolvable queue item', () async {
    final fakeEngine = FakePlayerEngine();
    final resolvedIds = <String>[];
    final resolutionRepository = SongResolutionRepository.test(
      resolveSongValue: (song, quality) async {
        resolvedIds.add('${song.id}:$quality');
        return song.copyWith(url: 'https://resolved.example/${song.id}.mp3');
      },
    );
    final container = ProviderContainer(
      overrides: [
        playerEngineProvider.overrideWithValue(fakeEngine),
        mediaSessionAdapterProvider.overrideWithValue(
          NoopMediaSessionAdapter(),
        ),
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
        songResolutionRepositoryProvider.overrideWithValue(
          resolutionRepository,
        ),
      ],
    );
    addTearDown(container.dispose);

    const firstSong = Song(
      id: 'preload-first',
      name: 'Preload First',
      artist: 'TuneFree',
      source: MusicSource.netease,
    );
    const secondSong = Song(
      id: 'preload-second',
      name: 'Preload Second',
      artist: 'TuneFree',
      source: MusicSource.netease,
    );

    final controller = container.read(playerControllerProvider.notifier);

    await controller.playSong(
      firstSong,
      queue: const <Song>[firstSong, secondSong],
    );
    await Future<void>.delayed(Duration.zero);

    expect(resolvedIds, <String>['preload-first:320k', 'preload-second:320k']);
  });

  test('playSong skips preloading Kuwo temporary CDN URLs', () async {
    final fakeEngine = FakePlayerEngine();
    final resolvedIds = <String>[];
    final resolutionRepository = SongResolutionRepository.test(
      resolveSongValue: (song, quality) async {
        resolvedIds.add('${song.source.wireValue}:${song.id}:$quality');
        return song.copyWith(url: 'https://resolved.example/${song.id}.mp3');
      },
    );
    final container = ProviderContainer(
      overrides: [
        playerEngineProvider.overrideWithValue(fakeEngine),
        mediaSessionAdapterProvider.overrideWithValue(
          NoopMediaSessionAdapter(),
        ),
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
        songResolutionRepositoryProvider.overrideWithValue(
          resolutionRepository,
        ),
      ],
    );
    addTearDown(container.dispose);

    const firstSong = Song(
      id: 'preload-first',
      name: 'Preload First',
      artist: 'TuneFree',
      source: MusicSource.netease,
    );
    const kuwoSong = Song(
      id: 'kuwo-next',
      name: 'Kuwo Next',
      artist: 'TuneFree',
      source: MusicSource.kuwo,
    );

    await container
        .read(playerControllerProvider.notifier)
        .playSong(firstSong, queue: const <Song>[firstSong, kuwoSong]);
    await Future<void>.delayed(Duration.zero);

    expect(resolvedIds, <String>['netease:preload-first:320k']);
  });

  test(
    'playSong keeps queue state and stops playback when resolution fails',
    () async {
      final fakeEngine = FakePlayerEngine();
      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(fakeEngine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
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
              resolveSongValue: (song, quality) async {
                throw StateError('resolution failed');
              },
            ),
          ),
          remoteSearchRepositoryProvider.overrideWithValue(
            FakeRemoteSearchRepository(
              singleResultsBySource: const <String, List<Song>>{},
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      const track = PlayerTrack(
        id: 'current-track',
        source: 'netease',
        title: 'Current Track',
        artist: 'TuneFree',
      );

      final controller = container.read(playerControllerProvider.notifier);

      await controller.openTrack(track, queue: const [track]);
      await Future<void>.delayed(Duration.zero);

      final state = container.read(playerControllerProvider);
      expect(state.currentTrack, track);
      expect(state.queueTracks, const [track]);
      expect(state.isLoading, isFalse);
      expect(state.isPlaying, isFalse);
      expect(state.playbackNotice, '所有音源暂时不可用，请稍后重试');
      expect(fakeEngine.loadCalls, 0);
    },
  );

  test(
    'openTrack resets stale playback values before load completes',
    () async {
      final loadCompleter = Completer<void>();
      final fakeEngine = FakePlayerEngine(
        loadCompleter: loadCompleter,
        delayedLoadCall: 2,
      );
      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(fakeEngine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            LocalPlaybackResolver(
              recordsForSong: (songKey) async => const <DownloadRecord>[],
              fileExists: (path) async => false,
              removeRecord: ({required songKey, required quality}) async {},
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      const firstTrack = PlayerTrack(
        id: 'current-track',
        source: 'demo',
        title: 'Current Track',
        artist: 'TuneFree',
      );
      const nextTrack = PlayerTrack(
        id: 'next-track',
        source: 'demo',
        title: 'Next Track',
        artist: 'TuneFree',
      );

      final controller = container.read(playerControllerProvider.notifier);

      await controller.openTrack(firstTrack, queue: const [firstTrack]);
      await Future<void>.delayed(Duration.zero);
      await controller.togglePlayback();
      await Future<void>.delayed(Duration.zero);
      await controller.seek(const Duration(seconds: 24));
      await Future<void>.delayed(Duration.zero);

      final pendingOpenTrack = controller.openTrack(
        nextTrack,
        queue: const [nextTrack],
      );

      expect(container.read(playerControllerProvider).currentTrack, nextTrack);
      expect(container.read(playerControllerProvider).isLoading, isTrue);
      expect(container.read(playerControllerProvider).isPlaying, isFalse);
      expect(container.read(playerControllerProvider).position, Duration.zero);
      expect(container.read(playerControllerProvider).duration, Duration.zero);

      loadCompleter.complete();
      await pendingOpenTrack;
      await Future<void>.delayed(Duration.zero);

      expect(
        container.read(playerControllerProvider).duration,
        const Duration(minutes: 3, seconds: 12),
      );
      expect(container.read(playerControllerProvider).isPlaying, isFalse);
    },
  );

  test('ignores stale delayed loads after a newer song is selected', () async {
    final loadCompleter = Completer<void>();
    final fakeEngine = FakePlayerEngine(
      loadCompleter: loadCompleter,
      delayedLoadCall: 1,
    );
    final container = ProviderContainer(
      overrides: [
        playerEngineProvider.overrideWithValue(fakeEngine),
        mediaSessionAdapterProvider.overrideWithValue(
          NoopMediaSessionAdapter(),
        ),
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    const firstSong = Song(
      id: 'first-stale-load',
      name: 'First Stale Load',
      artist: 'TuneFree',
      source: MusicSource.netease,
      url: 'https://example.com/first.mp3',
    );
    const secondSong = Song(
      id: 'second-current-load',
      name: 'Second Current Load',
      artist: 'TuneFree',
      source: MusicSource.netease,
      url: 'https://example.com/second.mp3',
    );

    final controller = container.read(playerControllerProvider.notifier);
    final firstOpen = controller.playSong(
      firstSong,
      queue: const <Song>[firstSong, secondSong],
    );
    await Future<void>.delayed(Duration.zero);

    final secondOpen = controller.playSong(
      secondSong,
      queue: const <Song>[firstSong, secondSong],
    );
    await secondOpen;

    expect(container.read(playerControllerProvider).currentSong, secondSong);

    loadCompleter.complete();
    await firstOpen;
    await Future<void>.delayed(Duration.zero);

    expect(container.read(playerControllerProvider).currentSong, secondSong);
    expect(container.read(playerControllerProvider).isLoading, isFalse);
  });

  test('seek clamps positions to the current known duration', () async {
    final fakeEngine = FakePlayerEngine();
    final container = ProviderContainer(
      overrides: [
        playerEngineProvider.overrideWithValue(fakeEngine),
        mediaSessionAdapterProvider.overrideWithValue(
          NoopMediaSessionAdapter(),
        ),
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    const track = PlayerTrack(
      id: 'clamped-seek',
      source: 'demo',
      title: 'Clamped Seek',
      artist: 'TuneFree',
      streamUrl: 'https://example.com/song.mp3',
    );

    final controller = container.read(playerControllerProvider.notifier);

    await controller.openTrack(track, queue: const [track]);
    await Future<void>.delayed(Duration.zero);

    await controller.seek(const Duration(seconds: -9));
    await Future<void>.delayed(Duration.zero);
    expect(fakeEngine.lastSeek, Duration.zero);
    expect(container.read(playerControllerProvider).position, Duration.zero);

    await controller.seek(const Duration(minutes: 8));
    await Future<void>.delayed(Duration.zero);
    expect(fakeEngine.lastSeek, const Duration(minutes: 3, seconds: 12));
    expect(
      container.read(playerControllerProvider).position,
      const Duration(minutes: 3, seconds: 12),
    );
  });

  test('expand and collapse update full-player state', () {
    final fakeEngine = FakePlayerEngine();
    final container = ProviderContainer(
      overrides: [
        playerEngineProvider.overrideWithValue(fakeEngine),
        mediaSessionAdapterProvider.overrideWithValue(
          NoopMediaSessionAdapter(),
        ),
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
      ],
    );
    addTearDown(container.dispose);
    addTearDown(fakeEngine.dispose);

    final controller = container.read(playerControllerProvider.notifier);

    controller.expand();
    expect(container.read(playerControllerProvider).isExpanded, isTrue);

    controller.collapse();
    expect(container.read(playerControllerProvider).isExpanded, isFalse);
  });

  test('collapse clears transient full-player panels', () {
    final fakeEngine = FakePlayerEngine();
    final container = ProviderContainer(
      overrides: [
        playerEngineProvider.overrideWithValue(fakeEngine),
        mediaSessionAdapterProvider.overrideWithValue(
          NoopMediaSessionAdapter(),
        ),
        playerPreferencesStoreProvider.overrideWithValue(
          TestPlayerPreferencesStore(),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
        localPlaybackResolverProvider.overrideWithValue(
          LocalPlaybackResolver(
            recordsForSong: (songKey) async => const <DownloadRecord>[],
            fileExists: (path) async => false,
            removeRecord: ({required songKey, required quality}) async {},
          ),
        ),
      ],
    );
    addTearDown(container.dispose);
    addTearDown(fakeEngine.dispose);

    final controller = container.read(playerControllerProvider.notifier);

    controller.expand();
    controller.setShowLyrics(true);
    controller.setShowQueue(true);
    controller.setShowDownload(true);
    controller.setShowMore(true);

    controller.collapse();

    final state = container.read(playerControllerProvider);
    expect(state.isExpanded, isFalse);
    expect(state.showLyrics, isFalse);
    expect(state.showQueue, isFalse);
    expect(state.showDownload, isFalse);
    expect(state.showMore, isFalse);
  });

  test(
    'quality setters update player state for current parity interactions',
    () async {
      final fakeEngine = FakePlayerEngine();
      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(fakeEngine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
        ],
      );
      addTearDown(container.dispose);
      addTearDown(fakeEngine.dispose);

      final controller = container.read(playerControllerProvider.notifier);

      await controller.setPlaybackQuality(AudioQuality.flac);
      controller.setDownloadQuality(AudioQuality.flac24bit);

      final state = container.read(playerControllerProvider);
      expect(state.playbackQuality, AudioQuality.flac);
      expect(state.downloadQuality, AudioQuality.flac24bit);
    },
  );

  test(
    'setPlaybackQuality forwards async engine errors without reverting local state',
    () async {
      final fakeEngine = FakePlayerEngine()
        ..setAudioQualityError = StateError('quality failed');
      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(fakeEngine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
        ],
      );
      addTearDown(container.dispose);

      final controller = container.read(playerControllerProvider.notifier);

      await expectLater(
        controller.setPlaybackQuality(AudioQuality.flac),
        throwsA(isA<StateError>()),
      );

      expect(
        container.read(playerControllerProvider).playbackQuality,
        AudioQuality.flac,
      );
    },
  );

  test(
    'controller clears currentTrack when engine snapshot clears currentSong',
    () async {
      final fakeEngine = FakePlayerEngine();
      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(fakeEngine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(
            TestPlayerPreferencesStore(),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            LocalPlaybackResolver(
              recordsForSong: (songKey) async => const <DownloadRecord>[],
              fileExists: (path) async => false,
              removeRecord: ({required songKey, required quality}) async {},
            ),
          ),
          localPlaybackResolverProvider.overrideWithValue(
            LocalPlaybackResolver(
              recordsForSong: (songKey) async => const <DownloadRecord>[],
              fileExists: (path) async => false,
              removeRecord: ({required songKey, required quality}) async {},
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      const track = PlayerTrack(
        id: 'clearable-track',
        source: 'demo',
        title: 'Clearable Track',
        artist: 'TuneFree',
      );

      final controller = container.read(playerControllerProvider.notifier);

      await controller.openTrack(track, queue: const [track]);
      await Future<void>.delayed(Duration.zero);

      fakeEngine._snapshot = fakeEngine.latestSnapshot.copyWith(
        currentSong: null,
      );
      fakeEngine._controller.add(fakeEngine._snapshot);
      await Future<void>.delayed(Duration.zero);

      expect(container.read(playerControllerProvider).currentTrack, isNull);
    },
  );

  test(
    'clearQueue ignores stale engine snapshots that still reference the cleared song',
    () async {
      final fakeEngine = FakePlayerEngine();
      final store = TestPlayerPreferencesStore();
      final container = ProviderContainer(
        overrides: [
          playerEngineProvider.overrideWithValue(fakeEngine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
          playerPreferencesStoreProvider.overrideWithValue(store),
          localPlaybackResolverProvider.overrideWithValue(
            LocalPlaybackResolver(
              recordsForSong: (songKey) async => const <DownloadRecord>[],
              fileExists: (path) async => false,
              removeRecord: ({required songKey, required quality}) async {},
            ),
          ),
        ],
      );
      addTearDown(container.dispose);

      const track = PlayerTrack(
        id: 'stale-track',
        source: 'demo',
        title: 'Stale Track',
        artist: 'TuneFree',
      );

      final controller = container.read(playerControllerProvider.notifier);

      await controller.openTrack(track, queue: const [track]);
      await Future<void>.delayed(Duration.zero);
      await controller.clearQueue();
      await Future<void>.delayed(Duration.zero);

      fakeEngine._controller.add(
        fakeEngine.latestSnapshot.copyWith(
          currentSong: Song(
            id: 'stale-track',
            name: 'Stale Track',
            artist: 'TuneFree',
            source: MusicSource('demo'),
          ),
        ),
      );
      await Future<void>.delayed(Duration.zero);

      final state = container.read(playerControllerProvider);
      expect(state.currentTrack, isNull);
      expect(state.queue, isEmpty);
      expect(store.currentSong, isNull);
      expect(store.queue, isEmpty);
      expect(fakeEngine.clearCalls, 1);
    },
  );
}
