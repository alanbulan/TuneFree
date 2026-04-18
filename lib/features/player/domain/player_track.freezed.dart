// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'player_track.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$PlayerTrack {

 String get id; String get source; String get title; String get artist; String? get artworkUrl; String? get streamUrl; String? get lyrics;
/// Create a copy of PlayerTrack
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$PlayerTrackCopyWith<PlayerTrack> get copyWith => _$PlayerTrackCopyWithImpl<PlayerTrack>(this as PlayerTrack, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is PlayerTrack&&(identical(other.id, id) || other.id == id)&&(identical(other.source, source) || other.source == source)&&(identical(other.title, title) || other.title == title)&&(identical(other.artist, artist) || other.artist == artist)&&(identical(other.artworkUrl, artworkUrl) || other.artworkUrl == artworkUrl)&&(identical(other.streamUrl, streamUrl) || other.streamUrl == streamUrl)&&(identical(other.lyrics, lyrics) || other.lyrics == lyrics));
}


@override
int get hashCode => Object.hash(runtimeType,id,source,title,artist,artworkUrl,streamUrl,lyrics);

@override
String toString() {
  return 'PlayerTrack(id: $id, source: $source, title: $title, artist: $artist, artworkUrl: $artworkUrl, streamUrl: $streamUrl, lyrics: $lyrics)';
}


}

/// @nodoc
abstract mixin class $PlayerTrackCopyWith<$Res>  {
  factory $PlayerTrackCopyWith(PlayerTrack value, $Res Function(PlayerTrack) _then) = _$PlayerTrackCopyWithImpl;
@useResult
$Res call({
 String id, String source, String title, String artist, String? artworkUrl, String? streamUrl, String? lyrics
});




}
/// @nodoc
class _$PlayerTrackCopyWithImpl<$Res>
    implements $PlayerTrackCopyWith<$Res> {
  _$PlayerTrackCopyWithImpl(this._self, this._then);

  final PlayerTrack _self;
  final $Res Function(PlayerTrack) _then;

/// Create a copy of PlayerTrack
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? source = null,Object? title = null,Object? artist = null,Object? artworkUrl = freezed,Object? streamUrl = freezed,Object? lyrics = freezed,}) {
  return _then(_self.copyWith(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,source: null == source ? _self.source : source // ignore: cast_nullable_to_non_nullable
as String,title: null == title ? _self.title : title // ignore: cast_nullable_to_non_nullable
as String,artist: null == artist ? _self.artist : artist // ignore: cast_nullable_to_non_nullable
as String,artworkUrl: freezed == artworkUrl ? _self.artworkUrl : artworkUrl // ignore: cast_nullable_to_non_nullable
as String?,streamUrl: freezed == streamUrl ? _self.streamUrl : streamUrl // ignore: cast_nullable_to_non_nullable
as String?,lyrics: freezed == lyrics ? _self.lyrics : lyrics // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [PlayerTrack].
extension PlayerTrackPatterns on PlayerTrack {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _PlayerTrack value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _PlayerTrack() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _PlayerTrack value)  $default,){
final _that = this;
switch (_that) {
case _PlayerTrack():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _PlayerTrack value)?  $default,){
final _that = this;
switch (_that) {
case _PlayerTrack() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String source,  String title,  String artist,  String? artworkUrl,  String? streamUrl,  String? lyrics)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _PlayerTrack() when $default != null:
return $default(_that.id,_that.source,_that.title,_that.artist,_that.artworkUrl,_that.streamUrl,_that.lyrics);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String source,  String title,  String artist,  String? artworkUrl,  String? streamUrl,  String? lyrics)  $default,) {final _that = this;
switch (_that) {
case _PlayerTrack():
return $default(_that.id,_that.source,_that.title,_that.artist,_that.artworkUrl,_that.streamUrl,_that.lyrics);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String source,  String title,  String artist,  String? artworkUrl,  String? streamUrl,  String? lyrics)?  $default,) {final _that = this;
switch (_that) {
case _PlayerTrack() when $default != null:
return $default(_that.id,_that.source,_that.title,_that.artist,_that.artworkUrl,_that.streamUrl,_that.lyrics);case _:
  return null;

}
}

}

/// @nodoc


class _PlayerTrack implements PlayerTrack {
  const _PlayerTrack({required this.id, required this.source, required this.title, required this.artist, this.artworkUrl, this.streamUrl, this.lyrics});
  

@override final  String id;
@override final  String source;
@override final  String title;
@override final  String artist;
@override final  String? artworkUrl;
@override final  String? streamUrl;
@override final  String? lyrics;

/// Create a copy of PlayerTrack
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$PlayerTrackCopyWith<_PlayerTrack> get copyWith => __$PlayerTrackCopyWithImpl<_PlayerTrack>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _PlayerTrack&&(identical(other.id, id) || other.id == id)&&(identical(other.source, source) || other.source == source)&&(identical(other.title, title) || other.title == title)&&(identical(other.artist, artist) || other.artist == artist)&&(identical(other.artworkUrl, artworkUrl) || other.artworkUrl == artworkUrl)&&(identical(other.streamUrl, streamUrl) || other.streamUrl == streamUrl)&&(identical(other.lyrics, lyrics) || other.lyrics == lyrics));
}


@override
int get hashCode => Object.hash(runtimeType,id,source,title,artist,artworkUrl,streamUrl,lyrics);

@override
String toString() {
  return 'PlayerTrack(id: $id, source: $source, title: $title, artist: $artist, artworkUrl: $artworkUrl, streamUrl: $streamUrl, lyrics: $lyrics)';
}


}

/// @nodoc
abstract mixin class _$PlayerTrackCopyWith<$Res> implements $PlayerTrackCopyWith<$Res> {
  factory _$PlayerTrackCopyWith(_PlayerTrack value, $Res Function(_PlayerTrack) _then) = __$PlayerTrackCopyWithImpl;
@override @useResult
$Res call({
 String id, String source, String title, String artist, String? artworkUrl, String? streamUrl, String? lyrics
});




}
/// @nodoc
class __$PlayerTrackCopyWithImpl<$Res>
    implements _$PlayerTrackCopyWith<$Res> {
  __$PlayerTrackCopyWithImpl(this._self, this._then);

  final _PlayerTrack _self;
  final $Res Function(_PlayerTrack) _then;

/// Create a copy of PlayerTrack
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? source = null,Object? title = null,Object? artist = null,Object? artworkUrl = freezed,Object? streamUrl = freezed,Object? lyrics = freezed,}) {
  return _then(_PlayerTrack(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,source: null == source ? _self.source : source // ignore: cast_nullable_to_non_nullable
as String,title: null == title ? _self.title : title // ignore: cast_nullable_to_non_nullable
as String,artist: null == artist ? _self.artist : artist // ignore: cast_nullable_to_non_nullable
as String,artworkUrl: freezed == artworkUrl ? _self.artworkUrl : artworkUrl // ignore: cast_nullable_to_non_nullable
as String?,streamUrl: freezed == streamUrl ? _self.streamUrl : streamUrl // ignore: cast_nullable_to_non_nullable
as String?,lyrics: freezed == lyrics ? _self.lyrics : lyrics // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

// dart format on
