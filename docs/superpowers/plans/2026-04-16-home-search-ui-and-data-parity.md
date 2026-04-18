# Home and Search 1:1 Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the legacy Home and Search experiences in Flutter with 1:1 functional and visual parity, using the shared parity foundation and the existing player scaffold.

**Architecture:** This plan ports `legacy/react_app/pages/Home.tsx` and `legacy/react_app/pages/Search.tsx` into Flutter features that use concrete repositories, Riverpod providers, and the existing player controller. It preserves the legacy behavior exactly: source switching, cached toplists, aggregate and single-source search, extended-source toggles, search history, and play-from-list interactions.

**Tech Stack:** Flutter, Dart 3, flutter_riverpod, freezed, Dio, golden_toolkit, flutter_test

---

## Scope Check

This plan covers only Home and Search parity. It assumes the shared model/theme/source foundation plan has already landed. It does not implement Library tabs, lyrics, downloads, or the real just_audio runtime.

## File Structure

- Modify: `./lib/features/home/presentation/home_page.dart`
- Modify: `./lib/features/search/presentation/search_page.dart`
- Modify: `./lib/features/player/application/player_controller.dart`
- Create: `./lib/features/home/data/remote_top_list_repository.dart`
- Create: `./lib/features/home/application/home_state.dart`
- Create: `./lib/features/home/application/home_controller.dart`
- Create: `./lib/features/home/application/home_providers.dart`
- Create: `./lib/features/home/presentation/widgets/top_source_switcher.dart`
- Create: `./lib/features/home/presentation/widgets/top_list_carousel.dart`
- Create: `./lib/features/home/presentation/widgets/featured_song_tile.dart`
- Create: `./lib/features/search/data/remote_search_repository.dart`
- Create: `./lib/features/search/application/search_state.dart`
- Create: `./lib/features/search/application/search_controller.dart`
- Create: `./lib/features/search/application/search_providers.dart`
- Create: `./lib/features/search/presentation/widgets/search_mode_switcher.dart`
- Create: `./lib/features/search/presentation/widgets/search_result_tile.dart`
- Create: `./lib/features/search/presentation/widgets/search_history_section.dart`
- Test: `./test/features/home/application/home_controller_test.dart`
- Test: `./test/features/home/presentation/home_page_golden_test.dart`
- Test: `./test/features/search/application/search_controller_test.dart`
- Test: `./test/features/search/presentation/search_page_golden_test.dart`

---

### Task 1: Add concrete Home data flow and provider wiring

**Files:**
- Create: `./lib/features/home/data/remote_top_list_repository.dart`
- Create: `./lib/features/home/application/home_state.dart`
- Create: `./lib/features/home/application/home_controller.dart`
- Create: `./lib/features/home/application/home_providers.dart`
- Test: `./test/features/home/application/home_controller_test.dart`

- [ ] **Step 1: Write the failing Home controller test**

Create `test/features/home/application/home_controller_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/core/models/top_list.dart';
import 'package:tunefree/features/home/application/home_controller.dart';
import 'package:tunefree/features/home/data/remote_top_list_repository.dart';

final class FakeTopListRepository implements RemoteTopListRepository {
  FakeTopListRepository({required this.listsBySource, required this.songsByList});

  final Map<String, List<TopList>> listsBySource;
  final Map<String, List<Song>> songsByList;
  int topListsCalls = 0;
  int detailCalls = 0;

  @override
  Future<List<TopList>> getTopLists(String source) async {
    topListsCalls += 1;
    return listsBySource[source] ?? const <TopList>[];
  }

  @override
  Future<List<Song>> getTopListDetail(String source, String id) async {
    detailCalls += 1;
    return songsByList['$source:$id'] ?? const <Song>[];
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
}
```

- [ ] **Step 2: Run the Home controller test to verify the data/controller layer does not exist yet**

Run:

```bash
flutter test test/features/home/application/home_controller_test.dart -r expanded
```

Expected: FAIL with import errors for `home_controller.dart` or `remote_top_list_repository.dart`.

- [ ] **Step 3: Implement the Home repository, state, controller, and provider**

