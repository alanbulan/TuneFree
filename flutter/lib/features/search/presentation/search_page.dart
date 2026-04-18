import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/song.dart';
import '../../player/application/player_controller.dart';
import '../../player/domain/player_state.dart';
import '../application/search_controller.dart' as search_application;
import '../application/search_providers.dart';
import '../application/search_state.dart';
import 'widgets/search_history_section.dart';
import 'widgets/search_mode_switcher.dart';
import 'widgets/search_result_tile.dart';
import 'widgets/search_source_selector.dart';

const _extendedAggregateSourcesLabel = 'JOOX / Bilibili';
const _gdStudioAttribution = 'GD音乐台 (music.gdstudio.xyz)';
const _gdStudioRateLimitHint = '5 分钟内不超过 50 次请求';
const _gdStudioOnlySources = <String>{'joox', 'bilibili'};

class SearchPage extends ConsumerStatefulWidget {
  const SearchPage({super.key});

  @override
  ConsumerState<SearchPage> createState() => _SearchPageState();
}

class _SearchPageState extends ConsumerState<SearchPage> {
  static const _headerContentSpacing = 16.0;

  final textController = TextEditingController();
  final GlobalKey _headerKey = GlobalKey();
  double _measuredHeaderHeight = 0;

  @override
  void dispose() {
    textController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = ref.watch(searchControllerProvider);
    final state = controller.state;
    final playerState = ref.watch(playerControllerProvider);
    final queryExists = state.query.trim().isNotEmpty;
    final showInitialLoading = state.isSearching && state.results.isEmpty;
    final showLoadMoreSpinner = state.isSearching && state.results.isNotEmpty;
    final showHistory = !queryExists && state.history.isNotEmpty;
    final showEmptyState =
        !state.isSearching &&
        state.results.isEmpty &&
        controller.hasSearchAttemptForCurrentQuery &&
        state.searchError.isEmpty;
    final showLoadMoreButton = !state.isSearching && state.results.isNotEmpty && state.hasMore;
    final searchHint = _buildSearchHint(state);

    _syncTextController(state.query);
    _scheduleHeaderMeasurement();

    final topContentPadding = math.max(_measuredHeaderHeight, _minimumHeaderExtent(state, searchHint));

    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      body: SafeArea(
        child: Stack(
          children: [
            ListView(
              padding: EdgeInsets.fromLTRB(20, topContentPadding + _headerContentSpacing, 20, 120),
              children: [
                if (showHistory) ...[
                  SearchHistorySection(
                    history: state.history,
                    onSelect: (value) {
                      textController.text = value;
                      controller.updateQuery(value);
                      controller.submitSearch();
                    },
                    onClear: controller.clearHistory,
                    onClearRequested: () => _confirmClearHistory(context),
                  ),
                  const SizedBox(height: 12),
                ],
                if (showInitialLoading)
                  const _SearchLoadingSkeleton()
                else
                  _SearchResultsSection(
                    results: state.results,
                    playerState: playerState,
                    showLoadMoreSpinner: showLoadMoreSpinner,
                    showLoadMoreButton: showLoadMoreButton,
                    showEmptyState: showEmptyState,
                    onLoadMore: controller.loadMore,
                    onSongTap: (song) {
                      ref.read(playerControllerProvider.notifier).openLegacySong(
                            id: song.id,
                            source: song.source.wireValue,
                            title: song.name,
                            artist: song.artist,
                            artworkUrl: song.pic,
                            streamUrl: song.url,
                            lyrics: song.lrc,
                          );
                    },
                  ),
              ],
            ),
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: _SearchHeader(
                headerKey: _headerKey,
                textController: textController,
                state: state,
                controller: controller,
                searchHint: searchHint,
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _syncTextController(String query) {
    if (textController.text == query) {
      return;
    }
    textController.value = textController.value.copyWith(
      text: query,
      selection: TextSelection.collapsed(offset: query.length),
      composing: TextRange.empty,
    );
  }

  String _buildSearchHint(SearchState state) {
    if (state.searchMode == 'aggregate' && state.includeExtendedSources) {
      return '已启用扩展聚合：$_extendedAggregateSourcesLabel。速度可能稍慢，并会占用 $_gdStudioAttribution 的公开接口频次。';
    }
    if (state.searchMode == 'single' && _gdStudioOnlySources.contains(state.selectedSource)) {
      return '${searchSourceFullLabel(state.selectedSource)} 使用 $_gdStudioAttribution 公开接口，建议控制频率：$_gdStudioRateLimitHint。';
    }
    return '';
  }

  Future<bool> _confirmClearHistory(BuildContext context) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('清空搜索历史'),
          content: const Text('确定要清空搜索历史吗？'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('取消'),
            ),
            TextButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('清空'),
            ),
          ],
        );
      },
    );
    return result ?? false;
  }

  double _minimumHeaderExtent(SearchState state, String searchHint) {
    final hasBanner = searchHint.isNotEmpty || state.searchError.isNotEmpty;
    return hasBanner ? 260 : 200;
  }

  void _scheduleHeaderMeasurement() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      final context = _headerKey.currentContext;
      final renderObject = context?.findRenderObject();
      if (renderObject is! RenderBox || !renderObject.hasSize) {
        return;
      }
      final nextHeight = renderObject.size.height;
      if ((nextHeight - _measuredHeaderHeight).abs() < 0.5) {
        return;
      }
      setState(() {
        _measuredHeaderHeight = nextHeight;
      });
    });
  }
}

