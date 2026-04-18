// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'library_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$LibraryState {

 List<Song> get favorites; List<Playlist> get playlists; String get apiKey; String get corsProxy; String get apiBase; String? get exportedBackupJson; String? get lastImportSummary; List<DownloadedTrackItem> get downloads; String get downloadFilter; bool get isLoaded;
/// Create a copy of LibraryState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$LibraryStateCopyWith<LibraryState> get copyWith => _$LibraryStateCopyWithImpl<LibraryState>(this as LibraryState, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is LibraryState&&const DeepCollectionEquality().equals(other.favorites, favorites)&&const DeepCollectionEquality().equals(other.playlists, playlists)&&(identical(other.apiKey, apiKey) || other.apiKey == apiKey)&&(identical(other.corsProxy, corsProxy) || other.corsProxy == corsProxy)&&(identical(other.apiBase, apiBase) || other.apiBase == apiBase)&&(identical(other.exportedBackupJson, exportedBackupJson) || other.exportedBackupJson == exportedBackupJson)&&(identical(other.lastImportSummary, lastImportSummary) || other.lastImportSummary == lastImportSummary)&&const DeepCollectionEquality().equals(other.downloads, downloads)&&(identical(other.downloadFilter, downloadFilter) || other.downloadFilter == downloadFilter)&&(identical(other.isLoaded, isLoaded) || other.isLoaded == isLoaded));
}


@override
int get hashCode => Object.hash(runtimeType,const DeepCollectionEquality().hash(favorites),const DeepCollectionEquality().hash(playlists),apiKey,corsProxy,apiBase,exportedBackupJson,lastImportSummary,const DeepCollectionEquality().hash(downloads),downloadFilter,isLoaded);

@override
String toString() {
  return 'LibraryState(favorites: $favorites, playlists: $playlists, apiKey: $apiKey, corsProxy: $corsProxy, apiBase: $apiBase, exportedBackupJson: $exportedBackupJson, lastImportSummary: $lastImportSummary, downloads: $downloads, downloadFilter: $downloadFilter, isLoaded: $isLoaded)';
}


}

