import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';

enum PlayerEngineProcessingState { idle, loading, ready, completed }

class PlayerEngineSnapshot {
  const PlayerEngineSnapshot({
    this.currentSong,
    this.isLoading = false,
    this.isPlaying = false,
    this.position = Duration.zero,
    this.duration = Duration.zero,
    this.audioQuality = AudioQuality.k320,
    this.processingState = PlayerEngineProcessingState.idle,
  });

  static const Object _currentSongUnchanged = Object();

  final Song? currentSong;
  final bool isLoading;
  final bool isPlaying;
  final Duration position;
  final Duration duration;
  final AudioQuality audioQuality;
  final PlayerEngineProcessingState processingState;

  PlayerEngineSnapshot copyWith({
    Object? currentSong = _currentSongUnchanged,
    bool? isLoading,
    bool? isPlaying,
    Duration? position,
    Duration? duration,
    AudioQuality? audioQuality,
    PlayerEngineProcessingState? processingState,
  }) {
    return PlayerEngineSnapshot(
      currentSong: identical(currentSong, _currentSongUnchanged)
          ? this.currentSong
          : currentSong as Song?,
      isLoading: isLoading ?? this.isLoading,
      isPlaying: isPlaying ?? this.isPlaying,
      position: position ?? this.position,
      duration: duration ?? this.duration,
      audioQuality: audioQuality ?? this.audioQuality,
      processingState: processingState ?? this.processingState,
    );
  }
}

abstract class PlayerEngine {
  Stream<PlayerEngineSnapshot> get snapshots;
  PlayerEngineSnapshot get latestSnapshot;
  Future<void> loadSong(Song song, {required AudioQuality quality});
  Future<void> play();
  Future<void> pause();
  Future<void> seek(Duration position);
  Future<void> stop();
  Future<void> clearMediaSession();
  Future<void> setAudioQuality(AudioQuality quality);
  Future<void> dispose();
}
