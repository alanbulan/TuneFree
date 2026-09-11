import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/song.dart';
import '../../../shared/music_source_display.dart';
import '../../../shared/theme/tune_free_palette.dart';
import '../../../shared/theme/tune_free_spacing.dart';
import '../../player/application/player_controller.dart';
import '../../library/application/library_controller.dart';
import '../application/home_providers.dart';
import 'widgets/featured_song_tile.dart';
import 'widgets/top_list_carousel.dart';
import 'widgets/top_source_switcher.dart';

class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = TuneFreeColors.of(context);
    final controller = ref.watch(homeControllerProvider);
    final state = controller.state;
    final greeting = _greeting();
    final selectedName = state.selectedTopListName?.trim();
    final sectionTitle = selectedName == null || selectedName.isEmpty
        ? '榜单热歌'
        : '$selectedName · 热歌';

    return Scaffold(
      backgroundColor: colors.background,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            TuneFreeSpacing.page,
            8,
            TuneFreeSpacing.page,
            TuneFreeSpacing.shellContentBottomPadding,
          ),
          children: [
            Text(
              greeting,
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w700,
                color: colors.textPrimary,
                letterSpacing: -0.4,
              ),
            ),
            const SizedBox(height: 14),
            const _HomeStatsCard(),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  '排行榜',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                ),
                TopSourceSwitcher(
                  activeSource: state.activeSource,
                  onChanged: controller.loadSource,
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (state.hasError)
              const _HomeErrorCard()
            else if (state.listsLoading && state.topLists.isEmpty)
              const _TopListSkeleton()
            else
              TopListCarousel(
                topLists: state.topLists,
                selectedId: state.selectedTopListId,
                onTap: controller.selectTopList,
              ),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    sectionTitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                _SourceChip(source: state.activeSource),
              ],
            ),
            const SizedBox(height: 12),
            _PlaySelectionButton(
              songs: state.featuredSongs,
              label: state.selectedTopListName?.trim().isNotEmpty ?? false
                  ? '播放「${state.selectedTopListName!.trim()}」'
                  : '播放当前榜单',
              onPlay: _playQueue,
            ),
            const SizedBox(height: 12),
            if (state.songsLoading)
              const _SongSkeletonList()
            else if (state.featuredSongs.isEmpty)
              const _HomeEmptyState()
            else
              ...state.featuredSongs.asMap().entries.map(
                (entry) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: FeaturedSongTile(
                    song: entry.value,
                    index: entry.key,
                    onPlay: (song) => _playSong(ref, song, state.featuredSongs),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  void _playSong(WidgetRef ref, Song song, List<Song> queue) {
    ref.read(playerControllerProvider.notifier).playSong(song, queue: queue);
  }

  /// 把当前榜单整个交给播放器，从第一首开始放。
  void _playQueue(WidgetRef ref, List<Song> songs) {
    if (songs.isEmpty) {
      return;
    }
    ref
        .read(playerControllerProvider.notifier)
        .playSong(songs.first, queue: List<Song>.unmodifiable(songs));
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

/// 本地资料库的计数卡，对应 Tauri `HomePanels.tsx` 里的 `home-library-stats`。
///
/// 与 Tauri 的两处差别：
/// - 那边是并排两张卡（hero + 统计）的 `hero-grid`，窄屏才折行。移动端一开始
///   就窄，没必要复制那套两列布局，直接一张横条。
/// - 那边只有「收藏歌曲 / 我的歌单」两项；这里多一项离线缓存 —— 数据本来就在
///   本地，多显示一项不增加任何成本。Tauri 那边要滤掉 `favorites` 这个伪歌单，
///   Flutter 的 playlists 里没有它，直接取长度即可。
class _HomeStatsCard extends ConsumerWidget {
  const _HomeStatsCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = TuneFreeColors.of(context);
    final library = ref.watch(libraryControllerProvider).state;

    return Container(
      key: const Key('home-stats-card'),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Expanded(
            child: _StatEntry(
              label: '收藏歌曲',
              value: library.favorites.length,
              loaded: library.isLoaded,
            ),
          ),
          const _StatDivider(),
          Expanded(
            child: _StatEntry(
              label: '我的歌单',
              value: library.playlists.length,
              loaded: library.isLoaded,
            ),
          ),
          const _StatDivider(),
          Expanded(
            child: _StatEntry(
              label: '离线缓存',
              value: library.downloads.length,
              loaded: library.isLoaded,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatEntry extends StatelessWidget {
  const _StatEntry({
    required this.label,
    required this.value,
    required this.loaded,
  });

  final String label;
  final int value;

  /// 资料库是否已经读完。
  final bool loaded;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Column(
      key: Key('home-stat-$label'),
      children: [
        // 还没读完时显示「—」而不是 0：冷启动那一下闪个 0 会让人以为收藏丢了。
        Text(
          loaded ? '$value' : '—',
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w700,
            color: colors.textPrimary,
            // 数字等宽，计数变化时不会左右跳。
            fontFeatures: const <FontFeature>[FontFeature.tabularFigures()],
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 11, color: colors.textSubtle),
        ),
      ],
    );
  }
}

class _StatDivider extends StatelessWidget {
  const _StatDivider();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 1,
      height: 26,
      color: TuneFreeColors.of(context).borderSubtle,
    );
  }
}

/// 「播放当前榜单」。
///
/// Tauri 把这个按钮放在 hero 卡里，旁边是问候语。这里放在榜单标题下方 ——
/// 要播的就是紧挨着的那张列表，放在它旁边比放在页顶更说得清「播的是什么」。
class _PlaySelectionButton extends StatelessWidget {
  const _PlaySelectionButton({
    required this.songs,
    required this.label,
    required this.onPlay,
  });

  final List<Song> songs;
  final String label;
  final void Function(WidgetRef ref, List<Song> songs) onPlay;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Consumer(
      builder: (context, ref, _) => SizedBox(
        width: double.infinity,
        child: FilledButton.icon(
          key: const Key('home-play-selection-button'),
          onPressed: songs.isEmpty ? null : () => onPlay(ref, songs),
          icon: const Icon(Icons.play_arrow_rounded, size: 20),
          label: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
          style: FilledButton.styleFrom(
            backgroundColor: colors.accent,
            disabledBackgroundColor: colors.fillSubtle,
            disabledForegroundColor: colors.textSubtle,
            padding: const EdgeInsets.symmetric(vertical: 12),
            textStyle: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }
}

class _SourceChip extends StatelessWidget {
  const _SourceChip({required this.source});

  final String source;

  @override
  Widget build(BuildContext context) {
    final badge = musicSourceBadgeColors(source, TuneFreeColors.of(context));

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: badge.background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        musicSourceBadgeLabel(source),
        style: TextStyle(
          fontSize: 10,
          color: badge.foreground,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _HomeErrorCard extends StatelessWidget {
  const _HomeErrorCard();

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.dangerSoft,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.dangerBorder),
      ),
      child: Text(
        '该音源暂不可用，请切换其他音源',
        style: TextStyle(
          fontSize: 12,
          color: colors.danger,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _HomeEmptyState extends StatelessWidget {
  const _HomeEmptyState();

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
      decoration: BoxDecoration(
        color: colors.surface.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Text(
            '暂无歌曲数据',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
          ),
          SizedBox(height: 6),
          Text(
            '请尝试切换其他榜单或音源',
            style: TextStyle(fontSize: 12, color: colors.textSecondary),
          ),
        ],
      ),
    );
  }
}

class _TopListSkeleton extends StatelessWidget {
  const _TopListSkeleton();

  static const _itemSpacing = 10.0;
  static const _minCardWidth = 104.0;
  static const _maxCardWidth = 128.0;
  static const _targetVisibleCards = 3.05;
  static const _cardHeightOffset = 34.0;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final cardWidth =
            ((constraints.maxWidth - (_itemSpacing * 2)) / _targetVisibleCards)
                .clamp(_minCardWidth, _maxCardWidth)
                .toDouble();

        return SizedBox(
          height: cardWidth + _cardHeightOffset,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: 3,
            separatorBuilder: (context, index) =>
                const SizedBox(width: _itemSpacing),
            itemBuilder: (context, index) {
              return SizedBox(width: cardWidth, child: const _SkeletonCard());
            },
          ),
        );
      },
    );
  }
}

class _SongSkeletonList extends StatelessWidget {
  const _SongSkeletonList();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var index = 0; index < 5; index += 1)
          const Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: _SkeletonSongTile(),
          ),
      ],
    );
  }
}

class _SkeletonCard extends StatelessWidget {
  const _SkeletonCard();

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Container(
      padding: const EdgeInsets.all(7),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: _SkeletonBlock(borderRadius: BorderRadius.circular(12)),
          ),
          const SizedBox(height: 6),
          const _SkeletonBlock(width: 82, height: 11),
          const SizedBox(height: 5),
          const _SkeletonBlock(width: 54, height: 9),
        ],
      ),
    );
  }
}

class _SkeletonSongTile extends StatelessWidget {
  const _SkeletonSongTile();

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(14),
      ),
      child: const Row(
        children: [
          _SkeletonBlock(width: 22, height: 16),
          SizedBox(width: 10),
          _SkeletonBlock(width: 44, height: 44),
          SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _SkeletonBlock(height: 13),
                SizedBox(height: 7),
                _SkeletonBlock(width: 112, height: 11),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SkeletonBlock extends StatelessWidget {
  const _SkeletonBlock({this.width, this.height, this.borderRadius});

  final double? width;
  final double? height;
  final BorderRadius? borderRadius;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: colors.borderSubtle,
        borderRadius: borderRadius ?? BorderRadius.circular(8),
      ),
    );
  }
}
