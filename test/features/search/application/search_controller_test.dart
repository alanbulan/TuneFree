import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/search/application/search_controller.dart';
import 'package:tunefree/features/search/data/remote_search_repository.dart';

final class FakeSearchRepository implements RemoteSearchRepository {
  FakeSearchRepository({
    Future<List<Song>> Function(String keyword, {required int page})?
    aggregateSearch,
    Future<List<Song>> Function(
      String keyword, {
      required String source,
      required int page,
    })?
    singleSearch,
  }) : _aggregateSearch = aggregateSearch,
       _singleSearch = singleSearch;

  final Future<List<Song>> Function(String keyword, {required int page})?
  _aggregateSearch;
  final Future<List<Song>> Function(
    String keyword, {
    required String source,
    required int page,
  })?
  _singleSearch;

  int aggregateCalls = 0;
  int singleCalls = 0;
  final List<String> aggregateKeywords = <String>[];
  final List<int> aggregatePages = <int>[];
  final List<String> singleKeywords = <String>[];
  final List<String> singleSources = <String>[];
  final List<int> singlePages = <int>[];

  @override
  Future<List<Song>> searchAggregate(
    String keyword, {
    required int page,
  }) async {
    aggregateCalls += 1;
    aggregateKeywords.add(keyword);
    aggregatePages.add(page);
    if (_aggregateSearch != null) {
      return _aggregateSearch(keyword, page: page);
    }
    return const <Song>[
      Song(id: 'n1', name: '网易歌曲', artist: '歌手A', source: MusicSource.netease),
      Song(id: 'q1', name: 'QQ歌曲', artist: '歌手B', source: MusicSource.qq),
    ];
  }

  @override
  Future<List<Song>> searchSingle(
    String keyword, {
    required String source,
    required int page,
  }) async {
    singleCalls += 1;
    singleKeywords.add(keyword);
    singleSources.add(source);
    singlePages.add(page);
    if (_singleSearch != null) {
      return _singleSearch(keyword, source: source, page: page);
    }
    return <Song>[
      Song(
        id: 'single-1',
        name: '$source 单源歌曲',
        artist: '歌手C',
        source: MusicSourceWire.fromWire(source),
      ),
    ];
  }
}

