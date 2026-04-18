import 'package:freezed_annotation/freezed_annotation.dart';

import '../../../core/models/song.dart';

part 'search_state.freezed.dart';

@freezed
abstract class SearchState with _$SearchState {
  const factory SearchState({
    @Default('') String query,
    @Default(<Song>[]) List<Song> results,
    @Default(false) bool isSearching,
    @Default('aggregate') String searchMode,
    @Default('netease') String selectedSource,
    @Default(false) bool includeExtendedSources,
    @Default(<String>[]) List<String> history,
    @Default(1) int page,
    @Default(true) bool hasMore,
    @Default('') String searchError,
  }) = _SearchState;
}