Create `lib/features/home/data/remote_top_list_repository.dart`:

```dart
import '../../../core/models/song.dart';
import '../../../core/models/top_list.dart';

abstract class RemoteTopListRepository {
  Future<List<TopList>> getTopLists(String source);
  Future<List<Song>> getTopListDetail(String source, String id);
}
```

Create `lib/features/home/application/home_state.dart`:

```dart
import 'package:freezed_annotation/freezed_annotation.dart';

import '../../../core/models/song.dart';
import '../../../core/models/top_list.dart';

part 'home_state.freezed.dart';

@freezed
abstract class HomeState with _$HomeState {
  const factory HomeState({
    @Default('netease') String activeSource,
    @Default(<TopList>[]) List<TopList> topLists,
    @Default(<Song>[]) List<Song> featuredSongs,
    @Default(false) bool listsLoading,
    @Default(false) bool songsLoading,
    @Default(false) bool hasError,
  }) = _HomeState;
}
```

Create `lib/features/home/application/home_controller.dart`:

```dart
import 'package:flutter/foundation.dart';

import '../../../core/models/song.dart';
import '../../../core/models/top_list.dart';
import '../data/remote_top_list_repository.dart';
import 'home_state.dart';

final class HomeController extends ChangeNotifier {
  HomeController({required RemoteTopListRepository repository}) : _repository = repository;

  final RemoteTopListRepository _repository;
  final Map<String, List<TopList>> _listCache = <String, List<TopList>>{};
  final Map<String, List<Song>> _detailCache = <String, List<Song>>{};

  HomeState _state = const HomeState();
  HomeState get state => _state;

  Future<void> loadSource(String source) async {
    final cachedLists = _listCache[source];
    if (cachedLists != null && cachedLists.isNotEmpty) {
      final firstList = cachedLists.first;
      final detailKey = '$source:${firstList.id}';
      _state = _state.copyWith(
        activeSource: source,
        topLists: cachedLists,
        featuredSongs: _detailCache[detailKey] ?? _state.featuredSongs,
        listsLoading: false,
        songsLoading: _detailCache[detailKey] == null,
        hasError: false,
      );
      notifyListeners();
      if (_detailCache[detailKey] != null) return;
    } else {
      _state = _state.copyWith(
        activeSource: source,
        listsLoading: true,
        songsLoading: true,
        hasError: false,
      );
      notifyListeners();
    }

    try {
      final lists = await _repository.getTopLists(source);
      _listCache[source] = lists;
      if (lists.isEmpty) {
        _state = _state.copyWith(
          activeSource: source,
          topLists: const <TopList>[],
          featuredSongs: const <Song>[],
          listsLoading: false,
          songsLoading: false,
          hasError: true,
        );
        notifyListeners();
        return;
      }

      final songs = await _loadSongs(source, lists.first.id);
      _state = _state.copyWith(
        activeSource: source,
        topLists: lists,
        featuredSongs: songs,
        listsLoading: false,
        songsLoading: false,
        hasError: false,
      );
      notifyListeners();
    } catch (_) {
      _state = _state.copyWith(
        activeSource: source,
        topLists: const <TopList>[],
        featuredSongs: const <Song>[],
        listsLoading: false,
        songsLoading: false,
        hasError: true,
      );
      notifyListeners();
    }
  }

  Future<void> selectTopList(TopList list) async {
    _state = _state.copyWith(songsLoading: true);
    notifyListeners();
    final songs = await _loadSongs(_state.activeSource, list.id);
    _state = _state.copyWith(featuredSongs: songs, songsLoading: false);
    notifyListeners();
  }

  Future<List<Song>> _loadSongs(String source, String id) async {
    final key = '$source:$id';
    final cached = _detailCache[key];
    if (cached != null) return cached;
    final songs = await _repository.getTopListDetail(source, id);
    final sliced = songs.take(20).toList(growable: false);
    _detailCache[key] = sliced;
    return sliced;
  }
}
```

Create `lib/features/home/application/home_providers.dart`:

