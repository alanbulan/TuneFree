import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:just_audio/just_audio.dart';

import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';
import 'media_session_adapter.dart';
import 'player_engine.dart';

abstract class AudioPlayerAdapter {
  Stream<PlayerState> get playerStateStream;
  Stream<Duration> get positionStream;
  Stream<Duration?> get durationStream;
  Duration? get duration;
  Future<Duration?> setUrl(String url);
  Future<void> play();
  Future<void> pause();
  Future<void> seek(Duration position);
  Future<void> stop();
  Future<void> dispose();
}

final class JustAudioPlayerAdapter implements AudioPlayerAdapter {
  JustAudioPlayerAdapter(this._audioPlayer);

  final AudioPlayer _audioPlayer;

  @override
  Stream<PlayerState> get playerStateStream => _audioPlayer.playerStateStream;

  @override
  Stream<Duration> get positionStream => _audioPlayer.positionStream;

  @override
  Stream<Duration?> get durationStream => _audioPlayer.durationStream;

  @override
  Duration? get duration => _audioPlayer.duration;

  @override
  Future<Duration?> setUrl(String url) => _audioPlayer.setUrl(url);

  @override
  Future<void> play() => _audioPlayer.play();

  @override
  Future<void> pause() => _audioPlayer.pause();

  @override
  Future<void> seek(Duration position) => _audioPlayer.seek(position);

  @override
  Future<void> stop() => _audioPlayer.stop();

  @override
  Future<void> dispose() => _audioPlayer.dispose();
}

final class JustAudioPlayerEngine implements PlayerEngine {
  JustAudioPlayerEngine._({
    required MediaSessionAdapter mediaSessionAdapter,
    AudioPlayerAdapter? audioPlayer,
    bool testMode = false,
  }) : _mediaSessionAdapter = mediaSessionAdapter,
       _audioPlayer = audioPlayer,
       _testMode = testMode {
    if (!_testMode && _audioPlayer != null) {
      _bindAudioPlayerStreams();
    }
  }

  factory JustAudioPlayerEngine.real({
    MediaSessionAdapter? mediaSessionAdapter,
  }) {
    return JustAudioPlayerEngine._(
      mediaSessionAdapter: mediaSessionAdapter ?? NoopMediaSessionAdapter(),
      audioPlayer: JustAudioPlayerAdapter(AudioPlayer()),
    );
  }

  factory JustAudioPlayerEngine.withAudioPlayer({
    required MediaSessionAdapter mediaSessionAdapter,
    required AudioPlayerAdapter audioPlayer,
  }) {
    return JustAudioPlayerEngine._(
      mediaSessionAdapter: mediaSessionAdapter,
      audioPlayer: audioPlayer,
    );
  }

  factory JustAudioPlayerEngine.test() {
    return JustAudioPlayerEngine._(
      mediaSessionAdapter: NoopMediaSessionAdapter(),
      testMode: true,
    );
  }

  final MediaSessionAdapter _mediaSessionAdapter;
  final AudioPlayerAdapter? _audioPlayer;
  final bool _testMode;
  final StreamController<PlayerEngineSnapshot> _controller =
      StreamController<PlayerEngineSnapshot>.broadcast();
  final List<StreamSubscription<dynamic>> _subscriptions =
      <StreamSubscription<dynamic>>[];
  int _lastPublishedProgressSecond = -1;

  PlayerEngineSnapshot _latestSnapshot = const PlayerEngineSnapshot();

  @override
  Stream<PlayerEngineSnapshot> get snapshots => _controller.stream;

  @override
  PlayerEngineSnapshot get latestSnapshot => _latestSnapshot;

  @override
  Future<void> loadSong(Song song, {required AudioQuality quality}) async {
    _lastPublishedProgressSecond = -1;
    _emit(
      _latestSnapshot.copyWith(
        currentSong: song,
        audioQuality: quality,
        isLoading: true,
        isPlaying: false,
        position: Duration.zero,
        duration: Duration.zero,
        processingState: PlayerEngineProcessingState.loading,
      ),
    );

    if (_testMode) {
      _emit(
        _latestSnapshot.copyWith(
          isLoading: false,
          duration: const Duration(minutes: 4, seconds: 56),
          processingState: PlayerEngineProcessingState.ready,
        ),
      );
      return;
    }

    final url = song.url;
    if (url == null || url.isEmpty) {
      _emit(
        _latestSnapshot.copyWith(
          isLoading: false,
          processingState: PlayerEngineProcessingState.idle,
        ),
      );
      return;
    }

    await _runPlayerCall(() async {
      await _audioPlayer!.setUrl(url);
      _emit(
        _latestSnapshot.copyWith(
          isLoading: false,
          duration: _audioPlayer.duration ?? Duration.zero,
          processingState: PlayerEngineProcessingState.ready,
        ),
      );
      await _safeUpdateMetadata(song, isPlaying: false);
    });
  }

  @override
  Future<void> play() async {
    await _runPlayerCall(() async {
      if (_testMode) {
        _emit(_latestSnapshot.copyWith(isPlaying: true));
      } else {
        await _audioPlayer!.play();
      }

      final song = _latestSnapshot.currentSong;
      if (song != null) {
        await _safeUpdateMetadata(song, isPlaying: true);
      }
    });
  }

