import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/application/media_session_adapter.dart';
import 'package:tunefree/features/player/application/player_controller.dart';
import 'package:tunefree/features/player/application/player_engine.dart';
import 'package:tunefree/features/player/application/playback_lifecycle_coordinator.dart';
import 'package:tunefree/features/player/application/just_audio_player_engine.dart';
import 'package:tunefree/features/player/data/player_preferences_store.dart';

final class InMemoryPlayerPreferencesStore implements PlayerPreferencesStore {
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

final class DelayedHydrationPlayerPreferencesStore
    implements PlayerPreferencesStore {
  DelayedHydrationPlayerPreferencesStore({required this.queueLoadCompleter});

  final Completer<void> queueLoadCompleter;
  final Completer<void> queueLoadStartedCompleter = Completer<void>();
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
  Future<List<Song>> loadQueue() async {
    if (!queueLoadStartedCompleter.isCompleted) {
      queueLoadStartedCompleter.complete();
    }
    await queueLoadCompleter.future;
    return queue;
  }

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

final class FakeRuntimePlayerEngine implements PlayerEngine {
  FakeRuntimePlayerEngine();

  final _controller = StreamController<PlayerEngineSnapshot>.broadcast();
  PlayerEngineSnapshot _snapshot = const PlayerEngineSnapshot();
  int playCalls = 0;
  int pauseCalls = 0;
  int stopCalls = 0;
  int loadCalls = 0;
  Duration? lastSeekPosition;
  Object? clearMediaSessionError;

  @override
  Stream<PlayerEngineSnapshot> get snapshots => _controller.stream;

  @override
  PlayerEngineSnapshot get latestSnapshot => _snapshot;

  @override
  Future<void> loadSong(Song song, {required AudioQuality quality}) async {
    loadCalls += 1;
    _snapshot = _snapshot.copyWith(
      currentSong: song,
      audioQuality: quality,
      isLoading: false,
      isPlaying: false,
      duration: const Duration(minutes: 4),
      position: Duration.zero,
      processingState: PlayerEngineProcessingState.ready,
    );
    _controller.add(_snapshot);
  }

  @override
  Future<void> play() async {
    playCalls += 1;
    _snapshot = _snapshot.copyWith(
      isPlaying: true,
      processingState: PlayerEngineProcessingState.ready,
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
  Future<void> stop() async {
    stopCalls += 1;
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
  Future<void> seek(Duration position) async {
    lastSeekPosition = position;
    _snapshot = _snapshot.copyWith(position: position);
    _controller.add(_snapshot);
  }

  @override
  Future<void> setAudioQuality(AudioQuality quality) async {
    _snapshot = _snapshot.copyWith(audioQuality: quality);
    _controller.add(_snapshot);
  }

  void emit(PlayerEngineSnapshot snapshot) {
    _snapshot = snapshot;
    _controller.add(snapshot);
  }

  @override
  Future<void> clearMediaSession() async {
    if (clearMediaSessionError case final Object error) {
      throw error;
    }
  }

  @override
  Future<void> dispose() async {
    await _controller.close();
  }
}

void main() {
  test(
    'controller keeps queue, play mode, and audio quality aligned with runtime engine',
    () async {
      final engine = JustAudioPlayerEngine.test();
      final store = InMemoryPlayerPreferencesStore();
      final controller = PlayerController.runtime(
        engine: engine,
        preferencesStore: store,
      );
      addTearDown(controller.disposeController);

      const song = Song(
        id: 'runtime-song',
        name: '海与你',
        artist: '马也_Crabbit',
        source: MusicSource.netease,
        url: 'https://example.com/song.mp3',
        audioQualities: [AudioQuality.flac, AudioQuality.k128],
      );

      await controller.playSong(song);
      expect(controller.state.currentSong?.key, 'netease:runtime-song');
      expect(controller.state.queue.single.key, 'netease:runtime-song');

      controller.togglePlayMode();
      expect(controller.state.playMode, 'loop');

      await controller.setAudioQuality(AudioQuality.k128);
      expect(controller.state.audioQuality, AudioQuality.k128);
    },
  );

  test(
    'late hydration does not overwrite runtime preference changes',
    () async {
      final queueLoadCompleter = Completer<void>();
      final engine = JustAudioPlayerEngine.test();
      final store =
          DelayedHydrationPlayerPreferencesStore(
              queueLoadCompleter: queueLoadCompleter,
            )
            ..playMode = 'shuffle'
            ..audioQuality = AudioQuality.flac;
      final controller = PlayerController.runtime(
        engine: engine,
        preferencesStore: store,
      );
      addTearDown(controller.disposeController);

      await store.queueLoadStartedCompleter.future;

      controller.togglePlayMode();
      await controller.setAudioQuality(AudioQuality.k128);
      controller.setDownloadQuality(AudioQuality.flac24bit);

      queueLoadCompleter.complete();
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(controller.state.playMode, 'loop');
      expect(controller.state.audioQuality, AudioQuality.k128);
      expect(controller.state.downloadQuality, AudioQuality.flac24bit);
    },
  );

  test(
    'play recovers the last stopped queue item when the queue is still present',
    () async {
      final engine = FakeRuntimePlayerEngine();
      final store = InMemoryPlayerPreferencesStore();
      final controller = PlayerController.runtime(
        engine: engine,
        preferencesStore: store,
        mediaSessionAdapter: NoopMediaSessionAdapter(),
        lifecycleEventSource: const NoopPlaybackLifecycleEventSource(),
      );
      addTearDown(controller.disposeController);

      const song = Song(
        id: 'resume-song',
        name: 'Resume Song',
        artist: 'TuneFree',
        source: MusicSource.netease,
        url: 'https://example.com/resume.mp3',
      );

      await controller.playSong(song, queue: const <Song>[song]);
      await controller.stop();
      await controller.play();

      expect(engine.stopCalls, 1);
      expect(engine.loadCalls, 2);
      expect(controller.state.currentSong?.key, 'netease:resume-song');
    },
  );

  test('completed snapshots use the controller play-mode policy', () async {
    final engine = FakeRuntimePlayerEngine();
    final store = InMemoryPlayerPreferencesStore();
    final controller = PlayerController.runtime(
      engine: engine,
      preferencesStore: store,
      mediaSessionAdapter: NoopMediaSessionAdapter(),
      lifecycleEventSource: const NoopPlaybackLifecycleEventSource(),
    );
    addTearDown(controller.disposeController);

    const song = Song(
      id: 'loop-song',
      name: 'Loop Song',
      artist: 'TuneFree',
      source: MusicSource.netease,
      url: 'https://example.com/loop.mp3',
    );

    await controller.playSong(song, queue: const <Song>[song]);
    controller.togglePlayMode();
    expect(controller.state.playMode, 'loop');

    engine.emit(
      engine.latestSnapshot.copyWith(
        isPlaying: false,
        processingState: PlayerEngineProcessingState.completed,
      ),
    );
    await Future<void>.delayed(Duration.zero);

    expect(engine.lastSeekPosition, Duration.zero);
    expect(engine.playCalls, greaterThanOrEqualTo(2));
  });

  test('stop leaves the queue intact so system play can recover later', () async {
    final engine = FakeRuntimePlayerEngine();
    final store = InMemoryPlayerPreferencesStore();
    final controller = PlayerController.runtime(
      engine: engine,
      preferencesStore: store,
      mediaSessionAdapter: NoopMediaSessionAdapter(),
      lifecycleEventSource: const NoopPlaybackLifecycleEventSource(),
    );
    addTearDown(controller.disposeController);

    const firstSong = Song(
      id: 'first',
      name: 'First Song',
      artist: 'TuneFree',
      source: MusicSource.netease,
      url: 'https://example.com/first.mp3',
    );
    const secondSong = Song(
      id: 'second',
      name: 'Second Song',
      artist: 'TuneFree',
      source: MusicSource.netease,
      url: 'https://example.com/second.mp3',
    );

    await controller.playSong(
      firstSong,
      queue: const <Song>[firstSong, secondSong],
    );
    await controller.stop();

    expect(controller.state.currentSong, isNull);
    expect(
      controller.state.queue.map((song) => song.key),
      <String>['netease:first', 'netease:second'],
    );
  });

  test(
    'stop preserves local stopped state when media session clearing fails',
    () async {
      final engine = FakeRuntimePlayerEngine()
        ..clearMediaSessionError = StateError('publish failed');
      final store = InMemoryPlayerPreferencesStore();
      final controller = PlayerController.runtime(
        engine: engine,
        preferencesStore: store,
        mediaSessionAdapter: NoopMediaSessionAdapter(),
        lifecycleEventSource: const NoopPlaybackLifecycleEventSource(),
      );
      addTearDown(controller.disposeController);

      const song = Song(
        id: 'stop-publish-failure',
        name: 'Stop Publish Failure',
        artist: 'TuneFree',
        source: MusicSource.netease,
        url: 'https://example.com/stop.mp3',
      );

      await controller.playSong(song, queue: const <Song>[song]);

      await expectLater(controller.stop(), throwsA(isA<StateError>()));

      expect(engine.stopCalls, 1);
      expect(controller.state.currentSong, isNull);
      expect(controller.state.isPlaying, isFalse);
      expect(controller.state.isLoading, isFalse);
      expect(controller.state.position, Duration.zero);
      expect(controller.state.duration, Duration.zero);
      expect(controller.state.queue.map((item) => item.key), <String>[song.key]);
      expect(store.currentSong, isNull);
      expect(store.queue.map((item) => item.key), <String>[song.key]);
    },
  );

  test('seek clamps positions to known playback bounds in runtime mode', () async {
    final engine = FakeRuntimePlayerEngine();
    final store = InMemoryPlayerPreferencesStore();
    final controller = PlayerController.runtime(
      engine: engine,
      preferencesStore: store,
      mediaSessionAdapter: NoopMediaSessionAdapter(),
      lifecycleEventSource: const NoopPlaybackLifecycleEventSource(),
    );
    addTearDown(controller.disposeController);

    const song = Song(
      id: 'bounded-seek',
      name: 'Bounded Seek',
      artist: 'TuneFree',
      source: MusicSource.netease,
      url: 'https://example.com/bounded.mp3',
    );

    await controller.playSong(song, queue: const <Song>[song]);

    await controller.seek(const Duration(seconds: -5));
    expect(engine.lastSeekPosition, Duration.zero);
    expect(controller.state.position, Duration.zero);

    await controller.seek(const Duration(minutes: 6));
    expect(engine.lastSeekPosition, const Duration(minutes: 4));
    expect(controller.state.position, const Duration(minutes: 4));
  });
}
