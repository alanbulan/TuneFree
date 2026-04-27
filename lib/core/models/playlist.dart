import 'package:freezed_annotation/freezed_annotation.dart';

import 'song.dart';

part 'playlist.freezed.dart';
part 'playlist.g.dart';

@freezed
abstract class Playlist with _$Playlist {
  const factory Playlist({
    required String id,
    required String name,
    required int createTime,
    @Default(<Song>[]) List<Song> songs,
  }) = _Playlist;

  factory Playlist.fromJson(Map<String, dynamic> json) => _$PlaylistFromJson(json);
}