  @override
  Future<void> pause() async {
    await _runPlayerCall(() async {
      if (_testMode) {
        _emit(_latestSnapshot.copyWith(isPlaying: false));
      } else {
        await _audioPlayer!.pause();
      }

      final song = _latestSnapshot.currentSong;
      if (song != null) {
        await _safeUpdateMetadata(song, isPlaying: false);
      }
    });
  }

  @override
  Future<void> stop() async {
    await _runPlayerCall(() async {
      if (_testMode) {
        _emit(
          _latestSnapshot.copyWith(
            currentSong: null,
            isPlaying: false,
            isLoading: false,
            position: Duration.zero,
            duration: Duration.zero,
            processingState: PlayerEngineProcessingState.idle,
          ),
        );
        return;
      }

      await _audioPlayer!.stop();
      _emit(
        _latestSnapshot.copyWith(
          currentSong: null,
          isPlaying: false,
          isLoading: false,
          position: Duration.zero,
          duration: Duration.zero,
          processingState: PlayerEngineProcessingState.idle,
        ),
      );
    });
  }

  @override
  Future<void> seek(Duration position) async {
    await _runPlayerCall(() async {
      if (_testMode) {
        _emit(_latestSnapshot.copyWith(position: position));
      } else {
        await _audioPlayer!.seek(position);
      }

      await _safeUpdateProgress(
        position: position,
        duration: _latestSnapshot.duration,
      );
    });
  }

  @override
  Future<void> clearMediaSession() => _mediaSessionAdapter.clear();

  @override
  Future<void> setAudioQuality(AudioQuality quality) async {
    _emit(_latestSnapshot.copyWith(audioQuality: quality));
  }

  @override
  Future<void> dispose() async {
    for (final subscription in _subscriptions) {
      await subscription.cancel();
    }

    if (!_testMode && _audioPlayer != null) {
      await _audioPlayer.dispose();
    }

    await _controller.close();
  }

  void _bindAudioPlayerStreams() {
    _subscriptions.addAll([
      _audioPlayer!.playerStateStream.listen((state) {
        _emit(
          _latestSnapshot.copyWith(
            isPlaying: state.playing,
            isLoading: _isPlayerLoading(state.playing, state.processingState),
            processingState: _mapProcessingState(state.processingState),
          ),
        );
      }),
      _audioPlayer.positionStream.listen((position) {
        _emit(_latestSnapshot.copyWith(position: position));
        final second = position.inSeconds;
        if (second == _lastPublishedProgressSecond) {
          return;
        }
        _lastPublishedProgressSecond = second;
        unawaited(
          _safeUpdateProgress(
            position: position,
            duration: _latestSnapshot.duration,
          ),
        );
      }),
      _audioPlayer.durationStream.listen((duration) {
        _emit(_latestSnapshot.copyWith(duration: duration ?? Duration.zero));
        final normalizedDuration = duration ?? Duration.zero;
        unawaited(
          _safeUpdateProgress(
            position: _latestSnapshot.position,
            duration: normalizedDuration,
          ),
        );
      }),
    ]);
  }

  bool _isPlayerLoading(bool isPlaying, ProcessingState? processingState) {
    if (processingState == null) {
      return _latestSnapshot.isLoading && !isPlaying;
    }

    return switch (processingState) {
      ProcessingState.loading || ProcessingState.buffering => true,
      ProcessingState.idle ||
      ProcessingState.ready ||
      ProcessingState.completed => false,
    };
  }

  PlayerEngineProcessingState _mapProcessingState(
    ProcessingState? processingState,
  ) {
    if (processingState == null) {
      return _latestSnapshot.processingState;
    }

    return switch (processingState) {
      ProcessingState.idle => PlayerEngineProcessingState.idle,
      ProcessingState.loading ||
      ProcessingState.buffering => PlayerEngineProcessingState.loading,
      ProcessingState.ready => PlayerEngineProcessingState.ready,
      ProcessingState.completed => PlayerEngineProcessingState.completed,
    };
  }

  Future<void> _runPlayerCall(Future<void> Function() operation) async {
    try {
      await operation();
    } catch (_) {
      _emit(_latestSnapshot.copyWith(isLoading: false));
      rethrow;
    }
  }

  Future<void> _safeUpdateMetadata(Song song, {required bool isPlaying}) async {
    try {
      await _mediaSessionAdapter.updateMetadata(song, isPlaying: isPlaying);
    } catch (error, stackTrace) {
      debugPrint(
        'JustAudioPlayerEngine media session metadata sync failed: $error\n$stackTrace',
      );
    }
  }

  Future<void> _safeUpdateProgress({
    required Duration position,
    required Duration duration,
  }) async {
    try {
      await _mediaSessionAdapter.updateProgress(
        position: position,
        duration: duration,
      );
    } catch (error, stackTrace) {
      debugPrint(
        'JustAudioPlayerEngine media session progress sync failed: $error\n$stackTrace',
      );
    }
  }

  void _emit(PlayerEngineSnapshot snapshot) {
    _latestSnapshot = snapshot;
    _controller.add(snapshot);
  }
}
