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
              const Text(
                '该音源暂不可用，请切换其他音源',
                style: TextStyle(fontSize: 12, color: Color(0xFFDC2626)),
              ),
            if (!state.hasError)
              TopListCarousel(topLists: state.topLists, onTap: controller.selectTopList),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('榜单热歌', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
                Text(
                  state.activeSource.toUpperCase(),
                  style: const TextStyle(
                    fontSize: 10,
                    color: Color(0xFFB6B8BF),
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            ...state.featuredSongs.asMap().entries.map(
              (entry) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: FeaturedSongTile(
                  song: entry.value,
                  index: entry.key,
                  onPlay: (song) => _playSong(ref, song),
                ),
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
          lyrics: song.lrc,
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
