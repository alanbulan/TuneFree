// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'top_list.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_TopList _$TopListFromJson(Map<String, dynamic> json) => _TopList(
  id: json['id'] as String,
  name: json['name'] as String,
  updateFrequency: json['updateFrequency'] as String?,
  picUrl: json['picUrl'] as String?,
  coverImgUrl: json['coverImgUrl'] as String?,
);

Map<String, dynamic> _$TopListToJson(_TopList instance) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'updateFrequency': instance.updateFrequency,
  'picUrl': instance.picUrl,
  'coverImgUrl': instance.coverImgUrl,
};
