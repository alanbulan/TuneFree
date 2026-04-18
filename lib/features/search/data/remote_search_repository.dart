import '../../../core/models/music_source.dart';
import '../../../core/models/song.dart';

abstract class RemoteSearchRepository {
  Future<List<Song>> searchAggregate(
    String keyword, {
    required int page,
    required bool includeExtendedSources,
  });

  Future<List<Song>> searchSingle(
    String keyword, {
    required String source,
    required int page,
  });
}

final class LegacySearchRepository implements RemoteSearchRepository {
  const LegacySearchRepository();

  @override
  Future<List<Song>> searchAggregate(
    String keyword, {
    required int page,
    required bool includeExtendedSources,
  }) async {
    final base = <Song>[
      Song(
        id: 'netease-$page-1',
        name: '$keyword 日常的小曲',
        artist: 'ましんこ',
        source: MusicSource.netease,
      ),
      Song(
        id: 'qq-$page-1',
        name: '雑踏、僕らの街',
        artist: 'トゲナシトゲアリ',
        source: MusicSource.qq,
      ),
      Song(
        id: 'kuwo-$page-1',
        name: '$keyword 日常小曲',
        artist: '片方',
        source: MusicSource.kuwo,
      ),
    ];
    if (!includeExtendedSources) return base;
    return <Song>[
      ...base,
      Song(
        id: 'joox-$page-1',
        name: '$keyword 扩展源 1',
        artist: 'JOOX',
        source: MusicSource.joox,
      ),
      Song(
        id: 'bilibili-$page-1',
        name: '$keyword 扩展源 2',
        artist: 'Bilibili',
        source: MusicSource.bilibili,
      ),
    ];
  }

  @override
  Future<List<Song>> searchSingle(
    String keyword, {
    required String source,
    required int page,
  }) async {
    return <Song>[
      Song(
        id: '$source-$page-1',
        name: '$keyword 单源结果',
        artist: 'TuneFree',
        source: MusicSourceWire.fromWire(source),
      ),
    ];
  }
}
