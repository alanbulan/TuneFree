import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/models/song.dart';
import '../data/remote_search_repository.dart';
import 'search_state.dart';

const _gdStudioOnlySources = <String>{'joox', 'bilibili'};
const _searchSourceFullLabels = <String, String>{
  'netease': '网易云',
  'qq': 'QQ音乐',
  'kuwo': '酷我音乐',
  'joox': 'JOOX',
  'bilibili': 'Bilibili',
};
const _gdStudioRateLimitHint = '5 分钟内不超过 50 次请求';
const _querySettleDelay = Duration(milliseconds: 800);

final class SearchController extends ChangeNotifier {
  SearchController({required RemoteSearchRepository repository})
      : _repository = repository;

  final RemoteSearchRepository _repository;

  int _requestToken = 0;
  int _queryRevision = 0;
  int _lastSearchAttemptRevision = -1;
  Timer? _querySettleTimer;

  SearchState _state = const SearchState();
  SearchState get state => _state;
  bool get hasSearchAttemptForCurrentQuery =>
      _state.query.trim().isNotEmpty && _lastSearchAttemptRevision == _queryRevision;

  @override
  void dispose() {
    _querySettleTimer?.cancel();
    super.dispose();
  }

  void updateQuery(String value) {
    _cancelQuerySettleTimer();
    final nextQuery = value.trim();
    final currentQuery = _state.query.trim();
    if (nextQuery != currentQuery) {
      _queryRevision += 1;
    }

    if (nextQuery.isEmpty) {
      _invalidateActiveRequest();
      _state = _state.copyWith(
        query: value,
        isSearching: false,
        page: 1,
        results: const <Song>[],
        hasMore: true,
        searchError: '',
      );
      notifyListeners();
      return;
    }

    _state = _state.copyWith(query: value);
    notifyListeners();
    _scheduleSettledQuerySearch();
  }

  void setSearchMode(String mode) {
    _cancelQuerySettleTimer();
    _invalidateActiveRequest();
    _state = _resetVisibleResults(_state.copyWith(searchMode: mode));
    notifyListeners();
    _retrySettledQueryIfPresent();
  }

  void setSelectedSource(String source) {
    _cancelQuerySettleTimer();
    _invalidateActiveRequest();
    _state = _resetVisibleResults(_state.copyWith(selectedSource: source));
    notifyListeners();
    _retrySettledQueryIfPresent();
  }

  void toggleExtendedSources() {
    _cancelQuerySettleTimer();
    _invalidateActiveRequest();
    _state = _resetVisibleResults(
      _state.copyWith(includeExtendedSources: !_state.includeExtendedSources),
    );
    notifyListeners();
    _retrySettledQueryIfPresent();
  }

  Future<void> submitSearch() async {
    _cancelQuerySettleTimer();
    final normalizedQuery = _state.query.trim();
    if (normalizedQuery.isEmpty) {
      updateQuery(_state.query);
      return;
    }

    _lastSearchAttemptRevision = _queryRevision;

    await _performSearch(
      normalizedQuery: normalizedQuery,
      page: 1,
      appendResults: false,
      history: <String>[
        normalizedQuery,
        ..._state.history.where((value) => value != normalizedQuery),
      ].take(15).toList(growable: false),
    );
  }

  Future<void> loadMore() async {
    final normalizedQuery = _state.query.trim();
    if (normalizedQuery.isEmpty || _state.isSearching || !_state.hasMore) {
      return;
    }

    await _performSearch(
      normalizedQuery: normalizedQuery,
      page: _state.page + 1,
      appendResults: true,
    );
  }

  void clearHistory() {
    _state = _state.copyWith(history: const <String>[]);
    notifyListeners();
  }

  Future<void> _performSearch({
    required String normalizedQuery,
    required int page,
    required bool appendResults,
    List<String>? history,
  }) async {
    final requestToken = _nextRequestToken();
    final searchMode = _state.searchMode;
    final includeExtendedSources = _state.includeExtendedSources;
    final selectedSource = _state.selectedSource;
    final previousResults = _state.results;
    final previousPage = _state.page;

    _state = _state.copyWith(
      isSearching: true,
      page: page,
      results: appendResults ? previousResults : const <Song>[],
      hasMore: true,
      searchError: '',
      history: history ?? _state.history,
    );
    notifyListeners();

    try {
      final results = await _searchSongs(
        normalizedQuery,
        page: page,
        searchMode: searchMode,
        includeExtendedSources: includeExtendedSources,
        selectedSource: selectedSource,
      );
      if (!_isLatestRequest(requestToken)) {
        return;
      }

      _state = _state.copyWith(
        isSearching: false,
        page: page,
        results: appendResults ? <Song>[...previousResults, ...results] : results,
        hasMore: results.isNotEmpty,
      );
      notifyListeners();
    } catch (_) {
      if (!_isLatestRequest(requestToken)) {
        return;
      }

      _state = _state.copyWith(
        isSearching: false,
        page: appendResults ? previousPage : 1,
        results: appendResults ? previousResults : const <Song>[],
        hasMore: false,
        searchError: _buildSearchError(
          searchMode: searchMode,
          selectedSource: selectedSource,
        ),
      );
      notifyListeners();
    }
  }

  Future<List<Song>> _searchSongs(
    String normalizedQuery, {
    required int page,
    required String searchMode,
    required bool includeExtendedSources,
    required String selectedSource,
  }) {
    return searchMode == 'aggregate'
        ? _repository.searchAggregate(
            normalizedQuery,
            page: page,
            includeExtendedSources: includeExtendedSources,
          )
        : _repository.searchSingle(
            normalizedQuery,
            source: selectedSource,
            page: page,
          );
  }

  void _scheduleSettledQuerySearch() {
    _querySettleTimer = Timer(_querySettleDelay, _retrySettledQueryIfPresent);
  }

  void _retrySettledQueryIfPresent() {
    final normalizedQuery = _state.query.trim();
    if (normalizedQuery.isEmpty) {
      return;
    }
    unawaited(submitSearch());
  }

  void _cancelQuerySettleTimer() {
    _querySettleTimer?.cancel();
    _querySettleTimer = null;
  }

  SearchState _resetVisibleResults(SearchState state) {
    return state.copyWith(
      isSearching: false,
      page: 1,
      results: const <Song>[],
      hasMore: true,
      searchError: '',
    );
  }

  String _buildSearchError({
    required String searchMode,
    required String selectedSource,
  }) {
    if (searchMode == 'single' && _gdStudioOnlySources.contains(selectedSource)) {
      return '${_searchSourceFullLabels[selectedSource] ?? selectedSource} 当前不可用，或可能触发了公开接口频控（$_gdStudioRateLimitHint）。';
    }
    return '搜索失败，请稍后重试。';
  }

  int _nextRequestToken() => ++_requestToken;

  void _invalidateActiveRequest() {
    _requestToken += 1;
  }

  bool _isLatestRequest(int requestToken) => requestToken == _requestToken;
}