class _SearchHeader extends StatelessWidget {
  const _SearchHeader({
    required this.headerKey,
    required this.textController,
    required this.state,
    required this.controller,
    required this.searchHint,
  });

  final GlobalKey headerKey;
  final TextEditingController textController;
  final SearchState state;
  final search_application.SearchController controller;
  final String searchHint;

  @override
  Widget build(BuildContext context) {
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
        child: Container(
          key: headerKey,
          foregroundDecoration: BoxDecoration(
            color: const Color(0xFFF5F7FA).withValues(alpha: 0.95),
          ),
          child: Container(
            key: const Key('search-header-surface'),
            decoration: const BoxDecoration(
              color: Color(0xFFF5F7FA),
              boxShadow: [
                BoxShadow(
                  color: Color(0x14000000),
                  blurRadius: 16,
                  offset: Offset(0, 6),
                ),
              ],
            ),
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('搜索', style: TextStyle(fontSize: 32, fontWeight: FontWeight.w700)),
                const SizedBox(height: 16),
                TextField(
                  controller: textController,
                  onChanged: controller.updateQuery,
                  onSubmitted: (_) => controller.submitSearch(),
                  decoration: InputDecoration(
                    prefixIcon: const Icon(Icons.search_rounded, size: 18),
                    hintText: state.searchMode == 'aggregate'
                        ? '全网聚合搜索 (已启用跨域代理)...'
                        : '搜索 ${searchSourceFullLabel(state.selectedSource)} 资源...',
                    filled: true,
                    fillColor: Colors.white,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    SearchModeSwitcher(
                      searchMode: state.searchMode,
                      includeExtendedSources: state.includeExtendedSources,
                      onModeChanged: controller.setSearchMode,
                      onToggleExtendedSources: controller.toggleExtendedSources,
                    ),
                    if (state.searchMode == 'single')
                      SearchSourceSelector(
                        selectedSource: state.selectedSource,
                        onSelected: controller.setSelectedSource,
                      ),
                  ],
                ),
                if (searchHint.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _SearchMessageBanner(
                    message: searchHint,
                    backgroundColor: const Color(0xFFFFFBEB),
                    borderColor: const Color(0xFFFDE68A),
                    foregroundColor: const Color(0xFFB45309),
                  ),
                ],
                if (state.searchError.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _SearchMessageBanner(
                    message: state.searchError,
                    backgroundColor: const Color(0xFFFEF2F2),
                    borderColor: const Color(0xFFFECACA),
                    foregroundColor: const Color(0xFFDC2626),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SearchResultsSection extends StatelessWidget {
  const _SearchResultsSection({
    required this.results,
    required this.playerState,
    required this.showLoadMoreSpinner,
    required this.showLoadMoreButton,
    required this.showEmptyState,
    required this.onLoadMore,
    required this.onSongTap,
  });

  final List<Song> results;
  final PlayerState playerState;
  final bool showLoadMoreSpinner;
  final bool showLoadMoreButton;
  final bool showEmptyState;
  final VoidCallback onLoadMore;
  final ValueChanged<Song> onSongTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        ...results.map((song) {
          final isCurrent =
              playerState.currentTrack?.id == song.id && playerState.currentTrack?.source == song.source.wireValue;
          return Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: SearchResultTile(
              song: song,
              isCurrent: isCurrent,
              isPlaying: isCurrent && playerState.isPlaying,
              onTap: () => onSongTap(song),
            ),
          );
        }),
        if (showLoadMoreSpinner)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Center(
              child: SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Color(0xFFE94B5B),
                ),
              ),
            ),
          ),
        if (showLoadMoreButton)
          TextButton(
            onPressed: onLoadMore,
            child: const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Text(
                '查看更多结果',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFF8B8B95),
                ),
              ),
            ),
          ),
        if (showEmptyState)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 48),
            child: Column(
              children: [
                Icon(Icons.music_note_rounded, size: 48, color: Color(0x33111111)),
                SizedBox(height: 12),
                Text(
                  '未找到相关歌曲，请尝试简化关键词',
                  style: TextStyle(fontSize: 14, color: Color(0xFF9CA3AF)),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _SearchMessageBanner extends StatelessWidget {
  const _SearchMessageBanner({
    required this.message,
    required this.backgroundColor,
    required this.borderColor,
    required this.foregroundColor,
  });

  final String message;
  final Color backgroundColor;
  final Color borderColor;
  final Color foregroundColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: borderColor),
      ),
      child: Text(
        message,
        style: TextStyle(fontSize: 12, height: 1.4, color: foregroundColor),
      ),
    );
  }
}

class _SearchLoadingSkeleton extends StatelessWidget {
  const _SearchLoadingSkeleton();

  @override
  Widget build(BuildContext context) {
    return Column(
      key: const Key('search-loading-skeleton'),
      children: List<Widget>.generate(6, (index) {
        return const Padding(
          padding: EdgeInsets.only(bottom: 8),
          child: _SearchLoadingTile(),
        );
      }, growable: false),
    );
  }
}

class _SearchLoadingTile extends StatelessWidget {
  const _SearchLoadingTile();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(16),
      ),
      child: const Row(
        children: [
          _SearchLoadingBlock(width: 48, height: 48, radius: 12),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _SearchLoadingBlock(width: 180, height: 14, radius: 8),
                SizedBox(height: 8),
                _SearchLoadingBlock(width: 96, height: 10, radius: 999),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SearchLoadingBlock extends StatelessWidget {
  const _SearchLoadingBlock({
    required this.width,
    required this.height,
    required this.radius,
  });

  final double width;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: const Color(0xFFE5E7EB),
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}
