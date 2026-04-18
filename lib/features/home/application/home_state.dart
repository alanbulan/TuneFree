import 'package:freezed_annotation/freezed_annotation.dart';

import '../../../core/models/song.dart';
import '../../../core/models/top_list.dart';

part 'home_state.freezed.dart';

@freezed
abstract class HomeState with _$HomeState {
  const factory HomeState({
    @Default('netease') String activeSource,
    @Default(<TopList>[]) List<TopList> topLists,
    @Default(<Song>[]) List<Song> featuredSongs,
    @Default(false) bool listsLoading,
    @Default(false) bool songsLoading,
    @Default(false) bool hasError,
  }) = _HomeState;
}
