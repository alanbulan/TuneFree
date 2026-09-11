import 'package:material_ui/material_ui.dart';
import '../../../../shared/theme/tune_free_palette.dart';

import '../../../../core/models/playlist.dart';
import '../../../../shared/widgets/music_network_image.dart';

class LibraryPlaylistGrid extends StatelessWidget {
  const LibraryPlaylistGrid({
    super.key,
    required this.playlists,
    required this.onTap,
  });

  final List<Playlist> playlists;
  final ValueChanged<Playlist> onTap;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: playlists.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 12,
        crossAxisSpacing: 12,
        childAspectRatio: 1.08,
      ),
      itemBuilder: (context, index) {
        final playlist = playlists[index];
        final coverUrl = _playlistCoverUrl(playlist);
        final hasCover = coverUrl != null;
        return GestureDetector(
          onTap: () => onTap(playlist),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (hasCover)
                  MusicNetworkImage(
                    coverUrl,
                    width: double.infinity,
                    height: double.infinity,
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) {
                      return const _PlaylistCoverFallback();
                    },
                  )
                else
                  const _PlaylistCoverFallback(),
                if (hasCover)
                  const DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [Color(0x26000000), Color(0xB3000000)],
                      ),
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      Text(
                        playlist.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: hasCover ? Colors.white : Colors.black,
                          height: 1.15,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${playlist.songs.length} 首歌曲',
                        style: TextStyle(
                          fontSize: 12,
                          color: hasCover
                              ? const Color(0xE6FFFFFF)
                              : colors.textSubtle,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

String? _playlistCoverUrl(Playlist playlist) {
  for (final song in playlist.songs) {
    final pic = song.pic?.trim();
    if (pic != null && pic.isNotEmpty) {
      return pic;
    }
  }
  return null;
}

class _PlaylistCoverFallback extends StatelessWidget {
  const _PlaylistCoverFallback();

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Container(
      color: colors.surface,
      padding: const EdgeInsets.all(14),
      alignment: Alignment.topLeft,
      child: Container(
        width: 50,
        height: 50,
        decoration: BoxDecoration(
          color: const Color(0xFFFFEEF1),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Icon(
          Icons.folder_rounded,
          color: colors.accent,
          size: 26,
        ),
      ),
    );
  }
}
