import 'package:material_ui/material_ui.dart';
import '../../../../shared/theme/tune_free_palette.dart';

import '../../../../core/models/song.dart';
import '../../../../shared/widgets/music_network_image.dart';
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
    final colors = TuneFreeColors.of(context);
    final badgeColors = searchSourceBadgeColors(
      song.source.wireValue,
      TuneFreeColors.of(context),
    );

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          key: isCurrent ? Key('search-result-current-${song.key}') : null,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: isCurrent ? Colors.white : Colors.transparent,
            borderRadius: BorderRadius.circular(14),
            boxShadow: isCurrent
                ? [
                    BoxShadow(
                      color: colors.accentSoft,
                      blurRadius: 12,
                      offset: Offset(0, 4),
                    ),
                  ]
                : null,
            border: isCurrent
                ? Border.all(color: colors.accentSoft)
                : null,
          ),
          child: Row(
            children: [
              Stack(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: _SearchResultArtwork(song: song),
                  ),
                  if (isCurrent && isPlaying)
                    Positioned.fill(
                      child: Container(
                        key: Key('search-result-playing-indicator-${song.key}'),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Center(
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: colors.accent,
                              shape: BoxShape.circle,
                            ),
                            child: SizedBox(width: 12, height: 12),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      song.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                        color: isCurrent
                            ? colors.accent
                            : colors.textStrong,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 5,
                            vertical: 2,
                          ),
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
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            song.artist,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 11,
                              color: colors.textSubtle,
                            ),
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
      return MusicNetworkImage(
        imageUrl,
        key: Key('search-result-artwork-${song.key}'),
        width: 44,
        height: 44,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stackTrace) =>
            _FallbackArtwork(song: song),
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
    final colors = TuneFreeColors.of(context);
    return Container(
      key: Key('search-result-fallback-${song.key}'),
      width: 44,
      height: 44,
      decoration: BoxDecoration(
        color: colors.fillSubtle,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Icon(
        Icons.music_note_rounded,
        size: 22,
        color: colors.lyricInactive,
      ),
    );
  }
}
