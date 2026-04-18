import 'package:flutter/material.dart';

import '../../../../core/models/playlist.dart';

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
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: playlists.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 16,
        crossAxisSpacing: 16,
        childAspectRatio: 1,
      ),
      itemBuilder: (context, index) {
        final playlist = playlists[index];
        return GestureDetector(
          onTap: () => onTap(playlist),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(24),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Icon(Icons.folder_rounded, color: Color(0xFFE94B5B), size: 28),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      playlist.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                    ),
                    Text(
                      '${playlist.songs.length} 首歌曲',
                      style: const TextStyle(fontSize: 12, color: Color(0xFF8B8B95)),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
