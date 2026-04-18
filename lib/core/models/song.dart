import 'package:freezed_annotation/freezed_annotation.dart';

import 'audio_quality.dart';
import 'music_source.dart';

part 'song.freezed.dart';
part 'song.g.dart';

@freezed
abstract class Song with _$Song {
  const Song._();

  const factory Song({
    required String id,
    required String name,
    required String artist,
    @Default('') String album,
    String? pic,
    String? picId,
    String? url,
    String? urlId,
    String? lrc,
    String? lyricId,
    @JsonKey(fromJson: _sourceFromJson, toJson: _sourceToJson) required MusicSource source,
    @JsonKey(name: 'types', fromJson: _audioQualitiesFromJson, toJson: _audioQualitiesToJson)
    @Default(<AudioQuality>[]) List<AudioQuality> audioQualities,
  }) = _Song;

  factory Song.fromJson(Map<String, dynamic> json) => _$SongFromJson(json);

  String get key => '${source.wireValue}:$id';
}

MusicSource _sourceFromJson(String value) => MusicSourceWire.fromWire(value);
String _sourceToJson(MusicSource source) => source.wireValue;
List<AudioQuality> _audioQualitiesFromJson(List<dynamic>? raw) =>
    (raw ?? const <dynamic>[])
        .map((item) => AudioQualityWire.fromWire(item as String))
        .toList(growable: false);
List<String> _audioQualitiesToJson(List<AudioQuality> values) =>
    values.map((value) => value.wireValue).toList(growable: false);
