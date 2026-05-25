import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/song.dart';
import '../../../shared/music_source_display.dart';
import '../../../shared/theme/tune_free_palette.dart';
import '../../../shared/theme/tune_free_spacing.dart';
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
    final selectedName = state.selectedTopListName?.trim();
    final sectionTitle = selectedName == null || selectedName.isEmpty
        ? '榜单热歌'
        : '$selectedName · 热歌';

    return Scaffold(
      backgroundColor: TuneFreePalette.background,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            20,
            8,
            20,
            TuneFreeSpacing.shellContentBottomPadding,
          ),
          children: [
            Text(
              greeting,
              style: const TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.w700,
                color: TuneFreePalette.textPrimary,
                letterSpacing: -0.4,
              ),
            ),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  '排行榜',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                ),
                TopSourceSwitcher(
                  activeSource: state.activeSource,
                  onChanged: controller.loadSource,
                ),
              ],
            ),
            const SizedBox(height: 16),
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
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    sectionTitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                _SourceChip(source: state.activeSource),
              ],
            ),
            const SizedBox(height: 16),
            if (state.songsLoading)
              const _SongSkeletonList()
            else if (state.featuredSongs.isEmpty)
              const _HomeEmptyState()
            else
              ...state.featuredSongs.asMap().entries.map(
                (entry) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
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

  String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 5) return '夜深了';
    if (hour < 11) return '早上好';
    if (hour < 13) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }
}

class _SourceChip extends StatelessWidget {
  const _SourceChip({required this.source});

  final String source;

  @override
  Widget build(BuildContext context) {
    final colors = musicSourceBadgeColors(source);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        musicSourceBadgeLabel(source),
        style: TextStyle(
          fontSize: 10,
          color: colors.foreground,
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
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFEF2F2),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFECACA)),
      ),
      child: const Text(
        '该音源暂不可用，请切换其他音源',
        style: TextStyle(
          fontSize: 12,
          color: Color(0xFFDC2626),
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
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 32),
      decoration: BoxDecoration(
        color: TuneFreePalette.surface.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(16),
      ),
      child: const Column(
        children: [
          Text(
            '暂无歌曲数据',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
          ),
          SizedBox(height: 6),
          Text(
            '请尝试切换其他榜单或音源',
            style: TextStyle(
              fontSize: 12,
              color: TuneFreePalette.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

class _TopListSkeleton extends StatelessWidget {
  const _TopListSkeleton();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 185,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: 3,
        separatorBuilder: (context, index) => const SizedBox(width: 12),
        itemBuilder: (context, index) {
          return const SizedBox(width: 140, child: _SkeletonCard());
        },
      ),
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
            padding: EdgeInsets.only(bottom: 12),
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
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: TuneFreePalette.surface,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: _SkeletonBlock(borderRadius: BorderRadius.circular(12)),
          ),
          const SizedBox(height: 8),
          const _SkeletonBlock(width: 92, height: 12),
          const SizedBox(height: 6),
          const _SkeletonBlock(width: 58, height: 10),
        ],
      ),
    );
  }
}

class _SkeletonSongTile extends StatelessWidget {
  const _SkeletonSongTile();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: TuneFreePalette.surface,
        borderRadius: BorderRadius.circular(16),
      ),
      child: const Row(
        children: [
          _SkeletonBlock(width: 24, height: 18),
          SizedBox(width: 12),
          _SkeletonBlock(width: 48, height: 48),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _SkeletonBlock(height: 14),
                SizedBox(height: 8),
                _SkeletonBlock(width: 120, height: 12),
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
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: const Color(0xFFE5E7EB),
        borderRadius: borderRadius ?? BorderRadius.circular(8),
      ),
    );
  }
}
