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

  int _requestToken = 0;

  HomeState _state = const HomeState();
  HomeState get state => _state;

  Future<void> loadSource(String source) async {
    final requestToken = _nextRequestToken();
    final cachedLists = _listCache[source];
    if (cachedLists != null && cachedLists.isNotEmpty) {
      final firstList = cachedLists.first;
      final detailKey = '$source:${firstList.id}';
      final cachedSongs = _detailCache[detailKey];
      _state = _state.copyWith(
        activeSource: source,
        topLists: cachedLists,
        featuredSongs: cachedSongs ?? const <Song>[],
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
      if (!_isLatestRequest(requestToken)) {
        return;
      }
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
      if (!_isLatestRequest(requestToken)) {
        return;
      }
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
    final source = _state.activeSource;
    final requestToken = _nextRequestToken();
    _state = _state.copyWith(songsLoading: true, hasError: false);
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
    final cached = _detailCache[key];
    if (cached != null) return cached;
    final songs = await _repository.getTopListDetail(source, id);
    final sliced = songs.take(20).toList(growable: false);
    _detailCache[key] = sliced;
    return sliced;
  }

  int _nextRequestToken() => ++_requestToken;

  bool _isLatestRequest(int requestToken) => requestToken == _requestToken;
}