/// @nodoc
abstract mixin class $LibraryStateCopyWith<$Res>  {
  factory $LibraryStateCopyWith(LibraryState value, $Res Function(LibraryState) _then) = _$LibraryStateCopyWithImpl;
@useResult
$Res call({
 List<Song> favorites, List<Playlist> playlists, String apiKey, String corsProxy, String apiBase, String? exportedBackupJson, String? lastImportSummary, List<DownloadedTrackItem> downloads, String downloadFilter, bool isLoaded
});




}
/// @nodoc
class _$LibraryStateCopyWithImpl<$Res>
    implements $LibraryStateCopyWith<$Res> {
  _$LibraryStateCopyWithImpl(this._self, this._then);

  final LibraryState _self;
  final $Res Function(LibraryState) _then;

/// Create a copy of LibraryState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? favorites = null,Object? playlists = null,Object? apiKey = null,Object? corsProxy = null,Object? apiBase = null,Object? exportedBackupJson = freezed,Object? lastImportSummary = freezed,Object? downloads = null,Object? downloadFilter = null,Object? isLoaded = null,}) {
  return _then(_self.copyWith(
favorites: null == favorites ? _self.favorites : favorites // ignore: cast_nullable_to_non_nullable
as List<Song>,playlists: null == playlists ? _self.playlists : playlists // ignore: cast_nullable_to_non_nullable
as List<Playlist>,apiKey: null == apiKey ? _self.apiKey : apiKey // ignore: cast_nullable_to_non_nullable
as String,corsProxy: null == corsProxy ? _self.corsProxy : corsProxy // ignore: cast_nullable_to_non_nullable
as String,apiBase: null == apiBase ? _self.apiBase : apiBase // ignore: cast_nullable_to_non_nullable
as String,exportedBackupJson: freezed == exportedBackupJson ? _self.exportedBackupJson : exportedBackupJson // ignore: cast_nullable_to_non_nullable
as String?,lastImportSummary: freezed == lastImportSummary ? _self.lastImportSummary : lastImportSummary // ignore: cast_nullable_to_non_nullable
as String?,downloads: null == downloads ? _self.downloads : downloads // ignore: cast_nullable_to_non_nullable
as List<DownloadedTrackItem>,downloadFilter: null == downloadFilter ? _self.downloadFilter : downloadFilter // ignore: cast_nullable_to_non_nullable
as String,isLoaded: null == isLoaded ? _self.isLoaded : isLoaded // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}

}


/// Adds pattern-matching-related methods to [LibraryState].
extension LibraryStatePatterns on LibraryState {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _LibraryState value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _LibraryState() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _LibraryState value)  $default,){
final _that = this;
switch (_that) {
case _LibraryState():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _LibraryState value)?  $default,){
final _that = this;
switch (_that) {
case _LibraryState() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( List<Song> favorites,  List<Playlist> playlists,  String apiKey,  String corsProxy,  String apiBase,  String? exportedBackupJson,  String? lastImportSummary,  List<DownloadedTrackItem> downloads,  String downloadFilter,  bool isLoaded)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _LibraryState() when $default != null:
return $default(_that.favorites,_that.playlists,_that.apiKey,_that.corsProxy,_that.apiBase,_that.exportedBackupJson,_that.lastImportSummary,_that.downloads,_that.downloadFilter,_that.isLoaded);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( List<Song> favorites,  List<Playlist> playlists,  String apiKey,  String corsProxy,  String apiBase,  String? exportedBackupJson,  String? lastImportSummary,  List<DownloadedTrackItem> downloads,  String downloadFilter,  bool isLoaded)  $default,) {final _that = this;
switch (_that) {
case _LibraryState():
return $default(_that.favorites,_that.playlists,_that.apiKey,_that.corsProxy,_that.apiBase,_that.exportedBackupJson,_that.lastImportSummary,_that.downloads,_that.downloadFilter,_that.isLoaded);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( List<Song> favorites,  List<Playlist> playlists,  String apiKey,  String corsProxy,  String apiBase,  String? exportedBackupJson,  String? lastImportSummary,  List<DownloadedTrackItem> downloads,  String downloadFilter,  bool isLoaded)?  $default,) {final _that = this;
switch (_that) {
case _LibraryState() when $default != null:
return $default(_that.favorites,_that.playlists,_that.apiKey,_that.corsProxy,_that.apiBase,_that.exportedBackupJson,_that.lastImportSummary,_that.downloads,_that.downloadFilter,_that.isLoaded);case _:
  return null;

}
}

}

/// @nodoc


class _LibraryState implements LibraryState {
  const _LibraryState({final  List<Song> favorites = const <Song>[], final  List<Playlist> playlists = const <Playlist>[], this.apiKey = '', this.corsProxy = '', this.apiBase = '', this.exportedBackupJson, this.lastImportSummary, final  List<DownloadedTrackItem> downloads = const <DownloadedTrackItem>[], this.downloadFilter = 'all', this.isLoaded = false}): _favorites = favorites,_playlists = playlists,_downloads = downloads;
  

 final  List<Song> _favorites;
@override@JsonKey() List<Song> get favorites {
  if (_favorites is EqualUnmodifiableListView) return _favorites;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_favorites);
}

 final  List<Playlist> _playlists;
@override@JsonKey() List<Playlist> get playlists {
  if (_playlists is EqualUnmodifiableListView) return _playlists;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_playlists);
}

@override@JsonKey() final  String apiKey;
@override@JsonKey() final  String corsProxy;
@override@JsonKey() final  String apiBase;
@override final  String? exportedBackupJson;
@override final  String? lastImportSummary;
 final  List<DownloadedTrackItem> _downloads;
@override@JsonKey() List<DownloadedTrackItem> get downloads {
  if (_downloads is EqualUnmodifiableListView) return _downloads;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_downloads);
}

@override@JsonKey() final  String downloadFilter;
@override@JsonKey() final  bool isLoaded;

