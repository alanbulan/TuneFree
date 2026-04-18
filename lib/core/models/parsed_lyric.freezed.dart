// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'parsed_lyric.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$ParsedLyric {

 double get time; String get text; String? get translation;
/// Create a copy of ParsedLyric
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$ParsedLyricCopyWith<ParsedLyric> get copyWith => _$ParsedLyricCopyWithImpl<ParsedLyric>(this as ParsedLyric, _$identity);

  /// Serializes this ParsedLyric to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is ParsedLyric&&(identical(other.time, time) || other.time == time)&&(identical(other.text, text) || other.text == text)&&(identical(other.translation, translation) || other.translation == translation));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,time,text,translation);

@override
String toString() {
  return 'ParsedLyric(time: $time, text: $text, translation: $translation)';
}


}

/// @nodoc
abstract mixin class $ParsedLyricCopyWith<$Res>  {
  factory $ParsedLyricCopyWith(ParsedLyric value, $Res Function(ParsedLyric) _then) = _$ParsedLyricCopyWithImpl;
@useResult
$Res call({
 double time, String text, String? translation
});




}
/// @nodoc
class _$ParsedLyricCopyWithImpl<$Res>
    implements $ParsedLyricCopyWith<$Res> {
  _$ParsedLyricCopyWithImpl(this._self, this._then);

  final ParsedLyric _self;
  final $Res Function(ParsedLyric) _then;

/// Create a copy of ParsedLyric
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? time = null,Object? text = null,Object? translation = freezed,}) {
  return _then(_self.copyWith(
time: null == time ? _self.time : time // ignore: cast_nullable_to_non_nullable
as double,text: null == text ? _self.text : text // ignore: cast_nullable_to_non_nullable
as String,translation: freezed == translation ? _self.translation : translation // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [ParsedLyric].
extension ParsedLyricPatterns on ParsedLyric {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _ParsedLyric value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _ParsedLyric() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _ParsedLyric value)  $default,){
final _that = this;
switch (_that) {
case _ParsedLyric():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _ParsedLyric value)?  $default,){
final _that = this;
switch (_that) {
case _ParsedLyric() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( double time,  String text,  String? translation)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _ParsedLyric() when $default != null:
return $default(_that.time,_that.text,_that.translation);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( double time,  String text,  String? translation)  $default,) {final _that = this;
switch (_that) {
case _ParsedLyric():
return $default(_that.time,_that.text,_that.translation);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( double time,  String text,  String? translation)?  $default,) {final _that = this;
switch (_that) {
case _ParsedLyric() when $default != null:
return $default(_that.time,_that.text,_that.translation);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _ParsedLyric implements ParsedLyric {
  const _ParsedLyric({required this.time, required this.text, this.translation});
  factory _ParsedLyric.fromJson(Map<String, dynamic> json) => _$ParsedLyricFromJson(json);

@override final  double time;
@override final  String text;
@override final  String? translation;

/// Create a copy of ParsedLyric
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$ParsedLyricCopyWith<_ParsedLyric> get copyWith => __$ParsedLyricCopyWithImpl<_ParsedLyric>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$ParsedLyricToJson(this, );
}

@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _ParsedLyric&&(identical(other.time, time) || other.time == time)&&(identical(other.text, text) || other.text == text)&&(identical(other.translation, translation) || other.translation == translation));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => Object.hash(runtimeType,time,text,translation);

@override
String toString() {
  return 'ParsedLyric(time: $time, text: $text, translation: $translation)';
}


}

/// @nodoc
abstract mixin class _$ParsedLyricCopyWith<$Res> implements $ParsedLyricCopyWith<$Res> {
  factory _$ParsedLyricCopyWith(_ParsedLyric value, $Res Function(_ParsedLyric) _then) = __$ParsedLyricCopyWithImpl;
@override @useResult
$Res call({
 double time, String text, String? translation
});




}
/// @nodoc
class __$ParsedLyricCopyWithImpl<$Res>
    implements _$ParsedLyricCopyWith<$Res> {
  __$ParsedLyricCopyWithImpl(this._self, this._then);

  final _ParsedLyric _self;
  final $Res Function(_ParsedLyric) _then;

/// Create a copy of ParsedLyric
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? time = null,Object? text = null,Object? translation = freezed,}) {
  return _then(_ParsedLyric(
time: null == time ? _self.time : time // ignore: cast_nullable_to_non_nullable
as double,text: null == text ? _self.text : text // ignore: cast_nullable_to_non_nullable
as String,translation: freezed == translation ? _self.translation : translation // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

// dart format on