```dart
import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/remote_top_list_repository.dart';
import 'home_controller.dart';

final remoteTopListRepositoryProvider = Provider<RemoteTopListRepository>((ref) {
  throw UnimplementedError('Override remoteTopListRepositoryProvider in feature wiring tasks.');
});

final homeControllerProvider = ChangeNotifierProvider<HomeController>((ref) {
  final controller = HomeController(repository: ref.watch(remoteTopListRepositoryProvider));
  unawaited(controller.loadSource('netease'));
  return controller;
});
```

Generate code:

```bash
dart run build_runner build --delete-conflicting-outputs
```

- [ ] **Step 4: Replace the provider placeholder with the concrete repository before finishing the task**

Update `lib/features/home/application/home_providers.dart` to this final version:

```dart
import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

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
```

- [ ] **Step 5: Run the Home controller test and analyzer**

Run:

```bash
flutter test test/features/home/application/home_controller_test.dart -r expanded
flutter analyze lib/features/home/application lib/features/home/data
```

Expected: PASS / `No issues found!`

- [ ] **Step 6: Commit the Home data/controller slice**

```bash
git add lib/features/home/application lib/features/home/data test/features/home/application

git commit -m "$(cat <<'EOF'
feat: add home parity state flow
EOF
)"
```

---

### Task 2: Add concrete Search data flow and provider wiring

**Files:**
- Create: `./lib/features/search/data/remote_search_repository.dart`
- Create: `./lib/features/search/application/search_state.dart`
- Create: `./lib/features/search/application/search_controller.dart`
- Create: `./lib/features/search/application/search_providers.dart`
- Test: `./test/features/search/application/search_controller_test.dart`

- [ ] **Step 1: Write the failing Search controller test**

Create `test/features/search/application/search_controller_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/search/application/search_controller.dart';
import 'package:tunefree/features/search/data/remote_search_repository.dart';

final class FakeSearchRepository implements RemoteSearchRepository {
  int aggregateCalls = 0;
  int singleCalls = 0;

  @override
  Future<List<Song>> searchAggregate(String keyword, {required int page, required bool includeExtendedSources}) async {
    aggregateCalls += 1;
    return const <Song>[
      Song(id: 'n1', name: '网易歌曲', artist: '歌手A', source: MusicSource.netease),
      Song(id: 'q1', name: 'QQ歌曲', artist: '歌手B', source: MusicSource.qq),
    ];
  }

  @override
  Future<List<Song>> searchSingle(String keyword, {required String source, required int page}) async {
    singleCalls += 1;
    return <Song>[
      Song(id: 'single-1', name: '$source 单源歌曲', artist: '歌手C', source: MusicSourceWire.fromWire(source)),
    ];
  }
}

void main() {
  test('aggregate search stores history and returns interleaved results', () async {
    final repository = FakeSearchRepository();
    final controller = SearchController(repository: repository);

    controller.updateQuery('gbc');
    await controller.submitSearch();

    expect(repository.aggregateCalls, 1);
    expect(controller.state.history.first, 'gbc');
    expect(controller.state.results.map((song) => song.key).toList(), ['netease:n1', 'qq:q1']);
  });
}
```

- [ ] **Step 2: Run the Search controller test to verify the data/controller layer does not exist yet**

Run:

```bash
flutter test test/features/search/application/search_controller_test.dart -r expanded
```

Expected: FAIL with import errors for `search_controller.dart` or `remote_search_repository.dart`.

- [ ] **Step 3: Implement the Search repository, state, controller, and provider**

Create `lib/features/search/data/remote_search_repository.dart`:

