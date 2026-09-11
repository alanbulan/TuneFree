// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'player_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$PlayerState {

 Song? get currentSong; List<Song> get queue; bool get isPlaying; bool get isLoading; Duration get position; Duration get duration; String get playMode; AudioQuality get audioQuality; AudioQuality get downloadQuality; bool get isExpanded; bool get showLyrics; bool get showQueue; bool get showDownload; bool get showMore; String? get playbackNotice;
/// Create a copy of PlayerState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$PlayerStateCopyWith<PlayerState> get copyWith => _$PlayerStateCopyWithImpl<PlayerState>(this as PlayerState, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as PlayerState;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is PlayerState&&(identical(other.currentSong, _this.currentSong) || other.currentSong == _this.currentSong)&&const DeepCollectionEquality().equals(other.queue, _this.queue)&&(identical(other.isPlaying, _this.isPlaying) || other.isPlaying == _this.isPlaying)&&(identical(other.isLoading, _this.isLoading) || other.isLoading == _this.isLoading)&&(identical(other.position, _this.position) || other.position == _this.position)&&(identical(other.duration, _this.duration) || other.duration == _this.duration)&&(identical(other.playMode, _this.playMode) || other.playMode == _this.playMode)&&(identical(other.audioQuality, _this.audioQuality) || other.audioQuality == _this.audioQuality)&&(identical(other.downloadQuality, _this.downloadQuality) || other.downloadQuality == _this.downloadQuality)&&(identical(other.isExpanded, _this.isExpanded) || other.isExpanded == _this.isExpanded)&&(identical(other.showLyrics, _this.showLyrics) || other.showLyrics == _this.showLyrics)&&(identical(other.showQueue, _this.showQueue) || other.showQueue == _this.showQueue)&&(identical(other.showDownload, _this.showDownload) || other.showDownload == _this.showDownload)&&(identical(other.showMore, _this.showMore) || other.showMore == _this.showMore)&&(identical(other.playbackNotice, _this.playbackNotice) || other.playbackNotice == _this.playbackNotice));
}


@override
int get hashCode {
  final _this = this as PlayerState;
  return Object.hash(runtimeType,_this.currentSong,const DeepCollectionEquality().hash(_this.queue),_this.isPlaying,_this.isLoading,_this.position,_this.duration,_this.playMode,_this.audioQuality,_this.downloadQuality,_this.isExpanded,_this.showLyrics,_this.showQueue,_this.showDownload,_this.showMore,_this.playbackNotice);
}

@override
String toString() {
  final _this = this as PlayerState;
  return 'PlayerState(currentSong: ${_this.currentSong}, queue: ${_this.queue}, isPlaying: ${_this.isPlaying}, isLoading: ${_this.isLoading}, position: ${_this.position}, duration: ${_this.duration}, playMode: ${_this.playMode}, audioQuality: ${_this.audioQuality}, downloadQuality: ${_this.downloadQuality}, isExpanded: ${_this.isExpanded}, showLyrics: ${_this.showLyrics}, showQueue: ${_this.showQueue}, showDownload: ${_this.showDownload}, showMore: ${_this.showMore}, playbackNotice: ${_this.playbackNotice})';
}


}

