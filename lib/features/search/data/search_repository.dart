import '../../../core/models/song.dart';

typedef SearchFunction = Future<List<Song>> Function(String keyword, int page);

final class SearchRepository {
  SearchRepository({
    required SearchFunction neteaseSearch,
    required SearchFunction qqSearch,
    required SearchFunction kuwoSearch,
    SearchFunction? jooxSearch,
    SearchFunction? bilibiliSearch,
  })  : _neteaseSearch = neteaseSearch,
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

  Future<List<Song>> searchAggregate(
    String keyword, {
    required int page,
    bool includeExtendedSources = false,
  }) async {
    final functions = <SearchFunction>[
      _neteaseSearch,
      _qqSearch,
      _kuwoSearch,
      if (includeExtendedSources && _jooxSearch != null) _jooxSearch,
      if (includeExtendedSources && _bilibiliSearch != null) _bilibiliSearch,
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
}
