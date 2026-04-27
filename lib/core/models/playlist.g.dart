// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'playlist.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_Playlist _$PlaylistFromJson(Map<String, dynamic> json) => _Playlist(
  id: json['id'] as String,
  name: json['name'] as String,
  createTime: (json['createTime'] as num).toInt(),
  songs:
      (json['songs'] as List<dynamic>?)
          ?.map((e) => Song.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const <Song>[],
);

Map<String, dynamic> _$PlaylistToJson(_Playlist instance) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'createTime': instance.createTime,
  'songs': instance.songs,
};