void main() {
  test(
    'aggregate search stores history and returns interleaved results',
    () async {
      final repository = FakeSearchRepository();
      final controller = SearchController(repository: repository);

      controller.updateQuery('gbc');
      await controller.submitSearch();

      expect(repository.aggregateCalls, 1);
      expect(controller.state.history.first, 'gbc');
      expect(controller.state.results.map((song) => song.key).toList(), [
        'netease:n1',
        'qq:q1',
      ]);
    },
  );

  test(
    'ignores stale aggregate search responses from older requests',
    () async {
      final pendingResults = <String, Completer<List<Song>>>{
        'old': Completer<List<Song>>(),
        'new': Completer<List<Song>>(),
      };
      final repository = FakeSearchRepository(
        aggregateSearch: (String keyword, {required int page}) {
          return pendingResults[keyword]!.future;
        },
      );
      final controller = SearchController(repository: repository);

      controller.updateQuery('old');
      final oldSearch = controller.submitSearch();
      controller.updateQuery('new');
      final newSearch = controller.submitSearch();

      pendingResults['new']!.complete(<Song>[
        const Song(
          id: 'new-1',
          name: 'New Result',
          artist: 'Artist B',
          source: MusicSource.qq,
        ),
      ]);
      await newSearch;

      pendingResults['old']!.complete(<Song>[
        const Song(
          id: 'old-1',
          name: 'Old Result',
          artist: 'Artist A',
          source: MusicSource.netease,
        ),
      ]);
      await oldSearch;

      expect(controller.state.history, <String>['new', 'old']);
      expect(
        controller.state.results.map((song) => song.key).toList(),
        <String>['qq:new-1'],
      );
      expect(controller.state.isSearching, isFalse);
      expect(controller.state.searchError, isEmpty);
    },
  );

  test('清空历史后能原样恢复', () async {
    final repository = FakeSearchRepository(
      aggregateSearch: (String keyword, {required int page}) async =>
          const <Song>[],
    );
    final controller = SearchController(repository: repository);

    controller.updateQuery('gbc');
    await controller.submitSearch();
    controller.updateQuery('yorushika');
    await controller.submitSearch();

    final before = controller.state.history;
    expect(before, <String>['yorushika', 'gbc']);

    // 历史只活在内存里，所以「快照」就是把这串字符串留在调用方手里 ——
    // 撤销不需要任何持久化结构。
    controller.clearHistory();
    expect(controller.state.history, isEmpty);

    controller.restoreHistory(before);
    expect(controller.state.history, <String>['yorushika', 'gbc']);
  });

  test('changing filters invalidates pending search responses', () async {
    final pendingResults = Completer<List<Song>>();
    final repository = FakeSearchRepository(
      aggregateSearch: (String keyword, {required int page}) {
        return pendingResults.future;
      },
      singleSearch:
          (String keyword, {required String source, required int page}) async =>
              const <Song>[],
    );
    final controller = SearchController(repository: repository);

    controller.updateQuery('stale');
    final search = controller.submitSearch();
    controller.setSearchMode('single');

    pendingResults.complete(<Song>[
      const Song(
        id: 'stale-1',
        name: 'Stale Result',
        artist: 'Artist A',
        source: MusicSource.netease,
      ),
    ]);
    await search;

    expect(controller.state.results, isEmpty);
    expect(controller.state.isSearching, isFalse);
    expect(controller.state.searchError, isEmpty);
    expect(controller.state.searchMode, 'single');
  });

  test(
    'search attempt tracking only turns on after a real search runs',
    () async {
      final repository = FakeSearchRepository(
        aggregateSearch: (String keyword, {required int page}) async =>
            const <Song>[],
      );
      final controller = SearchController(repository: repository);

      controller.updateQuery('missing');

      expect(controller.hasSearchAttemptForCurrentQuery, isFalse);

      await controller.submitSearch();

      expect(controller.hasSearchAttemptForCurrentQuery, isTrue);

      controller.updateQuery('missing again');

      expect(controller.hasSearchAttemptForCurrentQuery, isFalse);

      controller.updateQuery('');

      expect(controller.hasSearchAttemptForCurrentQuery, isFalse);
    },
  );

  test('typing a query auto-searches after the input settles', () async {
    final repository = FakeSearchRepository();
    final controller = SearchController(repository: repository);

    controller.updateQuery('gbc');
    expect(repository.aggregateCalls, 0);

    await Future<void>.delayed(const Duration(milliseconds: 900));

    expect(repository.aggregateCalls, 1);
    expect(repository.aggregateKeywords, <String>['gbc']);
    expect(repository.aggregatePages, <int>[1]);
    expect(controller.state.results, isNotEmpty);
  });

  test(
    'settled queries re-run automatically when switching to single mode',
    () async {
      final repository = FakeSearchRepository();
      final controller = SearchController(repository: repository);

      controller.updateQuery('gbc');
      await controller.submitSearch();
      controller.setSearchMode('single');

      expect(repository.aggregateCalls, 1);
      expect(repository.singleCalls, 1);
      expect(repository.singleKeywords, <String>['gbc']);
      expect(repository.singleSources, <String>['netease']);
      expect(repository.singlePages, <int>[1]);
      expect(controller.state.searchMode, 'single');
      expect(controller.state.page, 1);
    },
  );

  test(
    'settled queries re-run automatically when changing the selected source',
    () async {
      final repository = FakeSearchRepository();
      final controller = SearchController(repository: repository);

      controller.updateQuery('gbc');
      await controller.submitSearch();
      controller.setSearchMode('single');
      repository.singleCalls = 0;
      repository.singleKeywords.clear();
      repository.singleSources.clear();
      repository.singlePages.clear();

      controller.setSelectedSource('qq');
      await Future<void>.delayed(Duration.zero);

      expect(repository.singleCalls, 1);
      expect(repository.singleKeywords, <String>['gbc']);
      expect(repository.singleSources, <String>['qq']);
      expect(repository.singlePages, <int>[1]);
      expect(controller.state.selectedSource, 'qq');
      expect(controller.state.results.single.id, 'single-1');
    },
  );

  test('aggregate searches always include peer sources', () async {
    final repository = FakeSearchRepository();
    final controller = SearchController(repository: repository);

    controller.updateQuery('gbc');
    await controller.submitSearch();

    expect(repository.aggregateCalls, 1);
    expect(repository.aggregateKeywords, <String>['gbc']);
    expect(repository.aggregatePages, <int>[1]);
  });

  test(
    'clearing the query resets results and restores the history-only state',
    () async {
      final repository = FakeSearchRepository();
      final controller = SearchController(repository: repository);

      controller.updateQuery('gbc');
      await controller.submitSearch();

      expect(controller.state.results, isNotEmpty);
      expect(controller.state.history, <String>['gbc']);

      controller.updateQuery('');

      expect(controller.state.query, isEmpty);
      expect(controller.state.results, isEmpty);
      expect(controller.state.page, 1);
      expect(controller.state.hasMore, isTrue);
      expect(controller.state.searchError, isEmpty);
      expect(controller.state.history, <String>['gbc']);
    },
  );

  test(
    'loadMore fetches and appends the next page when more results are available',
    () async {
      final repository = FakeSearchRepository(
        aggregateSearch: (String keyword, {required int page}) async {
          return <Song>[
            Song(
              id: 'page-$page',
              name: '$keyword 第$page页',
              artist: 'Artist $page',
              source: MusicSource.netease,
            ),
          ];
        },
      );
      final controller = SearchController(repository: repository);

      controller.updateQuery('gbc');
      await controller.submitSearch();
      await controller.loadMore();

      expect(repository.aggregatePages, <int>[1, 2]);
      expect(controller.state.page, 2);
      expect(controller.state.results.map((song) => song.id).toList(), <String>[
        'page-1',
        'page-2',
      ]);
      expect(controller.state.hasMore, isTrue);
    },
  );

  test(
    'loadMore is ignored when there is no query, no more data, or a request is active',
    () async {
      final pendingResults = Completer<List<Song>>();
      final repository = FakeSearchRepository(
        aggregateSearch: (String keyword, {required int page}) {
          if (page == 1) {
            return Future<List<Song>>.value(<Song>[
              const Song(
                id: 'page-1',
                name: 'Result',
                artist: 'Artist',
                source: MusicSource.netease,
              ),
            ]);
          }
          return pendingResults.future;
        },
      );
      final controller = SearchController(repository: repository);

      await controller.loadMore();
      expect(repository.aggregatePages, isEmpty);

      controller.updateQuery('gbc');
      await controller.submitSearch();
      controller.updateQuery('');
      await controller.loadMore();
      expect(repository.aggregatePages, <int>[1]);

      controller.updateQuery('gbc');
      final loadingSearch = controller.submitSearch();
      await controller.loadMore();
      expect(repository.aggregatePages, <int>[1, 1]);
      pendingResults.complete(<Song>[
        const Song(
          id: 'page-2',
          name: 'More',
          artist: 'Artist',
          source: MusicSource.netease,
        ),
      ]);
      await loadingSearch;

      controller.updateQuery('done');
      final noMoreRepository = FakeSearchRepository(
        aggregateSearch: (String keyword, {required int page}) async =>
            const <Song>[],
      );
      final noMoreController = SearchController(repository: noMoreRepository);
      noMoreController.updateQuery('done');
      await noMoreController.submitSearch();
      await noMoreController.loadMore();
      expect(noMoreRepository.aggregatePages, <int>[1]);
      expect(noMoreController.state.hasMore, isFalse);
    },
  );
}
