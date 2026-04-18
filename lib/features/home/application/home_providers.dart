import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/music_source.dart';
import '../../../core/models/song.dart';
import '../../../core/models/top_list.dart';
import '../data/remote_top_list_repository.dart';
import 'home_controller.dart';

final class LegacyTopListRepository implements RemoteTopListRepository {
  const LegacyTopListRepository();

  @override
  Future<List<TopList>> getTopLists(String source) async {
    if (source == 'netease') {
      return const <TopList>[
        TopList(id: '1', name: '飙升榜', updateFrequency: '热度更新'),
        TopList(id: '2', name: '新歌榜', updateFrequency: '榜单更新'),
        TopList(id: '3', name: '原创榜', updateFrequency: '每周四更新'),
      ];
    }
    if (source == 'qq') {
      return const <TopList>[
        TopList(id: '11', name: 'QQ热歌榜', updateFrequency: '每日更新'),
        TopList(id: '12', name: 'QQ新歌榜', updateFrequency: '每日更新'),
      ];
    }
    return const <TopList>[
      TopList(id: '21', name: '酷我热歌榜', updateFrequency: '每日更新'),
      TopList(id: '22', name: '酷我飙升榜', updateFrequency: '每日更新'),
    ];
  }

  @override
  Future<List<Song>> getTopListDetail(String source, String id) async {
    return List<Song>.generate(
      5,
      (index) => Song(
        id: '$source-$id-$index',
        name: index == 0 ? '海与你' : '$source 榜单歌曲 ${index + 1}',
        artist: index == 0 ? '马也_Crabbit' : 'TuneFree',
        source: switch (source) {
          'netease' => MusicSource.netease,
          'qq' => MusicSource.qq,
          _ => MusicSource.kuwo,
        },
      ),
      growable: false,
    );
  }
}

final remoteTopListRepositoryProvider = Provider<RemoteTopListRepository>((ref) {
  return const LegacyTopListRepository();
});

final homeControllerProvider = ChangeNotifierProvider<HomeController>((ref) {
  final controller = HomeController(repository: ref.watch(remoteTopListRepositoryProvider));
  unawaited(controller.loadSource('netease'));
  return controller;
});