/// Create a copy of LibraryState
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$LibraryStateCopyWith<_LibraryState> get copyWith => __$LibraryStateCopyWithImpl<_LibraryState>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _LibraryState&&const DeepCollectionEquality().equals(other._favorites, _favorites)&&const DeepCollectionEquality().equals(other._playlists, _playlists)&&(identical(other.apiKey, apiKey) || other.apiKey == apiKey)&&(identical(other.corsProxy, corsProxy) || other.corsProxy == corsProxy)&&(identical(other.apiBase, apiBase) || other.apiBase == apiBase)&&(identical(other.exportedBackupJson, exportedBackupJson) || other.exportedBackupJson == exportedBackupJson)&&(identical(other.lastImportSummary, lastImportSummary) || other.lastImportSummary == lastImportSummary)&&const DeepCollectionEquality().equals(other._downloads, _downloads)&&(identical(other.downloadFilter, downloadFilter) || other.downloadFilter == downloadFilter)&&(identical(other.isLoaded, isLoaded) || other.isLoaded == isLoaded));
}


@override
int get hashCode => Object.hash(runtimeType,const DeepCollectionEquality().hash(_favorites),const DeepCollectionEquality().hash(_playlists),apiKey,corsProxy,apiBase,exportedBackupJson,lastImportSummary,const DeepCollectionEquality().hash(_downloads),downloadFilter,isLoaded);

@override
String toString() {
  return 'LibraryState(favorites: $favorites, playlists: $playlists, apiKey: $apiKey, corsProxy: $corsProxy, apiBase: $apiBase, exportedBackupJson: $exportedBackupJson, lastImportSummary: $lastImportSummary, downloads: $downloads, downloadFilter: $downloadFilter, isLoaded: $isLoaded)';
}


}

/// @nodoc
abstract mixin class _$LibraryStateCopyWith<$Res> implements $LibraryStateCopyWith<$Res> {
  factory _$LibraryStateCopyWith(_LibraryState value, $Res Function(_LibraryState) _then) = __$LibraryStateCopyWithImpl;
@override @useResult
$Res call({
 List<Song> favorites, List<Playlist> playlists, String apiKey, String corsProxy, String apiBase, String? exportedBackupJson, String? lastImportSummary, List<DownloadedTrackItem> downloads, String downloadFilter, bool isLoaded
});




}
/// @nodoc
class __$LibraryStateCopyWithImpl<$Res>
    implements _$LibraryStateCopyWith<$Res> {
  __$LibraryStateCopyWithImpl(this._self, this._then);

  final _LibraryState _self;
  final $Res Function(_LibraryState) _then;

/// Create a copy of LibraryState
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? favorites = null,Object? playlists = null,Object? apiKey = null,Object? corsProxy = null,Object? apiBase = null,Object? exportedBackupJson = freezed,Object? lastImportSummary = freezed,Object? downloads = null,Object? downloadFilter = null,Object? isLoaded = null,}) {
  return _then(_LibraryState(
favorites: null == favorites ? _self._favorites : favorites // ignore: cast_nullable_to_non_nullable
as List<Song>,playlists: null == playlists ? _self._playlists : playlists // ignore: cast_nullable_to_non_nullable
as List<Playlist>,apiKey: null == apiKey ? _self.apiKey : apiKey // ignore: cast_nullable_to_non_nullable
as String,corsProxy: null == corsProxy ? _self.corsProxy : corsProxy // ignore: cast_nullable_to_non_nullable
as String,apiBase: null == apiBase ? _self.apiBase : apiBase // ignore: cast_nullable_to_non_nullable
as String,exportedBackupJson: freezed == exportedBackupJson ? _self.exportedBackupJson : exportedBackupJson // ignore: cast_nullable_to_non_nullable
as String?,lastImportSummary: freezed == lastImportSummary ? _self.lastImportSummary : lastImportSummary // ignore: cast_nullable_to_non_nullable
as String?,downloads: null == downloads ? _self._downloads : downloads // ignore: cast_nullable_to_non_nullable
as List<DownloadedTrackItem>,downloadFilter: null == downloadFilter ? _self.downloadFilter : downloadFilter // ignore: cast_nullable_to_non_nullable
as String,isLoaded: null == isLoaded ? _self.isLoaded : isLoaded // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}


}

// dart format on
