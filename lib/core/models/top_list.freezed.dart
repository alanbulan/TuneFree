// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'top_list.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$TopList {

 String get id; String get name; String? get updateFrequency; String? get picUrl; String? get coverImgUrl;
/// Create a copy of TopList
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$TopListCopyWith<TopList> get copyWith => _$TopListCopyWithImpl<TopList>(this as TopList, _$identity);

  /// Serializes this TopList to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is TopList&&(identical(other.id, id) || other.id == id)&&(identical(other.name, name) || other.name == name)&&(identical(other.updateFrequency, updateFrequency) || other.updateFrequency == updateFrequency)&&(identical(other.picUrl, picUrl) || other.picUrl == picUrl)&&(identical(other.coverImgUrl, coverImgUrl) || other.coverImgUrl == coverImgUrl));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,id,name,updateFrequency,picUrl,coverImgUrl);

@override
String toString() {
  return 'TopList(id: $id, name: $name, updateFrequency: $updateFrequency, picUrl: $picUrl, coverImgUrl: $coverImgUrl)';
}


}

/// @nodoc
abstract mixin class $TopListCopyWith<$Res>  {
  factory $TopListCopyWith(TopList value, $Res Function(TopList) _then) = _$TopListCopyWithImpl;
@useResult
$Res call({
 String id, String name, String? updateFrequency, String? picUrl, String? coverImgUrl
});




}
/// @nodoc
class _$TopListCopyWithImpl<$Res>
    implements $TopListCopyWith<$Res> {
  _$TopListCopyWithImpl(this._self, this._then);

  final TopList _self;
  final $Res Function(TopList) _then;

/// Create a copy of TopList
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? name = null,Object? updateFrequency = freezed,Object? picUrl = freezed,Object? coverImgUrl = freezed,}) {
  return _then(_self.copyWith(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,name: null == name ? _self.name : name // ignore: cast_nullable_to_non_nullable
as String,updateFrequency: freezed == updateFrequency ? _self.updateFrequency : updateFrequency // ignore: cast_nullable_to_non_nullable
as String?,picUrl: freezed == picUrl ? _self.picUrl : picUrl // ignore: cast_nullable_to_non_nullable
as String?,coverImgUrl: freezed == coverImgUrl ? _self.coverImgUrl : coverImgUrl // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [TopList].
extension TopListPatterns on TopList {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _TopList value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _TopList() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _TopList value)  $default,){
final _that = this;
switch (_that) {
case _TopList():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _TopList value)?  $default,){
final _that = this;
switch (_that) {
case _TopList() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String name,  String? updateFrequency,  String? picUrl,  String? coverImgUrl)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _TopList() when $default != null:
return $default(_that.id,_that.name,_that.updateFrequency,_that.picUrl,_that.coverImgUrl);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String name,  String? updateFrequency,  String? picUrl,  String? coverImgUrl)  $default,) {final _that = this;
switch (_that) {
case _TopList():
return $default(_that.id,_that.name,_that.updateFrequency,_that.picUrl,_that.coverImgUrl);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String name,  String? updateFrequency,  String? picUrl,  String? coverImgUrl)?  $default,) {final _that = this;
switch (_that) {
case _TopList() when $default != null:
return $default(_that.id,_that.name,_that.updateFrequency,_that.picUrl,_that.coverImgUrl);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _TopList implements TopList {
  const _TopList({required this.id, required this.name, this.updateFrequency, this.picUrl, this.coverImgUrl});
  factory _TopList.fromJson(Map<String, dynamic> json) => _$TopListFromJson(json);

@override final  String id;
@override final  String name;
@override final  String? updateFrequency;
@override final  String? picUrl;
@override final  String? coverImgUrl;

/// Create a copy of TopList
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$TopListCopyWith<_TopList> get copyWith => __$TopListCopyWithImpl<_TopList>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$TopListToJson(this, );
}

@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _TopList&&(identical(other.id, id) || other.id == id)&&(identical(other.name, name) || other.name == name)&&(identical(other.updateFrequency, updateFrequency) || other.updateFrequency == updateFrequency)&&(identical(other.picUrl, picUrl) || other.picUrl == picUrl)&&(identical(other.coverImgUrl, coverImgUrl) || other.coverImgUrl == coverImgUrl));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,id,name,updateFrequency,picUrl,coverImgUrl);

@override
String toString() {
  return 'TopList(id: $id, name: $name, updateFrequency: $updateFrequency, picUrl: $picUrl, coverImgUrl: $coverImgUrl)';
}


}

/// @nodoc
abstract mixin class _$TopListCopyWith<$Res> implements $TopListCopyWith<$Res> {
  factory _$TopListCopyWith(_TopList value, $Res Function(_TopList) _then) = __$TopListCopyWithImpl;
@override @useResult
$Res call({
 String id, String name, String? updateFrequency, String? picUrl, String? coverImgUrl
});




}
/// @nodoc
class __$TopListCopyWithImpl<$Res>
    implements _$TopListCopyWith<$Res> {
  __$TopListCopyWithImpl(this._self, this._then);

  final _TopList _self;
  final $Res Function(_TopList) _then;

/// Create a copy of TopList
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? name = null,Object? updateFrequency = freezed,Object? picUrl = freezed,Object? coverImgUrl = freezed,}) {
  return _then(_TopList(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,name: null == name ? _self.name : name // ignore: cast_nullable_to_non_nullable
as String,updateFrequency: freezed == updateFrequency ? _self.updateFrequency : updateFrequency // ignore: cast_nullable_to_non_nullable
as String?,picUrl: freezed == picUrl ? _self.picUrl : picUrl // ignore: cast_nullable_to_non_nullable
as String?,coverImgUrl: freezed == coverImgUrl ? _self.coverImgUrl : coverImgUrl // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

// dart format on
