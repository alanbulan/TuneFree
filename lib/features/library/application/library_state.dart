import 'package:freezed_annotation/freezed_annotation.dart';

import '../../../core/models/playlist.dart';
import '../../../core/models/song.dart';
import '../../player/data/download_library_repository.dart';

part 'library_state.freezed.dart';

@freezed
abstract class LibraryState with _$LibraryState {
  const factory LibraryState({
    @Default(<Song>[]) List<Song> favorites,
    @Default(<Playlist>[]) List<Playlist> playlists,
    @Default('') String apiKey,
    @Default('') String corsProxy,
    @Default('') String apiBase,
    String? exportedBackupJson,
    String? lastImportSummary,
    @Default(<DownloadedTrackItem>[]) List<DownloadedTrackItem> downloads,
    @Default('all') String downloadFilter,
    @Default(false) bool isLoaded,
  }) = _LibraryState;
}
