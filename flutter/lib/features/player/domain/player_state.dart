import 'package:freezed_annotation/freezed_annotation.dart';

import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';
import 'play_mode.dart';
import 'player_track.dart';

part 'player_state.freezed.dart';

@freezed
abstract class PlayerState with _$PlayerState {
  const PlayerState._();

  const factory PlayerState({
    Song? currentSong,
    @Default(<Song>[]) List<Song> queue,
    @Default(false) bool isPlaying,
    @Default(false) bool isLoading,
    @Default(Duration.zero) Duration position,
    @Default(Duration.zero) Duration duration,
    @Default('sequence') String playMode,
    @Default(AudioQuality.k320) AudioQuality audioQuality,
    @Default(AudioQuality.k320) AudioQuality downloadQuality,
    @Default(false) bool isExpanded,
    @Default(false) bool showLyrics,
    @Default(false) bool showQueue,
    @Default(false) bool showDownload,
    @Default(false) bool showMore,
  }) = _PlayerState;

  PlayerTrack? get currentTrack {
    final song = currentSong;
    if (song == null) {
      return null;
    }

    return _trackFromSong(song);
  }

  List<PlayerTrack> get queueTracks =>
      queue.map(_trackFromSong).toList(growable: false);

  PlayMode get playModeEnum => switch (playMode) {
    'loop' => PlayMode.loop,
    'shuffle' => PlayMode.shuffle,
    _ => PlayMode.sequence,
  };

  AudioQuality get playbackQuality => audioQuality;

  PlayerTrack _trackFromSong(Song song) {
    return PlayerTrack(
      id: song.id,
      source: song.source.wireValue,
      title: song.name,
      artist: song.artist,
      artworkUrl: song.pic,
      streamUrl: song.url,
      lyrics: song.lrc,
    );
  }
}
