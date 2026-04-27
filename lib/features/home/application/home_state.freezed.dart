// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'home_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$HomeState {

 String get activeSource; List<TopList> get topLists; List<Song> get featuredSongs; bool get listsLoading; bool get songsLoading; bool get hasError;
/// Create a copy of HomeState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$HomeStateCopyWith<HomeState> get copyWith => _$HomeStateCopyWithImpl<HomeState>(this as HomeState, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is HomeState&&(identical(other.activeSource, activeSource) || other.activeSource == activeSource)&&const DeepCollectionEquality().equals(other.topLists, topLists)&&const DeepCollectionEquality().equals(other.featuredSongs, featuredSongs)&&(identical(other.listsLoading, listsLoading) || other.listsLoading == listsLoading)&&(identical(other.songsLoading, songsLoading) || other.songsLoading == songsLoading)&&(identical(other.hasError, hasError) || other.hasError == hasError));
}


@override
int get hashCode => Object.hash(runtimeType,activeSource,const DeepCollectionEquality().hash(topLists),const DeepCollectionEquality().hash(featuredSongs),listsLoading,songsLoading,hasError);

@override
String toString() {
  return 'HomeState(activeSource: $activeSource, topLists: $topLists, featuredSongs: $featuredSongs, listsLoading: $listsLoading, songsLoading: $songsLoading, hasError: $hasError)';
}


}

/// @nodoc
abstract mixin class $HomeStateCopyWith<$Res>  {
  factory $HomeStateCopyWith(HomeState value, $Res Function(HomeState) _then) = _$HomeStateCopyWithImpl;
@useResult
$Res call({
 String activeSource, List<TopList> topLists, List<Song> featuredSongs, bool listsLoading, bool songsLoading, bool hasError
});




}
/// @nodoc
class _$HomeStateCopyWithImpl<$Res>
    implements $HomeStateCopyWith<$Res> {
  _$HomeStateCopyWithImpl(this._self, this._then);

  final HomeState _self;
  final $Res Function(HomeState) _then;

/// Create a copy of HomeState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? activeSource = null,Object? topLists = null,Object? featuredSongs = null,Object? listsLoading = null,Object? songsLoading = null,Object? hasError = null,}) {
  return _then(_self.copyWith(
activeSource: null == activeSource ? _self.activeSource : activeSource // ignore: cast_nullable_to_non_nullable
as String,topLists: null == topLists ? _self.topLists : topLists // ignore: cast_nullable_to_non_nullable
as List<TopList>,featuredSongs: null == featuredSongs ? _self.featuredSongs : featuredSongs // ignore: cast_nullable_to_non_nullable
as List<Song>,listsLoading: null == listsLoading ? _self.listsLoading : listsLoading // ignore: cast_nullable_to_non_nullable
as bool,songsLoading: null == songsLoading ? _self.songsLoading : songsLoading // ignore: cast_nullable_to_non_nullable
as bool,hasError: null == hasError ? _self.hasError : hasError // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}

}


/// Adds pattern-matching-related methods to [HomeState].
extension HomeStatePatterns on HomeState {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _HomeState value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _HomeState() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _HomeState value)  $default,){
final _that = this;
switch (_that) {
case _HomeState():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _HomeState value)?  $default,){
final _that = this;
switch (_that) {
case _HomeState() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String activeSource,  List<TopList> topLists,  List<Song> featuredSongs,  bool listsLoading,  bool songsLoading,  bool hasError)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _HomeState() when $default != null:
return $default(_that.activeSource,_that.topLists,_that.featuredSongs,_that.listsLoading,_that.songsLoading,_that.hasError);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String activeSource,  List<TopList> topLists,  List<Song> featuredSongs,  bool listsLoading,  bool songsLoading,  bool hasError)  $default,) {final _that = this;
switch (_that) {
case _HomeState():
return $default(_that.activeSource,_that.topLists,_that.featuredSongs,_that.listsLoading,_that.songsLoading,_that.hasError);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String activeSource,  List<TopList> topLists,  List<Song> featuredSongs,  bool listsLoading,  bool songsLoading,  bool hasError)?  $default,) {final _that = this;
switch (_that) {
case _HomeState() when $default != null:
return $default(_that.activeSource,_that.topLists,_that.featuredSongs,_that.listsLoading,_that.songsLoading,_that.hasError);case _:
  return null;

}
}

}