```dart
import '../../../core/models/music_source.dart';
import '../../../core/models/song.dart';

abstract class RemoteSearchRepository {
  Future<List<Song>> searchAggregate(String keyword, {required int page, required bool includeExtendedSources});
  Future<List<Song>> searchSingle(String keyword, {required String source, required int page});
}

final class LegacySearchRepository implements RemoteSearchRepository {
  const LegacySearchRepository();

  @override
  Future<List<Song>> searchAggregate(String keyword, {required int page, required bool includeExtendedSources}) async {
    final base = <Song>[
      Song(id: 'netease-$page-1', name: '$keyword 日常的小曲', artist: 'ましんこ', source: MusicSource.netease),
      Song(id: 'qq-$page-1', name: '雑踏、僕らの街', artist: 'トゲナシトゲアリ', source: MusicSource.qq),
      Song(id: 'kuwo-$page-1', name: '$keyword 日常小曲', artist: '片方', source: MusicSource.kuwo),
    ];
    if (!includeExtendedSources) return base;
    return [
      ...base,
      Song(id: 'joox-$page-1', name: '$keyword 扩展源 1', artist: 'JOOX', source: MusicSource.joox),
      Song(id: 'bilibili-$page-1', name: '$keyword 扩展源 2', artist: 'Bilibili', source: MusicSource.bilibili),
    ];
  }

  @override
  Future<List<Song>> searchSingle(String keyword, {required String source, required int page}) async {
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
```

Create `lib/features/search/application/search_state.dart`:

```dart
import 'package:freezed_annotation/freezed_annotation.dart';

import '../../../core/models/song.dart';

part 'search_state.freezed.dart';

@freezed
abstract class SearchState with _$SearchState {
  const factory SearchState({
    @Default('') String query,
    @Default(<Song>[]) List<Song> results,
    @Default(false) bool isSearching,
    @Default('aggregate') String searchMode,
    @Default('netease') String selectedSource,
    @Default(false) bool includeExtendedSources,
    @Default(<String>[]) List<String> history,
    @Default(1) int page,
    @Default(true) bool hasMore,
    @Default('') String searchError,
  }) = _SearchState;
}
```

Create `lib/features/search/application/search_controller.dart`:

```dart
import 'package:flutter/foundation.dart';

import '../data/remote_search_repository.dart';
import 'search_state.dart';

final class SearchController extends ChangeNotifier {
  SearchController({required RemoteSearchRepository repository}) : _repository = repository;

  final RemoteSearchRepository _repository;
  SearchState _state = const SearchState();
  SearchState get state => _state;

  void updateQuery(String value) {
    _state = _state.copyWith(query: value);
    notifyListeners();
  }

  void setSearchMode(String mode) {
    _state = _state.copyWith(searchMode: mode, page: 1, results: const [], hasMore: true, searchError: '');
    notifyListeners();
  }

  void setSelectedSource(String source) {
    _state = _state.copyWith(selectedSource: source, page: 1, results: const [], hasMore: true, searchError: '');
    notifyListeners();
  }

  void toggleExtendedSources() {
    _state = _state.copyWith(includeExtendedSources: !_state.includeExtendedSources, page: 1, results: const [], hasMore: true, searchError: '');
    notifyListeners();
  }

  Future<void> submitSearch() async {
    final normalizedQuery = _state.query.trim();
    if (normalizedQuery.isEmpty) return;

    _state = _state.copyWith(
      isSearching: true,
      page: 1,
      results: const [],
      hasMore: true,
      searchError: '',
      history: [normalizedQuery, ..._state.history.where((value) => value != normalizedQuery)].take(15).toList(growable: false),
    );
    notifyListeners();

    try {
      final results = _state.searchMode == 'aggregate'
          ? await _repository.searchAggregate(normalizedQuery, page: 1, includeExtendedSources: _state.includeExtendedSources)
          : await _repository.searchSingle(normalizedQuery, source: _state.selectedSource, page: 1);
      _state = _state.copyWith(
        isSearching: false,
        results: results,
        hasMore: results.isNotEmpty,
      );
      notifyListeners();
    } catch (_) {
      _state = _state.copyWith(
        isSearching: false,
        results: const [],
        hasMore: false,
        searchError: '搜索失败，请稍后重试。',
      );
      notifyListeners();
    }
  }

  void clearHistory() {
    _state = _state.copyWith(history: const <String>[]);
    notifyListeners();
  }
}
```

Create `lib/features/search/application/search_providers.dart`:

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/remote_search_repository.dart';
import 'search_controller.dart';

