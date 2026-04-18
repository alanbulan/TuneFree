import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/core/models/top_list.dart';
import 'package:tunefree/features/home/application/home_controller.dart';
import 'package:tunefree/features/home/data/remote_top_list_repository.dart';

final class FakeTopListRepository implements RemoteTopListRepository {
  FakeTopListRepository({
    required this.listsBySource,
    required this.songsByList,
    this.topListsErrorBySource = const <String, Exception>{},
    this.detailErrorByKey = const <String, Exception>{},
  });

  final Map<String, List<TopList>> listsBySource;
  final Map<String, List<Song>> songsByList;
  final Map<String, Exception> topListsErrorBySource;
  final Map<String, Exception> detailErrorByKey;
  int topListsCalls = 0;
  int detailCalls = 0;

  @override
  Future<List<TopList>> getTopLists(String source) async {
    topListsCalls += 1;
    final error = topListsErrorBySource[source];
    if (error != null) {
      throw error;
    }
    return listsBySource[source] ?? const <TopList>[];
  }

  @override
  Future<List<Song>> getTopListDetail(String source, String id) async {
    detailCalls += 1;
    final error = detailErrorByKey['$source:$id'];
    if (error != null) {
      throw error;
    }
    return songsByList['$source:$id'] ?? const <Song>[];
  }
}

final class ControlledTopListRepository implements RemoteTopListRepository {
  ControlledTopListRepository({
    this.listsBySource = const <String, List<TopList>>{},
    this.songsByList = const <String, List<Song>>{},
    this.topListResponses = const <String, Completer<List<TopList>>>{},
    this.detailResponses = const <String, Completer<List<Song>>>{},
  });

  final Map<String, List<TopList>> listsBySource;
  final Map<String, List<Song>> songsByList;
  final Map<String, Completer<List<TopList>>> topListResponses;
  final Map<String, Completer<List<Song>>> detailResponses;

  @override
  Future<List<TopList>> getTopLists(String source) {
    final response = topListResponses[source];
    if (response != null) {
      return response.future;
    }
    return Future<List<TopList>>.value(listsBySource[source] ?? const <TopList>[]);
  }

  @override
  Future<List<Song>> getTopListDetail(String source, String id) {
    final response = detailResponses['$source:$id'];
    if (response != null) {
      return response.future;
    }
    return Future<List<Song>>.value(songsByList['$source:$id'] ?? const <Song>[]);
  }
}

