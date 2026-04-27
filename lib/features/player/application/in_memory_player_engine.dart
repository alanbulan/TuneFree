import 'dart:async';

import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';
import '../domain/player_track.dart';
import 'player_engine.dart';

class InMemoryPlayerEngine implements PlayerEngine {
  InMemoryPlayerEngine();

  final StreamController<PlayerEngineSnapshot> _controller =
      StreamController<PlayerEngineSnapshot>.broadcast();
  PlayerEngineSnapshot _snapshot = const PlayerEngineSnapshot();
  PlayerTrack? _currentTrack;

  @override
  Stream<PlayerEngineSnapshot> get snapshots => _controller.stream;

  @override
  PlayerEngineSnapshot get latestSnapshot => _snapshot;

  @override
  Future<void> loadSong(Song song, {required AudioQuality quality}) async {
    _currentTrack = PlayerTrack(
      id: song.id,
      source: song.source.wireValue,
      title: song.name,
      artist: song.artist,
      artworkUrl: song.pic,
      streamUrl: song.url,
      lyrics: song.lrc,
    );
    _snapshot = _snapshot.copyWith(
      currentSong: song,
      audioQuality: quality,
      isLoading: false,
      isPlaying: false,
      position: Duration.zero,
      duration: const Duration(minutes: 3, seconds: 12),
      processingState: PlayerEngineProcessingState.ready,
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
    if (_currentTrack == null) {
      return;
    }
    _snapshot = _snapshot.copyWith(
      isPlaying: true,
      processingState: PlayerEngineProcessingState.ready,
    );
    _controller.add(_snapshot);
  }

  @override
  Future<void> seek(Duration position) async {
    _snapshot = _snapshot.copyWith(position: position);
    _controller.add(_snapshot);
  }

  @override
  Future<void> clearMediaSession() async {}

  @override
  Future<void> stop() async {
    _snapshot = const PlayerEngineSnapshot();
    _controller.add(_snapshot);
    _currentTrack = null;
  }

  @override
  Future<void> setAudioQuality(AudioQuality quality) async {
    final currentSong = _snapshot.currentSong;
    _snapshot = _snapshot.copyWith(
      audioQuality: quality,
      currentSong: currentSong,
    );
    _controller.add(_snapshot);
  }

  @override
  Future<void> dispose() async {
    await _controller.close();
  }
}
