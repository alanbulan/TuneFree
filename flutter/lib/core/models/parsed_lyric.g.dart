// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'parsed_lyric.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_ParsedLyric _$ParsedLyricFromJson(Map<String, dynamic> json) => _ParsedLyric(
  time: (json['time'] as num).toDouble(),
  text: json['text'] as String,
  translation: json['translation'] as String?,
);

Map<String, dynamic> _$ParsedLyricToJson(_ParsedLyric instance) =>
    <String, dynamic>{
      'time': instance.time,
      'text': instance.text,
      'translation': instance.translation,
    };
