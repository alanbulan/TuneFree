// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'song.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_Song _$SongFromJson(Map<String, dynamic> json) => _Song(
  id: json['id'] as String,
  name: json['name'] as String,
  artist: json['artist'] as String,
  album: json['album'] as String? ?? '',
  pic: json['pic'] as String?,
  picId: json['picId'] as String?,
  url: json['url'] as String?,
  urlId: json['urlId'] as String?,
  lrc: json['lrc'] as String?,
  lyricId: json['lyricId'] as String?,
  source: _sourceFromJson(json['source'] as String),
  audioQualities: json['types'] == null
      ? const <AudioQuality>[]
      : _audioQualitiesFromJson(json['types'] as List?),
);

Map<String, dynamic> _$SongToJson(_Song instance) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'artist': instance.artist,
  'album': instance.album,
  'pic': instance.pic,
  'picId': instance.picId,
  'url': instance.url,
  'urlId': instance.urlId,
  'lrc': instance.lrc,
  'lyricId': instance.lyricId,
  'source': _sourceToJson(instance.source),
  'types': _audioQualitiesToJson(instance.audioQualities),
};