/// @nodoc
abstract mixin class $PlayerStateCopyWith<$Res>  {
  factory $PlayerStateCopyWith(PlayerState value, $Res Function(PlayerState) _then) = _$PlayerStateCopyWithImpl;
@useResult
$Res call({
 Song? currentSong, List<Song> queue, bool isPlaying, bool isLoading, Duration position, Duration duration, String playMode, AudioQuality audioQuality, AudioQuality downloadQuality, bool isExpanded, bool showLyrics, bool showQueue, bool showDownload, bool showMore, String? playbackNotice
});


$SongCopyWith<$Res>? get currentSong;

}
/// @nodoc
class _$PlayerStateCopyWithImpl<$Res>
    implements $PlayerStateCopyWith<$Res> {
  _$PlayerStateCopyWithImpl(this._self, this._then);

  final PlayerState _self;
  final $Res Function(PlayerState) _then;

/// Create a copy of PlayerState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? currentSong = freezed,Object? queue = null,Object? isPlaying = null,Object? isLoading = null,Object? position = null,Object? duration = null,Object? playMode = null,Object? audioQuality = null,Object? downloadQuality = null,Object? isExpanded = null,Object? showLyrics = null,Object? showQueue = null,Object? showDownload = null,Object? showMore = null,Object? playbackNotice = freezed,}) {
  return _then(PlayerState(
currentSong: freezed == currentSong ? _self.currentSong : currentSong // ignore: cast_nullable_to_non_nullable
as Song?,queue: null == queue ? _self.queue : queue // ignore: cast_nullable_to_non_nullable
as List<Song>,isPlaying: null == isPlaying ? _self.isPlaying : isPlaying // ignore: cast_nullable_to_non_nullable
as bool,isLoading: null == isLoading ? _self.isLoading : isLoading // ignore: cast_nullable_to_non_nullable
as bool,position: null == position ? _self.position : position // ignore: cast_nullable_to_non_nullable
as Duration,duration: null == duration ? _self.duration : duration // ignore: cast_nullable_to_non_nullable
as Duration,playMode: null == playMode ? _self.playMode : playMode // ignore: cast_nullable_to_non_nullable
as String,audioQuality: null == audioQuality ? _self.audioQuality : audioQuality // ignore: cast_nullable_to_non_nullable
as AudioQuality,downloadQuality: null == downloadQuality ? _self.downloadQuality : downloadQuality // ignore: cast_nullable_to_non_nullable
as AudioQuality,isExpanded: null == isExpanded ? _self.isExpanded : isExpanded // ignore: cast_nullable_to_non_nullable
as bool,showLyrics: null == showLyrics ? _self.showLyrics : showLyrics // ignore: cast_nullable_to_non_nullable
as bool,showQueue: null == showQueue ? _self.showQueue : showQueue // ignore: cast_nullable_to_non_nullable
as bool,showDownload: null == showDownload ? _self.showDownload : showDownload // ignore: cast_nullable_to_non_nullable
as bool,showMore: null == showMore ? _self.showMore : showMore // ignore: cast_nullable_to_non_nullable
as bool,playbackNotice: freezed == playbackNotice ? _self.playbackNotice : playbackNotice // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}
/// Create a copy of PlayerState
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$SongCopyWith<$Res>? get currentSong {
    if (_self.currentSong == null) {
    return null;
  }

  return $SongCopyWith<$Res>(_self.currentSong!, (value) {
    return _then(_self.copyWith(currentSong: value));
  });
}
}


/// Adds pattern-matching-related methods to [PlayerState].
extension PlayerStatePatterns on PlayerState {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _PlayerState value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _PlayerState() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _PlayerState value)  $default,){
final _that = this;
switch (_that) {
case _PlayerState():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _PlayerState value)?  $default,){
final _that = this;
switch (_that) {
case _PlayerState() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( Song? currentSong,  List<Song> queue,  bool isPlaying,  bool isLoading,  Duration position,  Duration duration,  String playMode,  AudioQuality audioQuality,  AudioQuality downloadQuality,  bool isExpanded,  bool showLyrics,  bool showQueue,  bool showDownload,  bool showMore,  String? playbackNotice)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _PlayerState() when $default != null:
return $default(_that.currentSong,_that.queue,_that.isPlaying,_that.isLoading,_that.position,_that.duration,_that.playMode,_that.audioQuality,_that.downloadQuality,_that.isExpanded,_that.showLyrics,_that.showQueue,_that.showDownload,_that.showMore,_that.playbackNotice);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( Song? currentSong,  List<Song> queue,  bool isPlaying,  bool isLoading,  Duration position,  Duration duration,  String playMode,  AudioQuality audioQuality,  AudioQuality downloadQuality,  bool isExpanded,  bool showLyrics,  bool showQueue,  bool showDownload,  bool showMore,  String? playbackNotice)  $default,) {final _that = this;
switch (_that) {
case _PlayerState():
return $default(_that.currentSong,_that.queue,_that.isPlaying,_that.isLoading,_that.position,_that.duration,_that.playMode,_that.audioQuality,_that.downloadQuality,_that.isExpanded,_that.showLyrics,_that.showQueue,_that.showDownload,_that.showMore,_that.playbackNotice);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( Song? currentSong,  List<Song> queue,  bool isPlaying,  bool isLoading,  Duration position,  Duration duration,  String playMode,  AudioQuality audioQuality,  AudioQuality downloadQuality,  bool isExpanded,  bool showLyrics,  bool showQueue,  bool showDownload,  bool showMore,  String? playbackNotice)?  $default,) {final _that = this;
switch (_that) {
case _PlayerState() when $default != null:
return $default(_that.currentSong,_that.queue,_that.isPlaying,_that.isLoading,_that.position,_that.duration,_that.playMode,_that.audioQuality,_that.downloadQuality,_that.isExpanded,_that.showLyrics,_that.showQueue,_that.showDownload,_that.showMore,_that.playbackNotice);case _:
  return null;

}
}

}

/// @nodoc


class _PlayerState extends PlayerState {
  const _PlayerState({this.currentSong,  List<Song> queue = const <Song>[], this.isPlaying = false, this.isLoading = false, this.position = Duration.zero, this.duration = Duration.zero, this.playMode = 'sequence', this.audioQuality = AudioQuality.k320, this.downloadQuality = AudioQuality.k320, this.isExpanded = false, this.showLyrics = false, this.showQueue = false, this.showDownload = false, this.showMore = false, this.playbackNotice}): _queue = queue,super._();
  

@override final  Song? currentSong;
 final  List<Song> _queue;
@override@JsonKey() List<Song> get queue {
  if (_queue is EqualUnmodifiableListView) return _queue;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_queue);
}

@override@JsonKey() final  bool isPlaying;
@override@JsonKey() final  bool isLoading;
@override@JsonKey() final  Duration position;
@override@JsonKey() final  Duration duration;
@override@JsonKey() final  String playMode;
@override@JsonKey() final  AudioQuality audioQuality;
@override@JsonKey() final  AudioQuality downloadQuality;
@override@JsonKey() final  bool isExpanded;
@override@JsonKey() final  bool showLyrics;
@override@JsonKey() final  bool showQueue;
@override@JsonKey() final  bool showDownload;
@override@JsonKey() final  bool showMore;
@override final  String? playbackNotice;

/// Create a copy of PlayerState
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$PlayerStateCopyWith<_PlayerState> get copyWith => __$PlayerStateCopyWithImpl<_PlayerState>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _PlayerState&&(identical(other.currentSong, currentSong) || other.currentSong == currentSong)&&const DeepCollectionEquality().equals(other.queue, _queue)&&(identical(other.isPlaying, isPlaying) || other.isPlaying == isPlaying)&&(identical(other.isLoading, isLoading) || other.isLoading == isLoading)&&(identical(other.position, position) || other.position == position)&&(identical(other.duration, duration) || other.duration == duration)&&(identical(other.playMode, playMode) || other.playMode == playMode)&&(identical(other.audioQuality, audioQuality) || other.audioQuality == audioQuality)&&(identical(other.downloadQuality, downloadQuality) || other.downloadQuality == downloadQuality)&&(identical(other.isExpanded, isExpanded) || other.isExpanded == isExpanded)&&(identical(other.showLyrics, showLyrics) || other.showLyrics == showLyrics)&&(identical(other.showQueue, showQueue) || other.showQueue == showQueue)&&(identical(other.showDownload, showDownload) || other.showDownload == showDownload)&&(identical(other.showMore, showMore) || other.showMore == showMore)&&(identical(other.playbackNotice, playbackNotice) || other.playbackNotice == playbackNotice));
}


