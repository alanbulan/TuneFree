import 'package:flutter/material.dart';

import '../../../../core/models/top_list.dart';
import '../../../../core/network/music_url_normalizer.dart';
import '../../../../shared/theme/tune_free_palette.dart';

class TopListCarousel extends StatelessWidget {
  const TopListCarousel({
    super.key,
    required this.topLists,
    required this.selectedId,
    required this.onTap,
  });

  final List<TopList> topLists;
  final String? selectedId;
  final ValueChanged<TopList> onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 185,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: topLists.length,
        separatorBuilder: (context, index) => const SizedBox(width: 12),
        itemBuilder: (context, index) {
          final list = topLists[index];
          final isSelected = list.id == selectedId;

          return GestureDetector(
            onTap: () => onTap(list),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: 140,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: TuneFreePalette.surface,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: isSelected
                      ? TuneFreePalette.accent
                      : Colors.transparent,
                  width: 1.2,
                ),
                boxShadow: [
                  if (isSelected)
                    BoxShadow(
                      color: TuneFreePalette.accent.withValues(alpha: 0.1),
                      blurRadius: 0,
                      spreadRadius: 2,
                    ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: _TopListArtwork(list: list)),
                  const SizedBox(height: 8),
                  Text(
                    list.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    list.updateFrequency ?? '每日更新',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 10,
                      color: TuneFreePalette.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _TopListArtwork extends StatelessWidget {
  const _TopListArtwork({required this.list});

  final TopList list;

  @override
  Widget build(BuildContext context) {
    final artworkUrl = (list.coverImgUrl ?? list.picUrl)?.trim();

    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (artworkUrl == null || artworkUrl.isEmpty)
            const ColoredBox(
              color: Color(0xFFF0F1F5),
              child: Icon(
                Icons.music_note_rounded,
                color: Color(0xFFB6B8BF),
                size: 32,
              ),
            )
          else
            Image.network(
              artworkUrl,
              key: Key('top-list-artwork-${list.id}'),
              fit: BoxFit.cover,
              headers: musicImageRequestHeaders(artworkUrl),
              errorBuilder: (context, error, stackTrace) {
                return const ColoredBox(
                  color: Color(0xFFF0F1F5),
                  child: Icon(
                    Icons.music_note_rounded,
                    color: Color(0xFFB6B8BF),
                    size: 32,
                  ),
                );
              },
            ),
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.bottomCenter,
                end: Alignment.topCenter,
                colors: [Color(0x66000000), Color(0x00000000)],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
