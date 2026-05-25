import '../../../core/models/song.dart';
import 'remote_search_repository.dart';

typedef SearchFunction = Future<List<Song>> Function(String keyword, int page);

final class SearchRepository implements RemoteSearchRepository {
  SearchRepository({
    required SearchFunction neteaseSearch,
    required SearchFunction qqSearch,
    required SearchFunction kuwoSearch,
    SearchFunction? jooxSearch,
    SearchFunction? bilibiliSearch,
  }) : _neteaseSearch = neteaseSearch,
       _qqSearch = qqSearch,
       _kuwoSearch = kuwoSearch,
       _jooxSearch = jooxSearch,
       _bilibiliSearch = bilibiliSearch;

  SearchRepository.test({
    required SearchFunction neteaseSearch,
    required SearchFunction qqSearch,
    required SearchFunction kuwoSearch,
    SearchFunction? jooxSearch,
    SearchFunction? bilibiliSearch,
  }) : this(
         neteaseSearch: neteaseSearch,
         qqSearch: qqSearch,
         kuwoSearch: kuwoSearch,
         jooxSearch: jooxSearch,
         bilibiliSearch: bilibiliSearch,
       );

  final SearchFunction _neteaseSearch;
  final SearchFunction _qqSearch;
  final SearchFunction _kuwoSearch;
  final SearchFunction? _jooxSearch;
  final SearchFunction? _bilibiliSearch;

  @override
  Future<List<Song>> searchAggregate(
    String keyword, {
    required int page,
  }) async {
    final functions = <SearchFunction>[
      _neteaseSearch,
      _qqSearch,
      _kuwoSearch,
      if (_jooxSearch != null) _jooxSearch,
      if (_bilibiliSearch != null) _bilibiliSearch,
    ];

    final results = await Future.wait(
      functions.map((search) async {
        try {
          return await search(keyword, page);
        } catch (_) {
          return <Song>[];
        }
      }),
    );

    final merged = <Song>[];
    final maxLength = results.fold<int>(
      0,
      (max, current) => current.length > max ? current.length : max,
    );
    for (var index = 0; index < maxLength; index += 1) {
      for (final sourceResult in results) {
        if (index < sourceResult.length) {
          merged.add(sourceResult[index]);
        }
      }
    }
    return merged;
  }

  @override
  Future<List<Song>> searchSingle(
    String keyword, {
    required String source,
    required int page,
  }) {
    final search = switch (source) {
      'netease' => _neteaseSearch,
      'qq' => _qqSearch,
      'kuwo' => _kuwoSearch,
      'joox' => _jooxSearch,
      'bilibili' => _bilibiliSearch,
      _ => null,
    };
    if (search == null) {
      return Future<List<Song>>.value(const <Song>[]);
    }
    return search(keyword, page);
  }
}
