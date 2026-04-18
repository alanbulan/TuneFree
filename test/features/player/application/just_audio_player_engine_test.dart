import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:just_audio/just_audio.dart' as ja;
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/application/just_audio_player_engine.dart';
import 'package:tunefree/features/player/application/media_session_adapter.dart';
import 'package:tunefree/features/player/application/media_session_remote_command.dart';
import 'package:tunefree/features/player/application/player_engine.dart';

class FakeAudioPlayerAdapter implements AudioPlayerAdapter {
  final StreamController<ja.PlayerState> _playerStateController =
      StreamController<ja.PlayerState>.broadcast();
  final StreamController<Duration> _positionController =
      StreamController<Duration>.broadcast();
  final StreamController<Duration?> _durationController =
      StreamController<Duration?>.broadcast();

  Duration? _duration;
  Object? setUrlError;
  Object? playError;
  Object? pauseError;
  Object? seekError;
  String? lastUrl;
  Duration? lastSeekPosition;
  int disposeCalls = 0;

  @override
  Stream<ja.PlayerState> get playerStateStream => _playerStateController.stream;

  @override
  Stream<Duration> get positionStream => _positionController.stream;

  @override
  Stream<Duration?> get durationStream => _durationController.stream;

  @override
  Duration? get duration => _duration;

  void emitPlayerState(ja.PlayerState state) {
    _playerStateController.add(state);
  }

  void emitPosition(Duration position) {
    _positionController.add(position);
  }

  void emitDuration(Duration? duration) {
    _duration = duration;
    _durationController.add(duration);
  }

  @override
  Future<Duration?> setUrl(String url) async {
    lastUrl = url;
    if (setUrlError case final Object error) {
      throw error;
    }
    return _duration;
  }

  @override
  Future<void> play() async {
    if (playError case final Object error) {
      throw error;
    }
  }

  @override
  Future<void> pause() async {
    if (pauseError case final Object error) {
      throw error;
    }
  }

  @override
  Future<void> stop() async {}

  @override
  Future<void> seek(Duration position) async {
    lastSeekPosition = position;
    if (seekError case final Object error) {
      throw error;
    }
  }

  @override
  Future<void> dispose() async {
    disposeCalls += 1;
    await _playerStateController.close();
    await _positionController.close();
    await _durationController.close();
  }
}

class FakeMediaSessionAdapter implements MediaSessionAdapter {
  Song? lastMetadataSong;
  bool? lastMetadataIsPlaying;
  Duration? lastProgressPosition;
  Duration? lastProgressDuration;
  int metadataUpdateCalls = 0;
  int progressUpdateCalls = 0;

  @override
  Stream<MediaSessionRemoteCommand> get remoteCommands =>
      const Stream<MediaSessionRemoteCommand>.empty();

  @override
  Future<void> clear() async {}

  @override
  Future<void> updateMetadata(Song song, {required bool isPlaying}) async {
    metadataUpdateCalls += 1;
    lastMetadataSong = song;
    lastMetadataIsPlaying = isPlaying;
  }

  @override
  Future<void> updateProgress({
    required Duration position,
    required Duration duration,
  }) async {
    progressUpdateCalls += 1;
    lastProgressPosition = position;
    lastProgressDuration = duration;
  }
}

class FailingMediaSessionAdapter extends FakeMediaSessionAdapter {
  Object? updateMetadataError;
  Object? updateProgressError;
  int clearCalls = 0;

  @override
  Future<void> clear() async {
    clearCalls += 1;
  }

  @override
  Future<void> updateMetadata(Song song, {required bool isPlaying}) async {
    await super.updateMetadata(song, isPlaying: isPlaying);
    if (updateMetadataError case final Object error) {
      throw error;
    }
  }

  @override
  Future<void> updateProgress({
    required Duration position,
    required Duration duration,
  }) async {
    if (updateProgressError case final Object error) {
      throw error;
    }
    await super.updateProgress(position: position, duration: duration);
  }
}

