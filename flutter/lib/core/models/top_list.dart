import 'package:freezed_annotation/freezed_annotation.dart';

part 'top_list.freezed.dart';
part 'top_list.g.dart';

@freezed
abstract class TopList with _$TopList {
  const factory TopList({
    required String id,
    required String name,
    String? updateFrequency,
    String? picUrl,
    String? coverImgUrl,
  }) = _TopList;

  factory TopList.fromJson(Map<String, dynamic> json) => _$TopListFromJson(json);
}
