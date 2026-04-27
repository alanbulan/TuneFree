// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'song.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$Song {

 String get id; String get name; String get artist; String get album; String? get pic; String? get picId; String? get url; String? get urlId; String? get lrc; String? get lyricId;@JsonKey(fromJson: _sourceFromJson, toJson: _sourceToJson) MusicSource get source;@JsonKey(name: 'types', fromJson: _audioQualitiesFromJson, toJson: _audioQualitiesToJson) List<AudioQuality> get audioQualities;
/// Create a copy of Song
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$SongCopyWith<Song> get copyWith => _$SongCopyWithImpl<Song>(this as Song, _$identity);

  /// Serializes this Song to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is Song&&(identical(other.id, id) || other.id == id)&&(identical(other.name, name) || other.name == name)&&(identical(other.artist, artist) || other.artist == artist)&&(identical(other.album, album) || other.album == album)&&(identical(other.pic, pic) || other.pic == pic)&&(identical(other.picId, picId) || other.picId == picId)&&(identical(other.url, url) || other.url == url)&&(identical(other.urlId, urlId) || other.urlId == urlId)&&(identical(other.lrc, lrc) || other.lrc == lrc)&&(identical(other.lyricId, lyricId) || other.lyricId == lyricId)&&(identical(other.source, source) || other.source == source)&&const DeepCollectionEquality().equals(other.audioQualities, audioQualities));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,id,name,artist,album,pic,picId,url,urlId,lrc,lyricId,source,const DeepCollectionEquality().hash(audioQualities));

@override
String toString() {
  return 'Song(id: $id, name: $name, artist: $artist, album: $album, pic: $pic, picId: $picId, url: $url, urlId: $urlId, lrc: $lrc, lyricId: $lyricId, source: $source, audioQualities: $audioQualities)';
}


}

/// @nodoc
abstract mixin class $SongCopyWith<$Res>  {
  factory $SongCopyWith(Song value, $Res Function(Song) _then) = _$SongCopyWithImpl;
@useResult
$Res call({
 String id, String name, String artist, String album, String? pic, String? picId, String? url, String? urlId, String? lrc, String? lyricId,@JsonKey(fromJson: _sourceFromJson, toJson: _sourceToJson) MusicSource source,@JsonKey(name: 'types', fromJson: _audioQualitiesFromJson, toJson: _audioQualitiesToJson) List<AudioQuality> audioQualities
});




}
/// @nodoc
class _$SongCopyWithImpl<$Res>
    implements $SongCopyWith<$Res> {
  _$SongCopyWithImpl(this._self, this._then);

  final Song _self;
  final $Res Function(Song) _then;

/// Create a copy of Song
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? name = null,Object? artist = null,Object? album = null,Object? pic = freezed,Object? picId = freezed,Object? url = freezed,Object? urlId = freezed,Object? lrc = freezed,Object? lyricId = freezed,Object? source = null,Object? audioQualities = null,}) {
  return _then(_self.copyWith(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,name: null == name ? _self.name : name // ignore: cast_nullable_to_non_nullable
as String,artist: null == artist ? _self.artist : artist // ignore: cast_nullable_to_non_nullable
as String,album: null == album ? _self.album : album // ignore: cast_nullable_to_non_nullable
as String,pic: freezed == pic ? _self.pic : pic // ignore: cast_nullable_to_non_nullable
as String?,picId: freezed == picId ? _self.picId : picId // ignore: cast_nullable_to_non_nullable
as String?,url: freezed == url ? _self.url : url // ignore: cast_nullable_to_non_nullable
as String?,urlId: freezed == urlId ? _self.urlId : urlId // ignore: cast_nullable_to_non_nullable
as String?,lrc: freezed == lrc ? _self.lrc : lrc // ignore: cast_nullable_to_non_nullable
as String?,lyricId: freezed == lyricId ? _self.lyricId : lyricId // ignore: cast_nullable_to_non_nullable
as String?,source: null == source ? _self.source : source // ignore: cast_nullable_to_non_nullable
as MusicSource,audioQualities: null == audioQualities ? _self.audioQualities : audioQualities // ignore: cast_nullable_to_non_nullable
as List<AudioQuality>,
  ));
}

}