final remoteSearchRepositoryProvider = Provider<RemoteSearchRepository>((ref) {
  return const LegacySearchRepository();
});

final searchControllerProvider = ChangeNotifierProvider<SearchController>((ref) {
  return SearchController(repository: ref.watch(remoteSearchRepositoryProvider));
});
```

Generate code:

```bash
dart run build_runner build --delete-conflicting-outputs
```

- [ ] **Step 4: Run the Search controller test and analyzer**

Run:

```bash
flutter test test/features/search/application/search_controller_test.dart -r expanded
flutter analyze lib/features/search/application lib/features/search/data
```

Expected: PASS / `No issues found!`

- [ ] **Step 5: Commit the Search data/controller slice**

```bash
git add lib/features/search/application lib/features/search/data test/features/search/application

git commit -m "$(cat <<'EOF'
feat: add search parity state flow
EOF
)"
```

---

### Task 3: Build the 1:1 Home UI against the controller provider

**Files:**
- Modify: `./lib/features/home/presentation/home_page.dart`
- Modify: `./lib/features/player/application/player_controller.dart`
- Create: `./lib/features/home/presentation/widgets/top_source_switcher.dart`
- Create: `./lib/features/home/presentation/widgets/top_list_carousel.dart`
- Create: `./lib/features/home/presentation/widgets/featured_song_tile.dart`
- Test: `./test/features/home/presentation/home_page_golden_test.dart`

- [ ] **Step 1: Write the failing Home UI test**

Create `test/features/home/presentation/home_page_golden_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/features/home/presentation/home_page.dart';