@override
int get hashCode {
    return Object.hash(runtimeType,currentSong,const DeepCollectionEquality().hash(_queue),isPlaying,isLoading,position,duration,playMode,audioQuality,downloadQuality,isExpanded,showLyrics,showQueue,showDownload,showMore,playbackNotice);
}

@override
String toString() {
    return 'PlayerState(currentSong: $currentSong, queue: $queue, isPlaying: $isPlaying, isLoading: $isLoading, position: $position, duration: $duration, playMode: $playMode, audioQuality: $audioQuality, downloadQuality: $downloadQuality, isExpanded: $isExpanded, showLyrics: $showLyrics, showQueue: $showQueue, showDownload: $showDownload, showMore: $showMore, playbackNotice: $playbackNotice)';
}


}

/// @nodoc
abstract mixin class _$PlayerStateCopyWith<$Res> implements $PlayerStateCopyWith<$Res> {
  factory _$PlayerStateCopyWith(_PlayerState value, $Res Function(_PlayerState) _then) = __$PlayerStateCopyWithImpl;
@override @useResult
$Res call({
 Song? currentSong, List<Song> queue, bool isPlaying, bool isLoading, Duration position, Duration duration, String playMode, AudioQuality audioQuality, AudioQuality downloadQuality, bool isExpanded, bool showLyrics, bool showQueue, bool showDownload, bool showMore, String? playbackNotice
});


@override $SongCopyWith<$Res>? get currentSong;

}
/// @nodoc
class __$PlayerStateCopyWithImpl<$Res>
    implements _$PlayerStateCopyWith<$Res> {
  __$PlayerStateCopyWithImpl(this._self, this._then);

  final _PlayerState _self;
  final $Res Function(_PlayerState) _then;

/// Create a copy of PlayerState
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? currentSong = freezed,Object? queue = null,Object? isPlaying = null,Object? isLoading = null,Object? position = null,Object? duration = null,Object? playMode = null,Object? audioQuality = null,Object? downloadQuality = null,Object? isExpanded = null,Object? showLyrics = null,Object? showQueue = null,Object? showDownload = null,Object? showMore = null,Object? playbackNotice = freezed,}) {
  return _then(_PlayerState(
currentSong: freezed == currentSong ? _self.currentSong : currentSong // ignore: cast_nullable_to_non_nullable
as Song?,queue: null == queue ? _self._queue : queue // ignore: cast_nullable_to_non_nullable
as List<Song>,isPlaying: null == isPlaying ? _self.isPlaying : isPlaying // ignore: cast_nullable_to_non_nullable
as bool,isLoading: null == isLoading ? _self.isLoading : isLoading // ignore: cast_nullable_to_non_nullable
as bool,position: null == position ? _self.position : position // ignore: cast_nullable_to_non_nullable
as Duration,duration: null == duration ? _self.duration : duration // ignore: cast_nullable_to_non_nullable
as Duration,playMode: null == playMode ? _self.playMode : playMode // ignore: cast_nullable_to_non_nullable
as String,audioQuality: null == audioQuality ? _self.audioQuality : audioQuality // ignore: cast_nullable_to_non_nullable
as AudioQuality,downloadQuality: null == downloadQuality ? _self.downloadQuality : downloadQuality // ignore: cast_nullable_to_non_nullable
as AudioQuality,isExpanded: null == isExpanded ? _self.isExpanded : isExpanded // ignore: cast_nullable_to_non_nullable
as bool,showLyrics: null == showLyrics ? _self.showLyrics : showLyrics // ignore: cast_nullable_to_non_nullable
as bool,showQueue: null == showQueue ? _self.showQueue : showQueue // ignore: cast_nullable_to_non_nullable
as bool,showDownload: null == showDownload ? _self.showDownload : showDownload // ignore: cast_nullable_to_non_nullable
as bool,showMore: null == showMore ? _self.showMore : showMore // ignore: cast_nullable_to_non_nullable
as bool,playbackNotice: freezed == playbackNotice ? _self.playbackNotice : playbackNotice // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

/// Create a copy of PlayerState
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$SongCopyWith<$Res>? get currentSong {
    if (_self.currentSong == null) {
    return null;
  }

  return $SongCopyWith<$Res>(_self.currentSong!, (value) {
    return _then(_self.copyWith(currentSong: value));
  });
}
}

// dart format on