/// Adds pattern-matching-related methods to [Song].
extension SongPatterns on Song {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _Song value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _Song() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _Song value)  $default,){
final _that = this;
switch (_that) {
case _Song():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _Song value)?  $default,){
final _that = this;
switch (_that) {
case _Song() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String name,  String artist,  String album,  String? pic,  String? picId,  String? url,  String? urlId,  String? lrc,  String? lyricId, @JsonKey(fromJson: _sourceFromJson, toJson: _sourceToJson)  MusicSource source, @JsonKey(name: 'types', fromJson: _audioQualitiesFromJson, toJson: _audioQualitiesToJson)  List<AudioQuality> audioQualities)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _Song() when $default != null:
return $default(_that.id,_that.name,_that.artist,_that.album,_that.pic,_that.picId,_that.url,_that.urlId,_that.lrc,_that.lyricId,_that.source,_that.audioQualities);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String name,  String artist,  String album,  String? pic,  String? picId,  String? url,  String? urlId,  String? lrc,  String? lyricId, @JsonKey(fromJson: _sourceFromJson, toJson: _sourceToJson)  MusicSource source, @JsonKey(name: 'types', fromJson: _audioQualitiesFromJson, toJson: _audioQualitiesToJson)  List<AudioQuality> audioQualities)  $default,) {final _that = this;
switch (_that) {
case _Song():
return $default(_that.id,_that.name,_that.artist,_that.album,_that.pic,_that.picId,_that.url,_that.urlId,_that.lrc,_that.lyricId,_that.source,_that.audioQualities);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String name,  String artist,  String album,  String? pic,  String? picId,  String? url,  String? urlId,  String? lrc,  String? lyricId, @JsonKey(fromJson: _sourceFromJson, toJson: _sourceToJson)  MusicSource source, @JsonKey(name: 'types', fromJson: _audioQualitiesFromJson, toJson: _audioQualitiesToJson)  List<AudioQuality> audioQualities)?  $default,) {final _that = this;
switch (_that) {
case _Song() when $default != null:
return $default(_that.id,_that.name,_that.artist,_that.album,_that.pic,_that.picId,_that.url,_that.urlId,_that.lrc,_that.lyricId,_that.source,_that.audioQualities);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _Song extends Song {
  const _Song({required this.id, required this.name, required this.artist, this.album = '', this.pic, this.picId, this.url, this.urlId, this.lrc, this.lyricId, @JsonKey(fromJson: _sourceFromJson, toJson: _sourceToJson) required this.source, @JsonKey(name: 'types', fromJson: _audioQualitiesFromJson, toJson: _audioQualitiesToJson) final  List<AudioQuality> audioQualities = const <AudioQuality>[]}): _audioQualities = audioQualities,super._();
  factory _Song.fromJson(Map<String, dynamic> json) => _$SongFromJson(json);

@override final  String id;
@override final  String name;
@override final  String artist;
@override@JsonKey() final  String album;
@override final  String? pic;
@override final  String? picId;
@override final  String? url;
@override final  String? urlId;
@override final  String? lrc;
@override final  String? lyricId;
@override@JsonKey(fromJson: _sourceFromJson, toJson: _sourceToJson) final  MusicSource source;
 final  List<AudioQuality> _audioQualities;
@override@JsonKey(name: 'types', fromJson: _audioQualitiesFromJson, toJson: _audioQualitiesToJson) List<AudioQuality> get audioQualities {
  if (_audioQualities is EqualUnmodifiableListView) return _audioQualities;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_audioQualities);
}


/// Create a copy of Song
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$SongCopyWith<_Song> get copyWith => __$SongCopyWithImpl<_Song>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$SongToJson(this, );
}

@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _Song&&(identical(other.id, id) || other.id == id)&&(identical(other.name, name) || other.name == name)&&(identical(other.artist, artist) || other.artist == artist)&&(identical(other.album, album) || other.album == album)&&(identical(other.pic, pic) || other.pic == pic)&&(identical(other.picId, picId) || other.picId == picId)&&(identical(other.url, url) || other.url == url)&&(identical(other.urlId, urlId) || other.urlId == urlId)&&(identical(other.lrc, lrc) || other.lrc == lrc)&&(identical(other.lyricId, lyricId) || other.lyricId == lyricId)&&(identical(other.source, source) || other.source == source)&&const DeepCollectionEquality().equals(other._audioQualities, _audioQualities));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,id,name,artist,album,pic,picId,url,urlId,lrc,lyricId,source,const DeepCollectionEquality().hash(_audioQualities));

@override
String toString() {
  return 'Song(id: $id, name: $name, artist: $artist, album: $album, pic: $pic, picId: $picId, url: $url, urlId: $urlId, lrc: $lrc, lyricId: $lyricId, source: $source, audioQualities: $audioQualities)';
}


}

/// @nodoc
abstract mixin class _$SongCopyWith<$Res> implements $SongCopyWith<$Res> {
  factory _$SongCopyWith(_Song value, $Res Function(_Song) _then) = __$SongCopyWithImpl;
@override @useResult
$Res call({
 String id, String name, String artist, String album, String? pic, String? picId, String? url, String? urlId, String? lrc, String? lyricId,@JsonKey(fromJson: _sourceFromJson, toJson: _sourceToJson) MusicSource source,@JsonKey(name: 'types', fromJson: _audioQualitiesFromJson, toJson: _audioQualitiesToJson) List<AudioQuality> audioQualities
});




}
/// @nodoc
class __$SongCopyWithImpl<$Res>
    implements _$SongCopyWith<$Res> {
  __$SongCopyWithImpl(this._self, this._then);

  final _Song _self;
  final $Res Function(_Song) _then;

/// Create a copy of Song
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? name = null,Object? artist = null,Object? album = null,Object? pic = freezed,Object? picId = freezed,Object? url = freezed,Object? urlId = freezed,Object? lrc = freezed,Object? lyricId = freezed,Object? source = null,Object? audioQualities = null,}) {
  return _then(_Song(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,name: null == name ? _self.name : name // ignore: cast_nullable_to_non_nullable
as String,artist: null == artist ? _self.artist : artist // ignore: cast_nullable_to_non_nullable
as String,album: null == album ? _self.album : album // ignore: cast_nullable_to_non_nullable
as String,pic: freezed == pic ? _self.pic : pic // ignore: cast_nullable_to_non_nullable
as String?,picId: freezed == picId ? _self.picId : picId // ignore: cast_nullable_to_non_nullable
as String?,url: freezed == url ? _self.url : url // ignore: cast_nullable_to_non_nullable
as String?,urlId: freezed == urlId ? _self.urlId : urlId // ignore: cast_nullable_to_non_nullable
as String?,lrc: freezed == lrc ? _self.lrc : lrc // ignore: cast_nullable_to_non_nullable
as String?,lyricId: freezed == lyricId ? _self.lyricId : lyricId // ignore: cast_nullable_to_non_nullable
as String?,source: null == source ? _self.source : source // ignore: cast_nullable_to_non_nullable
as MusicSource,audioQualities: null == audioQualities ? _self._audioQualities : audioQualities // ignore: cast_nullable_to_non_nullable
as List<AudioQuality>,
  ));
}


}

// dart format on
