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
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: const Color(0xFFF0F1F5),
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    song.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    song.artist,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, color: Color(0xFF8B8B95)),
                  ),
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
