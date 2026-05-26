import 'package:flutter/material.dart';

import '../../../../core/models/song.dart';
import '../../../../shared/widgets/music_network_image.dart';
import '../../../../shared/music_source_display.dart';
import '../../../../shared/theme/tune_free_palette.dart';

class FeaturedSongTile extends StatelessWidget {
  const FeaturedSongTile({
    super.key,
    required this.song,
    required this.index,
    required this.onPlay,
  });

  final Song song;
  final int index;
  final ValueChanged<Song> onPlay;

  @override
  Widget build(BuildContext context) {
    final highlight = index < 3;
    final badgeColors = musicSourceBadgeColors(song.source.wireValue);

    return GestureDetector(
      onTap: () => onPlay(song),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: TuneFreePalette.surface,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.03),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
        ),
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
                  color: highlight
                      ? TuneFreePalette.accent
                      : TuneFreePalette.textSecondary.withValues(alpha: 0.5),
                ),
              ),
            ),
            const SizedBox(width: 12),
            _SongArtwork(artworkUrl: song.pic),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    song.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: badgeColors.background,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          musicSourceBadgeLabel(song.source.wireValue),
                          style: TextStyle(
                            fontSize: 10,
                            color: badgeColors.foreground,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          song.artist,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 12,
                            color: TuneFreePalette.textSecondary,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Container(
              width: 36,
              height: 36,
              decoration: const BoxDecoration(
                color: Color(0xFFF9FAFB),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.play_arrow_rounded,
                color: TuneFreePalette.accent,
                size: 22,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SongArtwork extends StatelessWidget {
  const _SongArtwork({required this.artworkUrl});

  final String? artworkUrl;

  @override
  Widget build(BuildContext context) {
    final resolvedUrl = artworkUrl?.trim();

    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: SizedBox(
        width: 48,
        height: 48,
        child: resolvedUrl == null || resolvedUrl.isEmpty
            ? const _SongArtworkFallback()
            : MusicNetworkImage(
                resolvedUrl,
                key: const Key('featured-song-artwork'),
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) =>
                    const _SongArtworkFallback(),
              ),
      ),
    );
  }
}

class _SongArtworkFallback extends StatelessWidget {
  const _SongArtworkFallback();

  @override
  Widget build(BuildContext context) {
    return const ColoredBox(
      color: Color(0xFFF0F1F5),
      child: Icon(Icons.music_note_rounded, color: Color(0xFFB6B8BF), size: 24),
    );
  }
}
