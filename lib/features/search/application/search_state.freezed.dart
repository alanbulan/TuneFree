// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'search_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$SearchState {

 String get query; List<Song> get results; bool get isSearching; String get searchMode; String get selectedSource; bool get includeExtendedSources; List<String> get history; int get page; bool get hasMore; String get searchError;
/// Create a copy of SearchState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$SearchStateCopyWith<SearchState> get copyWith => _$SearchStateCopyWithImpl<SearchState>(this as SearchState, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is SearchState&&(identical(other.query, query) || other.query == query)&&const DeepCollectionEquality().equals(other.results, results)&&(identical(other.isSearching, isSearching) || other.isSearching == isSearching)&&(identical(other.searchMode, searchMode) || other.searchMode == searchMode)&&(identical(other.selectedSource, selectedSource) || other.selectedSource == selectedSource)&&(identical(other.includeExtendedSources, includeExtendedSources) || other.includeExtendedSources == includeExtendedSources)&&const DeepCollectionEquality().equals(other.history, history)&&(identical(other.page, page) || other.page == page)&&(identical(other.hasMore, hasMore) || other.hasMore == hasMore)&&(identical(other.searchError, searchError) || other.searchError == searchError));
}


@override
int get hashCode => Object.hash(runtimeType,query,const DeepCollectionEquality().hash(results),isSearching,searchMode,selectedSource,includeExtendedSources,const DeepCollectionEquality().hash(history),page,hasMore,searchError);

@override
String toString() {
  return 'SearchState(query: $query, results: $results, isSearching: $isSearching, searchMode: $searchMode, selectedSource: $selectedSource, includeExtendedSources: $includeExtendedSources, history: $history, page: $page, hasMore: $hasMore, searchError: $searchError)';
}


}

/// @nodoc
abstract mixin class $SearchStateCopyWith<$Res>  {
  factory $SearchStateCopyWith(SearchState value, $Res Function(SearchState) _then) = _$SearchStateCopyWithImpl;
@useResult
$Res call({
 String query, List<Song> results, bool isSearching, String searchMode, String selectedSource, bool includeExtendedSources, List<String> history, int page, bool hasMore, String searchError
});




}
/// @nodoc
class _$SearchStateCopyWithImpl<$Res>
    implements $SearchStateCopyWith<$Res> {
  _$SearchStateCopyWithImpl(this._self, this._then);

  final SearchState _self;
  final $Res Function(SearchState) _then;

/// Create a copy of SearchState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? query = null,Object? results = null,Object? isSearching = null,Object? searchMode = null,Object? selectedSource = null,Object? includeExtendedSources = null,Object? history = null,Object? page = null,Object? hasMore = null,Object? searchError = null,}) {
  return _then(_self.copyWith(
query: null == query ? _self.query : query // ignore: cast_nullable_to_non_nullable
as String,results: null == results ? _self.results : results // ignore: cast_nullable_to_non_nullable
as List<Song>,isSearching: null == isSearching ? _self.isSearching : isSearching // ignore: cast_nullable_to_non_nullable
as bool,searchMode: null == searchMode ? _self.searchMode : searchMode // ignore: cast_nullable_to_non_nullable
as String,selectedSource: null == selectedSource ? _self.selectedSource : selectedSource // ignore: cast_nullable_to_non_nullable
as String,includeExtendedSources: null == includeExtendedSources ? _self.includeExtendedSources : includeExtendedSources // ignore: cast_nullable_to_non_nullable
as bool,history: null == history ? _self.history : history // ignore: cast_nullable_to_non_nullable
as List<String>,page: null == page ? _self.page : page // ignore: cast_nullable_to_non_nullable
as int,hasMore: null == hasMore ? _self.hasMore : hasMore // ignore: cast_nullable_to_non_nullable
as bool,searchError: null == searchError ? _self.searchError : searchError // ignore: cast_nullable_to_non_nullable
as String,
  ));
}

}


/// Adds pattern-matching-related methods to [SearchState].
extension SearchStatePatterns on SearchState {
/// A variant of `map` that fallback to returning `orElse`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _SearchState value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _SearchState() when $default != null:
return $default(_that);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// Callbacks receives the raw object, upcasted.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case final Subclass2 value:
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _SearchState value)  $default,){
final _that = this;
switch (_that) {
case _SearchState():
return $default(_that);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `map` that fallback to returning `null`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _SearchState value)?  $default,){
final _that = this;
switch (_that) {
case _SearchState() when $default != null:
return $default(_that);case _:
  return null;

}
}
/// A variant of `when` that fallback to an `orElse` callback.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String query,  List<Song> results,  bool isSearching,  String searchMode,  String selectedSource,  bool includeExtendedSources,  List<String> history,  int page,  bool hasMore,  String searchError)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _SearchState() when $default != null:
return $default(_that.query,_that.results,_that.isSearching,_that.searchMode,_that.selectedSource,_that.includeExtendedSources,_that.history,_that.page,_that.hasMore,_that.searchError);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// As opposed to `map`, this offers destructuring.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case Subclass2(:final field2):
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String query,  List<Song> results,  bool isSearching,  String searchMode,  String selectedSource,  bool includeExtendedSources,  List<String> history,  int page,  bool hasMore,  String searchError)  $default,) {final _that = this;
switch (_that) {
case _SearchState():
return $default(_that.query,_that.results,_that.isSearching,_that.searchMode,_that.selectedSource,_that.includeExtendedSources,_that.history,_that.page,_that.hasMore,_that.searchError);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `when` that fallback to returning `null`
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String query,  List<Song> results,  bool isSearching,  String searchMode,  String selectedSource,  bool includeExtendedSources,  List<String> history,  int page,  bool hasMore,  String searchError)?  $default,) {final _that = this;
switch (_that) {
case _SearchState() when $default != null:
return $default(_that.query,_that.results,_that.isSearching,_that.searchMode,_that.selectedSource,_that.includeExtendedSources,_that.history,_that.page,_that.hasMore,_that.searchError);case _:
  return null;

}
}

}