void main() {
  test('loadSource fetches lists, first-detail songs, and reuses cached source data', () async {
    final repository = FakeTopListRepository(
      listsBySource: {
        'netease': const [TopList(id: '1', name: '飙升榜')],
      },
      songsByList: {
        'netease:1': const [
          Song(id: 'n1', name: '海与你', artist: '马也_Crabbit', source: MusicSource.netease),
        ],
      },
    );

    final controller = HomeController(repository: repository);

    await controller.loadSource('netease');
    expect(controller.state.activeSource, 'netease');
    expect(controller.state.topLists.first.name, '飙升榜');
    expect(controller.state.featuredSongs.first.name, '海与你');
    expect(repository.topListsCalls, 1);
    expect(repository.detailCalls, 1);

    await controller.loadSource('netease');
    expect(repository.topListsCalls, 1);
    expect(repository.detailCalls, 1);
  });

  test('loadSource ignores stale results from an earlier overlapping source request', () async {
    final neteaseLists = Completer<List<TopList>>();
    final neteaseSongs = Completer<List<Song>>();
    final qqLists = Completer<List<TopList>>();
    final qqSongs = Completer<List<Song>>();
    final repository = ControlledTopListRepository(
      topListResponses: {
        'netease': neteaseLists,
        'qq': qqLists,
      },
      detailResponses: {
        'netease:1': neteaseSongs,
        'qq:2': qqSongs,
      },
    );
    final controller = HomeController(repository: repository);

    final neteaseLoad = controller.loadSource('netease');
    final qqLoad = controller.loadSource('qq');

    qqLists.complete(const [TopList(id: '2', name: 'QQ热歌榜')]);
    qqSongs.complete(const [
      Song(id: 'q1', name: '句号', artist: 'G.E.M.', source: MusicSource.qq),
    ]);
    await qqLoad;

    neteaseLists.complete(const [TopList(id: '1', name: '飙升榜')]);
    neteaseSongs.complete(const [
      Song(id: 'n1', name: '海与你', artist: '马也_Crabbit', source: MusicSource.netease),
    ]);
    await neteaseLoad;

    expect(controller.state.activeSource, 'qq');
    expect(controller.state.topLists.single.name, 'QQ热歌榜');
    expect(controller.state.featuredSongs.single.name, '句号');
    expect(controller.state.hasError, isFalse);
    expect(controller.state.listsLoading, isFalse);
    expect(controller.state.songsLoading, isFalse);
  });

  test('selectTopList ignores stale results from an earlier overlapping selection', () async {
    final delayedSongs = Completer<List<Song>>();
    final repository = ControlledTopListRepository(
      listsBySource: {
        'netease': const [
          TopList(id: '1', name: '飙升榜'),
          TopList(id: '2', name: '新歌榜'),
          TopList(id: '3', name: '原创榜'),
        ],
      },
      songsByList: {
        'netease:1': const [
          Song(id: 'n1', name: '海与你', artist: '马也_Crabbit', source: MusicSource.netease),
        ],
        'netease:3': const [
          Song(id: 'n3', name: '麋鹿', artist: '周深', source: MusicSource.netease),
        ],
      },
      detailResponses: {
        'netease:2': delayedSongs,
      },
    );
    final controller = HomeController(repository: repository);

    await controller.loadSource('netease');

    final staleSelection = controller.selectTopList(const TopList(id: '2', name: '新歌榜'));
    await controller.selectTopList(const TopList(id: '3', name: '原创榜'));

    delayedSongs.complete(const [
      Song(id: 'n2', name: '迟到', artist: '张碧晨', source: MusicSource.netease),
    ]);
    await staleSelection;

    expect(controller.state.featuredSongs.single.name, '麋鹿');
    expect(controller.state.songsLoading, isFalse);
    expect(controller.state.hasError, isFalse);
  });

  test('selectTopList marks error state without throwing when repository detail loading fails', () async {
    final repository = FakeTopListRepository(
      listsBySource: {
        'netease': const [TopList(id: '1', name: '飙升榜')],
      },
      songsByList: {
        'netease:1': const [
          Song(id: 'n1', name: '海与你', artist: '马也_Crabbit', source: MusicSource.netease),
        ],
      },
      detailErrorByKey: {
        'netease:2': Exception('detail failed'),
      },
    );
    final controller = HomeController(repository: repository);

    await controller.loadSource('netease');

    await expectLater(
      controller.selectTopList(const TopList(id: '2', name: '新歌榜')),
      completes,
    );
    expect(controller.state.songsLoading, isFalse);
    expect(controller.state.hasError, isTrue);
    expect(controller.state.featuredSongs.first.name, '海与你');
  });

  test('loadSource clears previous featured songs while cached new-source songs are loading', () async {
    final detailErrorByKey = <String, Exception>{
      'qq:2': Exception('detail failed'),
    };
    final repository = FakeTopListRepository(
      listsBySource: {
        'netease': const [TopList(id: '1', name: '飙升榜')],
        'qq': const [TopList(id: '2', name: '热歌榜')],
      },
      songsByList: {
        'netease:1': const [
          Song(id: 'n1', name: '海与你', artist: '马也_Crabbit', source: MusicSource.netease),
        ],
        'qq:2': const [
          Song(id: 'q1', name: '句号', artist: 'G.E.M.', source: MusicSource.qq),
        ],
      },
      detailErrorByKey: detailErrorByKey,
    );
    final controller = HomeController(repository: repository);

    await controller.loadSource('qq');
    expect(controller.state.hasError, isTrue);

    await controller.loadSource('netease');
    expect(controller.state.featuredSongs.first.name, '海与你');

    detailErrorByKey.remove('qq:2');
    final loadFuture = controller.loadSource('qq');
    expect(controller.state.activeSource, 'qq');
    expect(controller.state.topLists.first.name, '热歌榜');
    expect(controller.state.songsLoading, isTrue);
    expect(controller.state.featuredSongs, isEmpty);

    await loadFuture;
    expect(controller.state.featuredSongs.first.name, '句号');
    expect(controller.state.songsLoading, isFalse);
  });
}