/// @nodoc


class _HomeState implements HomeState {
  const _HomeState({this.activeSource = 'netease', final  List<TopList> topLists = const <TopList>[], final  List<Song> featuredSongs = const <Song>[], this.listsLoading = false, this.songsLoading = false, this.hasError = false}): _topLists = topLists,_featuredSongs = featuredSongs;
  

@override@JsonKey() final  String activeSource;
 final  List<TopList> _topLists;
@override@JsonKey() List<TopList> get topLists {
  if (_topLists is EqualUnmodifiableListView) return _topLists;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_topLists);
}

 final  List<Song> _featuredSongs;
@override@JsonKey() List<Song> get featuredSongs {
  if (_featuredSongs is EqualUnmodifiableListView) return _featuredSongs;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_featuredSongs);
}

@override@JsonKey() final  bool listsLoading;
@override@JsonKey() final  bool songsLoading;
@override@JsonKey() final  bool hasError;

/// Create a copy of HomeState
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$HomeStateCopyWith<_HomeState> get copyWith => __$HomeStateCopyWithImpl<_HomeState>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _HomeState&&(identical(other.activeSource, activeSource) || other.activeSource == activeSource)&&const DeepCollectionEquality().equals(other._topLists, _topLists)&&const DeepCollectionEquality().equals(other._featuredSongs, _featuredSongs)&&(identical(other.listsLoading, listsLoading) || other.listsLoading == listsLoading)&&(identical(other.songsLoading, songsLoading) || other.songsLoading == songsLoading)&&(identical(other.hasError, hasError) || other.hasError == hasError));
}


@override
int get hashCode => Object.hash(runtimeType,activeSource,const DeepCollectionEquality().hash(_topLists),const DeepCollectionEquality().hash(_featuredSongs),listsLoading,songsLoading,hasError);

@override
String toString() {
  return 'HomeState(activeSource: $activeSource, topLists: $topLists, featuredSongs: $featuredSongs, listsLoading: $listsLoading, songsLoading: $songsLoading, hasError: $hasError)';
}


}

/// @nodoc
abstract mixin class _$HomeStateCopyWith<$Res> implements $HomeStateCopyWith<$Res> {
  factory _$HomeStateCopyWith(_HomeState value, $Res Function(_HomeState) _then) = __$HomeStateCopyWithImpl;
@override @useResult
$Res call({
 String activeSource, List<TopList> topLists, List<Song> featuredSongs, bool listsLoading, bool songsLoading, bool hasError
});




}
/// @nodoc
class __$HomeStateCopyWithImpl<$Res>
    implements _$HomeStateCopyWith<$Res> {
  __$HomeStateCopyWithImpl(this._self, this._then);

  final _HomeState _self;
  final $Res Function(_HomeState) _then;

/// Create a copy of HomeState
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? activeSource = null,Object? topLists = null,Object? featuredSongs = null,Object? listsLoading = null,Object? songsLoading = null,Object? hasError = null,}) {
  return _then(_HomeState(
activeSource: null == activeSource ? _self.activeSource : activeSource // ignore: cast_nullable_to_non_nullable
as String,topLists: null == topLists ? _self._topLists : topLists // ignore: cast_nullable_to_non_nullable
as List<TopList>,featuredSongs: null == featuredSongs ? _self._featuredSongs : featuredSongs // ignore: cast_nullable_to_non_nullable
as List<Song>,listsLoading: null == listsLoading ? _self.listsLoading : listsLoading // ignore: cast_nullable_to_non_nullable
as bool,songsLoading: null == songsLoading ? _self.songsLoading : songsLoading // ignore: cast_nullable_to_non_nullable
as bool,hasError: null == hasError ? _self.hasError : hasError // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}


}

// dart format on
