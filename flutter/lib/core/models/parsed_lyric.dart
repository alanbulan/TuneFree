import 'package:freezed_annotation/freezed_annotation.dart';

part 'parsed_lyric.freezed.dart';
part 'parsed_lyric.g.dart';

@freezed
abstract class ParsedLyric with _$ParsedLyric {
  const factory ParsedLyric({
    required double time,
    required String text,
    String? translation,
  }) = _ParsedLyric;

  factory ParsedLyric.fromJson(Map<String, dynamic> json) => _$ParsedLyricFromJson(json);
}