/// @nodoc


class _SearchState implements SearchState {
  const _SearchState({this.query = '', final  List<Song> results = const <Song>[], this.isSearching = false, this.searchMode = 'aggregate', this.selectedSource = 'netease', this.includeExtendedSources = false, final  List<String> history = const <String>[], this.page = 1, this.hasMore = true, this.searchError = ''}): _results = results,_history = history;
  

@override@JsonKey() final  String query;
 final  List<Song> _results;
@override@JsonKey() List<Song> get results {
  if (_results is EqualUnmodifiableListView) return _results;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_results);
}

@override@JsonKey() final  bool isSearching;
@override@JsonKey() final  String searchMode;
@override@JsonKey() final  String selectedSource;
@override@JsonKey() final  bool includeExtendedSources;
 final  List<String> _history;
@override@JsonKey() List<String> get history {
  if (_history is EqualUnmodifiableListView) return _history;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_history);
}

@override@JsonKey() final  int page;
@override@JsonKey() final  bool hasMore;
@override@JsonKey() final  String searchError;

/// Create a copy of SearchState
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$SearchStateCopyWith<_SearchState> get copyWith => __$SearchStateCopyWithImpl<_SearchState>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _SearchState&&(identical(other.query, query) || other.query == query)&&const DeepCollectionEquality().equals(other._results, _results)&&(identical(other.isSearching, isSearching) || other.isSearching == isSearching)&&(identical(other.searchMode, searchMode) || other.searchMode == searchMode)&&(identical(other.selectedSource, selectedSource) || other.selectedSource == selectedSource)&&(identical(other.includeExtendedSources, includeExtendedSources) || other.includeExtendedSources == includeExtendedSources)&&const DeepCollectionEquality().equals(other._history, _history)&&(identical(other.page, page) || other.page == page)&&(identical(other.hasMore, hasMore) || other.hasMore == hasMore)&&(identical(other.searchError, searchError) || other.searchError == searchError));
}


@override
int get hashCode => Object.hash(runtimeType,query,const DeepCollectionEquality().hash(_results),isSearching,searchMode,selectedSource,includeExtendedSources,const DeepCollectionEquality().hash(_history),page,hasMore,searchError);

@override
String toString() {
  return 'SearchState(query: $query, results: $results, isSearching: $isSearching, searchMode: $searchMode, selectedSource: $selectedSource, includeExtendedSources: $includeExtendedSources, history: $history, page: $page, hasMore: $hasMore, searchError: $searchError)';
}


}

/// @nodoc
abstract mixin class _$SearchStateCopyWith<$Res> implements $SearchStateCopyWith<$Res> {
  factory _$SearchStateCopyWith(_SearchState value, $Res Function(_SearchState) _then) = __$SearchStateCopyWithImpl;
@override @useResult
$Res call({
 String query, List<Song> results, bool isSearching, String searchMode, String selectedSource, bool includeExtendedSources, List<String> history, int page, bool hasMore, String searchError
});




}
/// @nodoc
class __$SearchStateCopyWithImpl<$Res>
    implements _$SearchStateCopyWith<$Res> {
  __$SearchStateCopyWithImpl(this._self, this._then);

  final _SearchState _self;
  final $Res Function(_SearchState) _then;

/// Create a copy of SearchState
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? query = null,Object? results = null,Object? isSearching = null,Object? searchMode = null,Object? selectedSource = null,Object? includeExtendedSources = null,Object? history = null,Object? page = null,Object? hasMore = null,Object? searchError = null,}) {
  return _then(_SearchState(
query: null == query ? _self.query : query // ignore: cast_nullable_to_non_nullable
as String,results: null == results ? _self._results : results // ignore: cast_nullable_to_non_nullable
as List<Song>,isSearching: null == isSearching ? _self.isSearching : isSearching // ignore: cast_nullable_to_non_nullable
as bool,searchMode: null == searchMode ? _self.searchMode : searchMode // ignore: cast_nullable_to_non_nullable
as String,selectedSource: null == selectedSource ? _self.selectedSource : selectedSource // ignore: cast_nullable_to_non_nullable
as String,includeExtendedSources: null == includeExtendedSources ? _self.includeExtendedSources : includeExtendedSources // ignore: cast_nullable_to_non_nullable
as bool,history: null == history ? _self._history : history // ignore: cast_nullable_to_non_nullable
as List<String>,page: null == page ? _self.page : page // ignore: cast_nullable_to_non_nullable
as int,hasMore: null == hasMore ? _self.hasMore : hasMore // ignore: cast_nullable_to_non_nullable
as bool,searchError: null == searchError ? _self.searchError : searchError // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

// dart format on
