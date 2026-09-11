import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/data/similar_radio_repository.dart';
import 'package:tunefree/features/search/data/remote_search_repository.dart';

/// 按音源分派的一个假搜索：可以精确控制每个源返回什么。
final class _FakeSearch implements RemoteSearchRepository {
  _FakeSearch({
    this.singleResults = const <Song>[],
    this.aggregateResults = const <Song>[],
    this.singleThrows = false,
  });

  final List<Song> singleResults;
  final List<Song> aggregateResults;
  final bool singleThrows;

  final List<String> singleQueries = <String>[];
  final List<String> singleSources = <String>[];
  var aggregateCalls = 0;

  @override
  Future<List<Song>> searchSingle(
    String keyword, {
    required String source,
    required int page,
  }) async {
    singleQueries.add(keyword);
    singleSources.add(source);
    if (singleThrows) {
      throw StateError('source down');
    }
    return singleResults;
  }

  @override
  Future<List<Song>> searchAggregate(String keyword, {required int page}) async {
    aggregateCalls += 1;
    return aggregateResults;
  }
}

Song _song(String id, String name, {String artist = '目标歌手'}) => Song(
  id: id,
  name: name,
  artist: artist,
  source: MusicSource.netease,
);

const _seed = Song(
  id: 'seed',
  name: '种子曲',
  artist: '目标歌手',
  source: MusicSource.netease,
);

void main() {
  test('用歌手名在种子自己的音源里搜', () async {
    final search = _FakeSearch(
      singleResults: <Song>[_song('a', '另一首'), _song('b', '再一首')],
    );
    final repository = SimilarRadioRepository(search: search);

    final songs = await repository.songsLike(_seed);

    expect(search.singleQueries.single, '目标歌手');
    expect(search.singleSources.single, 'netease');
    expect(search.aggregateCalls, 0);
    expect(songs.map((song) => song.id), <String>['a', 'b']);
  });

  test('种子自己不会出现在结果里', () async {
    final search = _FakeSearch(
      singleResults: <Song>[_seed, _song('a', '另一首')],
    );
    final repository = SimilarRadioRepository(search: search);

    final songs = await repository.songsLike(_seed);

    expect(songs.map((song) => song.id), <String>['a']);
  });

  test('结果去重', () async {
    final search = _FakeSearch(
      singleResults: <Song>[_song('a', '另一首'), _song('a', '重复')],
    );
    final repository = SimilarRadioRepository(search: search);

    final songs = await repository.songsLike(_seed);

    expect(songs, hasLength(1));
  });

  test('限制条数，默认 20', () async {
    final search = _FakeSearch(
      singleResults: <Song>[
        for (var index = 0; index < 50; index += 1) _song('s$index', '第$index首'),
      ],
    );
    final repository = SimilarRadioRepository(search: search);

    expect(await repository.songsLike(_seed), hasLength(20));
    expect(await repository.songsLike(_seed, limit: 5), hasLength(5));
  });

  test('歌手为空时退回用歌名搜', () async {
    final search = _FakeSearch(singleResults: <Song>[_song('a', '另一首')]);
    final repository = SimilarRadioRepository(search: search);

    await repository.songsLike(
      const Song(
        id: 'seed',
        name: '只有歌名',
        artist: '   ',
        source: MusicSource.netease,
      ),
    );

    expect(search.singleQueries.single, '只有歌名');
  });

  test('种子音源搜不到时退回聚合搜索', () async {
    final search = _FakeSearch(
      aggregateResults: <Song>[_song('a', '另一首')],
    );
    final repository = SimilarRadioRepository(search: search);

    final songs = await repository.songsLike(_seed);

    expect(search.aggregateCalls, 1);
    expect(songs.map((song) => song.id), <String>['a']);
  });

  test('单源抛异常时也退回聚合，不把入口炸掉', () async {
    final search = _FakeSearch(
      singleThrows: true,
      aggregateResults: <Song>[_song('a', '另一首')],
    );
    final repository = SimilarRadioRepository(search: search);

    expect(await repository.songsLike(_seed), hasLength(1));
  });

  test('两条路都拿不到就返回空列表，而不是抛异常', () async {
    final repository = SimilarRadioRepository(search: _FakeSearch());

    expect(await repository.songsLike(_seed), isEmpty);
  });
}
