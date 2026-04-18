import 'package:freezed_annotation/freezed_annotation.dart';

part 'player_track.freezed.dart';

@freezed
abstract class PlayerTrack with _$PlayerTrack {
  const factory PlayerTrack({
    required String id,
    required String source,
    required String title,
    required String artist,
    String? artworkUrl,
    String? streamUrl,
    String? lyrics,
  }) = _PlayerTrack;
}