void main() {
  const song = Song(
    id: 'runtime-1',
    name: '海与你',
    artist: '马也_Crabbit',
    source: MusicSource.netease,
    url: 'https://example.com/test.mp3',
    audioQualities: [AudioQuality.k320],
  );

  test('snapshot copyWith can intentionally clear currentSong', () {
    const snapshot = PlayerEngineSnapshot(currentSong: song, isPlaying: true);

    final cleared = snapshot.copyWith(currentSong: null, isPlaying: false);

    expect(cleared.currentSong, isNull);
    expect(cleared.isPlaying, isFalse);
    expect(snapshot.currentSong, song);
  });

  test('test engine emits loading, progress, and quality snapshots', () async {
    final engine = JustAudioPlayerEngine.test();
    addTearDown(engine.dispose);

    final snapshots = <PlayerEngineSnapshot>[];
    final subscription = engine.snapshots.listen(snapshots.add);
    addTearDown(subscription.cancel);

    await engine.loadSong(song, quality: AudioQuality.k320);
    await engine.play();
    await engine.seek(const Duration(seconds: 42));
    await engine.setAudioQuality(AudioQuality.flac);
    await engine.pause();

    expect(
      snapshots,
      contains(
        isA<PlayerEngineSnapshot>().having(
          (value) => value.isLoading,
          'isLoading',
          isTrue,
        ),
      ),
    );
    expect(engine.latestSnapshot.currentSong?.key, 'netease:runtime-1');
    expect(engine.latestSnapshot.position, const Duration(seconds: 42));
    expect(engine.latestSnapshot.audioQuality, AudioQuality.flac);
    expect(engine.latestSnapshot.isPlaying, isFalse);
    expect(engine.latestSnapshot.isLoading, isFalse);
  });

  test(
    'real engine reflects audio player stream updates in snapshots',
    () async {
      final audioPlayer = FakeAudioPlayerAdapter()
        ..emitDuration(const Duration(minutes: 2));
      final mediaSession = FailingMediaSessionAdapter();
      final engine = JustAudioPlayerEngine.withAudioPlayer(
        mediaSessionAdapter: mediaSession,
        audioPlayer: audioPlayer,
      );
      addTearDown(engine.dispose);

      await engine.loadSong(song, quality: AudioQuality.k320);
      audioPlayer.emitPlayerState(
        ja.PlayerState(true, ja.ProcessingState.ready),
      );
      audioPlayer.emitPosition(const Duration(seconds: 12));
      audioPlayer.emitDuration(const Duration(minutes: 5));
      await Future<void>.delayed(Duration.zero);

      expect(engine.latestSnapshot.currentSong, song);
      expect(engine.latestSnapshot.isPlaying, isTrue);
      expect(engine.latestSnapshot.isLoading, isFalse);
      expect(engine.latestSnapshot.position, const Duration(seconds: 12));
      expect(engine.latestSnapshot.duration, const Duration(minutes: 5));
    },
  );

  test(
    'loadSong publishes paused metadata and throttled progress updates',
    () async {
      final audioPlayer = FakeAudioPlayerAdapter()
        ..emitDuration(const Duration(minutes: 5));
      final mediaSession = FakeMediaSessionAdapter();
      final engine = JustAudioPlayerEngine.withAudioPlayer(
        mediaSessionAdapter: mediaSession,
        audioPlayer: audioPlayer,
      );
      addTearDown(engine.dispose);

      await engine.loadSong(song, quality: AudioQuality.k320);
      expect(mediaSession.lastMetadataSong, song);
      expect(mediaSession.lastMetadataIsPlaying, isFalse);

      audioPlayer.emitPosition(const Duration(seconds: 1));
      await Future<void>.delayed(Duration.zero);
      expect(mediaSession.lastProgressPosition, const Duration(seconds: 1));
      expect(mediaSession.lastProgressDuration, const Duration(minutes: 5));

      audioPlayer.emitPosition(const Duration(milliseconds: 1100));
      await Future<void>.delayed(Duration.zero);
      expect(mediaSession.lastProgressPosition, const Duration(seconds: 1));

      audioPlayer.emitPosition(const Duration(seconds: 2));
      await Future<void>.delayed(Duration.zero);
      expect(mediaSession.lastProgressPosition, const Duration(seconds: 2));
    },
  );

  test('loadSong clears loading state when setUrl fails', () async {
    final audioPlayer = FakeAudioPlayerAdapter()
      ..setUrlError = StateError('load failed');
    final engine = JustAudioPlayerEngine.withAudioPlayer(
      mediaSessionAdapter: FailingMediaSessionAdapter(),
      audioPlayer: audioPlayer,
    );
    addTearDown(engine.dispose);

    await expectLater(
      engine.loadSong(song, quality: AudioQuality.k320),
      throwsA(isA<StateError>()),
    );

    expect(engine.latestSnapshot.currentSong, song);
    expect(engine.latestSnapshot.isLoading, isFalse);
    expect(engine.latestSnapshot.isPlaying, isFalse);
    expect(engine.latestSnapshot.duration, Duration.zero);
  });

  test(
    'play, pause, and seek failures do not leave stale loading state',
    () async {
      final audioPlayer = FakeAudioPlayerAdapter()
        ..emitDuration(const Duration(minutes: 4));
      final mediaSession = FailingMediaSessionAdapter();
      final engine = JustAudioPlayerEngine.withAudioPlayer(
        mediaSessionAdapter: mediaSession,
        audioPlayer: audioPlayer,
      );
      addTearDown(engine.dispose);

      await engine.loadSong(song, quality: AudioQuality.k320);
      audioPlayer.emitPlayerState(
        ja.PlayerState(false, ja.ProcessingState.buffering),
      );
      await Future<void>.delayed(Duration.zero);
      expect(engine.latestSnapshot.isLoading, isTrue);

      audioPlayer.playError = StateError('play failed');
      await expectLater(engine.play(), throwsA(isA<StateError>()));
      expect(engine.latestSnapshot.isLoading, isFalse);
      expect(engine.latestSnapshot.isPlaying, isFalse);

      audioPlayer.pauseError = StateError('pause failed');
      await expectLater(engine.pause(), throwsA(isA<StateError>()));
      expect(engine.latestSnapshot.isLoading, isFalse);
      expect(engine.latestSnapshot.isPlaying, isFalse);

      audioPlayer.seekError = StateError('seek failed');
      await expectLater(
        engine.seek(const Duration(seconds: 5)),
        throwsA(isA<StateError>()),
      );
      expect(engine.latestSnapshot.isLoading, isFalse);
      expect(mediaSession.lastProgressPosition, isNull);
    },
  );

  test(
    'duration stream updates sync progress to media session immediately',
    () async {
      final audioPlayer = FakeAudioPlayerAdapter();
      final mediaSession = FakeMediaSessionAdapter();
      final engine = JustAudioPlayerEngine.withAudioPlayer(
        mediaSessionAdapter: mediaSession,
        audioPlayer: audioPlayer,
      );
      addTearDown(engine.dispose);

      await engine.loadSong(song, quality: AudioQuality.k320);

      audioPlayer.emitDuration(const Duration(minutes: 5));
      await Future<void>.delayed(Duration.zero);

      expect(mediaSession.lastProgressDuration, const Duration(minutes: 5));
      expect(mediaSession.lastProgressPosition, Duration.zero);
    },
  );

  test('loadSong resets duration/position progress throttling state', () async {
    final audioPlayer = FakeAudioPlayerAdapter()
      ..emitDuration(const Duration(minutes: 5));
    final mediaSession = FakeMediaSessionAdapter();
    final engine = JustAudioPlayerEngine.withAudioPlayer(
      mediaSessionAdapter: mediaSession,
      audioPlayer: audioPlayer,
    );
    addTearDown(engine.dispose);

    await engine.loadSong(song, quality: AudioQuality.k320);

    audioPlayer.emitPosition(const Duration(seconds: 5));
    await Future<void>.delayed(Duration.zero);
    final firstSongPublishedCalls = mediaSession.progressUpdateCalls;

    await engine.loadSong(
      const Song(
        id: 'runtime-2',
        name: 'Another',
        artist: 'Another Artist',
        source: MusicSource.netease,
      ),
      quality: AudioQuality.k320,
    );

    audioPlayer.emitPosition(const Duration(seconds: 5));
    await Future<void>.delayed(Duration.zero);

    expect(
      mediaSession.progressUpdateCalls,
      greaterThan(firstSongPublishedCalls),
    );
    expect(mediaSession.lastProgressPosition, const Duration(seconds: 5));
  });
}