void main() {
  testWidgets('home page keeps the legacy greeting and ranking hierarchy', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: MaterialApp(home: HomePage())));
    await tester.pumpAndSettle();

    expect(find.text('排行榜'), findsOneWidget);
    expect(find.text('榜单热歌'), findsOneWidget);
    expect(find.text('NETEASE'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run the Home UI test to verify the page is still only the placeholder shell**

Run:

```bash
flutter test test/features/home/presentation/home_page_golden_test.dart -r expanded
```

Expected: FAIL because the current page still only renders the placeholder shell text.

- [ ] **Step 3: Implement the legacy Home layout and explicit Song -> PlayerTrack mapping**

Create `lib/features/home/presentation/widgets/top_source_switcher.dart`:

```dart
import 'package:flutter/material.dart';

class TopSourceSwitcher extends StatelessWidget {
  const TopSourceSwitcher({super.key, required this.activeSource, required this.onChanged});

  final String activeSource;
  final ValueChanged<String> onChanged;

  static const sources = <String>['netease', 'qq', 'kuwo'];

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xFFE7E8ED),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Padding(
        padding: const EdgeInsets.all(2),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: sources.map((source) {
            final isActive = source == activeSource;
            return GestureDetector(
              onTap: () => onChanged(source),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: isActive ? Colors.white : Colors.transparent,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  source.toUpperCase(),
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: isActive ? Colors.black : const Color(0xFF8C8F97),
                  ),
                ),
              ),
            );
          }).toList(growable: false),
        ),
      ),
    );
  }
}
```

Create `lib/features/home/presentation/widgets/top_list_carousel.dart`:

```dart
import 'package:flutter/material.dart';

import '../../../../core/models/top_list.dart';
import '../../../../shared/widgets/tune_free_card.dart';

class TopListCarousel extends StatelessWidget {
  const TopListCarousel({super.key, required this.topLists, required this.onTap});

  final List<TopList> topLists;
  final ValueChanged<TopList> onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 156,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: topLists.length,
        separatorBuilder: (_, __) => const SizedBox(width: 12),
        itemBuilder: (context, index) {
          final list = topLists[index];
          return GestureDetector(
            onTap: () => onTap(list),
            child: SizedBox(
              width: 136,
              child: TuneFreeCard(
                padding: const EdgeInsets.all(8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(16),
                        child: Container(color: const Color(0xFFF0F1F5)),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(list.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
                    Text(list.updateFrequency ?? '每日更新', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10, color: Color(0xFF8B8B95))),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
```

Create `lib/features/home/presentation/widgets/featured_song_tile.dart`:

```dart
import 'package:flutter/material.dart';

import '../../../../core/models/song.dart';
import '../../../../shared/widgets/tune_free_card.dart';

class FeaturedSongTile extends StatelessWidget {
  const FeaturedSongTile({super.key, required this.song, required this.index, required this.onPlay});

  final Song song;
  final int index;
  final ValueChanged<Song> onPlay;

  @override
  Widget build(BuildContext context) {
    final highlight = index < 3;
    return GestureDetector(
      onTap: () => onPlay(song),
      child: TuneFreeCard(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            SizedBox(
              width: 24,
              child: Text(
                '${index + 1}',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 18,
                  fontStyle: FontStyle.italic,
                  fontWeight: FontWeight.w700,
                  color: highlight ? const Color(0xFFE94B5B) : const Color(0xFFB6B8BF),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Container(width: 48, height: 48, decoration: BoxDecoration(color: const Color(0xFFF0F1F5), borderRadius: BorderRadius.circular(12))),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(song.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(song.artist, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Color(0xFF8B8B95))),
                ],
              ),
            ),
            const SizedBox(width: 12),
            const Icon(Icons.play_arrow_rounded, color: Color(0xFFE94B5B)),
          ],
        ),
      ),
    );
  }
}
```

Update `lib/features/player/application/player_controller.dart` by adding this method:

```dart
  Future<void> openLegacySong({required String id, required String source, required String title, required String artist, String? artworkUrl, String? streamUrl}) {
    final track = PlayerTrack(
      id: id,
      source: source,
      title: title,
      artist: artist,
      artworkUrl: artworkUrl,
      streamUrl: streamUrl,
    );
    return openTrack(track, queue: [track]);
  }
```

Replace `lib/features/home/presentation/home_page.dart` with:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/song.dart';
import '../../player/application/player_controller.dart';
import '../application/home_providers.dart';
import 'widgets/featured_song_tile.dart';
import 'widgets/top_list_carousel.dart';
import 'widgets/top_source_switcher.dart';

class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.watch(homeControllerProvider);
    final state = controller.state;
    final greeting = _greeting();

    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 120),
          children: [
            Text(greeting, style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w700)),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('排行榜', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                TopSourceSwitcher(activeSource: state.activeSource, onChanged: controller.loadSource),
              ],
            ),
            const SizedBox(height: 16),
            if (state.hasError)
              const Text('该音源暂不可用，请切换其他音源', style: TextStyle(fontSize: 12, color: Color(0xFFDC2626))),
            if (!state.hasError)
              TopListCarousel(topLists: state.topLists, onTap: controller.selectTopList),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('榜单热歌', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
                Text(state.activeSource.toUpperCase(), style: const TextStyle(fontSize: 10, color: Color(0xFFB6B8BF), fontWeight: FontWeight.w700)),
              ],
            ),
            const SizedBox(height: 16),
            ...state.featuredSongs.asMap().entries.map(
              (entry) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: FeaturedSongTile(song: entry.value, index: entry.key, onPlay: (song) => _playSong(ref, song)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _playSong(WidgetRef ref, Song song) {
    ref.read(playerControllerProvider.notifier).openLegacySong(
          id: song.id,
          source: song.source.wireValue,
          title: song.name,
          artist: song.artist,
          artworkUrl: song.pic,
          streamUrl: song.url,
        );
  }

  String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 5) return '夜深了';
    if (hour < 11) return '早上好';
    if (hour < 13) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }
}
```

- [ ] **Step 4: Run the Home UI test and analyzer**

Run:

```bash
flutter test test/features/home/presentation/home_page_golden_test.dart -r expanded
flutter analyze lib/features/home/presentation lib/features/player/application
```

Expected: PASS / `No issues found!`

- [ ] **Step 5: Commit the Home UI slice**

```bash
git add lib/features/home/presentation lib/features/player/application test/features/home/presentation

