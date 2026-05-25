import 'package:flutter/foundation.dart';

import '../../../core/models/song.dart';
import '../../../core/models/top_list.dart';
import '../data/remote_top_list_repository.dart';
import 'home_state.dart';

final class HomeController extends ChangeNotifier {
  HomeController({required RemoteTopListRepository repository})
    : _repository = repository;

  static const _cacheTtl = Duration(minutes: 3);

  final RemoteTopListRepository _repository;
  final Map<String, _CachedValue<List<TopList>>> _listCache =
      <String, _CachedValue<List<TopList>>>{};
  final Map<String, _CachedValue<List<Song>>> _detailCache =
      <String, _CachedValue<List<Song>>>{};

  int _requestToken = 0;

  HomeState _state = const HomeState();
  HomeState get state => _state;

  Future<void> loadSource(String source) async {
    final requestToken = _nextRequestToken();
    final cachedLists = _freshValue(_listCache[source]);
    if (cachedLists != null && cachedLists.isNotEmpty) {
      final firstList = cachedLists.first;
      final detailKey = '$source:${firstList.id}';
      final cachedSongs = _freshValue(_detailCache[detailKey]);
      _state = _state.copyWith(
        activeSource: source,
        topLists: cachedLists,
        featuredSongs: cachedSongs ?? const <Song>[],
        selectedTopListId: firstList.id,
        selectedTopListName: firstList.name,
        listsLoading: false,
        songsLoading: cachedSongs == null,
        hasError: false,
      );
      notifyListeners();
      if (cachedSongs != null) return;
    } else {
      _state = _state.copyWith(
        activeSource: source,
        topLists: const <TopList>[],
        featuredSongs: const <Song>[],
        selectedTopListId: null,
        selectedTopListName: null,
        listsLoading: true,
        songsLoading: true,
        hasError: false,
      );
      notifyListeners();
    }

    try {
      final lists = await _repository.getTopLists(source);
      if (!_isLatestRequest(requestToken)) {
        return;
      }
      _listCache[source] = _CachedValue(lists, DateTime.now());
      if (lists.isEmpty) {
        _state = _state.copyWith(
          activeSource: source,
          topLists: const <TopList>[],
          featuredSongs: const <Song>[],
          selectedTopListId: null,
          selectedTopListName: null,
          listsLoading: false,
          songsLoading: false,
          hasError: true,
        );
        notifyListeners();
        return;
      }

      final selectedList = lists.first;
      final songs = await _loadSongs(source, selectedList.id);
      if (!_isLatestRequest(requestToken)) {
        return;
      }
      _state = _state.copyWith(
        activeSource: source,
        topLists: lists,
        featuredSongs: songs,
        selectedTopListId: selectedList.id,
        selectedTopListName: selectedList.name,
        listsLoading: false,
        songsLoading: false,
        hasError: false,
      );
      notifyListeners();
    } catch (_) {
      if (!_isLatestRequest(requestToken)) {
        return;
      }
      _state = _state.copyWith(
        activeSource: source,
        topLists: const <TopList>[],
        featuredSongs: const <Song>[],
        selectedTopListId: null,
        selectedTopListName: null,
        listsLoading: false,
        songsLoading: false,
        hasError: true,
      );
      notifyListeners();
    }
  }

  Future<void> selectTopList(TopList list) async {
    final source = _state.activeSource;
    final requestToken = _nextRequestToken();
    _state = _state.copyWith(
      selectedTopListId: list.id,
      selectedTopListName: list.name,
      songsLoading: true,
      hasError: false,
    );
    notifyListeners();
    try {
      final songs = await _loadSongs(source, list.id);
      if (!_isLatestRequest(requestToken)) {
        return;
      }
      _state = _state.copyWith(featuredSongs: songs, songsLoading: false);
      notifyListeners();
    } catch (_) {
      if (!_isLatestRequest(requestToken)) {
        return;
      }
      _state = _state.copyWith(songsLoading: false, hasError: true);
      notifyListeners();
    }
  }

  Future<List<Song>> _loadSongs(String source, String id) async {
    final key = '$source:$id';
    final cached = _freshValue(_detailCache[key]);
    if (cached != null) return cached;
    final songs = await _repository.getTopListDetail(source, id);
    final sliced = songs.take(20).toList(growable: false);
    _detailCache[key] = _CachedValue(sliced, DateTime.now());
    return sliced;
  }

  T? _freshValue<T>(_CachedValue<T>? cachedValue) {
    if (cachedValue == null) {
      return null;
    }
    if (DateTime.now().difference(cachedValue.storedAt) > _cacheTtl) {
      return null;
    }
    return cachedValue.value;
  }

  int _nextRequestToken() => ++_requestToken;

  bool _isLatestRequest(int requestToken) {
    return !_disposed && requestToken == _requestToken;
  }

  bool _disposed = false;

  @override
  void dispose() {
    _disposed = true;
    _nextRequestToken();
    super.dispose();
  }
}

final class _CachedValue<T> {
  const _CachedValue(this.value, this.storedAt);

  final T value;
  final DateTime storedAt;
}
