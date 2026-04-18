import 'package:flutter/material.dart';

import '../../../../core/models/song.dart';
import 'search_source_selector.dart';

class SearchResultTile extends StatelessWidget {
  const SearchResultTile({
    super.key,
    required this.song,
    required this.isCurrent,
    required this.isPlaying,
    required this.onTap,
  });

  final Song song;
  final bool isCurrent;
  final bool isPlaying;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final badgeColors = searchSourceBadgeColors(song.source.wireValue);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Container(
          key: isCurrent ? Key('search-result-current-${song.key}') : null,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: isCurrent ? Colors.white : Colors.transparent,
            borderRadius: BorderRadius.circular(16),
            boxShadow: isCurrent
                ? const [
                    BoxShadow(
                      color: Color(0x14E94B5B),
                      blurRadius: 12,
                      offset: Offset(0, 4),
                    ),
                  ]
                : null,
            border: isCurrent ? Border.all(color: const Color(0x33E94B5B)) : null,
          ),
          child: Row(
            children: [
              Stack(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: _SearchResultArtwork(song: song),
                  ),
                  if (isCurrent && isPlaying)
                    Positioned.fill(
                      child: Container(
                        key: Key('search-result-playing-indicator-${song.key}'),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Center(
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: Color(0xFFE94B5B),
                              shape: BoxShape.circle,
                            ),
                            child: SizedBox(width: 12, height: 12),
                          ),
                        ),
                      ),
                    ),
                ],
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
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w500,
                        color: isCurrent ? const Color(0xFFE94B5B) : const Color(0xFF111111),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: badgeColors.background,
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            searchSourceBadgeLabel(song.source.wireValue),
                            style: TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.w700,
                              color: badgeColors.foreground,
                              letterSpacing: 0.3,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            song.artist,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 12, color: Color(0xFF8B8B95)),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SearchResultArtwork extends StatelessWidget {
  const _SearchResultArtwork({required this.song});

  final Song song;

  @override
  Widget build(BuildContext context) {
    final imageUrl = song.pic;
    if (imageUrl != null && imageUrl.isNotEmpty) {
      return Image.network(
        imageUrl,
        key: Key('search-result-artwork-${song.key}'),
        width: 48,
        height: 48,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stackTrace) => _FallbackArtwork(song: song),
      );
    }
    return _FallbackArtwork(song: song);
  }
}

class _FallbackArtwork extends StatelessWidget {
  const _FallbackArtwork({required this.song});

  final Song song;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: Key('search-result-fallback-${song.key}'),
      width: 48,
      height: 48,
      decoration: BoxDecoration(
        color: const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(12),
      ),
      child: const Icon(Icons.music_note_rounded, size: 24, color: Color(0xFFB6B8BF)),
    );
  }
}
