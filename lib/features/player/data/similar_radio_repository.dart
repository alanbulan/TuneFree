import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/song.dart';
import '../../search/application/search_providers.dart';
import '../../search/data/remote_search_repository.dart';

final similarRadioRepositoryProvider = Provider<SimilarRadioRepository>((ref) {
  return SimilarRadioRepository(
    search: ref.watch(remoteSearchRepositoryProvider),
  );
});

/// 以当前歌曲为种子凑一批可以接着放的歌。
///
/// **与 Tauri 的机制不是一回事，这里是刻意的。** 那边的 `get_similar_songs`
/// 是跑在 Tauri 进程里的 Rust + SQLite 推荐器（本地曲库召回 → 排序 → MMR
/// 去重），根本没有 HTTP 接口，Flutter 侧够不着；它唯一走网络的那条路
/// （GD Studio 的 `embeat_agent`）在第三档里已经核实是坏的（对所有关键词都
/// 返回空）。
///
/// 所以这里换一个**确实能用**的做法：拿种子的歌手去搜索接口搜一批同歌手的歌。
/// 语义是「同歌手」而不是「相似」—— 对音源受限的客户端来说这是最接近、并且
/// 不需要引入任何新接口的版本。
final class SimilarRadioRepository {
  SimilarRadioRepository({required RemoteSearchRepository search})
    : _search = search;

  final RemoteSearchRepository _search;

  /// 默认 20 首，与 Tauri 的 `limit: 20` 一致。
  Future<List<Song>> songsLike(Song seed, {int limit = 20}) async {
    final query = seed.artist.trim().isNotEmpty
        ? seed.artist.trim()
        : seed.name.trim();
    if (query.isEmpty) {
      return const <Song>[];
    }

    // 优先在种子自己的音源里找：这样每一首都能沿着种子那条已知可用的解析
    // 路径拿到播放地址。跨源聚合出来的歌不一定解析得动（酷我的 URL 解析在
    // 部分网络下是被挡的）。
    var results = await _searchSafely(
      () => _search.searchSingle(query, source: seed.source.wireValue, page: 1),
    );
    if (results.isEmpty) {
      results = await _searchSafely(
        () => _search.searchAggregate(query, page: 1),
      );
    }

    // 种子自己不算「相似的下一首」。
    final seen = <String>{seed.key};
    final songs = <Song>[];
    for (final song in results) {
      if (!seen.add(song.key)) {
        continue;
      }
      songs.add(song);
      if (songs.length >= limit) {
        break;
      }
    }
    return List<Song>.unmodifiable(songs);
  }

  Future<List<Song>> _searchSafely(
    Future<List<Song>> Function() request,
  ) async {
    try {
      return await request();
    } catch (_) {
      // 单个音源失败就退回聚合，聚合也失败就是「没有相似歌曲」，
      // 不该把整个电台入口炸掉。
      return const <Song>[];
    }
  }
}