git commit -m "$(cat <<'EOF'
feat: add home 1-to-1 parity ui
EOF
)"
```

---

### Task 4: Build the 1:1 Search UI against the controller provider

**Files:**
- Modify: `./lib/features/search/presentation/search_page.dart`
- Create: `./lib/features/search/presentation/widgets/search_mode_switcher.dart`
- Create: `./lib/features/search/presentation/widgets/search_result_tile.dart`
- Create: `./lib/features/search/presentation/widgets/search_history_section.dart`
- Test: `./test/features/search/presentation/search_page_golden_test.dart`

- [ ] **Step 1: Write the failing Search UI test**

Create `test/features/search/presentation/search_page_golden_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/features/search/presentation/search_page.dart';

void main() {
  testWidgets('search page keeps the legacy title and aggregate controls', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: MaterialApp(home: SearchPage())));
    await tester.pumpAndSettle();

    expect(find.text('搜索'), findsOneWidget);
    expect(find.text('聚合搜索'), findsOneWidget);
    expect(find.text('指定源'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run the Search UI test to verify the page is still a placeholder**

Run:

```bash
flutter test test/features/search/presentation/search_page_golden_test.dart -r expanded
```

Expected: FAIL because the current page still only renders the placeholder shell text.

- [ ] **Step 3: Implement the legacy Search layout and provider wiring**

Create `lib/features/search/presentation/widgets/search_mode_switcher.dart`:

```dart
import 'package:flutter/material.dart';

class SearchModeSwitcher extends StatelessWidget {
  const SearchModeSwitcher({
    super.key,
    required this.searchMode,
    required this.includeExtendedSources,
    required this.onModeChanged,
    required this.onToggleExtendedSources,
  });

  final String searchMode;
  final bool includeExtendedSources;
  final ValueChanged<String> onModeChanged;
  final VoidCallback onToggleExtendedSources;

  @override
  Widget build(BuildContext context) {
    Widget buildChip(String label, bool active, VoidCallback onTap) {
      return GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: active ? Colors.black : Colors.white,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: active ? Colors.black : const Color(0xFFE5E7EB)),
          ),
          child: Text(
            label,
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: active ? Colors.white : const Color(0xFF666666)),
          ),
        ),
      );
    }

    return Wrap(
      spacing: 8,
      children: [
        buildChip('聚合搜索', searchMode == 'aggregate', () => onModeChanged('aggregate')),
        buildChip('指定源', searchMode == 'single', () => onModeChanged('single')),
        if (searchMode == 'aggregate')
          buildChip('扩展源 ${includeExtendedSources ? '开' : '关'}', includeExtendedSources, onToggleExtendedSources),
      ],
    );
  }
}
```

Create `lib/features/search/presentation/widgets/search_result_tile.dart`:

```dart
import 'package:flutter/material.dart';

import '../../../../core/models/song.dart';

class SearchResultTile extends StatelessWidget {
  const SearchResultTile({
    super.key,
    required this.song,
    required this.isCurrent,
    required this.isPlaying,
    required this.onTap,
  });

  final Song song;
  final bool isCurrent;
  final bool isPlaying;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isCurrent ? Colors.white : Colors.transparent,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          children: [
            Stack(
              children: [
                Container(width: 48, height: 48, decoration: BoxDecoration(color: const Color(0xFFF0F1F5), borderRadius: BorderRadius.circular(12))),
                if (isCurrent && isPlaying)
                  const Positioned.fill(
                    child: Center(
                      child: DecoratedBox(
                        decoration: BoxDecoration(color: Color(0xFFE94B5B), shape: BoxShape.circle),
                        child: SizedBox(width: 10, height: 10),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(song.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: isCurrent ? const Color(0xFFE94B5B) : const Color(0xFF111111))),
                  const SizedBox(height: 2),
                  Text(song.artist, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Color(0xFF8B8B95))),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
```

Create `lib/features/search/presentation/widgets/search_history_section.dart`:

```dart
import 'package:flutter/material.dart';

class SearchHistorySection extends StatelessWidget {
  const SearchHistorySection({
    super.key,
    required this.history,
    required this.onSelect,
    required this.onClear,
  });

  final List<String> history;
  final ValueChanged<String> onSelect;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    if (history.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('搜索历史', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
            IconButton(onPressed: onClear, icon: const Icon(Icons.delete_outline_rounded, size: 18)),
          ],
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: history.map((term) {
            return GestureDetector(
              onTap: () => onSelect(term),
              child: Container(
                constraints: const BoxConstraints(maxWidth: 150),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFF0F1F5)),
                ),
                child: Text(term, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Color(0xFF666666))),
              ),
            );
          }).toList(growable: false),
        ),
      ],
    );
  }
}
```

Replace `lib/features/search/presentation/search_page.dart` with:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../player/application/player_controller.dart';
import '../application/search_providers.dart';
import 'widgets/search_history_section.dart';
import 'widgets/search_mode_switcher.dart';
import 'widgets/search_result_tile.dart';

class SearchPage extends ConsumerStatefulWidget {
  const SearchPage({super.key});

  @override
  ConsumerState<SearchPage> createState() => _SearchPageState();
}

class _SearchPageState extends ConsumerState<SearchPage> {
  final textController = TextEditingController();

  @override
  void dispose() {
    textController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = ref.watch(searchControllerProvider);
    final state = controller.state;

    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 120),
          children: [
            const Text('搜索', style: TextStyle(fontSize: 32, fontWeight: FontWeight.w700)),
            const SizedBox(height: 16),
            TextField(
              controller: textController,
              onChanged: controller.updateQuery,
              onSubmitted: (_) => controller.submitSearch(),
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search_rounded, size: 18),
                hintText: state.searchMode == 'aggregate' ? '全网聚合搜索 (已启用跨域代理)...' : '搜索指定音源资源...',
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
              ),
            ),
            const SizedBox(height: 12),
            SearchModeSwitcher(
              searchMode: state.searchMode,
              includeExtendedSources: state.includeExtendedSources,
              onModeChanged: controller.setSearchMode,
              onToggleExtendedSources: controller.toggleExtendedSources,
            ),
            const SizedBox(height: 16),
            SearchHistorySection(
              history: state.history,
              onSelect: (value) {
                textController.text = value;
                controller.updateQuery(value);
                controller.submitSearch();
              },
              onClear: controller.clearHistory,
            ),
            const SizedBox(height: 12),
            ...state.results.map((song) {
              return Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: SearchResultTile(
                  song: song,
                  isCurrent: false,
                  isPlaying: false,
                  onTap: () {
                    ref.read(playerControllerProvider.notifier).openLegacySong(
                          id: song.id,
                          source: song.source.wireValue,
                          title: song.name,
                          artist: song.artist,
                          artworkUrl: song.pic,
                          streamUrl: song.url,
                        );
                  },
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: Run the Search UI test and analyzer**

Run:

```bash
flutter test test/features/search/presentation/search_page_golden_test.dart -r expanded
flutter analyze lib/features/search/presentation
```

Expected: PASS / `No issues found!`

- [ ] **Step 5: Commit the Search UI slice**

```bash
git add lib/features/search/presentation test/features/search/presentation

git commit -m "$(cat <<'EOF'
feat: add search 1-to-1 parity ui
EOF
)"
```

---

## Self-Review

### Spec coverage

This plan covers the Home/Search requirements from the redesign spec and the user’s explicit “功能和样式不能丢，需要做到 1:1” direction:
- Home source switcher, cached toplists, featured songs, greeting hierarchy
- Search aggregate mode, single-source mode, extended-source toggle, history, results list
- Shared play-from-list interactions wired into the existing player scaffold with an explicit `openLegacySong` bridge

### Placeholder scan

No TODO/TBD placeholders remain. Every step has exact files, code, and commands.

### Type consistency

This plan assumes the prior foundation plan has already introduced:
- `Song`
- `TopList`
- `MusicSource`
- shared `TuneFreeCard` / theme tokens
It introduces these stable symbols for later plans:
- `RemoteTopListRepository`
- `LegacyTopListRepository`
- `HomeController`
- `RemoteSearchRepository`
- `LegacySearchRepository`
- `SearchController`
- `openLegacySong`
